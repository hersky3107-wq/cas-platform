import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'
import { cleanPerplexityText, kstTodayIso } from '@/lib/jeju/fishery'
import {
  getMarineData,
  resolveBeachNum,
  type MarineWarning,
  type WaveInfo,
  type SunInfo,
} from '@/lib/jeju/marine'
import { recordDebug, type DebugSink } from '@/lib/jeju/debug-capture'

/**
 * 해녀 물질안전 — KHOA (국립해양조사원) 수온/조석/조류 + two-layer safety
 * verdict. ADDITIVE ONLY: imports getMarineData/resolveBeachNum from
 * lib/jeju/marine.ts READ-ONLY (that file is NOT modified by this feature),
 * so 특보/파고/fishing-floor consumers of marine.ts are byte-for-byte
 * unaffected by anything in this file.
 *
 * Sources (apis.data.go.kr/1192136, KHOA):
 *   1. 수온 — surveyWaterTemp/GetSurveyWaterTempApiService (wtem, obsvtrNm, obsrvnDt)
 *   2. 조석 — tideFcstHghLw/GetTideFcstHghLwApiService (predcDt, predcTdlvVl, extrSe)
 *   3. 조류 — crntFcstTime/GetCrntFcstTimeApiService (predcDt, crdir, crsp)
 * Envelope confirmed live: ROOT-level `header`/`body` (NO `response` wrapper
 * — differs from BeachInfoservice/AirKorea/WthrWrn on the same domain).
 * numOfRows defaults to 10 upstream — MUST pass numOfRows=100 to get the
 * full day (23-24 hourly rows / 3-4 tide events).
 *
 * Auth: SAME key as marine.ts (JEJU_DATAGO_KEY → DATA_GO_KR_KEY → KPX_SERVICE_KEY).
 * Never throws; each section degrades to null + errors[] entry.
 *
 * SAFETY VERDICT — two separate layers, kept strictly separate:
 *   LAYER 1 (computeVerdict, below) — pure code, deterministic, no AI input.
 *     This is the ONLY thing that decides the 신호등 color.
 *   LAYER 2 (fetchAiExplanation, below) — Perplexity explains LAYER 1's
 *     already-decided verdict in plain elderly-friendly Korean. Prompted
 *     explicitly to never contradict the verdict. If it fails, the verdict
 *     + raw numbers still render (AI text is enrichment, not required).
 */

const KHOA_BASE = 'https://apis.data.go.kr/1192136'
/** 15s + 1 retry on transient failures only — matches marine.ts/environment.ts. */
const TIMEOUT_MS = 15_000
const RETRY_DELAY_MS = 500
const BODY_SNIPPET = 300
const PERPLEXITY_PROVIDER: ExtendedAiProviderName = 'perplexity'
const AI_MAX_TOKENS = 400

// ── LAYER-1 hard safety thresholds — TUNABLE, first pass, conservative ────────
// Adjust ONLY here. Do not scatter magic numbers elsewhere in this file.
/** 파고(m) ≥ this → 🔴 위험. */
const WAVE_DANGER_M = 1.5
/** 파고(m) ≥ this (and < danger) → 🟡 주의. */
const WAVE_CAUTION_M = 1.0
/** 유속(cm/s, current-hour OR today's max) ≥ this → 🔴 위험. */
const CURRENT_DANGER_CMS = 50
/** 유속(cm/s) ≥ this (and < danger) → 🟡 주의. */
const CURRENT_CAUTION_CMS = 30
/** 수온(°C) < this → 🟡 주의 (저체온 구간). No red tier for temp alone. */
const COLD_WATER_C = 20

// ── Beach → KHOA obsCode mapping ──────────────────────────────────────────────

interface ObsCodes {
  /** 조위관측소 — feeds BOTH 수온(surveyWaterTemp) and 조석(tideFcstHghLw). */
  tideTempCode: string
  /** 조류지점 — feeds 조류(crntFcstTime). Harbor/channel-based, not the beach itself. */
  currentCode: string
}

const OBSCODE_MAP: Record<string, ObsCodes> = {
  '348': { tideTempCode: 'DT_0004', currentCode: '02JJ-1' }, // 이호 → 제주
  '352': { tideTempCode: 'DT_0004', currentCode: '02JJ-1' }, // 함덕 → 제주
  '346': { tideTempCode: 'DT_0004', currentCode: '02JJ-1' }, // 협재 → 제주
  '337': { tideTempCode: 'DT_0010', currentCode: '08JJ07' }, // 중문 → 서귀포
  '342': { tideTempCode: 'DT_0022', currentCode: '08JJ03' }, // 표선 → 성산포
  '341': { tideTempCode: 'DT_0022', currentCode: '08JJ03' }, // 신양 → 성산포
}
/** Fallback for any beachNum outside the 6 mapped haenyeo spots (제주 station). */
const DEFAULT_OBS_CODES: ObsCodes = OBSCODE_MAP['348']

// ── Types ─────────────────────────────────────────────────────────────────────

export interface KhoaWaterTemp {
  tempC: number | null
  /** "HH:mm" of the latest observation row. */
  observedAt: string | null
  stationName: string | null
}

export interface KhoaTideEvent {
  time: string
  levelCm: number | null
  kind: 'high' | 'low'
  label: string
}

export interface KhoaCurrentPoint {
  time: string
  dir: string | null
  speedCmS: number | null
}

export interface KhoaCurrentInfo {
  hourly: KhoaCurrentPoint[]
  /** Speed at the closest hourly point to now (KST). */
  nowSpeedCmS: number | null
  nowDir: string | null
  /** Today's max hourly speed — used for the "later today" safety check. */
  maxSpeedCmS: number | null
  stationName: string | null
}

export type SafetyColor = 'red' | 'yellow' | 'green'

export interface SafetyVerdict {
  color: SafetyColor
  reasons: string[]
}

export interface HaenyeoAiMeta {
  source: '검색'
  retrievedAt: string
  asOf: string | null
}

export interface HaenyeoSafetyPayload {
  ok: true
  spot: string
  beachNum: string
  // Pass-through from getMarineData (lib/jeju/marine.ts — UNMODIFIED). Display only.
  wave: WaveInfo | null
  sun: SunInfo | null
  warnings: MarineWarning[]
  // NEW — KHOA sources (this file).
  waterTemp: KhoaWaterTemp | null
  waterTempStationLabel: string | null
  tideEvents: KhoaTideEvent[] | null
  tideStationLabel: string | null
  current: KhoaCurrentInfo | null
  currentStationLabel: string | null
  // LAYER 1 — code-only verdict. AI (below) can never change this.
  verdict: SafetyVerdict
  // LAYER 2 — AI explanation of the already-decided verdict. May be null.
  aiExplanation: string | null
  aiMeta: HaenyeoAiMeta | null
  updatedAt: string
  errors: string[]
}

export type HaenyeoSafetyResult = HaenyeoSafetyPayload | { ok: false; error: string }

// ── Key + generic fetch helpers (own copies — matches marine.ts/environment.ts convention) ──

function serviceKey(): string {
  return (
    process.env.JEJU_DATAGO_KEY ??
    process.env.DATA_GO_KR_KEY ??
    process.env.KPX_SERVICE_KEY ??
    ''
  )
}

function noDbSupabase(): SupabaseClient {
  return createClient('http://localhost', 'haenyeo-safety-no-db') as unknown as SupabaseClient
}

function asArray<T>(item: unknown): T[] {
  if (Array.isArray(item)) return item as T[]
  if (item === undefined || item === null || item === '') return []
  return [item as T]
}

function parseNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim())
    return Number.isFinite(n) ? n : null
  }
  return null
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim()
}

function bodySnippet(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, BODY_SNIPPET)
}

function redact(url: string): string {
  return url.replace(/serviceKey=[^&]+/i, 'serviceKey=***')
}

async function fetchJsonAttempt(url: string, debugSink?: DebugSink, debugLabel = 'fetch'): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let debugRecorded = false
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; Jeju-Haenyeo/1.0)' },
      cache: 'no-store',
    })
    const text = await res.text()
    if (debugSink?.enabled) {
      recordDebug(debugSink, { label: debugLabel, url: redact(url), status: res.status, bodySnippet: text.slice(0, 1500) })
      debugRecorded = true
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${bodySnippet(text)}`)
    const trimmed = text.trim()
    if (trimmed.startsWith('<')) throw new Error(`XML/error body — ${bodySnippet(trimmed)}`)
    try {
      return JSON.parse(trimmed) as unknown
    } catch {
      throw new Error(`Non-JSON body — ${bodySnippet(trimmed)}`)
    }
  } catch (e: unknown) {
    if (debugSink?.enabled && !debugRecorded) {
      const msg =
        e instanceof Error && e.name === 'AbortError'
          ? `Timeout after ${TIMEOUT_MS}ms`
          : e instanceof Error
            ? e.message
            : String(e)
      recordDebug(debugSink, { label: debugLabel, url: redact(url), status: null, bodySnippet: '', error: msg })
    }
    if (e instanceof Error && e.name === 'AbortError') throw new Error(`Timeout after ${TIMEOUT_MS}ms`)
    throw e instanceof Error ? e : new Error(String(e))
  } finally {
    clearTimeout(timer)
  }
}

function isRetryableFetchError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  if (e.name === 'TypeError') return true
  if (/^Timeout after \d+ms$/.test(e.message)) return true
  if (/^HTTP 5\d\d\b/.test(e.message)) return true
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchJson(url: string, debugSink?: DebugSink, debugLabel = 'fetch'): Promise<unknown> {
  try {
    return await fetchJsonAttempt(url, debugSink, debugLabel)
  } catch (e: unknown) {
    if (!isRetryableFetchError(e)) throw e
    await sleep(RETRY_DELAY_MS)
    return await fetchJsonAttempt(url, debugSink, `${debugLabel}-retry`)
  }
}

function kstYmd(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${kst.getUTCFullYear()}${pad(kst.getUTCMonth() + 1)}${pad(kst.getUTCDate())}`
}

function kstNowIso(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())}` +
    `T${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}:${pad(kst.getUTCSeconds())}+09:00`
  )
}

function kstNowHm(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}`
}

/** "2026-07-10 05:50" / "2026-07-10 09:00:00" / "202607100550" → "HH:mm". */
function extractHm(raw: string): string {
  const s = raw.trim()
  const m = s.match(/(\d{1,2}):(\d{2})/)
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}`
  const digits = s.replace(/\D/g, '')
  if (digits.length >= 12) return `${digits.slice(8, 10)}:${digits.slice(10, 12)}`
  if (digits.length === 4) return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`
  return ''
}

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(':').map((n) => Number(n))
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}

// ── KHOA envelope reader (confirmed live: ROOT header/body, no `response` wrapper) ──

interface KhoaEnvelope {
  header?: { resultCode?: string; resultMsg?: string }
  body?: { items?: { item?: unknown }; totalCount?: number }
}

function readKhoaItems(raw: unknown): Record<string, unknown>[] {
  if (!raw || typeof raw !== 'object') return []
  const item = (raw as KhoaEnvelope).body?.items?.item
  return asArray<Record<string, unknown>>(item)
}

function khoaResultCode(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return ''
  return str((raw as KhoaEnvelope).header?.resultCode)
}

// ── 1. 수온 (surveyWaterTemp) ─────────────────────────────────────────────────

async function fetchKhoaWaterTemp(
  obsCode: string,
  ymd: string,
  key: string,
  debugSink?: DebugSink,
): Promise<{ data: KhoaWaterTemp | null; error?: string }> {
  const params = new URLSearchParams({
    serviceKey: key,
    obsCode,
    reqDate: ymd,
    min: '60',
    type: 'json',
    numOfRows: '100',
    pageNo: '1',
  })
  const url = `${KHOA_BASE}/surveyWaterTemp/GetSurveyWaterTempApiService?${params.toString()}`
  try {
    const raw = await fetchJson(url, debugSink, 'khoa-watertemp')
    const code = khoaResultCode(raw)
    if (code && code !== '00') return { data: null, error: `resultCode ${code}` }
    const items = readKhoaItems(raw)
    if (items.length === 0) return { data: null, error: 'no rows' }
    // Latest obsrvnDt row — string sort works since format is fixed-width "YYYY-MM-DD HH:mm:ss".
    const latest = [...items].sort((a, b) => str(b.obsrvnDt).localeCompare(str(a.obsrvnDt)))[0]
    const tempC = parseNum(latest.wtem)
    if (tempC == null) return { data: null, error: 'no wtem value' }
    return {
      data: {
        tempC,
        observedAt: extractHm(str(latest.obsrvnDt)) || null,
        stationName: str(latest.obsvtrNm) || null,
      },
    }
  } catch (e: unknown) {
    return { data: null, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── 2. 조석 (tideFcstHghLw) ───────────────────────────────────────────────────

/** extrSe → { kind, label }. Some days have only 3 events (normal tidal variation). */
const TIDE_KIND: Record<string, { kind: 'high' | 'low'; label: string }> = {
  '1': { kind: 'high', label: '오전 고조' },
  '2': { kind: 'low', label: '오전 저조' },
  '3': { kind: 'high', label: '오후 고조' },
  '4': { kind: 'low', label: '오후 저조' },
}

async function fetchKhoaTide(
  obsCode: string,
  ymd: string,
  key: string,
  debugSink?: DebugSink,
): Promise<{ data: { events: KhoaTideEvent[]; stationName: string | null } | null; error?: string }> {
  const params = new URLSearchParams({
    serviceKey: key,
    obsCode,
    reqDate: ymd,
    type: 'json',
    numOfRows: '100',
    pageNo: '1',
  })
  const url = `${KHOA_BASE}/tideFcstHghLw/GetTideFcstHghLwApiService?${params.toString()}`
  try {
    const raw = await fetchJson(url, debugSink, 'khoa-tide')
    const code = khoaResultCode(raw)
    if (code && code !== '00') return { data: null, error: `resultCode ${code}` }
    const items = readKhoaItems(raw)
    if (items.length === 0) return { data: null, error: 'no rows' }
    const events = items
      .map((it) => {
        const time = extractHm(str(it.predcDt))
        if (!time) return null
        const meta = TIDE_KIND[str(it.extrSe)]
        return {
          time,
          levelCm: parseNum(it.predcTdlvVl),
          kind: meta?.kind ?? 'high',
          label: meta?.label ?? '조위',
        } as KhoaTideEvent
      })
      .filter((e): e is KhoaTideEvent => e != null)
      .sort((a, b) => a.time.localeCompare(b.time))
    if (events.length === 0) return { data: null, error: 'no parsable tide events' }
    return { data: { events, stationName: str(items[0]?.obsvtrNm) || null } }
  } catch (e: unknown) {
    return { data: null, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── 3. 조류 (crntFcstTime) ────────────────────────────────────────────────────

function pickCurrentNow(hourly: KhoaCurrentPoint[]): KhoaCurrentPoint | null {
  if (hourly.length === 0) return null
  const nowMin = hmToMinutes(kstNowHm())
  let best = hourly[0]
  let bestDiff = Math.abs(hmToMinutes(best.time) - nowMin)
  for (const p of hourly) {
    const diff = Math.abs(hmToMinutes(p.time) - nowMin)
    if (diff < bestDiff) {
      best = p
      bestDiff = diff
    }
  }
  return best
}

async function fetchKhoaCurrent(
  obsCode: string,
  ymd: string,
  key: string,
  debugSink?: DebugSink,
): Promise<{ data: KhoaCurrentInfo | null; error?: string }> {
  const params = new URLSearchParams({
    serviceKey: key,
    obsCode,
    reqDate: ymd,
    min: '60',
    type: 'json',
    numOfRows: '100',
    pageNo: '1',
  })
  const url = `${KHOA_BASE}/crntFcstTime/GetCrntFcstTimeApiService?${params.toString()}`
  try {
    const raw = await fetchJson(url, debugSink, 'khoa-current')
    const code = khoaResultCode(raw)
    if (code && code !== '00') return { data: null, error: `resultCode ${code}` }
    const items = readKhoaItems(raw)
    if (items.length === 0) return { data: null, error: 'no rows' }
    const hourly = items
      .map((it) => ({
        time: extractHm(str(it.predcDt)),
        dir: str(it.crdir) || null,
        speedCmS: parseNum(it.crsp),
      }))
      .filter((p) => p.time)
      .sort((a, b) => a.time.localeCompare(b.time))
    if (hourly.length === 0) return { data: null, error: 'no parsable current points' }
    const speeds = hourly.map((p) => p.speedCmS).filter((v): v is number => v != null)
    const maxSpeedCmS = speeds.length ? Math.max(...speeds) : null
    const now = pickCurrentNow(hourly)
    return {
      data: {
        hourly,
        nowSpeedCmS: now?.speedCmS ?? null,
        nowDir: now?.dir ?? null,
        maxSpeedCmS,
        stationName: str(items[0]?.obsvtrNm) || null,
      },
    }
  } catch (e: unknown) {
    return { data: null, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── LAYER 1 — code-only safety verdict ────────────────────────────────────────

/** Korean word for 물살 strength — display sugar only, does not affect the verdict. */
function currentSpeedWord(speedCmS: number | null): string | null {
  if (speedCmS == null) return null
  if (speedCmS < CURRENT_CAUTION_CMS) return '약함'
  if (speedCmS < CURRENT_DANGER_CMS) return '다소 강함'
  return '매우 강함'
}

/**
 * Pure, deterministic, no AI. This function alone decides the 신호등 color —
 * fetchAiExplanation (LAYER 2) only explains what this already decided.
 */
function computeVerdict(input: {
  warnings: MarineWarning[]
  waveHeightM: number | null
  waterTempC: number | null
  currentSpeedCmS: number | null
  maxCurrentSpeedCmS: number | null
}): SafetyVerdict {
  const reasons: string[] = []
  let color: SafetyColor = 'green'
  const setRed = (r: string) => {
    color = 'red'
    reasons.push(r)
  }
  const setYellow = (r: string) => {
    if (color !== 'red') color = 'yellow'
    reasons.push(r)
  }

  // 풍랑특보 (경보 OR 주의보) → RED, per spec (any-level 풍랑 특보 is red, not just 경보).
  const galeWarnings = input.warnings.filter(
    (w) => w.type.includes('풍랑') && (w.level === '경보' || w.level === '주의보'),
  )
  if (galeWarnings.length > 0) {
    setRed(`${galeWarnings.map((w) => `${w.type}${w.level}`).join(', ')}가 있어요`)
  }
  // Any OTHER 주의보 (any type) → YELLOW (풍랑주의보 already counted as RED above).
  const otherAdvisories = input.warnings.filter((w) => w.level === '주의보' && !galeWarnings.includes(w))
  if (otherAdvisories.length > 0) {
    setYellow(`${otherAdvisories.map((w) => `${w.type}${w.level}`).join(', ')}가 있어요`)
  }

  const wh = input.waveHeightM
  if (wh != null) {
    if (wh >= WAVE_DANGER_M) setRed(`파도 높이 ${wh.toFixed(1)}m — 매우 높아요`)
    else if (wh >= WAVE_CAUTION_M) setYellow(`파도 높이 ${wh.toFixed(1)}m — 주의가 필요해요`)
  }

  const curCandidates = [input.currentSpeedCmS, input.maxCurrentSpeedCmS].filter((v): v is number => v != null)
  const curPeak = curCandidates.length ? Math.max(...curCandidates) : null
  if (curPeak != null) {
    if (curPeak >= CURRENT_DANGER_CMS) setRed(`물살이 매우 강해요 (${Math.round(curPeak)}cm/s)`)
    else if (curPeak >= CURRENT_CAUTION_CMS) setYellow(`물살이 강해요 (${Math.round(curPeak)}cm/s)`)
  }

  const wt = input.waterTempC
  if (wt != null && wt < COLD_WATER_C) {
    setYellow(`수온 ${wt}°C — 저체온에 주의하세요`)
  }

  if (reasons.length === 0) reasons.push('특별한 위험 신호가 없어요')
  return { color, reasons }
}

// ── LAYER 2 — AI explanation of the already-decided verdict ──────────────────

const VERDICT_KO: Record<SafetyColor, string> = { red: '위험', yellow: '주의', green: '양호' }

function buildAiSystemPrompt(): string {
  return (
    '당신은 제주 해녀들을 위한 물질 안전 도우미입니다. ' +
    '아래 판정(색)은 이미 code로 확정되었고, 당신은 이 판정을 절대 뒤집거나 완화하지 말고 이유만 설명하세요. ' +
    '판정이 위험이면 반드시 물질을 피하라는 취지로, 주의면 조심하라는 취지로, 양호면 괜찮다는 취지로만 말하세요. ' +
    '판정과 반대되거나 판정을 완화하는 말은 절대 하지 마세요. ' +
    '반드시 순수 한글(표준 한국어)로만 작성하세요 — 한자, 영어 단어, 일본어, 중국어, 러시아어 등 ' +
    '다른 문자나 외국어를 단 한 글자도 섞지 마세요. 예: "事故"나 "強硬한" 같은 한자 혼용은 절대 금지입니다. ' +
    '2~3문장, 어르신도 이해하기 쉬운 따뜻하고 쉬운 표현을 쓰세요. ' +
    '수온이 낮으면 저체온 주의를 언급하고, 물살(조류)은 숫자 대신 "약함/보통/강함" 같은 말로 표현하고, ' +
    '간조 시각 무렵이 물질에 좋고 만조 시각은 피하는 게 좋다는 점을 알려주고, ' +
    '기상특보가 있으면 짧게 언급하세요. ' +
    '인용 번호([1][2] 등)와 한자·중문·일문 문장부호(。「」 등)는 쓰지 마세요.'
  )
}

/** Hangul syllables/jamo + common punctuation/whitespace/digits/°C — everything
 *  ELSE (Han ideographs, Hiragana/Katakana, Cyrillic, Latin letters) is treated
 *  as script contamination from the model and disqualifies the whole response,
 *  since a half-Korean half-foreign sentence is worse for elderly readers than
 *  no AI text at all (LAYER 1's verdict + raw numbers still render either way). */
/**
 * Exported so OTHER chips' Perplexity-enrichment text (e.g. the prices chip's
 * 생활물가 요약) can reuse the same non-Korean-script contamination check
 * instead of duplicating it — matches this module's own AI-explanation gate.
 */
export function hasForeignScriptContamination(text: string): boolean {
  const stripped = text.replace(
    /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F\s0-9.,~%()°※·\-!?"'…:/]/g,
    '',
  )
  return stripped.length > 0
}

function buildAiPrompt(input: {
  spot: string
  verdict: SafetyVerdict
  waterTempC: number | null
  tideEvents: KhoaTideEvent[] | null
  currentWord: string | null
  waveHeightM: number | null
  warnings: MarineWarning[]
}): string {
  const tideText = input.tideEvents?.length
    ? input.tideEvents.map((e) => `${e.label} ${e.time}(${e.levelCm ?? '?'}cm)`).join(', ')
    : '정보 없음'
  const warnText = input.warnings.length ? input.warnings.map((w) => `${w.type}${w.level}`).join(', ') : '없음'
  return [
    `오늘 ${input.spot} 해녀 물질 판정은 이미 [${VERDICT_KO[input.verdict.color]}]로 확정됐습니다.`,
    `확정 이유: ${input.verdict.reasons.join('; ')}`,
    `수온: ${input.waterTempC != null ? `${input.waterTempC}°C` : '정보 없음'}`,
    `물때(조석): ${tideText}`,
    `물살(조류) 상태: ${input.currentWord ?? '정보 없음'}`,
    `파도 높이: ${input.waveHeightM != null ? `${input.waveHeightM.toFixed(1)}m` : '정보 없음'}`,
    `기상특보: ${warnText}`,
    '이 판정을 뒤집지 말고, 위 정보를 바탕으로 오늘 물질 조건을 2~3문장으로 설명해 주세요.',
  ].join('\n')
}

async function fetchAiExplanation(input: {
  spot: string
  verdict: SafetyVerdict
  waterTempC: number | null
  tideEvents: KhoaTideEvent[] | null
  currentSpeedWord: string | null
  waveHeightM: number | null
  warnings: MarineWarning[]
}): Promise<{ text: string | null; meta: HaenyeoAiMeta | null }> {
  const retrievedAt = kstNowIso()
  try {
    const r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: PERPLEXITY_PROVIDER,
      prompt: buildAiPrompt({ ...input, currentWord: input.currentSpeedWord }),
      systemPrompt: buildAiSystemPrompt(),
      maxCompletionTokens: AI_MAX_TOKENS,
      timeoutMs: TIMEOUT_MS,
      skipLanguageInjection: true,
    })
    if (r.error || !r.text?.trim()) return { text: null, meta: null }
    const cleaned = cleanPerplexityText(r.text)
    // Discard rather than show elders a half-Korean/half-foreign-script sentence —
    // the verdict + raw numbers already render regardless (this is enrichment only).
    if (hasForeignScriptContamination(cleaned)) return { text: null, meta: null }
    return { text: cleaned, meta: { source: '검색', retrievedAt, asOf: kstTodayIso() } }
  } catch {
    return { text: null, meta: null }
  }
}

// ── Display-only extras for OTHER chips (e.g. fishing) ────────────────────────

export interface MarineDisplayExtras {
  waterTemp: KhoaWaterTemp | null
  waterTempStationLabel: string | null
  tideEvents: KhoaTideEvent[] | null
  tideStationLabel: string | null
  errors: string[]
}

/**
 * DISPLAY-ONLY 수온/조석 for chips that want the same KHOA data the haenyeo
 * chip shows, WITHOUT its wave/warnings fetch, safety verdict, or AI
 * explanation — e.g. the fishing chip's "바다 안전" card fact grid.
 * Reuses fetchKhoaWaterTemp/fetchKhoaTide (same functions getHaenyeoSafety
 * uses below) — no duplicate fetch logic. Never throws.
 *
 * CALLERS MUST NOT feed this into any verdict/safety-floor calculation —
 * it exists purely to fill in previously-empty display fields.
 */
export async function getMarineDisplayExtras(
  spot?: string | null,
  debugSink?: DebugSink,
): Promise<MarineDisplayExtras> {
  const key = serviceKey()
  if (!key) {
    return {
      waterTemp: null,
      waterTempStationLabel: null,
      tideEvents: null,
      tideStationLabel: null,
      errors: ['JEJU_DATAGO_KEY (or DATA_GO_KR_KEY / KPX_SERVICE_KEY) is not set'],
    }
  }

  const beachNum = resolveBeachNum(spot)
  const obsCodes = OBSCODE_MAP[beachNum] ?? DEFAULT_OBS_CODES
  const ymd = kstYmd()
  const errors: string[] = []

  const [waterTempSettled, tideSettled] = await Promise.allSettled([
    fetchKhoaWaterTemp(obsCodes.tideTempCode, ymd, key, debugSink),
    fetchKhoaTide(obsCodes.tideTempCode, ymd, key, debugSink),
  ])

  let waterTemp: KhoaWaterTemp | null = null
  if (waterTempSettled.status === 'fulfilled') {
    waterTemp = waterTempSettled.value.data
    if (waterTempSettled.value.error) errors.push(`waterTemp: ${waterTempSettled.value.error}`)
  } else {
    errors.push(`waterTemp: ${waterTempSettled.reason instanceof Error ? waterTempSettled.reason.message : String(waterTempSettled.reason)}`)
  }

  let tideEvents: KhoaTideEvent[] | null = null
  let tideStationName: string | null = null
  if (tideSettled.status === 'fulfilled') {
    tideEvents = tideSettled.value.data?.events ?? null
    tideStationName = tideSettled.value.data?.stationName ?? null
    if (tideSettled.value.error) errors.push(`tide: ${tideSettled.value.error}`)
  } else {
    errors.push(`tide: ${tideSettled.reason instanceof Error ? tideSettled.reason.message : String(tideSettled.reason)}`)
  }

  return {
    waterTemp,
    waterTempStationLabel: waterTemp?.stationName ? `${waterTemp.stationName} 관측소 기준` : null,
    tideEvents,
    tideStationLabel: tideStationName ? `${tideStationName} 관측소 기준` : null,
    errors,
  }
}

// ── Public entry ──────────────────────────────────────────────────────────────

/**
 * Fetch the full haenyeo safety payload for a beach spot. Never throws.
 * Reuses getMarineData (marine.ts, UNMODIFIED) for wave/sun/warnings, adds
 * KHOA 수온/조석/조류, computes the LAYER-1 code verdict, then asks
 * Perplexity (LAYER 2) to explain — never override — that verdict.
 */
export async function getHaenyeoSafety(
  spot?: string | null,
  debugSink?: DebugSink,
): Promise<HaenyeoSafetyResult> {
  const key = serviceKey()
  if (!key) {
    return { ok: false, error: 'JEJU_DATAGO_KEY (or DATA_GO_KR_KEY / KPX_SERVICE_KEY) is not set' }
  }

  const beachNum = resolveBeachNum(spot)
  const obsCodes = OBSCODE_MAP[beachNum] ?? DEFAULT_OBS_CODES
  const ymd = kstYmd()
  const errors: string[] = []

  const [marineSettled, waterTempSettled, tideSettled, currentSettled] = await Promise.allSettled([
    getMarineData(spot, debugSink),
    fetchKhoaWaterTemp(obsCodes.tideTempCode, ymd, key, debugSink),
    fetchKhoaTide(obsCodes.tideTempCode, ymd, key, debugSink),
    fetchKhoaCurrent(obsCodes.currentCode, ymd, key, debugSink),
  ])

  let wave: WaveInfo | null = null
  let sun: SunInfo | null = null
  let warnings: MarineWarning[] = []
  if (marineSettled.status === 'fulfilled') {
    if (marineSettled.value.ok) {
      wave = marineSettled.value.wave
      sun = marineSettled.value.sun
      warnings = marineSettled.value.warnings
    } else {
      errors.push(`marine: ${marineSettled.value.error}`)
    }
  } else {
    errors.push(`marine: ${marineSettled.reason instanceof Error ? marineSettled.reason.message : String(marineSettled.reason)}`)
  }

  let waterTemp: KhoaWaterTemp | null = null
  if (waterTempSettled.status === 'fulfilled') {
    waterTemp = waterTempSettled.value.data
    if (waterTempSettled.value.error) errors.push(`waterTemp: ${waterTempSettled.value.error}`)
  } else {
    errors.push(`waterTemp: ${waterTempSettled.reason instanceof Error ? waterTempSettled.reason.message : String(waterTempSettled.reason)}`)
  }

  let tideEvents: KhoaTideEvent[] | null = null
  let tideStationName: string | null = null
  if (tideSettled.status === 'fulfilled') {
    tideEvents = tideSettled.value.data?.events ?? null
    tideStationName = tideSettled.value.data?.stationName ?? null
    if (tideSettled.value.error) errors.push(`tide: ${tideSettled.value.error}`)
  } else {
    errors.push(`tide: ${tideSettled.reason instanceof Error ? tideSettled.reason.message : String(tideSettled.reason)}`)
  }

  let current: KhoaCurrentInfo | null = null
  if (currentSettled.status === 'fulfilled') {
    current = currentSettled.value.data
    if (currentSettled.value.error) errors.push(`current: ${currentSettled.value.error}`)
  } else {
    errors.push(`current: ${currentSettled.reason instanceof Error ? currentSettled.reason.message : String(currentSettled.reason)}`)
  }

  // ── LAYER 1 — decided BEFORE the AI is ever consulted. ──────────────────
  const verdict = computeVerdict({
    warnings,
    waveHeightM: wave?.heightM ?? null,
    waterTempC: waterTemp?.tempC ?? null,
    currentSpeedCmS: current?.nowSpeedCmS ?? null,
    maxCurrentSpeedCmS: current?.maxSpeedCmS ?? null,
  })

  // ── LAYER 2 — explains LAYER 1's verdict; cannot change `verdict` above. ─
  const { text: aiExplanation, meta: aiMeta } = await fetchAiExplanation({
    spot: spot?.trim() || '이호테우',
    verdict,
    waterTempC: waterTemp?.tempC ?? null,
    tideEvents,
    currentSpeedWord: currentSpeedWord(current?.nowSpeedCmS ?? current?.maxSpeedCmS ?? null),
    waveHeightM: wave?.heightM ?? null,
    warnings,
  })

  return {
    ok: true,
    spot: spot?.trim() || '이호테우',
    beachNum,
    wave,
    sun,
    warnings,
    waterTemp,
    waterTempStationLabel: waterTemp?.stationName ? `${waterTemp.stationName} 관측소 기준` : null,
    tideEvents,
    tideStationLabel: tideStationName ? `${tideStationName} 관측소 기준` : null,
    current,
    currentStationLabel: current?.stationName ? `인근 해역 참고값 (${current.stationName} 기준)` : null,
    verdict,
    aiExplanation,
    aiMeta,
    updatedAt: new Date().toISOString(),
    errors,
  }
}
