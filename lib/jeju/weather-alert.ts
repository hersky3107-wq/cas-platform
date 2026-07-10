import 'server-only'

/**
 * SHARED Jeju weather & disaster alert layer — 도민(resident) mode.
 * Consumed by GET /api/domin/weather-alert. Pure proxy, no DB.
 *
 * Upstream (data.go.kr):
 *   1. 기상청 단기예보 (VilageFcstInfoService_2.0/getVilageFcst) —
 *        today + tomorrow: SKY / PTY / POP / TMP / TMN / TMX / WSD
 *   2. 기상청 중기예보 (MidFcstInfoService getMidLandFcst + getMidTa) —
 *        3–7 day outlook for 제주도
 *   3. 기상특보 — REUSES fetchJejuWeatherWarnings from lib/jeju/marine.ts
 *
 * Auth: JEJU_DATAGO_KEY → DATA_GO_KR_KEY → KPX_SERVICE_KEY.
 * Perplexity: always-on enrichment + fallback if both short/mid fail.
 * Never throws; section-level degrade via Promise.allSettled + errors[].
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'
import {
  fetchJejuWeatherWarnings,
  type MarineWarning,
} from '@/lib/jeju/marine'
import {
  cleanPerplexityText,
  kstTodayIso,
  type ContextMeta,
} from '@/lib/jeju/fishery'

/** Confirmed in connectors.ts — 제주도 중기 육상/기온 구역. */
const JEJU_MIDLAND_REGID = '11G00000'
const JEJU_MIDTA_REGID = '11G00201'

const VILAGE_URL =
  'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst'
const MID_LAND_URL =
  'https://apis.data.go.kr/1360000/MidFcstInfoService/getMidLandFcst'
const MID_TA_URL = 'https://apis.data.go.kr/1360000/MidFcstInfoService/getMidTa'

/** 15s (was 10s) — mobile networks add latency on top of upstream response time. */
const TIMEOUT_MS = 15_000
/** Backoff before the single automatic retry on a transient failure. */
const RETRY_DELAY_MS = 500
const BODY_SNIPPET = 300
const PERPLEXITY_PROVIDER: ExtendedAiProviderName = 'perplexity'
const CONTEXT_MAX_TOKENS = 400
const FALLBACK_MAX_TOKENS = 350

/** Confirmed KMA 5km grids (connectors.ts already uses 제주시 52,38). */
const REGION_GRID: Record<string, { label: string; nx: string; ny: string }> = {
  제주시: { label: '제주시', nx: '52', ny: '38' },
  서귀포: { label: '서귀포', nx: '52', ny: '33' },
  서귀포시: { label: '서귀포', nx: '52', ny: '33' },
}

const SKY_TEXT: Record<string, string> = {
  '1': '맑음',
  '3': '구름많음',
  '4': '흐림',
}

const PTY_TEXT: Record<string, string> = {
  '0': '없음',
  '1': '비',
  '2': '비/눈',
  '3': '눈',
  '4': '소나기',
  '5': '빗방울',
  '6': '빗방울눈날림',
  '7': '눈날림',
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TodayWeather {
  skyText: string | null
  tempC: number | null
  rainProb: number | null
  precipType: string | null
  windMs: number | null
}

export interface TomorrowWeather {
  skyText: string | null
  tempMinC: number | null
  tempMaxC: number | null
  rainProb: number | null
}

export interface WeekDay {
  date: string
  amText: string | null
  pmText: string | null
  tempMinC: number | null
  tempMaxC: number | null
  rainProbAm: number | null
  rainProbPm: number | null
}

export interface WeatherAlertPayload {
  ok: true
  region: string
  source: 'datago' | 'perplexity'
  confidence: 'high' | 'low'
  today: TodayWeather | null
  tomorrow: TomorrowWeather | null
  week: WeekDay[]
  warnings: MarineWarning[]
  context: string
  contextMeta: ContextMeta
  freshnessNote: string
  updatedAt: string
  errors: string[]
}

export type WeatherAlertResult = WeatherAlertPayload | { ok: false; error: string }

// ── Key + fetch helpers (mirror marine.ts) ────────────────────────────────────

function serviceKey(): string {
  return (
    process.env.JEJU_DATAGO_KEY ??
    process.env.DATA_GO_KR_KEY ??
    process.env.KPX_SERVICE_KEY ??
    ''
  )
}

function asArray<T>(item: unknown): T[] {
  if (Array.isArray(item)) return item as T[]
  if (item === undefined || item === null || item === '') return []
  return [item as T]
}

function parseNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim().replace(/,/g, ''))
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

function logUrl(label: string, url: string): void {
  console.log(`[weather-alert] ${label} →`, url.replace(/serviceKey=[^&]+/i, 'serviceKey=***'))
}

function readEnvelope(raw: unknown): Record<string, unknown>[] {
  if (!raw || typeof raw !== 'object') throw new Error('Unexpected response shape')
  const response = (raw as Record<string, unknown>).response
  if (!response || typeof response !== 'object') throw new Error('Missing response envelope')
  const resp = response as Record<string, unknown>
  const header =
    resp.header && typeof resp.header === 'object' ? (resp.header as Record<string, unknown>) : null
  const code = header ? String(header.resultCode ?? '') : ''
  const msg = header && typeof header.resultMsg === 'string' ? header.resultMsg : ''
  if (code && code !== '00' && code !== '03') {
    throw new Error(`resultCode ${code}${msg ? `: ${msg}` : ''}`)
  }
  const body =
    resp.body && typeof resp.body === 'object' ? (resp.body as Record<string, unknown>) : null
  const itemsContainer =
    body && body.items && typeof body.items === 'object'
      ? (body.items as Record<string, unknown>)
      : null
  return asArray<Record<string, unknown>>(itemsContainer ? itemsContainer.item : null)
}

/** Mid-forecast returns a single item object (not always an array). */
function readMidItem(raw: unknown): Record<string, unknown> {
  const items = readEnvelope(raw)
  if (items.length === 0) throw new Error('No mid-forecast item')
  return items[0]
}

async function fetchJsonAttempt(url: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; Jeju-WeatherAlert/1.0)',
      },
      cache: 'no-store',
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${bodySnippet(text)}`)
    const trimmed = text.trim()
    if (trimmed.startsWith('<') || trimmed.startsWith('<?xml')) {
      throw new Error(`XML/error body — ${bodySnippet(trimmed)}`)
    }
    try {
      return JSON.parse(trimmed) as unknown
    } catch {
      throw new Error(`Non-JSON body — ${bodySnippet(trimmed)}`)
    }
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`Timeout after ${TIMEOUT_MS}ms`)
    }
    throw e instanceof Error ? e : new Error(String(e))
  } finally {
    clearTimeout(timer)
  }
}

/** Timeout / network-abort / 5xx are transient — worth one retry. 4xx never is. */
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

/** fetchJsonAttempt + ONE automatic retry (after a short backoff) on transient failures. */
async function fetchJson(url: string): Promise<unknown> {
  try {
    return await fetchJsonAttempt(url)
  } catch (e: unknown) {
    if (!isRetryableFetchError(e)) throw e
    await sleep(RETRY_DELAY_MS)
    return await fetchJsonAttempt(url)
  }
}

// ── Date / region helpers ─────────────────────────────────────────────────────

function resolveRegion(region: string | null | undefined): { label: string; nx: string; ny: string } {
  const raw = (region ?? '').trim()
  if (!raw) return REGION_GRID['제주시']
  return REGION_GRID[raw] ?? REGION_GRID[raw.replace(/시$/, '')] ?? REGION_GRID['제주시']
}

/** KST YYYYMMDD + village-forecast base_time (02/05/08/11/14/17/20/23). */
function kstVilageBase(): { ymd: string; hm: string; todayYmd: string; tomorrowYmd: string } {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const todayYmd = `${kst.getUTCFullYear()}${pad(kst.getUTCMonth() + 1)}${pad(kst.getUTCDate())}`
  let h = kst.getUTCHours()
  const m = kst.getUTCMinutes()
  // Village forecast is published at each slot; usable ~10 min later.
  if (m < 10) h -= 1

  let baseYmd = todayYmd
  let slot: number
  if (h < 2) {
    // Before 02:10 → yesterday 23:00
    const y = new Date(kst.getTime() - 24 * 60 * 60 * 1000)
    baseYmd = `${y.getUTCFullYear()}${pad(y.getUTCMonth() + 1)}${pad(y.getUTCDate())}`
    slot = 23
  } else {
    const slots = [2, 5, 8, 11, 14, 17, 20, 23]
    slot = [...slots].reverse().find((x) => x <= h) ?? 23
  }

  const tomorrow = new Date(kst.getTime() + 24 * 60 * 60 * 1000)
  const tomorrowYmd = `${tomorrow.getUTCFullYear()}${pad(tomorrow.getUTCMonth() + 1)}${pad(tomorrow.getUTCDate())}`
  return { ymd: baseYmd, hm: `${pad(slot)}00`, todayYmd, tomorrowYmd }
}

/**
 * Mid-forecast tmFc: published at 06:00 and 18:00 KST.
 * Use today's 1800 after 18:00, today's 0600 from 07:00–17:59, else yesterday 1800.
 */
function kmaMidTmFc(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const year = kst.getUTCFullYear()
  const month = kst.getUTCMonth()
  const day = kst.getUTCDate()
  const hour = kst.getUTCHours()
  if (hour >= 18) return `${year}${pad(month + 1)}${pad(day)}1800`
  if (hour >= 7) return `${year}${pad(month + 1)}${pad(day)}0600`
  const y = new Date(Date.UTC(year, month, day) - 24 * 60 * 60 * 1000)
  return `${y.getUTCFullYear()}${pad(y.getUTCMonth() + 1)}${pad(y.getUTCDate())}1800`
}

function isoFromYmd(ymd: string): string {
  if (/^\d{8}$/.test(ymd)) return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
  return ymd
}

function addDaysYmd(ymd: string, days: number): string {
  const y = Number(ymd.slice(0, 4))
  const m = Number(ymd.slice(4, 6)) - 1
  const d = Number(ymd.slice(6, 8))
  const dt = new Date(Date.UTC(y, m, d) + days * 24 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}`
}

function kstNowIso(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+09:00`
  )
}

function extractAsOf(text: string): string | null {
  const full = text.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/)
  if (full) {
    return `${full[1]}-${full[2].padStart(2, '0')}-${full[3].padStart(2, '0')}`
  }
  const ymKo = text.match(/(\d{4})년\s*(\d{1,2})월/)
  if (ymKo) return `${ymKo[1]}-${ymKo[2].padStart(2, '0')}`
  return null
}

function noDbSupabase(): SupabaseClient {
  return createClient('http://localhost', 'weather-alert-no-db') as unknown as SupabaseClient
}

// ── Short-term (village) forecast ─────────────────────────────────────────────

function vilageUrl(key: string, nx: string, ny: string, baseDate: string, baseTime: string): string {
  const params = new URLSearchParams({
    serviceKey: key,
    pageNo: '1',
    numOfRows: '1000',
    dataType: 'JSON',
    base_date: baseDate,
    base_time: baseTime,
    nx,
    ny,
  })
  return `${VILAGE_URL}?${params.toString()}`
}

interface ShortBundle {
  today: TodayWeather | null
  tomorrow: TomorrowWeather | null
}

function pickNearest(
  items: Record<string, unknown>[],
  category: string,
  preferDate: string,
  preferHour?: string,
): string | null {
  const matched = items.filter((it) => str(it.category) === category && str(it.fcstDate) === preferDate)
  if (matched.length === 0) return null
  if (preferHour) {
    const exact = matched.find((it) => str(it.fcstTime).startsWith(preferHour))
    if (exact) return str(exact.fcstValue)
  }
  // Prefer midday (1200) then first available
  const noon = matched.find((it) => str(it.fcstTime) === '1200')
  if (noon) return str(noon.fcstValue)
  return str(matched[0].fcstValue)
}

function maxOf(items: Record<string, unknown>[], category: string, date: string): number | null {
  const vals = items
    .filter((it) => str(it.category) === category && str(it.fcstDate) === date)
    .map((it) => parseNum(it.fcstValue))
    .filter((n): n is number => n != null)
  return vals.length ? Math.max(...vals) : null
}

function minOf(items: Record<string, unknown>[], category: string, date: string): number | null {
  const vals = items
    .filter((it) => str(it.category) === category && str(it.fcstDate) === date)
    .map((it) => parseNum(it.fcstValue))
    .filter((n): n is number => n != null)
  return vals.length ? Math.min(...vals) : null
}

function parseShort(items: Record<string, unknown>[], todayYmd: string, tomorrowYmd: string): ShortBundle {
  const nowHour = String(new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCHours()).padStart(2, '0')

  const skyToday = pickNearest(items, 'SKY', todayYmd, nowHour)
  const ptyToday = pickNearest(items, 'PTY', todayYmd, nowHour)
  const popToday = pickNearest(items, 'POP', todayYmd, nowHour)
  const tmpToday = pickNearest(items, 'TMP', todayYmd, nowHour)
  const wsdToday = pickNearest(items, 'WSD', todayYmd, nowHour)

  const today: TodayWeather = {
    skyText: skyToday ? (SKY_TEXT[skyToday] ?? skyToday) : null,
    tempC: parseNum(tmpToday),
    rainProb: parseNum(popToday),
    precipType: ptyToday ? (PTY_TEXT[ptyToday] ?? ptyToday) : null,
    windMs: parseNum(wsdToday),
  }

  const skyTmr = pickNearest(items, 'SKY', tomorrowYmd, '12')
  const popTmr = maxOf(items, 'POP', tomorrowYmd)
  // TMN/TMX are once-per-day; fall back to min/max of hourly TMP
  const tmn = parseNum(pickNearest(items, 'TMN', tomorrowYmd)) ?? minOf(items, 'TMP', tomorrowYmd)
  const tmx = parseNum(pickNearest(items, 'TMX', tomorrowYmd)) ?? maxOf(items, 'TMP', tomorrowYmd)

  const tomorrow: TomorrowWeather = {
    skyText: skyTmr ? (SKY_TEXT[skyTmr] ?? skyTmr) : null,
    tempMinC: tmn,
    tempMaxC: tmx,
    rainProb: popTmr,
  }

  const todayEmpty =
    today.skyText == null && today.tempC == null && today.rainProb == null && today.windMs == null
  const tmrEmpty =
    tomorrow.skyText == null &&
    tomorrow.tempMinC == null &&
    tomorrow.tempMaxC == null &&
    tomorrow.rainProb == null

  return {
    today: todayEmpty ? null : today,
    tomorrow: tmrEmpty ? null : tomorrow,
  }
}

async function fetchShort(
  key: string,
  nx: string,
  ny: string,
): Promise<ShortBundle> {
  const { ymd, hm, todayYmd, tomorrowYmd } = kstVilageBase()
  const url = vilageUrl(key, nx, ny, ymd, hm)
  logUrl('vilage', url)
  const raw = await fetchJson(url)
  const items = readEnvelope(raw)
  if (items.length === 0) throw new Error('No village-forecast items')
  return parseShort(items, todayYmd, tomorrowYmd)
}

// ── Mid-term (3–7 day) ────────────────────────────────────────────────────────

function midUrl(base: string, key: string, regId: string, tmFc: string): string {
  const params = new URLSearchParams({
    serviceKey: key,
    pageNo: '1',
    numOfRows: '10',
    dataType: 'JSON',
    regId,
    tmFc,
  })
  return `${base}?${params.toString()}`
}

function parseWeek(
  land: Record<string, unknown>,
  ta: Record<string, unknown>,
  todayYmd: string,
): WeekDay[] {
  const out: WeekDay[] = []
  // Mid forecast day index n = n days after announcement; we want calendar days 3–7 from today.
  for (let n = 3; n <= 7; n++) {
    const dateYmd = addDaysYmd(todayYmd, n)
    const amText = str(land[`wf${n}Am`]) || null
    const pmText = str(land[`wf${n}Pm`]) || null
    const rainProbAm = parseNum(land[`rnSt${n}Am`])
    const rainProbPm = parseNum(land[`rnSt${n}Pm`])
    const tempMinC = parseNum(ta[`taMin${n}`])
    const tempMaxC = parseNum(ta[`taMax${n}`])
    out.push({
      date: isoFromYmd(dateYmd),
      amText,
      pmText,
      tempMinC,
      tempMaxC,
      rainProbAm,
      rainProbPm,
    })
  }
  return out
}

async function fetchWeek(key: string, todayYmd: string, errors: string[]): Promise<WeekDay[]> {
  const tmFc = kmaMidTmFc()
  const landUrl = midUrl(MID_LAND_URL, key, JEJU_MIDLAND_REGID, tmFc)
  const taUrl = midUrl(MID_TA_URL, key, JEJU_MIDTA_REGID, tmFc)
  logUrl('mid-land', landUrl)
  logUrl('mid-ta', taUrl)

  const [landSettled, taSettled] = await Promise.allSettled([
    fetchJson(landUrl).then(readMidItem),
    fetchJson(taUrl).then(readMidItem),
  ])

  if (landSettled.status === 'rejected' && taSettled.status === 'rejected') {
    const a = landSettled.reason instanceof Error ? landSettled.reason.message : String(landSettled.reason)
    const b = taSettled.reason instanceof Error ? taSettled.reason.message : String(taSettled.reason)
    throw new Error(`mid-land: ${a}; mid-ta: ${b}`)
  }

  const land =
    landSettled.status === 'fulfilled' ? landSettled.value : ({} as Record<string, unknown>)
  const ta = taSettled.status === 'fulfilled' ? taSettled.value : ({} as Record<string, unknown>)

  if (landSettled.status === 'rejected') {
    errors.push(
      `mid-land: ${landSettled.reason instanceof Error ? landSettled.reason.message : String(landSettled.reason)}`,
    )
  }
  if (taSettled.status === 'rejected') {
    errors.push(
      `mid-ta: ${taSettled.reason instanceof Error ? taSettled.reason.message : String(taSettled.reason)}`,
    )
  }

  const week = parseWeek(land, ta, todayYmd).filter(
    (d) => d.amText || d.pmText || d.tempMinC != null || d.tempMaxC != null,
  )
  if (week.length === 0) {
    throw new Error('mid-forecast empty after parse')
  }
  return week
}

// ── Perplexity enrichment + fallback ──────────────────────────────────────────

async function fetchContext(
  region: string,
  errors: string[],
): Promise<{ text: string; meta: ContextMeta }> {
  const today = kstTodayIso()
  const retrievedAt = kstNowIso()
  const systemPrompt =
    `오늘은 ${today}입니다. 가장 최신 정보 위주로, 가능하면 최근 1주일 이내 자료를 우선하라. ` +
    '당신은 제주 생활 기상 안내원입니다. 한국어로만, 군더더기 없이 3~4문장으로 답하세요. ' +
    '인용 번호([1][3] 등)를 쓰지 말고, 한자·중문·일문 문장부호(。「」 등)를 쓰지 마세요. ' +
    '기온·강수·바람·특보 등 생활 기상 특이사항만 사실 위주로 요약하세요.'
  const prompt =
    `제주 ${region} 오늘(${today}) 날씨·기상 특이사항을 알려주세요. ` +
    `기온, 비/바람, 특보·주의사항, 외출·조업에 참고할 생활 기상 요약을 해주세요.`
  try {
    const r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: PERPLEXITY_PROVIDER,
      prompt,
      systemPrompt,
      maxCompletionTokens: CONTEXT_MAX_TOKENS,
      timeoutMs: TIMEOUT_MS,
      skipLanguageInjection: true,
    })
    if (r.error || !r.text || !r.text.trim()) {
      errors.push(`context: ${r.error || 'empty'}`)
      return { text: '', meta: { source: '검색', retrievedAt, asOf: null } }
    }
    const text = cleanPerplexityText(r.text)
    return { text, meta: { source: '검색', retrievedAt, asOf: extractAsOf(text) } }
  } catch (e: unknown) {
    errors.push(`context: ${e instanceof Error ? e.message : String(e)}`)
    return { text: '', meta: { source: '검색', retrievedAt, asOf: null } }
  }
}

async function fetchForecastFallback(
  region: string,
  errors: string[],
): Promise<{ today: TodayWeather; contextExtra: string } | null> {
  const today = kstTodayIso()
  const systemPrompt =
    `오늘은 ${today}입니다. 가장 최신 정보 위주로 답하라. ` +
    '당신은 제주 날씨 안내원입니다. 한국어로만 답하세요. 인용 번호([1][3] 등)를 쓰지 마세요. ' +
    '가능하면 "맑음, 기온 약 24℃, 강수확률 20%, 바람 약 3m/s" 형태로 한 줄 요약한 뒤 한 문장 근거를 덧붙이세요.'
  const prompt = `제주 ${region} 오늘(${today}) 날씨 예보 — 하늘상태, 기온, 강수확률, 바람을 알려주세요.`
  try {
    const r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: PERPLEXITY_PROVIDER,
      prompt,
      systemPrompt,
      maxCompletionTokens: FALLBACK_MAX_TOKENS,
      timeoutMs: TIMEOUT_MS,
      skipLanguageInjection: true,
    })
    if (r.error || !r.text || !r.text.trim()) {
      errors.push(`fallback: ${r.error || 'empty'}`)
      return null
    }
    const text = cleanPerplexityText(r.text)
    const tempMatch = text.match(/(-?\d{1,2}(?:\.\d)?)\s*℃|(-?\d{1,2}(?:\.\d)?)\s*도/)
    const rainMatch = text.match(/강수(?:확률)?\s*(\d{1,3})\s*%|(\d{1,3})\s*%/)
    const windMatch = text.match(/(\d{1,2}(?:\.\d)?)\s*m\/?s/)
    let skyText: string | null = null
    for (const k of ['맑음', '구름많음', '흐림', '비', '소나기', '눈']) {
      if (text.includes(k)) {
        skyText = k
        break
      }
    }
    return {
      today: {
        skyText,
        tempC: tempMatch ? parseNum(tempMatch[1] ?? tempMatch[2]) : null,
        rainProb: rainMatch ? parseNum(rainMatch[1] ?? rainMatch[2]) : null,
        precipType: text.includes('비') ? '비' : text.includes('눈') ? '눈' : null,
        windMs: windMatch ? parseNum(windMatch[1]) : null,
      },
      contextExtra: text,
    }
  } catch (e: unknown) {
    errors.push(`fallback: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

// ── Public entry ──────────────────────────────────────────────────────────────

/**
 * Fetch Jeju weather + disaster alerts for a region. Never throws.
 * Short + mid + warnings + Perplexity context run in parallel via Promise.allSettled.
 */
export async function getWeatherAlert(
  regionInput?: string | null,
): Promise<WeatherAlertResult> {
  const key = serviceKey()
  if (!key) {
    return {
      ok: false,
      error: 'JEJU_DATAGO_KEY (or DATA_GO_KR_KEY / KPX_SERVICE_KEY) is not set',
    }
  }

  const region = resolveRegion(regionInput)
  const errors: string[] = []
  const { todayYmd } = kstVilageBase()

  const [shortSettled, weekSettled, warnSettled, contextSettled] = await Promise.allSettled([
    fetchShort(key, region.nx, region.ny),
    fetchWeek(key, todayYmd, errors),
    fetchJejuWeatherWarnings(key),
    fetchContext(region.label, errors),
  ])

  let today: TodayWeather | null = null
  let tomorrow: TomorrowWeather | null = null
  let week: WeekDay[] = []
  let warnings: MarineWarning[] = []
  let context = ''
  let contextMeta: ContextMeta = { source: '검색', retrievedAt: kstNowIso(), asOf: null }
  let source: 'datago' | 'perplexity' = 'datago'
  let confidence: 'high' | 'low' = 'high'

  if (shortSettled.status === 'fulfilled') {
    today = shortSettled.value.today
    tomorrow = shortSettled.value.tomorrow
  } else {
    errors.push(
      `short: ${shortSettled.reason instanceof Error ? shortSettled.reason.message : String(shortSettled.reason)}`,
    )
  }

  if (weekSettled.status === 'fulfilled') {
    week = weekSettled.value
  } else {
    errors.push(
      `week: ${weekSettled.reason instanceof Error ? weekSettled.reason.message : String(weekSettled.reason)}`,
    )
  }

  if (warnSettled.status === 'fulfilled') {
    warnings = warnSettled.value
  } else {
    errors.push(
      `warnings: ${warnSettled.reason instanceof Error ? warnSettled.reason.message : String(warnSettled.reason)}`,
    )
  }

  if (contextSettled.status === 'fulfilled') {
    context = contextSettled.value.text
    contextMeta = contextSettled.value.meta
  } else {
    errors.push(
      `context: ${contextSettled.reason instanceof Error ? contextSettled.reason.message : String(contextSettled.reason)}`,
    )
  }

  // FALLBACK: if BOTH short and mid failed, try Perplexity for today's forecast.
  const shortFailed = shortSettled.status === 'rejected' || (today == null && tomorrow == null)
  const weekFailed = weekSettled.status === 'rejected' || week.length === 0
  if (shortFailed && weekFailed) {
    const fb = await fetchForecastFallback(region.label, errors)
    if (fb) {
      today = fb.today
      source = 'perplexity'
      confidence = 'low'
      if (!context && fb.contextExtra) context = fb.contextExtra
    }
  }

  return {
    ok: true,
    region: region.label,
    source,
    confidence,
    today,
    tomorrow,
    week,
    warnings,
    context,
    contextMeta,
    freshnessNote: '기상청 단기·중기예보 기준 (실시간 관측 아님)',
    updatedAt: new Date().toISOString(),
    errors,
  }
}
