import 'server-only'

/**
 * SHARED Jeju public-bus module — generic infrastructure reused by tourist,
 * foreigner, and (future) resident-accessibility modes. NOT tourist-specific.
 *
 * Wraps the public TAGO bus open APIs (data.go.kr / 1613000) for Jeju
 * (cityCode = 39 covers the whole island). Auth via the shared data.go.kr
 * serviceKey (DATA_GO_KR_KEY → KPX_SERVICE_KEY fallback), same pattern as the
 * odcloud connectors.
 *
 * DESIGN CONTRACT:
 *   - 'server-only' — the serviceKey never reaches the client. Consume these
 *     functions exclusively from API routes / server code.
 *   - Every function returns BusResult<T> ({ ok, data } | { ok, error }) and
 *     NEVER throws — a hung/erroring TAGO call degrades gracefully.
 *   - ~10s AbortController timeout per upstream call.
 *   - Normalizes TAGO quirks: single-object-instead-of-array (wrapped), and
 *     XML error envelopes returned even when _type=json is requested.
 *   - Station names embed route context (e.g. "제주국제공항(600번)"); we keep the
 *     raw nodeNm and never over-parse it.
 */

const BASE = 'http://apis.data.go.kr/1613000'
const CITY_CODE = '39' // 제주도 — single code for the whole island
const TIMEOUT_MS = 10_000

// ── Result + domain types ─────────────────────────────────────────────────────

export type BusResult<T> = { ok: true; data: T } | { ok: false; error: string }

export interface BusStation {
  nodeId: string
  nodeNm: string
  lat: number
  lng: number
  /** Straight-line meters from the query point (when computed). */
  distance?: number
}

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

export interface BusRouteStop {
  seq: number
  nodeId: string
  nodeNm: string
  lat: number
  lng: number
}

export interface BusRoute {
  routeId: string
  routeNo: string
  routeType: string | null
  startNode: string | null
  endNode: string | null
  stops: BusRouteStop[]
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

/**
 * Fetch a TAGO operation and return its normalized item array.
 * Returns { ok:false } on network error, timeout, XML error envelope, or a
 * non-'00' resultCode. An empty result set is a SUCCESS with an empty array.
 */
async function tagoFetch<T>(
  path: string,
  params: Record<string, string | number>
): Promise<BusResult<T[]>> {
  const key = serviceKey()
  if (!key) return { ok: false, error: 'Bus API key not configured' }

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
      console.error(`[bus] HTTP ${res.status} for ${masked(url)}`)
      return { ok: false, error: `Bus API error (HTTP ${res.status})` }
    }

    // TAGO sometimes returns an XML error envelope even with _type=json.
    const trimmed = text.trimStart()
    if (trimmed.startsWith('<')) {
      const codeMatch = trimmed.match(/<returnReasonCode>([^<]*)<\/returnReasonCode>/i)
      const msgMatch = trimmed.match(/<returnAuthMsg>([^<]*)<\/returnAuthMsg>/i)
      console.error(
        `[bus] XML error envelope (code=${codeMatch?.[1] ?? '?'}, msg=${msgMatch?.[1] ?? '?'}) for ${masked(url)}`
      )
      return { ok: false, error: 'Bus API returned an error' }
    }

    let json: TagoEnvelope
    try {
      json = JSON.parse(text) as TagoEnvelope
    } catch {
      console.error(`[bus] Unparseable response for ${masked(url)}: ${text.slice(0, 200)}`)
      return { ok: false, error: 'Bus API returned an unexpected response' }
    }

    const header = json.response?.header
    if (header?.resultCode && header.resultCode !== '00') {
      // resultCode 03 / NODATA_ERROR = empty (valid), not a failure.
      if (header.resultCode === '03') return { ok: true, data: [] }
      console.error(`[bus] resultCode=${header.resultCode} (${header.resultMsg ?? ''}) for ${masked(url)}`)
      return { ok: false, error: header.resultMsg || 'Bus API error' }
    }

    const rawItems = json.response?.body?.items
    const item = rawItems && typeof rawItems === 'object' ? rawItems.item : undefined
    return { ok: true, data: asArray<T>(item) }
  } catch (e) {
    const aborted = (e as { name?: string })?.name === 'AbortError'
    console.error(`[bus] ${aborted ? 'timeout' : 'fetch error'} for ${masked(url)}`)
    return { ok: false, error: aborted ? 'Bus API timed out' : 'Bus API request failed' }
  } finally {
    clearTimeout(timer)
  }
}

// ── Distance helper (haversine, meters) ────────────────────────────────────────

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLng = ((bLng - aLng) * Math.PI) / 180
  const lat1 = (aLat * Math.PI) / 180
  const lat2 = (bLat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return Math.round(2 * R * Math.asin(Math.sqrt(h)))
}

// ── 1. Nearby stations by coordinate ───────────────────────────────────────────

type RawStation = {
  nodeid?: string
  nodenm?: string
  gpslati?: number | string
  gpslong?: number | string
}

/**
 * Stations near a coordinate (BusSttnInfoInqireService/getCrdntPrxmtSttnList).
 * Distance is computed locally (haversine) and used to sort ascending.
 */
export async function getNearbyStations(
  lat: number,
  lng: number
): Promise<BusResult<BusStation[]>> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, error: 'Invalid coordinates' }
  }

  const r = await tagoFetch<RawStation>('BusSttnInfoInqireService/getCrdntPrxmtSttnList', {
    gpsLati: lat,
    gpsLong: lng,
  })
  if (!r.ok) return r

  const stations: BusStation[] = r.data
    .map((s) => {
      const sLat = num(s.gpslati)
      const sLng = num(s.gpslong)
      return {
        nodeId: String(s.nodeid ?? ''),
        nodeNm: String(s.nodenm ?? ''),
        lat: sLat,
        lng: sLng,
        distance: haversineMeters(lat, lng, sLat, sLng),
      }
    })
    .filter((s) => s.nodeId !== '')
    .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0))

  return { ok: true, data: stations }
}

// ── 2. Real-time arrivals at a station ──────────────────────────────────────────

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
 * (ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList, cityCode=39).
 * Sorted by soonest arrival. An empty array means no imminent bus (normal).
 */
export async function getStationArrivals(nodeId: string): Promise<BusResult<BusArrival[]>> {
  const id = nodeId?.trim()
  if (!id) return { ok: false, error: 'Missing nodeId' }

  const r = await tagoFetch<RawArrival>(
    'ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList',
    { cityCode: CITY_CODE, nodeId: id }
  )
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

// ── 3. Search a route by number → ordered stop list ─────────────────────────────

type RawRoute = {
  routeid?: string
  routeno?: string | number
  routetp?: string
  startnodenm?: string
  endnodenm?: string
}

type RawRouteStop = {
  nodeid?: string
  nodenm?: string
  nodeord?: number | string
  gpslati?: number | string
  gpslong?: number | string
}

/**
 * "Where does bus N go" — search a Jeju route by its number and return the
 * matching route with its ordered stop list.
 *
 * Step 1: BusRouteInfoInqireService/getRouteNoList (cityCode=39, routeNo) →
 *         candidate routeIds. We pick the first exact-number match.
 * Step 2: BusRouteInfoInqireService/getRouteAcctoThrghSttnList (routeId) →
 *         ordered stops.
 *
 * When several routes share a number (e.g. branch variants), `routeId` selects
 * the first; callers wanting variant choice can extend this later.
 */
export async function searchRouteByNumber(routeNo: string): Promise<BusResult<BusRoute>> {
  const no = routeNo?.trim()
  if (!no) return { ok: false, error: 'Missing route number' }

  const listed = await tagoFetch<RawRoute>('BusRouteInfoInqireService/getRouteNoList', {
    cityCode: CITY_CODE,
    routeNo: no,
  })
  if (!listed.ok) return listed
  if (listed.data.length === 0) {
    return { ok: false, error: 'NO_ROUTE' }
  }

  // Prefer an exact route-number match; fall back to the first candidate.
  const exact = listed.data.find((r) => String(r.routeno ?? '') === no)
  const chosen = exact ?? listed.data[0]!
  const routeId = String(chosen.routeid ?? '')
  if (!routeId) return { ok: false, error: 'NO_ROUTE' }

  const stopsRes = await tagoFetch<RawRouteStop>(
    'BusRouteInfoInqireService/getRouteAcctoThrghSttnList',
    { cityCode: CITY_CODE, routeId }
  )
  if (!stopsRes.ok) return stopsRes

  const stops: BusRouteStop[] = stopsRes.data
    .map((s) => ({
      seq: num(s.nodeord),
      nodeId: String(s.nodeid ?? ''),
      nodeNm: String(s.nodenm ?? ''),
      lat: num(s.gpslati),
      lng: num(s.gpslong),
    }))
    .filter((s) => s.nodeNm !== '')
    .sort((a, b) => a.seq - b.seq)

  return {
    ok: true,
    data: {
      routeId,
      routeNo: String(chosen.routeno ?? no),
      routeType: str(chosen.routetp),
      startNode: str(chosen.startnodenm),
      endNode: str(chosen.endnodenm),
      stops,
    },
  }
}
