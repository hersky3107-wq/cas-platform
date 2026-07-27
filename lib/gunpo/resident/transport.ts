import 'server-only'

/**
 * SHARED Gunpo public-bus module — 시민(resident) mode 교통 chip. Cloned from
 * lib/jeju/bus.ts (TAGO 국토교통부 버스정보 API, apis.data.go.kr/1613000).
 *
 * DIFFERENCE FROM THE JEJU ORIGINAL (by STEP4 instruction): instead of a
 * geolocation "nearby stations" search (Jeju's getCrdntPrxmtSttnList flow),
 * Gunpo uses a FIXED list of named key stops (금정역·산본역 인근) — residents
 * think in station names, not GPS coordinates, and a fixed list avoids an
 * extra client geolocation prompt.
 *
 * CONFIRMED (STEP5): GUNPO_CITY_CODE = '31160' (TAGO 도시코드, 군포시).
 * CONFIRMED (STEP5, expanded STEP8/P1-2): GUNPO_KEY_STOPS — filled from a
 * live TAGO BusSttnInfoInqireService/getCrdntPrxmtSttnList lookup
 * (cityCode=31160) run against 5 역 앵커: 금정역(37.3722,126.9435) /
 * 산본역(37.3583,126.9319) / 수리산역(37.3489,126.9256) / 대야미역
 * (37.3283,126.9128) / 군포역(37.3517,126.9482). For each anchor, candidate
 * stops were checked in order of Haversine distance (nearest first, with
 * exact-name matches preferred) against
 * ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList; the first 2 that
 * returned a NON-ERROR response (a valid resultCode, even with 0 current
 * arrivals — an empty board is a normal state, not a failure) were kept.
 * All 5 anchors returned verified stops (none were skipped) — 10 stops total.
 * NOTE: TAGO does NOT expose a "방면"(direction-to-destination) field for
 * this city, and a cross-check against
 * BusRouteInfoInqireService/getRouteAcctoThrghSttnList showed the routes
 * serving these stops are circular/loop routes (each node appears twice, at
 * two different nodeord positions) — so a single unambiguous "○○방면" text
 * can NOT be derived from TAGO data without guessing. Per instruction
 * (추측값 절대 금지), labels below use only REAL, verified fields (official
 * station name + the actual TAGO nodenm suffix / nodeno where a suffix
 * doesn't exist) instead of invented direction text — edit the `label`
 * strings directly if you know the actual signage wording.
 *
 * DESIGN CONTRACT (mirrors lib/jeju/bus.ts):
 *   - 'server-only' — the serviceKey never reaches the client.
 *   - Every function returns BusResult<T> ({ ok, data } | { ok, error }) and
 *     NEVER throws.
 *   - ~15s AbortController timeout per upstream call, ONE automatic retry on
 *     timeout/network-abort/5xx. 4xx is never retried.
 *   - Normalizes TAGO quirks: single-object-instead-of-array (wrapped), and
 *     XML error envelopes returned even when _type=json is requested (TAGO
 *     does this on auth/quota errors) — parse failures degrade to a plain
 *     error string, never an unhandled exception.
 *
 * ISOLATION: MUST NOT import lib/jeju or lib/motie.
 */

const BASE = 'https://apis.data.go.kr/1613000'
/** 15s — mobile networks add latency on top of upstream response time. */
const TIMEOUT_MS = 15_000
/** Backoff before the single automatic retry on a transient failure. */
const RETRY_DELAY_MS = 500

/** CONFIRMED (STEP5): TAGO 도시코드 — 군포시. */
export const GUNPO_CITY_CODE = '31160'

export interface GunpoKeyStop {
  /** TAGO nodeId for this stop. */
  nodeId: string
  /** Display label shown in the UI (e.g. "금정역 1번 출구"). */
  label: string
}

/**
 * CONFIRMED (STEP5, expanded STEP8/P1-2): 5개 역(금정·산본·수리산·대야미·군포)
 * 인근 핵심 정류소 10곳 — 전체 정류소가 아니라 "이 목록에 있는 것만" 보여주는
 * 구조. 좌표기반 조회(getCrdntPrxmtSttnList, cityCode=31160)로 실측되고,
 * 도착정보 조회(getSttnAcctoArvlPrearngeInfoList)가 정상 응답한 nodeId만
 * 사용 (추측 없음, 무응답 정류소 제외); distM은 조회 당시 Haversine 거리
 * (참고용 주석, 코드에서 쓰이지 않음).
 */
export const GUNPO_KEY_STOPS: readonly GunpoKeyStop[] = [
  // 금정역(37.3722, 126.9435) 기준 최근접 2곳(둘 다 도착정보 응답 정상, 현재 0건):
  { nodeId: 'GGB225000166', label: '금정역 1번출구 (AK플라자)' }, // ~50m, nodeno 26178
  { nodeId: 'GGB225000011', label: '금정역 (정류소 26112)' }, // ~59m — 실제 nodenm은 "금정역"뿐이라 방면 문구 대신 정류소번호로 구분
  // 산본역(37.3583, 126.9319) 기준 최근접 2곳:
  { nodeId: 'GGB225000052', label: '산본역 (정류소 26046)' }, // ~46m — 위와 동일한 이유로 정류소번호 사용
  { nodeId: 'GGB225000047', label: '산본역 (정류소 26054)' }, // ~161m
  // 수리산역(37.3489, 126.9256) 기준 최근접 2곳:
  { nodeId: 'GGB225000138', label: '수리산역 (정류소 26017)' }, // ~21m
  { nodeId: 'GGB225000397', label: '수리산역 (정류소 26378)' }, // ~79m, 도착정보 응답 정상(현재 0건)
  // 대야미역(37.3283, 126.9128) 기준 — 정확한 명칭 매칭(nodenm에 "대야미" 포함)을
  // 우선했으며, 최근접 후보(둔대초등학교 등)보다 멀지만(~401~423m) 방문객에게
  // 더 식별하기 쉬운 실제 역명 정류소를 선택함:
  { nodeId: 'GGB225000198', label: '대야미역 (정류소 26261)' }, // ~401m
  { nodeId: 'GGB225000188', label: '대야미역 (정류소 26181)' }, // ~423m
  // 군포역(37.3517, 126.9482) 기준 최근접 2곳:
  { nodeId: 'GGB225000275', label: '군포역 2번출구 (정류소 26252)' }, // ~224m, 도착정보 응답 정상(현재 0건)
  { nodeId: 'GGB225000117', label: '군포역 (군포1동행정복지센터, 정류소 26128)' }, // ~262m, 도착정보 응답 정상(현재 0건)
]

// ── Result + domain types (mirrors lib/jeju/bus.ts) ────────────────────────────

export type BusResult<T> = { ok: true; data: T } | { ok: false; error: string }

export interface BusArrival {
  routeNo: string
  routeId: string
  /** Seconds until arrival (TAGO `arrtime`). */
  arrTimeSec: number
  /** Stops remaining before this stop (TAGO `arrprevstationcnt`). */
  stopsAway: number
  /** Raw vehicle type label, e.g. "일반차량", "저상버스". */
  vehicleType: string | null
  /** Raw route type label, e.g. "간선", "지선", "급행". */
  routeType: string | null
  /** True when the vehicle is a low-floor (저상) bus — useful for accessibility. */
  lowFloor: boolean
}

export interface CityCodeItem {
  cityCode: string
  cityName: string
}

// ── Low-level TAGO fetch (timeout + XML-envelope + array normalization) ────────

function serviceKey(): string {
  return process.env.DATA_GO_KR_KEY ?? process.env.KPX_SERVICE_KEY ?? ''
}

/** Mask the serviceKey before logging a URL. */
function masked(url: string): string {
  return url.replace(/serviceKey=[^&]+/i, 'serviceKey=***')
}

/** Wrap a TAGO `items.item` payload (object | array | '' | undefined) into an array. */
function asArray<T>(item: unknown): T[] {
  if (Array.isArray(item)) return item as T[]
  if (item === undefined || item === null || item === '') return []
  return [item as T]
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

type TagoEnvelope = {
  response?: {
    header?: { resultCode?: string; resultMsg?: string }
    body?: {
      items?: { item?: unknown } | '' | null
      totalCount?: number
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Single attempt at a TAGO operation. Returns its normalized item array as
 * { ok:false } on network error, timeout, XML error envelope (TAGO sometimes
 * returns one even with _type=json — this is caught here, NOT thrown), or a
 * non-'00' resultCode (empty result set is a SUCCESS with an empty array),
 * plus a `retryable` flag (timeout / network-abort / 5xx — never 4xx).
 */
async function tagoFetchAttempt<T>(
  path: string,
  params: Record<string, string | number>
): Promise<{ result: BusResult<T[]>; retryable: boolean }> {
  const key = serviceKey()
  if (!key) return { result: { ok: false, error: 'Bus API key not configured' }, retryable: false }

  const qs = new URLSearchParams({
    serviceKey: key,
    _type: 'json',
    numOfRows: '50',
    pageNo: '1',
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  })
  const url = `${BASE}/${path}?${qs.toString()}`

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    const text = await res.text()

    if (!res.ok) {
      console.error(`[gunpo-transport] HTTP ${res.status} for ${masked(url)}`)
      return {
        result: { ok: false, error: `Bus API error (HTTP ${res.status})` },
        retryable: res.status >= 500,
      }
    }

    // TAGO sometimes returns an XML error envelope even with _type=json —
    // never let this throw; degrade to a plain, non-retryable error.
    const trimmed = text.trimStart()
    if (trimmed.startsWith('<')) {
      const codeMatch = trimmed.match(/<returnReasonCode>([^<]*)<\/returnReasonCode>/i)
      const msgMatch = trimmed.match(/<returnAuthMsg>([^<]*)<\/returnAuthMsg>/i)
      console.error(
        `[gunpo-transport] XML error envelope (code=${codeMatch?.[1] ?? '?'}, msg=${msgMatch?.[1] ?? '?'}) for ${masked(url)}`
      )
      return { result: { ok: false, error: 'Bus API returned an error' }, retryable: false }
    }

    let json: TagoEnvelope
    try {
      json = JSON.parse(text) as TagoEnvelope
    } catch {
      console.error(`[gunpo-transport] Unparseable response for ${masked(url)}: ${text.slice(0, 200)}`)
      return { result: { ok: false, error: 'Bus API returned an unexpected response' }, retryable: false }
    }

    const header = json.response?.header
    if (header?.resultCode && header.resultCode !== '00') {
      // resultCode 03 / NODATA_ERROR = empty (valid), not a failure.
      if (header.resultCode === '03') return { result: { ok: true, data: [] }, retryable: false }
      console.error(`[gunpo-transport] resultCode=${header.resultCode} (${header.resultMsg ?? ''}) for ${masked(url)}`)
      return { result: { ok: false, error: header.resultMsg || 'Bus API error' }, retryable: false }
    }

    const rawItems = json.response?.body?.items
    const item = rawItems && typeof rawItems === 'object' ? rawItems.item : undefined
    return { result: { ok: true, data: asArray<T>(item) }, retryable: false }
  } catch (e) {
    const aborted = (e as { name?: string })?.name === 'AbortError'
    console.error(`[gunpo-transport] ${aborted ? 'timeout' : 'fetch error'} for ${masked(url)}`)
    return {
      result: { ok: false, error: aborted ? 'Bus API timed out' : 'Bus API request failed' },
      retryable: true,
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * tagoFetchAttempt + ONE automatic retry (after a short backoff) on transient
 * failures (timeout / network abort / 5xx). Never throws.
 */
async function tagoFetch<T>(
  path: string,
  params: Record<string, string | number>
): Promise<BusResult<T[]>> {
  const first = await tagoFetchAttempt<T>(path, params)
  if (first.result.ok || !first.retryable) return first.result
  await sleep(RETRY_DELAY_MS)
  const second = await tagoFetchAttempt<T>(path, params)
  return second.result
}

// ── 0. City code list — ONE-TIME lookup helper (not used by the arrival path) ──

type RawCityCode = { citycode?: string | number; cityname?: string }

/**
 * Looks up ALL TAGO city codes (BusSttnInfoInqireService/getCtyCodeList). Use
 * this ONCE (directly, or via GET /api/gunpo/resident/transport/city-codes)
 * to find 군포시's cityCode, then hardcode it into GUNPO_CITY_CODE above.
 */
export async function fetchCityCodeList(): Promise<BusResult<CityCodeItem[]>> {
  const r = await tagoFetch<RawCityCode>('BusSttnInfoInqireService/getCtyCodeList', {})
  if (!r.ok) return r
  const items: CityCodeItem[] = r.data
    .map((c) => ({ cityCode: String(c.citycode ?? '').trim(), cityName: String(c.cityname ?? '').trim() }))
    .filter((c) => c.cityCode !== '')
  return { ok: true, data: items }
}

// ── 1. Real-time arrivals at a station (requires GUNPO_CITY_CODE) ──────────────

type RawArrival = {
  routeno?: string | number
  routeid?: string
  arrtime?: number | string
  arrprevstationcnt?: number | string
  vehicletp?: string
  routetp?: string
}

/**
 * Real-time arrivals for a station
 * (ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList, cityCode=GUNPO_CITY_CODE).
 * Sorted by soonest arrival. An empty array means no imminent bus (normal).
 */
export async function getStationArrivals(nodeId: string): Promise<BusResult<BusArrival[]>> {
  const id = nodeId?.trim()
  if (!id) return { ok: false, error: 'Missing nodeId' }
  if (!GUNPO_CITY_CODE) {
    return {
      ok: false,
      error: 'GUNPO_CITY_CODE가 아직 설정되지 않았어요 (TODO — fetchCityCodeList 참고).',
    }
  }

  const r = await tagoFetch<RawArrival>('ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList', {
    cityCode: GUNPO_CITY_CODE,
    nodeId: id,
  })
  if (!r.ok) return r

  const arrivals: BusArrival[] = r.data
    .map((a) => {
      const vehicleType = str(a.vehicletp)
      return {
        routeNo: String(a.routeno ?? ''),
        routeId: String(a.routeid ?? ''),
        arrTimeSec: num(a.arrtime),
        stopsAway: num(a.arrprevstationcnt),
        vehicleType,
        routeType: str(a.routetp),
        lowFloor: vehicleType !== null && vehicleType.includes('저상'),
      }
    })
    .filter((a) => a.routeNo !== '')
    .sort((a, b) => a.arrTimeSec - b.arrTimeSec)

  return { ok: true, data: arrivals }
}

// ── 2. Aggregate: every GUNPO_KEY_STOPS entry, merged for the 교통 chip UI ─────

export interface GunpoBusRow {
  routeNo: string
  arrivalMin: number
  stopsAway: number
  vehicleType: string | null
  lowFloor: boolean
}

export interface GunpoStopSection {
  nodeId: string
  label: string
  rows: GunpoBusRow[]
  /** Friendly error for THIS stop only (other stops still render). */
  error: string | null
}

export interface GunpoTransportPayload {
  ok: true
  cityCode: string | null
  stops: GunpoStopSection[]
  freshnessNote: string
  updatedAt: string
  errors: string[]
}

export type GunpoTransportResult = GunpoTransportPayload | { ok: false; error: string }

function mapArrivals(arrivals: BusArrival[]): GunpoBusRow[] {
  return arrivals
    .map((a) => ({
      routeNo: a.routeNo,
      arrivalMin: Math.max(0, Math.round(a.arrTimeSec / 60)),
      stopsAway: a.stopsAway,
      vehicleType: a.vehicleType,
      lowFloor: a.lowFloor,
    }))
    .sort((a, b) => a.arrivalMin - b.arrivalMin)
}

/**
 * Fetches next-arrival boards for every configured GUNPO_KEY_STOPS entry in
 * parallel. Per-stop failures degrade to an empty section + that stop's
 * `error` (other stops still render); this function itself never throws and
 * always resolves `ok: true` (an unconfigured state — e.g. if GUNPO_KEY_STOPS
 * is ever emptied again — is communicated via empty `stops` + `errors`, not a
 * hard failure).
 */
export async function getGunpoTransport(): Promise<GunpoTransportResult> {
  const errors: string[] = []

  if (!GUNPO_CITY_CODE) errors.push('transport: GUNPO_CITY_CODE 미설정 (TODO — lib/gunpo/resident/transport.ts 참고)')
  if (GUNPO_KEY_STOPS.length === 0) errors.push('transport: GUNPO_KEY_STOPS 미설정 (TODO — lib/gunpo/resident/transport.ts 참고)')

  const settled = await Promise.allSettled(GUNPO_KEY_STOPS.map((s) => getStationArrivals(s.nodeId)))

  const stops: GunpoStopSection[] = GUNPO_KEY_STOPS.map((stop, i) => {
    const res = settled[i]
    if (res?.status === 'fulfilled' && res.value.ok) {
      return { nodeId: stop.nodeId, label: stop.label, rows: mapArrivals(res.value.data), error: null }
    }
    const reason =
      res?.status === 'fulfilled'
        ? (res.value as { ok: false; error: string }).error
        : res?.reason instanceof Error
          ? res.reason.message
          : String(res?.reason ?? 'unknown error')
    errors.push(`stop(${stop.label}): ${reason}`)
    return { nodeId: stop.nodeId, label: stop.label, rows: [], error: reason }
  }).filter((stop) => stop.rows.length > 0)

  return {
    ok: true,
    cityCode: GUNPO_CITY_CODE || null,
    stops,
    freshnessNote: '정류소별 실시간 도착 정보만 표시합니다 · 국토교통부(TAGO) 버스도착정보',
    updatedAt: new Date().toISOString(),
    errors,
  }
}
