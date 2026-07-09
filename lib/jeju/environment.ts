import 'server-only'

/**
 * SHARED Jeju environment / waste-sorting layer — 도민(resident) mode 배출·환경 chip.
 * Consumed by GET /api/domin/environment (+ POST .../ask). Pure proxy + one
 * static asset. No DB.
 *
 * THREE parts:
 *   1. 미세먼지 — 한국환경공단_에어코리아 대기오염 현황 (시도별 실시간, 제주).
 *        PM10 / PM2.5 값 + 등급 + 경보(있으면). data.go.kr key (KPX fallback).
 *   2. 클린하우스/재활용도움센터 — STATIC seed asset (lib/jeju/data/cleanhouse.json).
 *        Optional lat/lng → nearest N (haversine); default grouped by 읍면동.
 *   3. 배출요일제 / 분리배출 Q&A — Perplexity (no formal 요일제 API):
 *        ALWAYS-ON enrichment (context) + POST /ask (one call per question).
 *
 * Auth: JEJU_DATAGO_KEY → DATA_GO_KR_KEY → KPX_SERVICE_KEY (same as marine).
 * ISOLATION: 'server-only'; sessionId/userId null; MUST NOT import governance/
 * synod/DEEP/Arena. Never throws; sections degrade to null + errors[].
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'
import {
  cleanPerplexityText,
  kstTodayIso,
  type ContextMeta,
} from '@/lib/jeju/fishery'
import cleanhouseData from '@/lib/jeju/data/cleanhouse.json'

// ── Constants ─────────────────────────────────────────────────────────────────

const AIRKOREA_BASE = 'https://apis.data.go.kr/B552584/ArpltnInqireSvc'
const AIRKOREA_SIDO_OP = `${AIRKOREA_BASE}/getCtprvnRltmMesureDnsty`
const TIMEOUT_MS = 10_000
const BODY_SNIPPET = 300
const PERPLEXITY_PROVIDER: ExtendedAiProviderName = 'perplexity'
const CONTEXT_MAX_TOKENS = 500
const ASK_MAX_TOKENS = 500
const FRESHNESS_NOTE = '에어코리아 실시간 + 클린하우스 위치(표본) + 🔍 검색'

// AirKorea grade code → Korean label
const GRADE_LABEL: Record<string, string> = {
  '1': '좋음',
  '2': '보통',
  '3': '나쁨',
  '4': '매우나쁨',
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DustInfo {
  pm10: number | null
  pm10Grade: string | null
  pm25: number | null
  pm25Grade: string | null
  alert: string | null
  station: string | null
  measuredAt: string | null
}

export interface CleanCenter {
  name: string
  dong: string
  address: string
  lat: number
  lng: number
  items: string[]
  hours: string
  type: string
  /** present only when lat/lng provided */
  distanceKm?: number
}

export interface CentersResult {
  byDong?: Record<string, CleanCenter[]>
  nearest?: CleanCenter[]
}

export interface EnvironmentPayload {
  ok: true
  dust: DustInfo | null
  centers: CentersResult
  context: string
  contextMeta: ContextMeta
  freshnessNote: string
  updatedAt: string
  errors: string[]
}

export type EnvironmentResult = EnvironmentPayload | { ok: false; error: string }

export interface EnvironmentOptions {
  lat?: number | null
  lng?: number | null
  /** nearest N when lat/lng given (default 6) */
  limit?: number
}

export interface AskResult {
  ok: boolean
  question: string
  answer: string
  contextMeta: ContextMeta
  error?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function serviceKey(): string {
  return (
    process.env.JEJU_DATAGO_KEY ??
    process.env.DATA_GO_KR_KEY ??
    process.env.KPX_SERVICE_KEY ??
    ''
  )
}

function noDbSupabase(): SupabaseClient {
  return createClient('http://localhost', 'environment-no-db') as unknown as SupabaseClient
}

function kstNowIso(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())}` +
    `T${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}:${pad(kst.getUTCSeconds())}+09:00`
  )
}

function redact(url: string): string {
  return url.replace(/serviceKey=[^&]+/i, 'serviceKey=***')
}

function bodySnippet(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, BODY_SNIPPET)
}

function parseNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '' && v.trim() !== '-') {
    const n = Number(v.trim())
    return Number.isFinite(n) ? n : null
  }
  return null
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim()
}

function extractAsOf(text: string): string | null {
  const full = text.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/)
  if (full) return `${full[1]}-${full[2].padStart(2, '0')}-${full[3].padStart(2, '0')}`
  const ymKo = text.match(/(\d{4})년\s*(\d{1,2})월/)
  if (ymKo) return `${ymKo[1]}-${ymKo[2].padStart(2, '0')}`
  return null
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ── 1. 미세먼지 (AirKorea) ─────────────────────────────────────────────────────

interface AirEnvelope {
  response?: {
    header?: { resultCode?: string; resultMsg?: string }
    body?: { items?: unknown }
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (Jeju-Env/1.0)' },
      cache: 'no-store',
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${bodySnippet(text)}`)
    const trimmed = text.trim()
    if (trimmed.startsWith('<')) throw new Error(`XML/error body — ${bodySnippet(trimmed)}`)
    try {
      return JSON.parse(trimmed) as unknown
    } catch {
      throw new Error(`Non-JSON body — ${bodySnippet(trimmed)}`)
    }
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') throw new Error(`Timeout after ${TIMEOUT_MS}ms`)
    throw e instanceof Error ? e : new Error(String(e))
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Pick a representative 제주 station reading. AirKorea returns per-station rows;
 * we prefer 제주시청/노형/이도 area, else the first row that carries PM values.
 */
function pickStation(items: Record<string, unknown>[]): Record<string, unknown> | null {
  const withPm = items.filter((it) => parseNum(it.pm10Value) != null || parseNum(it.pm25Value) != null)
  const pool = withPm.length ? withPm : items
  if (pool.length === 0) return null
  const preferred = pool.find((it) => /이도|노형|연동|제주시/.test(str(it.stationName)))
  return preferred ?? pool[0]
}

async function fetchDust(errors: string[]): Promise<DustInfo | null> {
  const key = serviceKey()
  if (!key) {
    errors.push('dust: no service key')
    return null
  }
  const params = new URLSearchParams({
    serviceKey: key,
    returnType: 'json',
    numOfRows: '100',
    pageNo: '1',
    sidoName: '제주',
    ver: '1.3',
  })
  const url = `${AIRKOREA_SIDO_OP}?${params.toString()}`
  console.log('[environment] dust →', redact(url))
  try {
    const raw = (await fetchJson(url)) as AirEnvelope
    const header = raw.response?.header
    const code = str(header?.resultCode)
    if (code && code !== '00') {
      errors.push(`dust: resultCode ${code}${header?.resultMsg ? `: ${header.resultMsg}` : ''}`)
      return null
    }
    const itemsRaw = raw.response?.body?.items
    const items = Array.isArray(itemsRaw) ? (itemsRaw as Record<string, unknown>[]) : []
    if (items[0]) console.log('[environment] dust sample →', JSON.stringify(items[0]).slice(0, 300))
    const st = pickStation(items)
    if (!st) {
      errors.push('dust: no station data')
      return null
    }
    const pm10 = parseNum(st.pm10Value)
    const pm25 = parseNum(st.pm25Value)
    const pm10Grade = GRADE_LABEL[str(st.pm10Grade1h) || str(st.pm10Grade)] ?? null
    const pm25Grade = GRADE_LABEL[str(st.pm25Grade1h) || str(st.pm25Grade)] ?? null
    return {
      pm10,
      pm10Grade,
      pm25,
      pm25Grade,
      alert: null, // 경보 filled separately below if available
      station: str(st.stationName) || null,
      measuredAt: str(st.dataTime) || null,
    }
  } catch (e: unknown) {
    errors.push(`dust: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

// ── 2. 클린하우스/재활용도움센터 (static) ──────────────────────────────────────

interface RawCenter {
  name: string
  dong: string
  address: string
  lat: number
  lng: number
  items: string[]
  hours: string
  type: string
}

function allCenters(): CleanCenter[] {
  const raw = (cleanhouseData as { centers?: RawCenter[] }).centers ?? []
  return raw.map((c) => ({ ...c }))
}

function buildCenters(opts: EnvironmentOptions): CentersResult {
  const centers = allCenters()
  const { lat, lng } = opts

  if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
    const limit = opts.limit && opts.limit > 0 ? opts.limit : 6
    const nearest = centers
      .map((c) => ({ ...c, distanceKm: Math.round(haversineKm(lat, lng, c.lat, c.lng) * 10) / 10 }))
      .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0))
      .slice(0, limit)
    return { nearest }
  }

  // Default: group by 읍면동
  const byDong: Record<string, CleanCenter[]> = {}
  for (const c of centers) {
    ;(byDong[c.dong] ??= []).push(c)
  }
  return { byDong }
}

// ── 3. 배출요일제 / 분리배출 (Perplexity) ──────────────────────────────────────

async function fetchContext(errors: string[]): Promise<{ text: string; meta: ContextMeta }> {
  const today = kstTodayIso()
  const retrievedAt = kstNowIso()
  const systemPrompt =
    `오늘은 ${today}입니다. 가장 최신 정보 위주로 답하라. ` +
    '당신은 제주 생활쓰레기 배출 안내 도우미입니다. 한국어로만, 군더더기 없이 4~5문장으로 답하세요. ' +
    '인용 번호([1][3] 등)를 쓰지 말고, 한자·중문·일문 문장부호(。「」 등)를 쓰지 마세요. ' +
    '제주 클린하우스/재활용도움센터 이용 시간, 요일별 배출 품목(요일제), 분리배출 요령을 ' +
    '쉽고 실용적으로 요약하세요. 확실하지 않은 세부 요일은 단정하지 말고 "지역별로 다를 수 있다"고 안내하세요.'
  const prompt =
    `제주 생활쓰레기 배출요일제와 분리배출 방법을 ${today} 기준으로 요약해 주세요. ` +
    '클린하우스 운영시간, 요일별로 버릴 수 있는 품목, 헷갈리기 쉬운 분리배출 요령 위주로 알려주세요.'
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
    if (r.error || !r.text?.trim()) {
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

/** POST /ask — one Perplexity call answering "이건 어디에 어떻게 버려요?" for Jeju. */
export async function askEnvironment(question: string): Promise<AskResult> {
  const q = (question ?? '').trim()
  const today = kstTodayIso()
  const retrievedAt = kstNowIso()
  const meta: ContextMeta = { source: '검색', retrievedAt, asOf: null }

  if (!q) {
    return { ok: false, question: q, answer: '', contextMeta: meta, error: '질문이 비어 있어요.' }
  }

  const systemPrompt =
    `오늘은 ${today}입니다. ` +
    '당신은 제주 분리배출 안내 도우미입니다. 한국어로만, 3~4문장으로 명확하게 답하세요. ' +
    '인용 번호([1][3] 등)와 한자·중문·일문 문장부호(。「」 등)를 쓰지 마세요. ' +
    '해당 품목을 제주에서 어디에(클린하우스/재활용도움센터/전용수거함 등) 어떻게 버리는지 ' +
    '구체적으로 안내하세요. 확실하지 않으면 가까운 클린하우스나 행정복지센터 문의를 권하세요.'
  const prompt = `제주에서 "${q}" 어떻게, 어디에 버려야 하나요? 배출 방법을 알려주세요.`

  try {
    const r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: PERPLEXITY_PROVIDER,
      prompt,
      systemPrompt,
      maxCompletionTokens: ASK_MAX_TOKENS,
      timeoutMs: TIMEOUT_MS,
      skipLanguageInjection: true,
    })
    if (r.error || !r.text?.trim()) {
      return { ok: false, question: q, answer: '', contextMeta: meta, error: r.error || '답변을 받지 못했어요.' }
    }
    const answer = cleanPerplexityText(r.text)
    return { ok: true, question: q, answer, contextMeta: { ...meta, asOf: extractAsOf(answer) } }
  } catch (e: unknown) {
    return {
      ok: false,
      question: q,
      answer: '',
      contextMeta: meta,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

// ── Public entry (GET) ─────────────────────────────────────────────────────────

/**
 * Fetch Jeju environment snapshot: 미세먼지 + 클린하우스 위치 + 배출 안내(Perplexity).
 * Never throws; sections degrade to null / [] with errors[] entries.
 */
export async function getEnvironment(opts: EnvironmentOptions = {}): Promise<EnvironmentResult> {
  const errors: string[] = []

  const [dustSettled, contextSettled] = await Promise.allSettled([
    fetchDust(errors),
    fetchContext(errors),
  ])

  let dust: DustInfo | null = null
  if (dustSettled.status === 'fulfilled') {
    dust = dustSettled.value
  } else {
    errors.push(`dust(settled): ${dustSettled.reason instanceof Error ? dustSettled.reason.message : String(dustSettled.reason)}`)
  }

  let context = ''
  let contextMeta: ContextMeta = { source: '검색', retrievedAt: kstNowIso(), asOf: null }
  if (contextSettled.status === 'fulfilled') {
    context = contextSettled.value.text
    contextMeta = contextSettled.value.meta
  } else {
    errors.push(`context(settled): ${contextSettled.reason instanceof Error ? contextSettled.reason.message : String(contextSettled.reason)}`)
  }

  return {
    ok: true,
    dust,
    centers: buildCenters(opts),
    context,
    contextMeta,
    freshnessNote: FRESHNESS_NOTE,
    updatedAt: new Date().toISOString(),
    errors,
  }
}
