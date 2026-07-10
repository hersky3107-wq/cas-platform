import 'server-only'

/**
 * SHARED Jeju 축제·행사 (events) layer — 도민(resident) mode, RESIDENT lens.
 * Consumed by GET /api/domin/events.
 *
 * Sources:
 *   1. 한국문화정보원 한눈에보는문화정보 (B553457/cultureinfo, XML):
 *        /area2 (지역별, sido=제주) → primary list
 *        /detail2 (seq) → per-item price / url / address enrichment
 *        /realm2 (분야별) → best-effort festival enrichment
 *   2. Perplexity — fills what the culture DB misses (도정/시정 행사, 마을 행사,
 *        주민 참여 프로그램) tagged source:"검색", merged + de-duplicated.
 *
 * RESIDENT LENS: not just big festivals — 마을 행사 / 문화강좌·체험 / 주민 참여
 * / 공연·전시 too. Grouped: 축제 / 공연전시 / 체험강좌 / 도정시정 / 기타.
 *
 * DATE FILTER (critical): inject KST today; DROP events whose endDate < today;
 * keep only events overlapping [today, today+14]; sort by startDate asc;
 * label 진행중 (started, not ended) vs 예정.
 *
 * Caching: one merged payload per KST day in jeju_events_cache (events change
 * slowly; per-click Perplexity is wasteful). ?force=1 bypass.
 *
 * ISOLATION: 'server-only'; sessionId/userId null for AI; cache via
 * supabaseAdmin. MUST NOT import governance/synod/DEEP/Arena. Never throws.
 */

import { XMLParser } from 'fast-xml-parser'

import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'
import { cleanPerplexityText, kstTodayIso, type ContextMeta } from '@/lib/jeju/fishery'
import { supabaseAdmin } from '@/lib/supabase/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// ── Constants ─────────────────────────────────────────────────────────────────

const CULTURE_BASE = 'https://apis.data.go.kr/B553457/cultureinfo'
/** 15s (was 10s) — mobile networks add latency on top of upstream response time. */
const TIMEOUT_MS = 15_000
/** Backoff before the single automatic retry on a transient failure. */
const RETRY_DELAY_MS = 500
const PERPLEXITY_TIMEOUT_MS = 20_000
const BODY_SNIPPET = 300
const WINDOW_DAYS = 14
/** Max culture items enriched via detail2 (each is a call; daily-cached). */
const DETAIL_ENRICH_CAP = 20
const PERPLEXITY_PROVIDER: ExtendedAiProviderName = 'perplexity'
const MAX_TOKENS = 2500
const FRESHNESS_NOTE = '한국문화정보원 문화정보 + 🔍 검색 (오늘부터 2주 이내)'

const PARSER = new XMLParser({ ignoreAttributes: false, parseTagValue: true, isArray: () => false })

export const EVENT_GROUPS = ['축제', '공연전시', '체험강좌', '도정시정', '기타'] as const
export type EventGroup = (typeof EVENT_GROUPS)[number]

export type EventStatus = '진행중' | '예정'
export type EventSource = '문화정보' | '검색'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EventItem {
  title: string
  /** 분야 (realmName from culture API, or Perplexity-stated category) */
  category: string
  group: EventGroup
  place: string | null
  startDate: string | null // YYYY-MM-DD
  endDate: string | null // YYYY-MM-DD
  time: string | null
  price: string | null
  lat: number | null
  lng: number | null
  thumbnail: string | null
  url: string | null
  status: EventStatus
  source: EventSource
  /** event reference date (start, or stated date for 검색 items) */
  asOf: string | null
}

export type EventGroups = Record<EventGroup, EventItem[]>

export interface EventsPayload {
  ok: true
  windowDays: number
  today: string
  groups: EventGroups
  contextMeta: ContextMeta
  freshnessNote: string
  updatedAt: string
  errors: string[]
  fromCache: boolean
}

export type EventsResult = EventsPayload | { ok: false; error: string }

export interface GetEventsOptions {
  force?: boolean
}

// ── In-process race guard ─────────────────────────────────────────────────────

const inflight = new Map<string, Promise<EventsPayload>>()

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
  return createClient('http://localhost', 'events-no-db') as unknown as SupabaseClient
}

function kstNowIso(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())}` +
    `T${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}:${pad(kst.getUTCSeconds())}+09:00`
  )
}

function emptyGroups(): EventGroups {
  return { 축제: [], 공연전시: [], 체험강좌: [], 도정시정: [], 기타: [] }
}

function redact(url: string): string {
  return url.replace(/serviceKey=[^&]+/i, 'serviceKey=***')
}

function bodySnippet(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, BODY_SNIPPET)
}

/** Decode residual HTML entities the culture API double-encodes in text. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function str(v: unknown): string {
  return v === undefined || v === null ? '' : decodeEntities(String(v)).trim()
}

function strOrNull(v: unknown): string | null {
  const s = str(v)
  return s ? s : null
}

function toNum(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** 20260709 (num/str) → 2026-07-09. Returns null when unparseable. */
function ymdToIso(v: unknown): string | null {
  const s = str(v).replace(/[^\d]/g, '')
  if (s.length !== 8) return null
  const y = s.slice(0, 4)
  const m = s.slice(4, 6)
  const d = s.slice(6, 8)
  const mm = Number(m)
  const dd = Number(d)
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
  return `${y}-${m}-${d}`
}

function parseYmd(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return Number.isNaN(d.getTime()) ? null : d
}

function addDaysIso(iso: string, days: number): string {
  const d = parseYmd(iso)!
  d.setUTCDate(d.getUTCDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

function extractJsonObject(raw: string): string {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i)
  if (fence && fence[1]) text = fence[1].trim()
  if (text.startsWith('{')) return text
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return start !== -1 && end > start ? text.slice(start, end + 1) : text
}

/** realmName / Perplexity category → normalized UI group. */
function toGroup(realm: string, hint?: string): EventGroup {
  const t = `${realm} ${hint ?? ''}`
  if (/축제|festival|페스티벌|플리마켓|장터|한마당/.test(t)) return '축제'
  if (/도정|시정|군정|행정|주민참여|공청|설명회|간담|정책|민원/.test(t)) return '도정시정'
  if (/교육|체험|강좌|워크숍|워크샵|클래스|아카데미|캠프|프로그램/.test(t)) return '체험강좌'
  if (/전시|공연|미술|음악|국악|무용|연극|뮤지컬|오페라|콘서트|클래식|영화|문학|전람|공예/.test(t))
    return '공연전시'
  return '기타'
}

// ── XML fetch ─────────────────────────────────────────────────────────────────

async function fetchXmlAttempt(url: string): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { Accept: 'application/xml', 'User-Agent': 'Mozilla/5.0 (Jeju-Events/1.0)' },
      cache: 'no-store',
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${bodySnippet(text)}`)
    const trimmed = text.trim()
    if (!trimmed.startsWith('<')) throw new Error(`Non-XML body — ${bodySnippet(trimmed)}`)
    const parsed = PARSER.parse(trimmed) as Record<string, unknown>
    const response = parsed.response as Record<string, unknown> | undefined
    const header = response?.header as Record<string, unknown> | undefined
    // NOTE: parseTagValue coerces "00" → 0, so str() yields "0". Accept the
    // numeric-collapsed success/nodata codes (00/0 = OK, 03/3 = NODATA).
    const code = str(header?.resultCode)
    const SUCCESS_CODES = new Set(['', '00', '0', '03', '3'])
    if (!SUCCESS_CODES.has(code)) {
      const msg = str(header?.resultMsg)
      throw new Error(`resultCode ${code}${msg ? `: ${msg}` : ''} — ${bodySnippet(trimmed)}`)
    }
    return parsed
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') throw new Error(`Timeout after ${TIMEOUT_MS}ms`)
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

/** fetchXmlAttempt + ONE automatic retry (after a short backoff) on transient failures. */
async function fetchXml(url: string): Promise<Record<string, unknown>> {
  try {
    return await fetchXmlAttempt(url)
  } catch (e: unknown) {
    if (!isRetryableFetchError(e)) throw e
    await sleep(RETRY_DELAY_MS)
    return await fetchXmlAttempt(url)
  }
}

function envelopeItems(parsed: Record<string, unknown>): Record<string, unknown>[] {
  const body = (parsed.response as Record<string, unknown>)?.body as Record<string, unknown> | undefined
  const items = (body?.items as Record<string, unknown>)?.item
  if (!items) return []
  return Array.isArray(items) ? (items as Record<string, unknown>[]) : [items as Record<string, unknown>]
}

// ── 1. Culture API (area2 primary + detail2 enrich + realm2 best-effort) ───────

function rawToEvent(row: Record<string, unknown>, todayIso: string): EventItem | null {
  const title = strOrNull(row.title)
  if (!title) return null
  const startDate = ymdToIso(row.startDate)
  const endDate = ymdToIso(row.endDate)
  const realm = str(row.realmName)
  return {
    title,
    category: realm || '문화행사',
    group: toGroup(realm, title),
    place: strOrNull(row.place),
    startDate,
    endDate,
    time: null,
    price: strOrNull(row.price),
    lat: toNum(row.gpsY),
    lng: toNum(row.gpsX),
    thumbnail: strOrNull(row.thumbnail) ?? strOrNull(row.imgUrl),
    url: strOrNull(row.url),
    status: startDate && startDate <= todayIso ? '진행중' : '예정',
    source: '문화정보',
    asOf: startDate,
    // seq carried transiently for detail2 enrichment (stripped before return)
    ...(row.seq != null ? { _seq: toNum(row.seq) } : {}),
  } as EventItem & { _seq?: number | null }
}

async function fetchCultureArea(todayIso: string, errors: string[]): Promise<EventItem[]> {
  const key = serviceKey()
  if (!key) {
    errors.push('culture: no service key')
    return []
  }
  const from = todayIso.replace(/-/g, '')
  const to = addDaysIso(todayIso, WINDOW_DAYS).replace(/-/g, '')
  const out: EventItem[] = []

  // Paginate area2 (sido=제주) across the window. Cap pages defensively.
  for (let page = 1; page <= 5; page++) {
    const params = new URLSearchParams({
      serviceKey: key,
      numOfRows: '100',
      pageNo: String(page),
      sido: '제주',
      from,
      to,
    })
    const url = `${CULTURE_BASE}/area2?${params.toString()}`
    if (page === 1) console.log('[events] culture area2 →', redact(url))
    try {
      const parsed = await fetchXml(url)
      const rows = envelopeItems(parsed)
      if (rows.length === 0) break
      for (const r of rows) {
        const ev = rawToEvent(r, todayIso)
        if (ev) out.push(ev)
      }
      if (rows.length < 100) break
    } catch (e: unknown) {
      errors.push(`culture area2 p${page}: ${e instanceof Error ? e.message : String(e)}`)
      break
    }
  }
  return out
}

/** Best-effort: 축제 enrichment via realm2 (분야별). Degrades silently to []. */
async function fetchCultureRealm(todayIso: string, errors: string[]): Promise<EventItem[]> {
  const key = serviceKey()
  if (!key) return []
  const from = todayIso.replace(/-/g, '')
  const to = addDaysIso(todayIso, WINDOW_DAYS).replace(/-/g, '')
  const params = new URLSearchParams({
    serviceKey: key,
    numOfRows: '100',
    pageNo: '1',
    sido: '제주',
    from,
    to,
    sortStdr: '1',
    keyword: '축제',
  })
  const url = `${CULTURE_BASE}/realm2?${params.toString()}`
  console.log('[events] culture realm2 →', redact(url))
  try {
    const parsed = await fetchXml(url)
    const rows = envelopeItems(parsed)
    const out: EventItem[] = []
    for (const r of rows) {
      const ev = rawToEvent(r, todayIso)
      if (ev) out.push(ev)
    }
    return out
  } catch (e: unknown) {
    errors.push(`culture realm2: ${e instanceof Error ? e.message : String(e)}`)
    return []
  }
}

/** Enrich a culture event with detail2 (price / url / address). Mutates in place. */
async function enrichDetail(ev: EventItem & { _seq?: number | null }): Promise<void> {
  const seq = ev._seq
  if (seq == null) return
  const key = serviceKey()
  if (!key) return
  const url = `${CULTURE_BASE}/detail2?serviceKey=${key}&seq=${seq}`
  try {
    const parsed = await fetchXml(url)
    const rows = envelopeItems(parsed)
    const d = rows[0]
    if (!d) return
    ev.price = ev.price ?? strOrNull(d.price)
    ev.url = ev.url ?? strOrNull(d.url) ?? strOrNull(d.placeUrl)
    ev.place = ev.place ?? strOrNull(d.place)
    if (ev.lat == null) ev.lat = toNum(d.gpsY)
    if (ev.lng == null) ev.lng = toNum(d.gpsX)
    ev.thumbnail = ev.thumbnail ?? strOrNull(d.imgUrl)
  } catch {
    // best-effort; leave base fields
  }
}

// ── 2. Perplexity enrichment (도정/시정 + 마을 행사) ───────────────────────────

async function fetchPerplexityEvents(
  todayIso: string,
  errors: string[],
): Promise<{ items: EventItem[]; meta: ContextMeta }> {
  const retrievedAt = kstNowIso()
  const endIso = addDaysIso(todayIso, WINDOW_DAYS)

  const systemPrompt =
    `오늘은 ${todayIso}입니다. 가장 최신 정보 위주로 답하라. ` +
    '당신은 제주 도민을 위한 행사 안내 편집자입니다. ' +
    `제주 지역에서 오늘(${todayIso})부터 2주 이내(${endIso}까지) 열리는 ` +
    '축제·행사·도정/시정 행사·주민 참여 행사·문화강좌·공연·전시를 모으세요. ' +
    '이미 끝난 행사(종료일이 오늘 이전)는 절대 넣지 마세요. ' +
    '제주도청, 제주시청, 서귀포시청 및 제주 지역 언론(제주일보, 제주의소리, 한라일보 등)을 기준으로 하세요. ' +
    '큰 축제뿐 아니라 마을 행사, 주민 참여 프로그램, 문화강좌·체험도 포함하세요. ' +
    '한국어로만 답하세요. 인용 번호([1][3] 등)와 한자·중문·일문 문장부호(。「」 등)를 쓰지 마세요. ' +
    '반드시 아래 JSON 형식만 출력하세요(설명·마크다운·코드펜스 금지):\n' +
    '{"events":[{"title":"행사명","group":"축제|공연전시|체험강좌|도정시정|기타",' +
    '"place":"장소","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD",' +
    '"source":"출처(기관/언론사)","asOf":"YYYY-MM-DD"}]}\n' +
    '각 행사에 시작일과 (가능하면) 종료일을 YYYY-MM-DD로 넣으세요. ' +
    '실제로 존재하는 행사만, 날짜를 아는 것만 넣으세요. 지어내거나 패딩하지 마세요.'

  const prompt =
    `제주 도민을 위한 ${todayIso} 기준 오늘부터 2주 이내 행사 목록을 JSON으로 주세요. ` +
    '축제, 공연·전시, 체험·강좌, 도정/시정 행사, 마을·주민 행사를 골고루. 이미 끝난 행사는 제외.'

  try {
    const r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: PERPLEXITY_PROVIDER,
      prompt,
      systemPrompt,
      maxCompletionTokens: MAX_TOKENS,
      timeoutMs: PERPLEXITY_TIMEOUT_MS,
      temperature: 0.2,
      skipLanguageInjection: true,
    })
    if (r.error || !r.text?.trim()) {
      errors.push(`perplexity: ${r.error || 'empty'}`)
      return { items: [], meta: { source: '검색', retrievedAt, asOf: null } }
    }
    const cleaned = cleanPerplexityText(r.text)
    let parsed: unknown
    try {
      parsed = JSON.parse(extractJsonObject(cleaned))
    } catch {
      try {
        parsed = JSON.parse(extractJsonObject(r.text))
      } catch {
        errors.push('perplexity: JSON parse failed')
        return { items: [], meta: { source: '검색', retrievedAt, asOf: null } }
      }
    }
    const arr =
      parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).events)
        ? ((parsed as Record<string, unknown>).events as unknown[])
        : Array.isArray(parsed)
          ? (parsed as unknown[])
          : []

    const items: EventItem[] = []
    for (const row of arr) {
      if (!row || typeof row !== 'object') continue
      const it = row as Record<string, unknown>
      const title = strOrNull(it.title)
      if (!title) continue
      const startDate = ymdToIso(str(it.startDate).replace(/-/g, '')) ?? null
      const endDate = ymdToIso(str(it.endDate).replace(/-/g, '')) ?? null
      const groupHint = str(it.group)
      items.push({
        title: cleanPerplexityText(title),
        category: groupHint || '행사',
        group: toGroup(groupHint, title),
        place: strOrNull(it.place),
        startDate,
        endDate,
        time: null,
        price: null,
        lat: null,
        lng: null,
        thumbnail: null,
        url: null,
        status: startDate && startDate <= todayIso ? '진행중' : '예정',
        source: '검색',
        asOf: startDate ?? strOrNull(it.asOf),
      })
    }
    return { items, meta: { source: '검색', retrievedAt, asOf: todayIso } }
  } catch (e: unknown) {
    errors.push(`perplexity: ${e instanceof Error ? e.message : String(e)}`)
    return { items: [], meta: { source: '검색', retrievedAt, asOf: null } }
  }
}

// ── Window filter + dedupe + group ─────────────────────────────────────────────

/** Keep only events overlapping [today, today+windowDays]; drop finished. */
function withinWindow(ev: EventItem, todayIso: string, endIso: string): boolean {
  // Culture items always have startDate; require it for windowing.
  if (!ev.startDate) {
    // Perplexity item with no date → cannot verify recency → drop.
    return false
  }
  // endDate defaults to startDate when missing (single-day / unknown end).
  const end = ev.endDate ?? ev.startDate
  // finished before today → drop
  if (end < todayIso) return false
  // starts after the window → drop
  if (ev.startDate > endIso) return false
  return true
}

function normTitle(t: string): string {
  return t.toLowerCase().replace(/[\s\-·,.()[\]{}!?'"~/]+/g, '')
}

/**
 * Merge culture + Perplexity, de-duplicated by title+start similarity.
 * Culture-API items win (they carry coords / url / price).
 */
function mergeDedupe(culture: EventItem[], search: EventItem[]): EventItem[] {
  const seen = new Map<string, EventItem>()
  const keyOf = (ev: EventItem) => `${normTitle(ev.title)}|${ev.startDate ?? ''}`

  for (const ev of culture) {
    seen.set(keyOf(ev), ev)
  }
  for (const ev of search) {
    const k = keyOf(ev)
    if (seen.has(k)) continue
    // also treat as dup if a culture item shares the normalized title (any date)
    const nt = normTitle(ev.title)
    const titleDup = Array.from(seen.values()).some(
      (c) => c.source === '문화정보' && normTitle(c.title) === nt,
    )
    if (titleDup) continue
    seen.set(k, ev)
  }
  return Array.from(seen.values())
}

function groupAndSort(items: EventItem[]): EventGroups {
  const groups = emptyGroups()
  for (const ev of items) {
    // strip transient _seq before emitting
    delete (ev as EventItem & { _seq?: number | null })._seq
    groups[ev.group].push(ev)
  }
  for (const g of EVENT_GROUPS) {
    groups[g].sort((a, b) => {
      const cmp = (a.startDate ?? '').localeCompare(b.startDate ?? '')
      return cmp !== 0 ? cmp : a.title.localeCompare(b.title, 'ko')
    })
  }
  return groups
}

// ── Cache I/O (mirrors jeju_news_cache) ────────────────────────────────────────

async function readCache(cacheDate: string): Promise<EventsPayload | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('jeju_events_cache')
      .select('payload')
      .eq('cache_date', cacheDate)
      .maybeSingle()
    if (error) {
      console.warn('[events] cache read:', error.message)
      return null
    }
    if (!data?.payload || typeof data.payload !== 'object') return null
    const payload = data.payload as EventsPayload
    if (!payload.ok || !payload.groups) return null
    return { ...payload, fromCache: true }
  } catch (e: unknown) {
    console.warn('[events] cache read threw:', e instanceof Error ? e.message : e)
    return null
  }
}

async function writeCache(cacheDate: string, payload: EventsPayload): Promise<EventsPayload> {
  try {
    const { error } = await supabaseAdmin.from('jeju_events_cache').insert({
      cache_date: cacheDate,
      payload: { ...payload, fromCache: false },
    })
    if (!error) return payload
    const isConflict = error.code === '23505' || /duplicate|unique/i.test(error.message)
    if (isConflict) {
      console.log('[events] cache race — re-reading winner for', cacheDate)
      const winner = await readCache(cacheDate)
      if (winner) return winner
    } else {
      console.warn('[events] cache write:', error.message)
    }
  } catch (e: unknown) {
    console.warn('[events] cache write threw:', e instanceof Error ? e.message : e)
  }
  return payload
}

// ── Build fresh payload ─────────────────────────────────────────────────────────

async function buildFreshPayload(): Promise<EventsPayload> {
  const errors: string[] = []
  const today = kstTodayIso()
  const endIso = addDaysIso(today, WINDOW_DAYS)
  console.log('[events] fresh build', today, '→', endIso)

  const [areaSettled, realmSettled, pplxSettled] = await Promise.allSettled([
    fetchCultureArea(today, errors),
    fetchCultureRealm(today, errors),
    fetchPerplexityEvents(today, errors),
  ])

  const areaItems = areaSettled.status === 'fulfilled' ? areaSettled.value : []
  if (areaSettled.status === 'rejected') {
    errors.push(`culture area(settled): ${String(areaSettled.reason)}`)
  }
  const realmItems = realmSettled.status === 'fulfilled' ? realmSettled.value : []
  const searchItems = pplxSettled.status === 'fulfilled' ? pplxSettled.value.items : []
  let contextMeta: ContextMeta = { source: '검색', retrievedAt: kstNowIso(), asOf: null }
  if (pplxSettled.status === 'fulfilled') contextMeta = pplxSettled.value.meta
  else errors.push(`perplexity(settled): ${String(pplxSettled.reason)}`)

  // Merge the two culture sources (dedupe by title+start), keep those in window.
  const cultureMerged = mergeDedupe(areaItems, realmItems).filter((ev) =>
    withinWindow(ev, today, endIso),
  )

  // Enrich a bounded number via detail2 (price/url) — parallel, best-effort.
  const toEnrich = cultureMerged.slice(0, DETAIL_ENRICH_CAP)
  await Promise.allSettled(toEnrich.map((ev) => enrichDetail(ev as EventItem & { _seq?: number | null })))

  // Merge culture + Perplexity, window-filter Perplexity items too.
  const searchInWindow = searchItems.filter((ev) => withinWindow(ev, today, endIso))
  const all = mergeDedupe(cultureMerged, searchInWindow)

  const groups = groupAndSort(all)
  const total = all.length
  if (total === 0) errors.push('events: no events in window after filtering')

  return {
    ok: true,
    windowDays: WINDOW_DAYS,
    today,
    groups,
    contextMeta,
    freshnessNote: FRESHNESS_NOTE,
    updatedAt: new Date().toISOString(),
    errors,
    fromCache: false,
  }
}

// ── Public entry ──────────────────────────────────────────────────────────────

/**
 * Fetch Jeju resident-lens events (오늘 → +14일).
 * First request of a KST day → culture XML + Perplexity → cache in
 * jeju_events_cache. Later requests same day → cache hit. Never throws.
 */
export async function getEvents(opts: GetEventsOptions = {}): Promise<EventsResult> {
  const cacheDate = kstTodayIso()
  const force = Boolean(opts.force)

  if (!force) {
    const cached = await readCache(cacheDate)
    if (cached) {
      console.log('[events] cache hit', cacheDate)
      return cached
    }
  } else {
    console.log('[events] force bypass cache', cacheDate)
  }

  const existing = inflight.get(cacheDate)
  if (existing && !force) {
    console.log('[events] awaiting in-flight fetch', cacheDate)
    return existing
  }

  const work = (async (): Promise<EventsPayload> => {
    const fresh = await buildFreshPayload()
    if (force) return { ...fresh, fromCache: false }
    return writeCache(cacheDate, fresh)
  })()

  if (!force) inflight.set(cacheDate, work)
  try {
    return await work
  } finally {
    if (!force) inflight.delete(cacheDate)
  }
}
