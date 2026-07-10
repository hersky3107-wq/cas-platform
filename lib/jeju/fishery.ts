import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'

/**
 * SHARED Jeju fishery-price data layer — 도민 일반 mode 농수산 chip.
 * Feeds the fishing-decision widget via GET /api/domin/fishery-price.
 *
 * Upstream (data.go.kr, 해양수산부 1192000):
 *   1. Aggregation — select0050List/getselect0050List
 *        (위판장별 어종별 위탁판매 집계: 고가/저가/물량 by market + species)
 *   2. Sister (market resolve) — select0020List/getselect0020List
 *        (수협 산지조합 위판장 정보 → Jeju 위판장 codes, best-effort)
 *
 * Perplexity (via runSingleAiProvider, provider 'perplexity') is a FIRST-CLASS
 * part of this route — mirroring how the governance/DEEP engines use it:
 *   • ENRICHMENT (always): 1 call for 수요/작황/금어기/시황 market context.
 *   • FALLBACK (conditional): 1 call for a recent Jeju price when the official
 *     path fails (403/propagation, resultCode, timeout, or empty after backfill).
 *   → at most 2 Perplexity calls per request (well under the 5-call hard cap).
 *
 * Auth: JEJU_DATAGO_KEY → DATA_GO_KR_KEY → KPX_SERVICE_KEY (same as marine.ts).
 * Data is D+1 settled (previous business day), so we backfill baseDt backwards
 * up to `days` days until Jeju rows appear; today is never assumed to have data.
 *
 * ISOLATION: 'server-only'; sessionId/userId null (no DB, no BYOK, no credit);
 * MUST NOT import governance/synod/DEEP/Arena — only the shared Perplexity util.
 * Never throws; sections degrade to null with an errors[] entry.
 */

const AGG_URL = 'https://apis.data.go.kr/1192000/select0050List/getselect0050List'
const MARKET_URL = 'https://apis.data.go.kr/1192000/select0020List/getselect0020List'
/** 15s (was 10s) — mobile networks add latency on top of upstream response time. */
const TIMEOUT_MS = 15_000
/** Backoff before the single automatic retry on a transient failure. */
const RETRY_DELAY_MS = 500
/** Max chars of upstream response body surfaced in errors[] on failure. */
const BODY_SNIPPET = 300
const FRESHNESS_NOTE = '위판 마감 기준 (실시간 아님)'
const PERPLEXITY_PROVIDER: ExtendedAiProviderName = 'perplexity'
const CONTEXT_MAX_TOKENS = 420
const FALLBACK_MAX_TOKENS = 320

/** Jeju 산지조합/위판장 name keywords — the reliable region filter. */
const JEJU_KEYWORDS = [
  '제주',
  '서귀포',
  '성산',
  '한림',
  '추자',
  '모슬포',
  '한경',
  '우도',
  '표선',
  '위미',
  '김녕',
  '애월',
  '한동',
  '조천',
]

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FisheryLatest {
  date: string
  avgPrice: number | null
  highPrice: number | null
  lowPrice: number | null
  volumeKg: number | null
  market: string | null
}

export interface FisheryTrendPoint {
  date: string
  avgPrice: number | null
  volumeKg: number | null
}

export interface ContextMeta {
  /** Literal label for UI, e.g. "🔍 검색 · {asOf} 기준 · {retrievedAt} 조회" */
  source: '검색'
  /** ISO datetime (KST, +09:00) of when the Perplexity call completed. */
  retrievedAt: string
  /** Date/period the information refers to, extracted from the model text.
   *  e.g. "2026-07", "2026-07-09", "2025년 5월" → "2025-05". null if unclear. */
  asOf: string | null
}

export interface FisheryPayload {
  ok: true
  species: string
  source: 'datago' | 'perplexity'
  confidence: 'high' | 'low'
  latest: FisheryLatest | null
  trend: FisheryTrendPoint[]
  context: string
  contextMeta: ContextMeta
  freshnessNote: string
  updatedAt: string
  errors: string[]
}

export type FisheryResult = FisheryPayload | { ok: false; error: string }

// ── Key + fetch helpers (mirrors marine.ts) ─────────────────────────────────────

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
    // Strip thousands separators, currency words, units.
    const n = Number(v.replace(/[,\s]/g, '').replace(/[^\d.-]/g, ''))
    return Number.isFinite(n) ? n : null
  }
  return null
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim()
}

/** First candidate key present on `it` with a non-empty numeric value. */
function pickNum(it: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    if (k in it) {
      const n = parseNum(it[k])
      if (n != null) return n
    }
  }
  return null
}

function pickStr(it: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    if (k in it) {
      const s = str(it[k])
      if (s) return s
    }
  }
  return ''
}

/** First ~300 chars of upstream body, collapsed for errors[] readability. */
function bodySnippet(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, BODY_SNIPPET)
}

/** Redacted-URL logger (serviceKey → ***). */
function logUrl(label: string, url: string): void {
  console.log(`[fishery] ${label} →`, url.replace(/serviceKey=[^&]+/, 'serviceKey=***'))
}

/**
 * 1192000 envelope → items[]. Unlike the 1360000 services, MOF 1192000
 * (select00X0List) wraps under `responseJson` (or `responseXml`) and returns the
 * rows at `body.item` (an array), not `body.items.item`. Handles both shapes.
 * Throws a descriptive Error on failure (resultCode != 00/03).
 */
function readEnvelope(raw: unknown): Record<string, unknown>[] {
  if (!raw || typeof raw !== 'object') throw new Error('Unexpected response shape')
  const root = raw as Record<string, unknown>
  const response = root.responseJson ?? root.response ?? root.responseXml
  if (!response || typeof response !== 'object') {
    throw new Error(`Missing response envelope (keys: ${Object.keys(root).join(',')})`)
  }
  const resp = response as Record<string, unknown>
  const header =
    resp.header && typeof resp.header === 'object' ? (resp.header as Record<string, unknown>) : null
  const code = header ? String(header.resultCode ?? '') : ''
  const msg = header && typeof header.resultMsg === 'string' ? header.resultMsg : ''
  // '00'/'0' = success, '03' = NODATA (benign empty).
  if (code && code !== '00' && code !== '0' && code !== '03') {
    throw new Error(`resultCode ${code}${msg ? `: ${msg}` : ''}`)
  }
  const body =
    resp.body && typeof resp.body === 'object' ? (resp.body as Record<string, unknown>) : null
  if (!body) return []
  // Row shapes: body.item[] (1192000) | body.items.item[] | body.items[].
  if (Array.isArray(body.item)) return asArray<Record<string, unknown>>(body.item)
  if (Array.isArray(body.items)) return asArray<Record<string, unknown>>(body.items)
  const itemsContainer =
    body.items && typeof body.items === 'object' ? (body.items as Record<string, unknown>) : null
  return asArray<Record<string, unknown>>(itemsContainer ? itemsContainer.item : body.item ?? null)
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
        'User-Agent': 'Mozilla/5.0 (compatible; Jeju-Fishery/1.0)',
      },
      cache: 'no-store',
    })
    const text = await res.text()
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} — ${bodySnippet(text)}`)
    }
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

// ── Date helpers ────────────────────────────────────────────────────────────────

function kstToday(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000)
}

/** YYYY-MM-DD in Asia/Seoul. Shared with other resident-mode AI widgets. */
export function kstTodayIso(): string {
  const d = kstToday()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** Full ISO timestamp with +09:00 offset — used as ContextMeta.retrievedAt. */
function kstNowIso(): string {
  const d = kstToday()
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+09:00`
  )
}

function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
}

/** D+1 settled: candidate baseDt values from yesterday backwards, `days` total. */
function candidateDates(days: number): string[] {
  const base = kstToday()
  const out: string[] = []
  for (let i = 1; i <= days; i++) {
    const d = new Date(base.getTime() - i * 24 * 60 * 60 * 1000)
    out.push(ymd(d))
  }
  return out
}

function isoDate(yyyymmdd: string): string {
  if (/^\d{8}$/.test(yyyymmdd)) {
    return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
  }
  return yyyymmdd
}

// ── data.go.kr URL builders ─────────────────────────────────────────────────────

// NOTE: this service silently returns `{}` for large numOfRows (≥ ~200) despite
// its documented max of 999. One species+date is only ~33 national rows, so 100
// safely covers all 위판장 for a single query.
const MAX_ROWS = '100'

function aggUrl(key: string, baseDt: string, species: string): string {
  const params = new URLSearchParams({
    serviceKey: key,
    numOfRows: MAX_ROWS,
    pageNo: '1',
    type: 'json', // MANDATORY — defaults to XML otherwise
    baseDt,
  })
  if (species) params.set('mprcStdCodeNm', species)
  return `${AGG_URL}?${params.toString()}`
}

function marketUrl(key: string): string {
  const params = new URLSearchParams({
    serviceKey: key,
    numOfRows: MAX_ROWS,
    pageNo: '1',
    type: 'json',
  })
  return `${MARKET_URL}?${params.toString()}`
}

// ── Jeju filtering ──────────────────────────────────────────────────────────────

function isJejuRow(it: Record<string, unknown>, jejuCodes: Set<string>): boolean {
  const code = pickStr(it, ['csmtmktCode', 'CSMTMKT_CODE', 'mxtrCode'])
  if (code && jejuCodes.has(code)) return true
  const hay = [
    pickStr(it, ['mxtrNm', 'MXTR_NM']),
    pickStr(it, ['csmtmktNm', 'CSMTMKT_NM']),
    pickStr(it, ['addr', 'address', 'ADDR']),
  ].join(' ')
  return JEJU_KEYWORDS.some((k) => hay.includes(k))
}

/** Best-effort: resolve Jeju 위판장 codes from the sister endpoint. Non-fatal. */
async function resolveJejuMarketCodes(key: string, errors: string[]): Promise<Set<string>> {
  const codes = new Set<string>()
  try {
    const url = marketUrl(key)
    logUrl('market', url)
    const items = readEnvelope(await fetchJson(url))
    for (const it of items) {
      if (isJejuRow(it, codes)) {
        const code = pickStr(it, ['csmtmktCode', 'CSMTMKT_CODE'])
        if (code) codes.add(code)
      }
    }
  } catch (e: unknown) {
    // Best-effort only — keyword filtering still works without codes.
    errors.push(`market: ${e instanceof Error ? e.message : String(e)}`)
  }
  return codes
}

// ── Aggregation-row parsing ─────────────────────────────────────────────────────

const K_DATE = ['csmtDe', 'CSMT_DE', 'baseDt', 'standrdDe', 'delngDe', 'de', '위판일자']
const K_MARKET = ['csmtmktNm', 'CSMTMKT_NM', 'mxtrNm', 'MXTR_NM']
// Confirmed 1192000 field names: 고가 = hghpc, 저가 = lprc (no avg/volume fields).
const K_HIGH = ['hghpc', 'hgPrc', 'hgAmt', 'highAmt', 'mxAmt', 'hgUntpc', 'maxAmt', 'highPrice', '고가']
const K_LOW = ['lprc', 'lwPrc', 'lwAmt', 'lowAmt', 'mnAmt', 'lwUntpc', 'minAmt', 'lowPrice', '저가']
const K_AVG = ['avgAmt', 'avgPrc', 'avgUntpc', 'avgPceAmt', 'meanAmt', 'avgPrice', '평균가']
const K_VOL = ['delngQy', 'delngWt', 'whslMqty', 'qty', 'qy', 'wt', 'weight', 'totWt', 'mfWt', '물량', '중량']
const K_UNIT = ['goodsUnitNm', 'goodsStndrdNm', 'unitNm']

interface AggRow {
  date: string
  market: string
  high: number | null
  low: number | null
  avg: number | null
  volume: number | null
  unitKg: boolean
}

function parseAggRow(it: Record<string, unknown>, fallbackDate: string): AggRow {
  const high = pickNum(it, K_HIGH)
  const low = pickNum(it, K_LOW)
  let avg = pickNum(it, K_AVG)
  if (avg == null && high != null && low != null) avg = Math.round((high + low) / 2)
  const rawDate = pickStr(it, K_DATE) || fallbackDate
  const unit = pickStr(it, K_UNIT)
  return {
    date: isoDate(rawDate.replace(/[^\d]/g, '').slice(0, 8) || fallbackDate),
    market: pickStr(it, K_MARKET),
    high,
    low,
    avg,
    volume: pickNum(it, K_VOL),
    unitKg: /kg/i.test(unit),
  }
}

/** Drop rows with no usable positive price (zero-price 활어/미 noise rows). */
function hasPrice(r: AggRow): boolean {
  return (r.high != null && r.high > 0) || (r.low != null && r.low > 0)
}

/** Aggregate all Jeju rows for one date into a single trend point + representative market. */
function aggregateDate(rows: AggRow[]): {
  avg: number | null
  high: number | null
  low: number | null
  volume: number | null
  market: string | null
} {
  if (rows.length === 0) return { avg: null, high: null, low: null, volume: null, market: null }
  const avgs = rows.map((r) => r.avg).filter((n): n is number => n != null)
  const highs = rows.map((r) => r.high).filter((n): n is number => n != null)
  const lows = rows.map((r) => r.low).filter((n): n is number => n != null)
  const vols = rows.map((r) => r.volume).filter((n): n is number => n != null)
  const avg = avgs.length ? Math.round(avgs.reduce((a, b) => a + b, 0) / avgs.length) : null
  const high = highs.length ? Math.max(...highs) : null
  const low = lows.length ? Math.min(...lows) : null
  const volume = vols.length ? vols.reduce((a, b) => a + b, 0) : null
  // Representative market = highest-volume row, else first named row.
  const byVol = [...rows].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
  const market = byVol.find((r) => r.market)?.market ?? rows.find((r) => r.market)?.market ?? null
  return { avg, high, low, volume, market }
}

// ── Official (data.go.kr) path ──────────────────────────────────────────────────

interface OfficialResult {
  latest: FisheryLatest | null
  trend: FisheryTrendPoint[]
  errors: string[]
}

async function fetchOfficial(species: string, days: number): Promise<OfficialResult> {
  const errors: string[] = []
  const key = serviceKey()
  if (!key) {
    return { latest: null, trend: [], errors: ['datago: service key not set'] }
  }

  // Market-code resolution (best-effort) + all candidate dates fire in parallel.
  const dates = candidateDates(days)
  const [codesSettled, ...dateSettled] = await Promise.allSettled([
    resolveJejuMarketCodes(key, errors),
    ...dates.map(async (d) => {
      const url = aggUrl(key, d, species)
      logUrl(`agg ${d}`, url)
      const items = readEnvelope(await fetchJson(url))
      return { date: d, items }
    }),
  ])

  const jejuCodes = codesSettled.status === 'fulfilled' ? codesSettled.value : new Set<string>()

  const perDate: FisheryTrendPoint[] = []
  let latest: FisheryLatest | null = null

  // dateSettled aligns 1:1 with `dates` order.
  dateSettled.forEach((r, i) => {
    const d = dates[i]
    if (r.status === 'rejected') {
      errors.push(`agg ${d}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`)
      return
    }
    const allJejuRows = r.value.items
      .filter((it) => isJejuRow(it, jejuCodes))
      .map((it) => parseAggRow(it, d))
      .filter(hasPrice)
    if (allJejuRows.length === 0) return
    // Prefer kg-priced rows so we don't mix 원/kg with 원/상자·마리; else use all.
    const kgRows = allJejuRows.filter((row) => row.unitKg)
    const jejuRows = kgRows.length > 0 ? kgRows : allJejuRows
    const agg = aggregateDate(jejuRows)
    const isoD = isoDate(d)
    perDate.push({ date: isoD, avgPrice: agg.avg, volumeKg: agg.volume })
    // `dates` is newest-first, so the first date with rows is the latest.
    if (!latest) {
      latest = {
        date: isoD,
        avgPrice: agg.avg,
        highPrice: agg.high,
        lowPrice: agg.low,
        volumeKg: agg.volume,
        market: agg.market,
      }
    }
  })

  // trend ascending by date for a left→right sparkline.
  const trend = perDate.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return { latest, trend, errors }
}

// ── Perplexity (shared util) ────────────────────────────────────────────────────

function noDbSupabase(): SupabaseClient {
  // sessionId/userId null ⇒ router does no DB inserts / BYOK reads; never dereferenced.
  return createClient('http://localhost', 'fishery-no-db') as unknown as SupabaseClient
}

/**
 * Strip artefacts that Perplexity tends to inject:
 *   [1][3] citation markers, Chinese/Japanese periods (。), extra whitespace.
 * Shared with other resident-mode AI widgets (e.g. fishing-decision).
 */
export function cleanPerplexityText(text: string): string {
  return text
    .replace(/\[\d+\]/g, '')   // citation markers [1][3]…
    .replace(/。/g, '.')        // ideographic period → ASCII
    .replace(/「|」/g, '"')     // lenticular brackets → ASCII quotes
    .replace(/\s{2,}/g, ' ')   // collapse runs of whitespace
    .trim()
}

/**
 * Extract a date/period string from the model output to populate asOf.
 * Tries full date first (most specific), then year+month, then year alone.
 */
function extractAsOf(text: string): string | null {
  // "2026-07-09" / "2026.07.09" / "2026/07/09"
  const full = text.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/)
  if (full) {
    return `${full[1]}-${full[2].padStart(2, '0')}-${full[3].padStart(2, '0')}`
  }
  // "2026년 7월" / "2025년 5월"
  const ymKo = text.match(/(\d{4})년\s*(\d{1,2})월/)
  if (ymKo) return `${ymKo[1]}-${ymKo[2].padStart(2, '0')}`
  // "2026년"
  const yKo = text.match(/(\d{4})년/)
  if (yKo) return yKo[1]
  return null
}

/** ENRICHMENT (always): 수요/작황/금어기/시황 context for the AI decision layer. */
async function fetchContext(
  species: string,
  errors: string[],
): Promise<{ text: string; meta: ContextMeta }> {
  const today = kstTodayIso()
  const systemPrompt =
    `오늘은 ${today}입니다. 가장 최신 정보 위주로, 가능하면 최근 1개월 이내 자료를 우선하라. ` +
    '당신은 제주 수산물 시황 요약가입니다. 한국어로만, 군더더기 없이 3~4문장으로 답하세요. ' +
    '인용 번호([1][3] 등)를 쓰지 말고, 한자·중문·일문 문장부호(。「」 등)를 쓰지 마세요. ' +
    '가격 숫자를 지어내지 말고, 수요·작황·조업 여건·금어기·시황 흐름만 사실 위주로 요약하세요.'
  const prompt =
    `제주 지역 ${species}의 현재 시황을 알려주세요. ` +
    `수요, 작황/어황, 조업 여건, 금어기 여부, 최근 가격 방향(오름세/내림세) 위주로 ` +
    `${today} 기준 최신 정보를 요약해 주세요.`
  const retrievedAt = kstNowIso()
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

/** FALLBACK (conditional): recent Jeju 위판 price when the official path is empty. */
async function fetchPriceFallback(
  species: string,
  errors: string[],
): Promise<FisheryLatest | null> {
  const today = kstTodayIso()
  const systemPrompt =
    `오늘은 ${today}입니다. 가장 최신 정보 위주로, 가능하면 최근 1개월 이내 자료를 우선하라. ` +
    '당신은 제주 수산물 위판 시세 조사원입니다. 한국어로만 답하세요. ' +
    '인용 번호([1][3] 등)를 쓰지 마세요. ' +
    '최근 제주 산지/위판장의 kg당 대략적인 시세를 찾아, 가능하면 "약 12,000원/kg (2026-07-05, 서귀포수협)" 형태로 ' +
    '한 줄로 제시하고, 이어서 한 문장 근거를 덧붙이세요. 숫자를 모르면 모른다고 하세요.'
  const prompt = `제주 ${species} 위판 시세, kg당 원, ${today} 기준 가장 최근 값으로 알려주세요.`
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
    // Extract "약 12,000원/kg" style price + optional YYYY-MM-DD + market name.
    const priceMatch = text.match(/([\d,]{3,})\s*원/)
    const avgPrice = priceMatch ? parseNum(priceMatch[1]) : null
    const dateMatch = text.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/)
    const date = dateMatch
      ? `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`
      : isoDate(candidateDates(1)[0])
    const marketMatch = text.match(/([가-힣]+수협|[가-힣]+위판장|[가-힣]+수산업협동조합)/)
    return {
      date,
      avgPrice,
      highPrice: null,
      lowPrice: null,
      volumeKg: null,
      market: marketMatch ? marketMatch[1] : null,
    }
  } catch (e: unknown) {
    errors.push(`fallback: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

// ── Public entry ──────────────────────────────────────────────────────────────

/**
 * Fetch Jeju fishery prices for a species. Never throws.
 * Runs the official data.go.kr backfill and the mandatory Perplexity enrichment
 * in parallel; falls back to a Perplexity price lookup when official is empty.
 */
export async function getFisheryPrice(
  speciesInput?: string | null,
  daysInput?: string | number | null,
): Promise<FisheryResult> {
  const species = (speciesInput ?? '').trim()
  if (!species) {
    return { ok: false, error: 'species (수산물표준코드명) query param is required' }
  }
  const parsedDays =
    typeof daysInput === 'number' ? daysInput : parseNum(daysInput ?? null) ?? 7
  const days = Math.min(14, Math.max(1, Math.trunc(parsedDays || 7)))

  const errors: string[] = []

  // Official numbers + mandatory Perplexity context run concurrently.
  const [officialSettled, contextResult] = await Promise.all([
    (async () => {
      try {
        return await fetchOfficial(species, days)
      } catch (e: unknown) {
        return {
          latest: null,
          trend: [] as FisheryTrendPoint[],
          errors: [`datago: ${e instanceof Error ? e.message : String(e)}`],
        }
      }
    })(),
    fetchContext(species, errors),
  ])

  errors.push(...officialSettled.errors)

  let source: 'datago' | 'perplexity' = 'datago'
  let confidence: 'high' | 'low' = 'high'
  let latest = officialSettled.latest
  let trend = officialSettled.trend
  let contextMeta = contextResult.meta

  // FALLBACK: official empty (403/propagation/resultCode/timeout/no Jeju rows).
  if (!latest) {
    const fb = await fetchPriceFallback(species, errors)
    if (fb) {
      source = 'perplexity'
      confidence = 'low'
      latest = fb
      trend = [] // no reliable series from a single fallback lookup
      // asOf for the fallback is the price's reference date.
      contextMeta = { ...contextMeta, asOf: fb.date }
    }
  }

  return {
    ok: true,
    species,
    source,
    confidence,
    latest,
    trend,
    context: contextResult.text,
    contextMeta,
    freshnessNote: FRESHNESS_NOTE,
    updatedAt: new Date().toISOString(),
    errors,
  }
}
