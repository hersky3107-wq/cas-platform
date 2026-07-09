import 'server-only'

/**
 * SHARED Jeju transport layer — 도민(resident) mode.
 * Consumed by GET /api/domin/transport. Pure proxy, no DB.
 *
 * Sections:
 *   1. BUS — REUSES lib/jeju/bus.ts (TAGO 국토교통부 버스도착정보). Given optional
 *        nodeId / lat / lng (default: 제주시청 area), returns next-arrival info.
 *   2. AIRPORT — 국토교통부_(TAGO)_국내항공운항정보
 *        (apis.data.go.kr/1613000/DmstcFlightNvgInfo/GetArprtList →
 *        GetFlightOpratInfoList). Resolves 제주 code from GetArprtList, then
 *        queries today's 제주 departures/arrivals across major mainland routes.
 *   3. FERRY — 국토교통부_(TAGO)_국내선박운항정보
 *        (apis.data.go.kr/1613000/DmstcShipNvgInfo/GetPortList →
 *        GetShipOpratInfoList). Discovers Jeju port codes, lists today's sailings.
 *
 * ENDPOINT NOTE: service segment = "DmstcFlightNvgInfo" / "DmstcShipNvgInfo"
 * (NO trailing "Service"). Operations are capital-G (GetArprtList etc.).
 * Auth: lowercase serviceKey via URLSearchParams — same form as the bus call.
 *
 * Auth: JEJU_DATAGO_KEY → DATA_GO_KR_KEY → KPX_SERVICE_KEY (same as marine).
 * Perplexity: always-on enrichment + fallback if airport/ferry upstream fails.
 * Never throws; section-level degrade via Promise.allSettled + errors[].
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'
import {
  getNearbyStations,
  getStationArrivals,
  type BusArrival,
} from '@/lib/jeju/bus'
import {
  cleanPerplexityText,
  kstTodayIso,
  type ContextMeta,
} from '@/lib/jeju/fishery'

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * data.go.kr gateway — same host/auth as the working bus call.
 * Dataset 15098526 end-point: https://apis.data.go.kr/1613000/DmstcFlightNvgInfo
 * Dataset 15098523 end-point: https://apis.data.go.kr/1613000/DmstcShipNvgInfo
 *
 * CRITICAL: the service segment is "DmstcFlightNvgInfo" / "DmstcShipNvgInfo"
 * (NO trailing "Service"). Operations use capital-G (GetArprtList, etc.).
 * Auth: lowercase serviceKey, same encoding form as the bus call.
 */
const TAGO_BASE = 'https://apis.data.go.kr/1613000'
const FLIGHT_LIST = `${TAGO_BASE}/DmstcFlightNvgInfo/GetArprtList`
const FLIGHT_OP   = `${TAGO_BASE}/DmstcFlightNvgInfo/GetFlightOpratInfoList`
const SHIP_PORT_LIST = `${TAGO_BASE}/DmstcShipNvgInfo/GetPortList`
const SHIP_OP = `${TAGO_BASE}/DmstcShipNvgInfo/GetShipOpratInfoList`

const TIMEOUT_MS = 10_000
const BODY_SNIPPET = 300
const PERPLEXITY_PROVIDER: ExtendedAiProviderName = 'perplexity'
const CONTEXT_MAX_TOKENS = 400
const FALLBACK_MAX_TOKENS = 350

/**
 * Fallback TAGO airport ids (NAA + ICAO) used only if getArprtList fails.
 * Confirmed by portal sample (NAARKPC = 제주, NAARKSS = 김포, NAARKJJ = 광주).
 */
const FALLBACK_CJU_ID = 'NAARKPC'
const FALLBACK_MAINLAND: { id: string; name: string }[] = [
  { id: 'NAARKSS', name: '김포' },
  { id: 'NAARKPK', name: '김해' },
  { id: 'NAARKTU', name: '청주' },
  { id: 'NAARKTN', name: '대구' },
  { id: 'NAARKJJ', name: '광주' },
]

/** Port-name keywords that mark a port as Jeju-side (from getPortList). */
const JEJU_PORT_KEYWORDS = ['제주', '성산', '추자', '한림', '화순', '우도', '애월', '서귀포', '모슬포', '도두', '이호']

/** Default Jeju City map center (제주시청) for the bus board when no stop given. */
const DEFAULT_BUS_LAT = 33.4996
const DEFAULT_BUS_LNG = 126.5312
const MAX_BUS_STATIONS = 2
const MAX_BUS_ROWS = 10
const MAX_FLIGHTS = 20
const MAX_FERRY_PORTS = 4

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BusRow {
  route: string
  arrivalMin: number
  stopsLeft: number
  stopName: string
  lowFloor: boolean
}

export interface FlightRow {
  flightId: string
  airline: string | null
  origin: string
  dest: string
  schedTime: string | null
  estTime: string | null
  status: string
}

export interface FerryRow {
  route: string
  dep: string
  arr: string
  schedTime: string | null
  status: string
}

export type TransportType = 'departure' | 'arrival' | 'both'

export interface TransportPayload {
  ok: true
  source: 'datago' | 'perplexity'
  confidence: 'high' | 'low'
  bus: BusRow[]
  airport: { departures: FlightRow[]; arrivals: FlightRow[] }
  ferry: FerryRow[]
  context: string
  contextMeta: ContextMeta
  freshnessNote: string
  updatedAt: string
  errors: string[]
}

export type TransportResult = TransportPayload | { ok: false; error: string }

export interface TransportOptions {
  type?: TransportType
  nodeId?: string | null
  lat?: number | null
  lng?: number | null
}

// ── Key + fetch helpers (mirror marine.ts / weather-alert.ts) ─────────────────

function serviceKey(): string {
  return (
    process.env.JEJU_DATAGO_KEY ??
    process.env.DATA_GO_KR_KEY ??
    process.env.KPX_SERVICE_KEY ??
    ''
  )
}

function masked(url: string): string {
  return url.replace(/serviceKey=[^&]+/i, 'serviceKey=***')
}

function logUrl(label: string, url: string): void {
  console.log(`[transport] ${label} →`, masked(url))
}

function bodySnippet(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, BODY_SNIPPET)
}

function asArray<T>(item: unknown): T[] {
  if (Array.isArray(item)) return item as T[]
  if (item === undefined || item === null || item === '') return []
  return [item as T]
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim()
}

/** First non-empty string among the given keys (TAGO field-name drift tolerant). */
function pick(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const s = str(obj[k])
    if (s) return s
  }
  return ''
}

function parseNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim().replace(/,/g, ''))
    return Number.isFinite(n) ? n : null
  }
  return null
}

type TagoEnvelope = {
  response?: {
    header?: { resultCode?: string; resultMsg?: string }
    body?: { items?: { item?: unknown } | '' | null }
  }
}

/**
 * Fetch a TAGO op (JSON) and return its normalized item array. Throws on
 * network error / timeout / XML error envelope / non-'00'-non-empty resultCode.
 * NODATA (03/04) is a SUCCESS with an empty array.
 */
async function fetchTago(label: string, url: string): Promise<Record<string, unknown>[]> {
  logUrl(label, url)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; Jeju-Transport/1.0)',
      },
      cache: 'no-store',
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${bodySnippet(text)}`)

    const trimmed = text.trim()
    // TAGO returns an XML error envelope even with _type=json on auth/quota errors.
    if (trimmed.startsWith('<')) {
      const code = trimmed.match(/<returnReasonCode>([^<]*)<\/returnReasonCode>/i)?.[1]
      const msg = trimmed.match(/<returnAuthMsg>([^<]*)<\/returnAuthMsg>/i)?.[1]
      throw new Error(`XML error (code=${code ?? '?'}, msg=${msg ?? '?'}) — ${bodySnippet(trimmed)}`)
    }

    let json: TagoEnvelope
    try {
      json = JSON.parse(trimmed) as TagoEnvelope
    } catch {
      throw new Error(`Non-JSON body — ${bodySnippet(trimmed)}`)
    }

    const header = json.response?.header
    const code = str(header?.resultCode)
    if (code && code !== '00') {
      // 03/04 = NODATA → valid empty result.
      if (code === '03' || code === '04') return []
      // Surface the full raw header so auth/gateway mismatches (e.g. resultCode 99
      // "지원하지 않는 인증방식") are diagnosable from errors[] / logs.
      throw new Error(
        `resultCode ${code}${header?.resultMsg ? `: ${header.resultMsg}` : ''} — ${bodySnippet(trimmed)}`,
      )
    }

    const items = json.response?.body?.items
    const item = items && typeof items === 'object' ? items.item : undefined
    return asArray<Record<string, unknown>>(item)
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`Timeout after ${TIMEOUT_MS}ms`)
    }
    throw e instanceof Error ? e : new Error(String(e))
  } finally {
    clearTimeout(timer)
  }
}

// ── Date / time helpers ───────────────────────────────────────────────────────

/** KST today as YYYYMMDD (TAGO depPlandTime input). */
function ymdToday(): string {
  return kstTodayIso().replace(/-/g, '')
}

/** Current KST minutes-of-day, for "next departures" windowing. */
function kstNowMinutes(): number {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return kst.getUTCHours() * 60 + kst.getUTCMinutes()
}

function kstNowIso(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+09:00`
  )
}

/** "YYYYMMDDHHmm[ss]" → "HH:mm"; tolerant of already-short values. */
function hhmm(plandTime: string): string | null {
  const digits = plandTime.replace(/\D/g, '')
  if (digits.length >= 12) return `${digits.slice(8, 10)}:${digits.slice(10, 12)}`
  if (digits.length === 4) return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`
  return null
}

/** "HH:mm" → minutes-of-day, or null. */
function hhmmToMinutes(hm: string | null): number | null {
  if (!hm) return null
  const m = hm.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

function extractAsOf(text: string): string | null {
  const full = text.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/)
  if (full) return `${full[1]}-${full[2].padStart(2, '0')}-${full[3].padStart(2, '0')}`
  const ymKo = text.match(/(\d{4})년\s*(\d{1,2})월/)
  if (ymKo) return `${ymKo[1]}-${ymKo[2].padStart(2, '0')}`
  return null
}

function noDbSupabase(): SupabaseClient {
  return createClient('http://localhost', 'transport-no-db') as unknown as SupabaseClient
}

// ── 1. BUS (reuse lib/jeju/bus.ts) ─────────────────────────────────────────────

function mapArrivals(arrivals: BusArrival[], stopName: string): BusRow[] {
  return arrivals.map((a) => ({
    route: a.routeNo,
    arrivalMin: Math.max(0, Math.round(a.arrTimeSec / 60)),
    stopsLeft: a.stopsAway,
    stopName,
    lowFloor: a.lowFloor,
  }))
}

async function fetchBus(opts: TransportOptions, errors: string[]): Promise<BusRow[]> {
  // Explicit stop → single station board.
  const nodeId = (opts.nodeId ?? '').trim()
  if (nodeId) {
    const r = await getStationArrivals(nodeId)
    if (!r.ok) throw new Error(r.error)
    return mapArrivals(r.data, nodeId).slice(0, MAX_BUS_ROWS)
  }

  // Otherwise resolve the nearest Jeju City stops and merge their boards.
  const lat = opts.lat ?? DEFAULT_BUS_LAT
  const lng = opts.lng ?? DEFAULT_BUS_LNG
  const near = await getNearbyStations(lat, lng)
  if (!near.ok) throw new Error(near.error)
  const stations = near.data.slice(0, MAX_BUS_STATIONS)
  if (stations.length === 0) return []

  const settled = await Promise.allSettled(
    stations.map((s) => getStationArrivals(s.nodeId)),
  )

  const rows: BusRow[] = []
  settled.forEach((res, i) => {
    const station = stations[i]
    if (res.status === 'fulfilled' && res.value.ok) {
      rows.push(...mapArrivals(res.value.data, station.nodeNm || station.nodeId))
    } else {
      const reason =
        res.status === 'rejected'
          ? res.reason instanceof Error
            ? res.reason.message
            : String(res.reason)
          : (res.value as { ok: false; error: string }).error
      errors.push(`bus(${station.nodeNm || station.nodeId}): ${reason}`)
    }
  })

  return rows.sort((a, b) => a.arrivalMin - b.arrivalMin).slice(0, MAX_BUS_ROWS)
}

// ── TAGO URL builder — lowercase serviceKey, same form as the bus call ─────────

/** Build a TAGO query string with lowercase serviceKey (gateway auth form). */
function tagoQs(key: string, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    serviceKey: key,
    _type: 'json',
    numOfRows: '100',
    pageNo: '1',
    ...extra,
  })
  return params.toString()
}

// ── 2. AIRPORT (getArprtList → getFlightOpratInfoList) ─────────────────────────

interface TagoAirport {
  id: string
  name: string
}

async function resolveAirports(key: string, errors: string[]): Promise<{
  cju: TagoAirport
  mainland: TagoAirport[]
}> {
  try {
    const items = await fetchTago('airport-list', `${FLIGHT_LIST}?${tagoQs(key, { numOfRows: '200' })}`)
    if (items[0]) {
      console.log('[transport] airport-list sample →', JSON.stringify(items[0]).slice(0, 400))
    }
    const all: TagoAirport[] = items
      .map((it) => ({
        id: pick(it, ['airportId', 'airportid', 'nodeId', 'nodeid']),
        name: pick(it, ['airportNm', 'airportnm', 'nodeNm', 'nodenm']),
      }))
      .filter((a) => a.id && a.name)

    const cju =
      all.find((a) => /제주/.test(a.name) || /RKPC|CJU/i.test(a.id)) ??
      all.find((a) => a.id === FALLBACK_CJU_ID)

    if (!cju) throw new Error('제주 airport not found in getArprtList')

    // Mainland partners: prefer known Jeju routes; otherwise take non-Jeju airports.
    const preferredIds = new Set(FALLBACK_MAINLAND.map((a) => a.id))
    let mainland = all.filter((a) => a.id !== cju.id && preferredIds.has(a.id))
    if (mainland.length === 0) {
      mainland = all.filter((a) => a.id !== cju.id).slice(0, 5)
    }
    console.log(
      `[transport] CJU code=${cju.id} (${cju.name}); mainland=${mainland.map((a) => `${a.name}:${a.id}`).join(',')}`,
    )
    return { cju, mainland }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    errors.push(`airport-list: ${msg}`)
    console.warn('[transport] getArprtList failed — using fallback codes:', msg)
    return {
      cju: { id: FALLBACK_CJU_ID, name: '제주' },
      mainland: FALLBACK_MAINLAND.map((a) => ({ id: a.id, name: a.name })),
    }
  }
}

function flightUrl(key: string, depId: string, arrId: string, ymd: string): string {
  return `${FLIGHT_OP}?${tagoQs(key, {
    numOfRows: '100',
    depAirportId: depId,
    arrAirportId: arrId,
    depPlandTime: ymd,
  })}`
}

function toFlightRow(
  raw: Record<string, unknown>,
  depId: string,
  arrId: string,
  depName: string,
  arrName: string,
  side: 'departure' | 'arrival',
): FlightRow {
  const depPland = pick(raw, ['depPlandTime'])
  const arrPland = pick(raw, ['arrPlandTime'])
  return {
    flightId: pick(raw, ['vihicleId', 'flightNum', 'vhicleId']) || '항공편',
    airline: pick(raw, ['airlineNm']) || null,
    origin: pick(raw, ['depAirportNm']) || depName || depId,
    dest: pick(raw, ['arrAirportNm']) || arrName || arrId,
    schedTime: side === 'departure' ? hhmm(depPland) : hhmm(arrPland),
    estTime: null, // schedule API exposes no realtime estimate; disruptions via context
    status: '예정',
  }
}

/** Keep upcoming flights (from ~1h ago onward), soonest first, capped. */
function windowFlights(rows: FlightRow[]): FlightRow[] {
  const cutoff = kstNowMinutes() - 60
  const timed = rows
    .map((r) => ({ r, min: hhmmToMinutes(r.schedTime) }))
    .filter((x) => x.min == null || x.min >= cutoff)
  timed.sort((a, b) => (a.min ?? 9999) - (b.min ?? 9999))
  return timed.map((x) => x.r).slice(0, MAX_FLIGHTS)
}

async function fetchAirport(
  key: string,
  type: TransportType,
  ymd: string,
  errors: string[],
): Promise<{ departures: FlightRow[]; arrivals: FlightRow[] }> {
  const { cju, mainland } = await resolveAirports(key, errors)
  if (mainland.length === 0) throw new Error('no mainland airports resolved')

  interface Job {
    depId: string
    arrId: string
    depName: string
    arrName: string
    side: 'departure' | 'arrival'
  }
  const jobs: Job[] = []
  if (type !== 'arrival') {
    for (const a of mainland) {
      jobs.push({ depId: cju.id, arrId: a.id, depName: cju.name, arrName: a.name, side: 'departure' })
    }
  }
  if (type !== 'departure') {
    for (const a of mainland) {
      jobs.push({ depId: a.id, arrId: cju.id, depName: a.name, arrName: cju.name, side: 'arrival' })
    }
  }

  const settled = await Promise.allSettled(
    jobs.map((j) => fetchTago('flight', flightUrl(key, j.depId, j.arrId, ymd))),
  )

  const departures: FlightRow[] = []
  const arrivals: FlightRow[] = []
  let anySuccess = false
  settled.forEach((res, i) => {
    const j = jobs[i]
    if (res.status === 'fulfilled') {
      anySuccess = true
      const rows = res.value.map((it) =>
        toFlightRow(it, j.depId, j.arrId, j.depName, j.arrName, j.side),
      )
      if (j.side === 'departure') departures.push(...rows)
      else arrivals.push(...rows)
    } else {
      errors.push(
        `airport(${j.depName}→${j.arrName}): ${res.reason instanceof Error ? res.reason.message : String(res.reason)}`,
      )
    }
  })

  if (!anySuccess) throw new Error('all airport routes failed')

  return {
    departures: windowFlights(departures),
    arrivals: windowFlights(arrivals),
  }
}

// ── 3. FERRY (getPortList → getShipOpratInfoList) ──────────────────────────────

function portListUrl(key: string): string {
  return `${SHIP_PORT_LIST}?${tagoQs(key, { numOfRows: '1000' })}`
}

function shipOpUrl(key: string, depNodeId: string, ymd: string): string {
  return `${SHIP_OP}?${tagoQs(key, {
    numOfRows: '100',
    depPlandTime: ymd,
    depNodeId,
  })}`
}

interface JejuPort {
  nodeId: string
  nodeNm: string
}

async function resolveJejuPorts(key: string): Promise<JejuPort[]> {
  // GetPortList totalCount can be ~750; fetch all in one call by requesting 1000.
  const items = await fetchTago('ship-port-list', portListUrl(key))
  if (items[0]) {
    // Log the raw port shape once so unknown field names surface immediately.
    console.log('[transport] ship-port sample →', JSON.stringify(items[0]).slice(0, 400))
  }
  const ports: JejuPort[] = []
  for (const it of items) {
    const nodeNm = pick(it, ['nodeNm', 'nodenm', 'portNm', 'portnm', 'trmnlNm', 'trminlNm', 'nodeName'])
    const nodeId = pick(it, ['nodeId', 'nodeid', 'portId', 'portid', 'trmnlId', 'trminlId'])
    if (!nodeNm || !nodeId) continue
    if (JEJU_PORT_KEYWORDS.some((kw) => nodeNm.includes(kw))) {
      ports.push({ nodeId, nodeNm })
    }
  }
  return ports
}

function toFerryRow(raw: Record<string, unknown>, fallbackDep: string): FerryRow {
  const dep = pick(raw, ['depNodeNm', 'depnodenm', 'depPlaceNm', 'depTrminlNm']) || fallbackDep
  const arr = pick(raw, ['arrNodeNm', 'arrnodenm', 'arrPlaceNm', 'arrTrminlNm']) || '도착지'
  const ship = pick(raw, ['shipNm', 'shipnm', 'vesselNm'])
  const schedTime = hhmm(pick(raw, ['depPlandTime', 'depplandtime']))
  return {
    route: ship ? `${dep} → ${arr} (${ship})` : `${dep} → ${arr}`,
    dep,
    arr,
    schedTime,
    status: '예정',
  }
}

async function fetchFerry(key: string, ymd: string, errors: string[]): Promise<FerryRow[]> {
  const ports = await resolveJejuPorts(key)
  if (ports.length === 0) throw new Error('no Jeju ports resolved from getPortList')

  console.log(`[transport] Jeju ports: ${ports.map((p) => `${p.nodeNm}:${p.nodeId}`).join(', ')}`)

  const chosen = ports.slice(0, MAX_FERRY_PORTS)
  const settled = await Promise.allSettled(
    chosen.map((p) => fetchTago('ship-op', shipOpUrl(key, p.nodeId, ymd))),
  )

  const rows: FerryRow[] = []
  let anySuccess = false
  let loggedSample = false
  settled.forEach((res, i) => {
    const port = chosen[i]
    if (res.status === 'fulfilled') {
      anySuccess = true
      if (!loggedSample && res.value[0]) {
        console.log('[transport] ship-op sample →', JSON.stringify(res.value[0]).slice(0, 400))
        loggedSample = true
      }
      rows.push(...res.value.map((it) => toFerryRow(it, port.nodeNm)))
    } else {
      errors.push(`ferry(${port.nodeNm}): ${res.reason instanceof Error ? res.reason.message : String(res.reason)}`)
    }
  })

  if (!anySuccess) throw new Error('all Jeju ferry ports failed')

  return rows.sort((a, b) => {
    const am = hhmmToMinutes(a.schedTime) ?? 9999
    const bm = hhmmToMinutes(b.schedTime) ?? 9999
    return am - bm
  })
}

// ── Perplexity enrichment + fallback ──────────────────────────────────────────

async function fetchContext(errors: string[]): Promise<{ text: string; meta: ContextMeta }> {
  const today = kstTodayIso()
  const retrievedAt = kstNowIso()
  const systemPrompt =
    `오늘은 ${today}입니다. 가장 최신 정보 위주로, 가능하면 오늘·최근 자료를 우선하라. ` +
    '당신은 제주 교통 안내원입니다. 한국어로만, 군더더기 없이 3~4문장으로 답하세요. ' +
    '인용 번호([1][3] 등)를 쓰지 말고, 한자·중문·일문 문장부호(。「」 등)를 쓰지 마세요. ' +
    '제주공항 항공편·연안여객선·버스 등 오늘 교통 특이사항(결항·지연·기상 영향)만 사실 위주로 요약하세요.'
  const prompt =
    `제주 오늘(${today}) 교통·항공 특이사항을 알려주세요. ` +
    '제주국제공항 항공편 결항·지연, 여객선 통제, 기상으로 인한 교통 영향 위주로 알려주세요.'
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

/**
 * Fallback: when airport OR ferry upstream fails, ask Perplexity for today's
 * Jeju air/sea operating status. Returns plain text to merge into context.
 */
async function fetchTransportFallback(missing: string, errors: string[]): Promise<string> {
  const today = kstTodayIso()
  const systemPrompt =
    `오늘은 ${today}입니다. 가장 최신 정보 위주로 답하라. ` +
    '당신은 제주 교통 안내원입니다. 한국어로만 답하세요. 인용 번호([1][3] 등)를 쓰지 마세요. ' +
    '오늘 제주 기준 정보를 3~4문장으로 사실 위주로 요약하세요.'
  const prompt =
    `제주 오늘(${today}) ${missing} 운항 현황을 알려주세요. ` +
    '주요 노선의 정상 운항 여부, 결항·지연·통제 여부를 알려주세요.'
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
      return ''
    }
    return cleanPerplexityText(r.text)
  } catch (e: unknown) {
    errors.push(`fallback: ${e instanceof Error ? e.message : String(e)}`)
    return ''
  }
}

// ── Public entry ──────────────────────────────────────────────────────────────

/**
 * Fetch Jeju transport (bus + airport + ferry) with mandatory Perplexity
 * enrichment. Never throws; sections degrade to [] with errors[] entries.
 */
export async function getTransport(opts: TransportOptions = {}): Promise<TransportResult> {
  const key = serviceKey()
  if (!key) {
    return {
      ok: false,
      error: 'JEJU_DATAGO_KEY (or DATA_GO_KR_KEY / KPX_SERVICE_KEY) is not set',
    }
  }

  const type: TransportType = opts.type ?? 'both'
  const ymd = ymdToday()
  const errors: string[] = []

  let bus: BusRow[] = []
  let airport: { departures: FlightRow[]; arrivals: FlightRow[] } = { departures: [], arrivals: [] }
  let ferry: FerryRow[] = []
  let context = ''
  let contextMeta: ContextMeta = { source: '검색', retrievedAt: kstNowIso(), asOf: null }
  let source: 'datago' | 'perplexity' = 'datago'
  let confidence: 'high' | 'low' = 'high'

  // Bus is the real-time, resident-critical section. Run it FIRST and alone so
  // the airport burst (up to 10 parallel calls) can't starve TAGO's shared
  // session pool and trip its "가능한 세션 (30/30)" limit on the bus call.
  try {
    bus = await fetchBus(opts, errors)
  } catch (e: unknown) {
    errors.push(`bus: ${e instanceof Error ? e.message : String(e)}`)
  }

  const [airportSettled, ferrySettled, contextSettled] = await Promise.allSettled([
    fetchAirport(key, type, ymd, errors),
    fetchFerry(key, ymd, errors),
    fetchContext(errors),
  ])

  const airportFailed = airportSettled.status === 'rejected'
  if (airportSettled.status === 'fulfilled') {
    airport = airportSettled.value
  } else {
    errors.push(`airport: ${airportSettled.reason instanceof Error ? airportSettled.reason.message : String(airportSettled.reason)}`)
  }

  const ferryFailed = ferrySettled.status === 'rejected'
  if (ferrySettled.status === 'fulfilled') {
    ferry = ferrySettled.value
  } else {
    errors.push(`ferry: ${ferrySettled.reason instanceof Error ? ferrySettled.reason.message : String(ferrySettled.reason)}`)
  }

  if (contextSettled.status === 'fulfilled') {
    context = contextSettled.value.text
    contextMeta = contextSettled.value.meta
  } else {
    errors.push(`context: ${contextSettled.reason instanceof Error ? contextSettled.reason.message : String(contextSettled.reason)}`)
  }

  // FALLBACK: if airport OR ferry failed, enrich with a Perplexity status note.
  if (airportFailed || ferryFailed) {
    const missing = [airportFailed ? '항공편' : null, ferryFailed ? '여객선' : null]
      .filter(Boolean)
      .join('·')
    const fb = await fetchTransportFallback(missing, errors)
    if (fb) {
      context = context ? `${context}\n\n[${missing} 검색 안내] ${fb}` : fb
      source = 'perplexity'
      confidence = 'low'
    }
  }

  return {
    ok: true,
    source,
    confidence,
    bus,
    airport,
    ferry,
    context,
    contextMeta,
    freshnessNote: '버스는 실시간, 항공·여객선은 운항 스케줄 기준 (실시간 상태 아님)',
    updatedAt: new Date().toISOString(),
    errors,
  }
}
