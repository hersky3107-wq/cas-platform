'use client'

/**
 * 교통 — Jeju resident transport chip.
 *
 * Data sources (two, deliberately split):
 *   - BUS: the shared Jeju bus routes (/api/jeju/bus/nearby|arrivals|route),
 *     the same endpoints the senior (/jeju/resident/bus) and tourist bus panels
 *     use. Location-aware: GPS → nearest stop, with a stop switcher and a route
 *     -number search. Only TYPES are imported from lib/jeju/bus.ts (erased at
 *     compile time) — the server-only module is never pulled into the client.
 *   - AIRPORT / FERRY / CONTEXT: GET /api/domin/transport. Its `bus` array is
 *     intentionally ignored here (it was a hardcoded-제주시청 merged board with
 *     no stop selection); the live bus section above replaces it.
 *
 * Layout (top → bottom):
 *   1. 🚌 버스  — 가까운 정류소 (GPS/앵커) + 도착 정보 + 버스 번호 찾기
 *   2. ✈️ 제주공항 — 출발/도착 tabs, ~10 rows near current time
 *   3. ⛴️ 여객선 — compact route list
 *   4. 생활 교통 요약 — Perplexity context + provenance
 *   5. 🔊 읽어주기 (ko-KR) + source credit
 *
 * Accessibility mirrors haenyeo/weather chips: ≥20px body, ≥48px targets,
 * ko-KR TTS. Adult density — NOT the senior page's oversized type scale.
 * Korean-first hardcoded strings; no i18n hook.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FriendlyErrors } from '@/components/jeju/FriendlyErrors'
import type { BusStation, BusArrival, BusRoute } from '@/lib/jeju/bus'

// ── Design tokens (resident palette — identical to weather/haenyeo) ───────────

const C = {
  bg: '#FBF4E6',
  surface: '#FFFFFF',
  ink: '#12263A',
  inkSoft: '#3C4C60',
  sea: '#0E4E8A',
  seaStrong: '#0A3A66',
  focus: '#E8590C',
  mutedBg: '#F5EAD6',
  mutedBorder: '#D9C6A2',
  mutedInk: '#4E5568',
  // status colours
  green: '#14532D',
  greenBg: '#F0FDF4',
  greenBorder: '#86EFAC',
  yellow: '#8A3F04',
  yellowBg: '#FFFBEB',
  yellowBorder: '#FCD34D',
  red: '#B91C1C',
  redBg: '#FEF2F2',
  redBorder: '#FCA5A5',
  blue: '#0A3A66',
  blueBg: '#EAF2FB',
  blueBorder: '#93C5FD',
}

// ── API types ─────────────────────────────────────────────────────────────────

/**
 * Legacy merged bus board still returned by /api/domin/transport. Kept in the
 * payload type for accuracy, but NOT rendered — the live bus section uses the
 * /api/jeju/bus/* routes instead.
 */
interface BusRow {
  route: string
  arrivalMin: number
  stopsLeft: number
  stopName: string
  lowFloor?: boolean
}

interface FlightRow {
  flightId: string
  airline: string | null
  origin: string
  dest: string
  schedTime: string | null
  estTime: string | null
  status: string
}

interface FerryRow {
  route: string
  dep: string
  arr: string
  schedTime: string | null
  status: string
}

interface ContextMeta {
  source: string
  retrievedAt: string
  asOf: string | null
}

interface TransportPayload {
  ok: true
  source: string
  confidence: string
  bus: BusRow[]
  airport: { departures: FlightRow[]; arrivals: FlightRow[] }
  ferry: FerryRow[]
  context: string
  contextMeta: ContextMeta
  freshnessNote: string
  updatedAt: string
  errors: string[]
}

type TransportResult = TransportPayload | { ok: false; error: string }

// ── Bus API types (shared /api/jeju/bus/* routes) ─────────────────────────────

type NearbyResult = { ok: true; data: BusStation[] } | { ok: false; error: string }
type ArrivalsResult = { ok: true; data: BusArrival[] } | { ok: false; error: string }
type RouteResult = { ok: true; data: BusRoute } | { ok: false; error: string }

type BusTab = 'nearby' | 'route'
type GpsState = 'idle' | 'locating' | 'ok' | 'denied'

interface Anchor {
  label: string
  lat: number
  lng: number
}

/** No-GPS fallback anchors — same coordinates the senior bus page uses. */
const ANCHORS: Anchor[] = [
  { label: '제주시청', lat: 33.4996, lng: 126.5312 },
  { label: '제주버스터미널', lat: 33.4996, lng: 126.5135 },
  { label: '제주공항', lat: 33.5063, lng: 126.4929 },
  { label: '동문시장', lat: 33.5125, lng: 126.5267 },
  { label: '서귀포시청', lat: 33.2542, lng: 126.56 },
  { label: '중문', lat: 33.2496, lng: 126.4116 },
]

/** Anchor used automatically when geolocation is denied or unavailable. */
const DEFAULT_ANCHOR = ANCHORS[0]

/** Nearby stations kept in the switcher. */
const MAX_NEARBY_STATIONS = 12
const ARRIVAL_REFRESH_MS = 30_000

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Seconds until arrival → compact Korean label. */
function fmtArrival(sec: number): string {
  if (sec <= 60) return '곧 도착'
  return `${Math.round(sec / 60)}분 후`
}

function fmtRetrieval(meta: ContextMeta): string {
  const date = meta.retrievedAt.slice(0, 10)
  return meta.asOf
    ? `🔍 검색 · ${meta.asOf} 기준 · ${date} 조회`
    : `🔍 검색 · ${date} 조회`
}

function statusStyle(status: string): React.CSSProperties {
  if (!status) return {}
  if (status.includes('결항')) return { background: C.redBg, color: C.red, borderColor: C.redBorder }
  if (status.includes('지연')) return { background: C.yellowBg, color: C.yellow, borderColor: C.yellowBorder }
  if (status.includes('출발') || status.includes('도착')) return { background: C.greenBg, color: C.green, borderColor: C.greenBorder }
  return { background: C.blueBg, color: C.blue, borderColor: C.blueBorder }
}

// ── Component ─────────────────────────────────────────────────────────────────

type FlightTab = '출발' | '도착'

export default function TransportPage() {
  const router = useRouter()
  const [data, setData] = useState<TransportPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [flightTab, setFlightTab] = useState<FlightTab>('출발')
  const [ttsSupported, setTtsSupported] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // ── Bus section state (independent of /api/domin/transport) ────────────────
  const [busTab, setBusTab] = useState<BusTab>('nearby')
  const [gpsState, setGpsState] = useState<GpsState>('idle')
  /** Label of whatever the nearby search was measured from ('내 위치' or an anchor). */
  const [originLabel, setOriginLabel] = useState<string>('내 위치')
  const [stations, setStations] = useState<BusStation[] | null>(null)
  const [loadingStations, setLoadingStations] = useState(false)
  const [activeStation, setActiveStation] = useState<BusStation | null>(null)
  const [busArrivals, setBusArrivals] = useState<BusArrival[] | null>(null)
  const [loadingArrivals, setLoadingArrivals] = useState(false)
  const [showAllStations, setShowAllStations] = useState(false)
  const [routeNo, setRouteNo] = useState('')
  const [route, setRoute] = useState<BusRoute | null>(null)
  const [loadingRoute, setLoadingRoute] = useState(false)
  const [routeError, setRouteError] = useState<string | null>(null)
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) setTtsSupported(true)
  }, [])

  useEffect(
    () => () => {
      abortRef.current?.abort()
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try { window.speechSynthesis.cancel() } catch { /* no-op */ }
      }
    },
    [],
  )

  const fetchData = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch('/api/domin/transport?type=both', {
        signal: ctrl.signal,
        cache: 'no-store',
      })
      const json = (await res.json()) as TransportResult
      if (!json.ok) {
        setFetchError((json as { ok: false; error: string }).error)
        setData(null)
      } else {
        setData(json as TransportPayload)
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setFetchError('교통 정보를 불러오지 못했어요. 잠시 후 다시 해주세요.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchData() }, [fetchData])

  // ── Bus: nearby stations / arrivals / route search ─────────────────────────

  const clearRefresh = useCallback(() => {
    if (refreshTimer.current) {
      clearInterval(refreshTimer.current)
      refreshTimer.current = null
    }
  }, [])

  useEffect(() => () => clearRefresh(), [clearRefresh])

  const fetchArrivals = useCallback(async (station: BusStation, opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setLoadingArrivals(true)
      setBusArrivals(null)
    }
    setActiveStation(station)
    try {
      const res = await fetch('/api/jeju/bus/arrivals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId: station.nodeId }),
      })
      const json = (await res.json()) as ArrivalsResult
      setBusArrivals(json.ok ? json.data : [])
    } catch {
      setBusArrivals([])
    } finally {
      setLoadingArrivals(false)
    }
  }, [])

  const loadStations = useCallback(
    async (lat: number, lng: number, label: string) => {
      setLoadingStations(true)
      setStations(null)
      setActiveStation(null)
      setBusArrivals(null)
      setShowAllStations(false)
      setOriginLabel(label)
      try {
        const res = await fetch('/api/jeju/bus/nearby', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lat, lng }),
        })
        const json = (await res.json()) as NearbyResult
        if (json.ok && json.data.length > 0) {
          const list = json.data.slice(0, MAX_NEARBY_STATIONS)
          setStations(list)
          void fetchArrivals(list[0])
        } else {
          setStations([])
        }
      } catch {
        setStations([])
      } finally {
        setLoadingStations(false)
      }
    },
    [fetchArrivals],
  )

  /** GPS → nearest stop; falls back to the default anchor when unavailable. */
  const locate = useCallback(() => {
    clearRefresh()
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsState('denied')
      void loadStations(DEFAULT_ANCHOR.lat, DEFAULT_ANCHOR.lng, DEFAULT_ANCHOR.label)
      return
    }
    setGpsState('locating')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsState('ok')
        void loadStations(pos.coords.latitude, pos.coords.longitude, '내 위치')
      },
      () => {
        setGpsState('denied')
        void loadStations(DEFAULT_ANCHOR.lat, DEFAULT_ANCHOR.lng, DEFAULT_ANCHOR.label)
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    )
  }, [clearRefresh, loadStations])

  useEffect(() => { locate() }, [locate])

  // Auto-refresh the open station's arrivals every 30s.
  useEffect(() => {
    clearRefresh()
    if (!activeStation) return
    refreshTimer.current = setInterval(() => {
      void fetchArrivals(activeStation, { silent: true })
    }, ARRIVAL_REFRESH_MS)
    return clearRefresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStation?.nodeId])

  const searchRoute = useCallback(async () => {
    const no = routeNo.trim()
    if (!no || loadingRoute) return
    setLoadingRoute(true)
    setRouteError(null)
    setRoute(null)
    try {
      const res = await fetch('/api/jeju/bus/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routeNo: no }),
      })
      const json = (await res.json()) as RouteResult
      if (json.ok) setRoute(json.data)
      else {
        setRouteError(
          json.error === 'NO_ROUTE'
            ? '그 번호의 버스를 찾지 못했어요. 번호를 다시 확인해 주세요.'
            : '지금은 노선 정보를 불러올 수 없어요. 잠시 후 다시 시도해 주세요.',
        )
      }
    } catch {
      setRouteError('연결에 문제가 있어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoadingRoute(false)
    }
  }, [routeNo, loadingRoute])

  const stopSpeaking = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try { window.speechSynthesis.cancel() } catch { /* no-op */ }
    }
    setSpeaking(false)
  }, [])

  const buildTts = useCallback((d: TransportPayload | null): string => {
    const parts: string[] = ['제주 교통 안내입니다.']
    // Next bus at the selected stop (live /api/jeju/bus/arrivals data)
    if (activeStation && busArrivals && busArrivals.length > 0) {
      const a = busArrivals[0]
      const when = a.arrTimeSec <= 60 ? '곧' : `${Math.round(a.arrTimeSec / 60)}분 후`
      parts.push(`${activeStation.nodeNm} 정류장, ${a.routeNo}번 버스가 ${when} 도착합니다. ${a.stopsAway}정거장 전입니다.`)
    } else if (activeStation) {
      parts.push(`${activeStation.nodeNm} 정류장에 지금 오는 버스가 없습니다.`)
    } else {
      parts.push('버스 정보가 없습니다.')
    }
    // Disrupted flights
    const disrupted = [
      ...(d?.airport?.departures ?? []),
      ...(d?.airport?.arrivals ?? []),
    ].filter(f => f.status.includes('지연') || f.status.includes('결항'))
    if (disrupted.length > 0) {
      parts.push(`항공 특이사항: ${disrupted.map(f => `${f.flightId} ${f.status}`).join(', ')}.`)
    }
    return parts.join(' ')
  }, [activeStation, busArrivals])

  const onSpeak = useCallback(() => {
    if (speaking) { stopSpeaking(); return }
    if (typeof window === 'undefined') return
    try {
      window.speechSynthesis.cancel()
      setSpeaking(true)
      const u = new SpeechSynthesisUtterance(buildTts(data))
      u.lang = 'ko-KR'; u.rate = 0.9
      u.onend = () => setSpeaking(false)
      u.onerror = () => setSpeaking(false)
      window.speechSynthesis.speak(u)
    } catch { setSpeaking(false) }
  }, [speaking, data, buildTts, stopSpeaking])

  // ── Derived ────────────────────────────────────────────────────────────────
  const departures = data?.airport?.departures ?? []
  const arrivals = data?.airport?.arrivals ?? []
  const flightRows = flightTab === '출발' ? departures : arrivals

  return (
    <div style={S.root}>
      <style>{GLOBAL_CSS}</style>

      {/* ── Top bar ───────────────────────────────────────────────────────── */}
      <div style={S.topBar}>
        <button type="button" className="rt-back" style={S.backBtn}
          onClick={() => { stopSpeaking(); router.push('/jeju/resident/general') }} aria-label="뒤로 가기">
          ← 뒤로
        </button>
        <h1 style={S.pageTitle}>🚌 교통</h1>
        <button type="button" className="rt-ctrl" style={S.refreshBtn}
          onClick={() => { stopSpeaking(); locate(); void fetchData() }}
          aria-label="새로 고침" disabled={loading}>
          {loading ? '⏳' : '🔄'}
        </button>
      </div>

      <div style={S.body}>
        {/* ── 1. 버스 (live — /api/jeju/bus/*, independent of the transport call) ── */}
        <section style={S.card} aria-label="버스 도착 정보">
          <h2 style={S.sectionTitle}>🚌 버스</h2>

          <div style={S.tabRow} role="group" aria-label="버스 보기 방식 선택">
            {([['nearby', '📍 가까운 정류소'], ['route', '🔢 버스 번호 찾기']] as [BusTab, string][]).map(([id, label]) => (
              <button key={id} type="button" className="rt-tab"
                style={busTab === id ? { ...S.tab, ...S.tabActive } : S.tab}
                onClick={() => setBusTab(id)}
                aria-pressed={busTab === id}>
                {label}
              </button>
            ))}
          </div>

          {/* ── 가까운 정류소 ─────────────────────────────────────────── */}
          {busTab === 'nearby' && (
            <>
              {gpsState === 'locating' && (
                <p style={S.busNote} aria-live="polite">📍 내 위치를 확인하는 중…</p>
              )}

              {gpsState === 'denied' && (
                <p style={S.busNote}>
                  위치를 확인할 수 없어 <strong>{DEFAULT_ANCHOR.label}</strong> 기준으로 보여드려요.
                </p>
              )}

              {loadingStations && (
                <p style={S.busNote} aria-live="polite">가까운 정류소를 찾는 중…</p>
              )}

              {!loadingStations && stations && stations.length === 0 && (
                <p style={S.empty}>가까운 정류소를 찾지 못했어요.</p>
              )}

              {activeStation && (
                <div style={S.stationHead}>
                  <div style={S.stationHeadText}>
                    <span style={S.stationName}>{activeStation.nodeNm}</span>
                    {typeof activeStation.distance === 'number' && (
                      <span style={S.stationDist}>{originLabel}에서 약 {activeStation.distance}m</span>
                    )}
                  </div>
                  <button type="button" className="rt-ctrl" style={S.stationRefresh}
                    onClick={() => void fetchArrivals(activeStation)}
                    aria-label="도착 정보 새로 고침">🔄</button>
                </div>
              )}

              {loadingArrivals ? (
                <p style={S.busNote} aria-live="polite">도착 정보를 확인하는 중…</p>
              ) : activeStation && busArrivals && busArrivals.length > 0 ? (
                <div style={S.busList} role="list" aria-live="polite">
                  {busArrivals.map((a, i) => (
                    <div key={`${a.routeId}-${i}`} role="listitem" style={S.busRow}>
                      <span style={S.busRoute}>{a.routeNo}</span>
                      <div style={S.busMeta}>
                        <span style={S.busArrival}>{fmtArrival(a.arrTimeSec)}</span>
                        <span style={S.busDetail}>
                          남은 정거장 {a.stopsAway}개{a.routeType ? ` · ${a.routeType}` : ''}
                        </span>
                      </div>
                      {a.lowFloor && (
                        <span style={S.lowFloorBadge} aria-label="저상버스">저상</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : activeStation ? (
                <p style={S.empty}>지금 오는 버스가 없어요. 잠시 후 새로 고쳐 보세요.</p>
              ) : null}

              {activeStation && <p style={S.autoRefreshNote}>30초마다 자동으로 새로 고쳐요</p>}

              {/* 가까운 다른 정류소 */}
              {stations && stations.length > 1 && (
                <div style={S.switcher}>
                  <button type="button" className="rt-ctrl" style={S.switcherToggle}
                    onClick={() => setShowAllStations(v => !v)}
                    aria-expanded={showAllStations}>
                    가까운 다른 정류소 {showAllStations ? '▲' : '▼'}
                  </button>
                  {showAllStations && (
                    <div style={S.stationList} role="list">
                      {stations.map(s => (
                        <button key={s.nodeId} type="button" className="rt-station" role="listitem"
                          style={s.nodeId === activeStation?.nodeId
                            ? { ...S.stationBtn, ...S.stationBtnOn }
                            : S.stationBtn}
                          onClick={() => void fetchArrivals(s)}
                          aria-label={`${s.nodeNm} 정류소 도착 정보 보기`}
                          aria-pressed={s.nodeId === activeStation?.nodeId}>
                          <span style={S.stationBtnName}>{s.nodeNm}</span>
                          {typeof s.distance === 'number' && (
                            <span style={S.stationBtnDist}>{s.distance}m</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 기준 위치 바꾸기 */}
              <div style={S.anchorRow} role="group" aria-label="기준 위치 선택">
                <button type="button" className="rt-chip" style={S.anchorChip}
                  onClick={() => locate()} aria-label="내 위치로 정류소 찾기">📍 내 위치</button>
                {ANCHORS.map(a => (
                  <button key={a.label} type="button" className="rt-chip"
                    style={originLabel === a.label ? { ...S.anchorChip, ...S.anchorChipOn } : S.anchorChip}
                    onClick={() => void loadStations(a.lat, a.lng, a.label)}
                    aria-pressed={originLabel === a.label}>
                    {a.label}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* ── 버스 번호 찾기 ────────────────────────────────────────── */}
          {busTab === 'route' && (
            <>
              <div style={S.routeInputRow}>
                <input
                  className="rt-input"
                  style={S.routeInput}
                  value={routeNo}
                  onChange={e => setRouteNo(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void searchRoute() }}
                  placeholder="예: 240"
                  inputMode="numeric"
                  aria-label="버스 번호 입력"
                />
                <button type="button" className="rt-ctrl"
                  style={routeNo.trim() && !loadingRoute ? S.searchBtn : { ...S.searchBtn, opacity: 0.45, cursor: 'not-allowed' }}
                  onClick={() => void searchRoute()}
                  disabled={!routeNo.trim() || loadingRoute}
                  aria-disabled={!routeNo.trim() || loadingRoute}>
                  🔍 찾기
                </button>
              </div>

              {loadingRoute && <p style={S.busNote} aria-live="polite">노선을 찾는 중…</p>}
              {!loadingRoute && routeError && <p style={S.routeErrorLine} role="alert">{routeError}</p>}

              {!loadingRoute && route && (
                <div style={S.routeWrap}>
                  <div style={S.routeHead}>
                    <span style={S.busRoute}>{route.routeNo}</span>
                    {route.routeType && <span style={S.routeTypeBadge}>{route.routeType}</span>}
                  </div>
                  {route.startNode && route.endNode && (
                    <p style={S.routeEnds}>{route.startNode} ↔ {route.endNode}</p>
                  )}
                  <ol style={S.stopList}>
                    {route.stops.map((stop, i) => (
                      <li key={`${stop.nodeId}-${i}`} style={S.stopItem}>
                        <span style={S.stopSeq}>{stop.seq}</span>
                        <span style={S.stopName}>{stop.nodeNm}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </>
          )}
        </section>

        {/* ── Loading (공항·여객선) ──────────────────────────────────────── */}
        {loading && (
          <div style={S.loadingBox} aria-live="polite" aria-busy="true">
            <span style={{ fontSize: 48 }} aria-hidden>⏳</span>
            <p style={S.loadingText}>공항·여객선 정보 불러오는 중…</p>
          </div>
        )}

        {/* ── Fetch error ───────────────────────────────────────────────── */}
        {!loading && fetchError && (
          <div style={S.errorBox} role="alert">
            <p style={S.errorText}>⚠ {fetchError}</p>
            <button type="button" className="rt-ctrl" style={S.retryBtn}
              onClick={() => void fetchData()}>다시 시도</button>
          </div>
        )}

        {/* ── Main content ──────────────────────────────────────────────── */}
        {!loading && data && (
          <>
            {/* ── 2. 제주공항 ────────────────────────────────────────────── */}
            <section style={S.card} aria-label="제주공항 운항 정보">
              <h2 style={S.sectionTitle}>✈️ 제주공항</h2>

              {/* Tab row */}
              <div style={S.tabRow} role="group" aria-label="출발/도착 선택">
                {(['출발', '도착'] as FlightTab[]).map(tab => (
                  <button key={tab} type="button" className="rt-tab"
                    style={flightTab === tab ? { ...S.tab, ...S.tabActive } : S.tab}
                    onClick={() => setFlightTab(tab)}
                    aria-pressed={flightTab === tab}>
                    {tab}
                  </button>
                ))}
              </div>

              {flightRows.length === 0 ? (
                <p style={S.empty}>정보 없음</p>
              ) : (
                <div style={S.flightList} role="list">
                  {flightRows.map((f, i) => (
                    <div key={i} role="listitem" style={S.flightRow}>
                      <div style={S.flightLeft}>
                        <span style={S.flightTime}>{f.schedTime ?? '--:--'}</span>
                        {f.estTime && f.estTime !== f.schedTime && (
                          <span style={S.flightEst}>실제 {f.estTime}</span>
                        )}
                      </div>
                      <div style={S.flightMid}>
                        <span style={S.flightId}>{f.flightId}</span>
                        <span style={S.flightAirline}>{f.airline ?? ''}</span>
                        <span style={S.flightRoute}>
                          {flightTab === '출발'
                            ? `→ ${f.dest}`
                            : `${f.origin} →`}
                        </span>
                      </div>
                      <span style={{ ...S.statusBadge, ...statusStyle(f.status) }}>
                        {f.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── 3. 여객선 ─────────────────────────────────────────────── */}
            <section style={S.card} aria-label="여객선 운항 정보">
              <h2 style={S.sectionTitle}>⛴️ 여객선</h2>
              {data.ferry.length === 0 ? (
                <p style={S.empty}>정보 없음</p>
              ) : (
                <div style={S.ferryList} role="list">
                  {data.ferry.map((f, i) => (
                    <div key={i} role="listitem" style={S.ferryRow}>
                      <span style={S.ferryTime}>{f.schedTime ?? '--:--'}</span>
                      <span style={S.ferryRoute}>{f.dep} → {f.arr}</span>
                      <span style={{ ...S.statusBadge, ...statusStyle(f.status) }}>
                        {f.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── 4. 생활 교통 요약 ───────────────────────────────────────── */}
            {data.context && (
              <section style={S.card} aria-label="생활 교통 요약">
                <h2 style={S.sectionTitle}>📋 생활 교통 요약</h2>
                <p style={S.contextText}>{data.context}</p>
                <p style={S.provenanceLine}>{fmtRetrieval(data.contextMeta)}</p>
              </section>
            )}

            {/* ── 5. TTS + source ─────────────────────────────────────────── */}
            <div style={S.bottomRow}>
              {ttsSupported && (
                <button type="button" className="rt-ctrl" style={S.ttsBtn}
                  onClick={onSpeak}
                  aria-label={speaking ? '읽기 중단' : '이 화면 읽어주기'}>
                  <span aria-hidden>{speaking ? '⏹' : '🔊'}</span>
                  {speaking ? ' 중단' : ' 읽어주기'}
                </button>
              )}
              <p style={S.sourceCredit}>자료: 국토교통부(TAGO) + 🔍 검색</p>
            </div>

            {/* API errors (non-fatal, soft display).
                bus* entries are dropped: that section no longer reads this payload. */}
            <FriendlyErrors errors={data.errors.filter(e => !/^bus/i.test(e))} />
          </>
        )}
      </div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  root: {
    minHeight: '100dvh',
    background: C.bg,
    color: C.ink,
    fontFamily:
      "'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif",
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '0 0 48px',
    boxSizing: 'border-box',
  },
  topBar: {
    width: '100%',
    maxWidth: 640,
    display: 'flex',
    alignItems: 'center',
    position: 'sticky',
    top: 0,
    background: C.bg,
    paddingTop: 12,
    paddingBottom: 10,
    paddingLeft: 16,
    paddingRight: 16,
    zIndex: 5,
    gap: 10,
    boxSizing: 'border-box',
  },
  backBtn: {
    minHeight: 48,
    fontSize: 20,
    fontWeight: 700,
    color: C.sea,
    background: C.surface,
    border: `2px solid ${C.sea}`,
    borderRadius: 12,
    cursor: 'pointer',
    padding: '6px 16px',
    whiteSpace: 'nowrap',
  },
  pageTitle: {
    flex: 1,
    fontSize: 28,
    fontWeight: 900,
    color: C.ink,
    margin: 0,
    textAlign: 'center',
    lineHeight: 1.2,
  },
  refreshBtn: {
    minHeight: 48,
    minWidth: 48,
    fontSize: 22,
    fontWeight: 700,
    color: C.sea,
    background: C.surface,
    border: `2px solid ${C.sea}`,
    borderRadius: 12,
    cursor: 'pointer',
    padding: '6px 10px',
  },
  body: {
    width: '100%',
    maxWidth: 640,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    padding: '4px 16px 0',
    boxSizing: 'border-box',
  },
  loadingBox: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
    padding: '48px 0',
  },
  loadingText: {
    fontSize: 22,
    fontWeight: 700,
    color: C.inkSoft,
    margin: 0,
  },
  errorBox: {
    background: '#FEF2F2',
    border: '2px solid #FCA5A5',
    borderRadius: 16,
    padding: '20px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    alignItems: 'flex-start',
  },
  errorText: {
    fontSize: 20,
    fontWeight: 700,
    color: C.red,
    margin: 0,
  },
  retryBtn: {
    minHeight: 48,
    fontSize: 20,
    fontWeight: 700,
    color: C.sea,
    background: C.surface,
    border: `2px solid ${C.sea}`,
    borderRadius: 12,
    cursor: 'pointer',
    padding: '8px 22px',
  },
  // Card wrapper
  card: {
    background: C.surface,
    border: `2px solid ${C.mutedBorder}`,
    borderRadius: 18,
    padding: '20px 18px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: 900,
    color: C.ink,
    margin: 0,
    lineHeight: 1.25,
  },
  empty: {
    fontSize: 20,
    color: C.mutedInk,
    margin: 0,
    padding: '8px 0',
  },
  // ── Bus ──
  busList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  busRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    background: C.mutedBg,
    borderRadius: 12,
    padding: '12px 14px',
    minHeight: 62,
    boxSizing: 'border-box',
    position: 'relative',
  },
  busRoute: {
    fontSize: 30,
    fontWeight: 900,
    color: C.sea,
    minWidth: 64,
    lineHeight: 1.1,
    whiteSpace: 'nowrap',
  },
  busMeta: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    flex: 1,
    overflow: 'hidden',
  },
  busArrival: {
    fontSize: 24,
    fontWeight: 800,
    color: C.ink,
    lineHeight: 1.2,
  },
  busDetail: {
    fontSize: 16,
    color: C.mutedInk,
    lineHeight: 1.3,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  lowFloorBadge: {
    background: '#DCEAFB',
    color: '#0E4E8A',
    fontSize: 14,
    fontWeight: 700,
    borderRadius: 8,
    padding: '3px 8px',
    whiteSpace: 'nowrap',
    alignSelf: 'center',
  },
  // ── Bus: station head / switcher / anchors / route search (adult density) ──
  busNote: {
    fontSize: 17,
    fontWeight: 600,
    color: C.mutedInk,
    margin: 0,
    lineHeight: 1.5,
  },
  stationHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: C.blueBg,
    border: `1.5px solid ${C.blueBorder}`,
    borderRadius: 12,
    padding: '10px 14px',
  },
  stationHeadText: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    flex: 1,
    minWidth: 0,
  },
  stationName: {
    fontSize: 21,
    fontWeight: 800,
    color: C.ink,
    lineHeight: 1.3,
    wordBreak: 'keep-all',
  },
  stationDist: {
    fontSize: 15,
    fontWeight: 600,
    color: C.mutedInk,
    lineHeight: 1.3,
  },
  stationRefresh: {
    minHeight: 44,
    minWidth: 44,
    fontSize: 18,
    color: C.sea,
    background: C.surface,
    border: `2px solid ${C.sea}`,
    borderRadius: 10,
    cursor: 'pointer',
    flexShrink: 0,
  },
  autoRefreshNote: {
    fontSize: 13,
    color: C.mutedInk,
    margin: 0,
    lineHeight: 1.4,
  },
  switcher: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  switcherToggle: {
    minHeight: 48,
    fontSize: 17,
    fontWeight: 700,
    color: C.sea,
    background: C.surface,
    border: `2px solid ${C.mutedBorder}`,
    borderRadius: 12,
    cursor: 'pointer',
    padding: '8px 14px',
    textAlign: 'left',
  },
  stationList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  stationBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    width: '100%',
    minHeight: 48,
    background: C.mutedBg,
    border: `1.5px solid ${C.mutedBorder}`,
    borderRadius: 10,
    padding: '8px 14px',
    cursor: 'pointer',
    textAlign: 'left',
    boxSizing: 'border-box',
  },
  stationBtnOn: {
    background: C.blueBg,
    border: `2px solid ${C.sea}`,
  },
  stationBtnName: {
    fontSize: 17,
    fontWeight: 700,
    color: C.ink,
    wordBreak: 'keep-all',
    lineHeight: 1.35,
  },
  stationBtnDist: {
    fontSize: 14,
    fontWeight: 700,
    color: C.mutedInk,
    flexShrink: 0,
  },
  anchorRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  anchorChip: {
    minHeight: 40,
    fontSize: 15,
    fontWeight: 700,
    color: C.sea,
    background: C.surface,
    border: `1.5px solid ${C.mutedBorder}`,
    borderRadius: 999,
    cursor: 'pointer',
    padding: '6px 14px',
    whiteSpace: 'nowrap',
  },
  anchorChipOn: {
    color: C.surface,
    background: C.sea,
    border: `1.5px solid ${C.seaStrong}`,
  },
  routeInputRow: {
    display: 'flex',
    gap: 10,
  },
  routeInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    fontSize: 20,
    fontWeight: 700,
    color: C.ink,
    background: C.surface,
    border: `2px solid ${C.mutedBorder}`,
    borderRadius: 12,
    padding: '8px 14px',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  },
  searchBtn: {
    minHeight: 52,
    fontSize: 18,
    fontWeight: 700,
    color: C.surface,
    background: C.sea,
    border: 'none',
    borderRadius: 12,
    cursor: 'pointer',
    padding: '8px 18px',
    flexShrink: 0,
    whiteSpace: 'nowrap',
  },
  routeErrorLine: {
    fontSize: 17,
    fontWeight: 700,
    color: C.red,
    margin: 0,
    lineHeight: 1.5,
  },
  routeWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  routeHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  routeTypeBadge: {
    fontSize: 15,
    fontWeight: 700,
    color: C.blue,
    background: C.blueBg,
    border: `1.5px solid ${C.blueBorder}`,
    borderRadius: 8,
    padding: '4px 10px',
  },
  routeEnds: {
    fontSize: 17,
    fontWeight: 600,
    color: C.inkSoft,
    margin: 0,
    lineHeight: 1.5,
    wordBreak: 'keep-all',
  },
  stopList: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    maxHeight: 420,
    overflowY: 'auto',
  },
  stopItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: C.mutedBg,
    borderRadius: 10,
    padding: '8px 12px',
  },
  stopSeq: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: 30,
    height: 30,
    borderRadius: '50%',
    background: C.blueBg,
    fontSize: 14,
    fontWeight: 800,
    color: C.sea,
  },
  stopName: {
    fontSize: 17,
    fontWeight: 600,
    color: C.ink,
    flex: 1,
    lineHeight: 1.35,
    wordBreak: 'keep-all',
  },
  // ── Airport tabs ──
  tabRow: {
    display: 'flex',
    gap: 10,
  },
  tab: {
    minHeight: 48,
    flex: 1,
    fontSize: 20,
    fontWeight: 700,
    color: C.mutedInk,
    background: C.mutedBg,
    border: `2px solid ${C.mutedBorder}`,
    borderRadius: 12,
    cursor: 'pointer',
  },
  tabActive: {
    color: C.surface,
    background: C.sea,
    border: `2px solid ${C.seaStrong}`,
  },
  // ── Flight rows ──
  flightList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  flightRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: C.mutedBg,
    borderRadius: 12,
    padding: '10px 12px',
    minHeight: 58,
    boxSizing: 'border-box',
  },
  flightLeft: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    minWidth: 68,
    gap: 2,
  },
  flightTime: {
    fontSize: 22,
    fontWeight: 800,
    color: C.ink,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1.2,
  },
  flightEst: {
    fontSize: 14,
    color: C.yellow,
    fontWeight: 700,
    lineHeight: 1.2,
  },
  flightMid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    flex: 1,
    overflow: 'hidden',
  },
  flightId: {
    fontSize: 18,
    fontWeight: 800,
    color: C.sea,
    lineHeight: 1.2,
  },
  flightAirline: {
    fontSize: 14,
    color: C.inkSoft,
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  flightRoute: {
    fontSize: 16,
    fontWeight: 700,
    color: C.ink,
    lineHeight: 1.2,
  },
  statusBadge: {
    fontSize: 15,
    fontWeight: 700,
    borderRadius: 8,
    padding: '4px 10px',
    border: '1.5px solid transparent',
    whiteSpace: 'nowrap',
    alignSelf: 'center',
  },
  // ── Ferry ──
  ferryList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  ferryRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: C.mutedBg,
    borderRadius: 12,
    padding: '10px 14px',
    minHeight: 52,
    boxSizing: 'border-box',
  },
  ferryTime: {
    fontSize: 20,
    fontWeight: 800,
    color: C.ink,
    minWidth: 60,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  ferryRoute: {
    flex: 1,
    fontSize: 17,
    fontWeight: 600,
    color: C.inkSoft,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  // ── Context / provenance ──
  contextText: {
    fontSize: 19,
    lineHeight: 1.7,
    color: C.inkSoft,
    margin: 0,
  },
  provenanceLine: {
    fontSize: 15,
    color: C.mutedInk,
    margin: '4px 0 0',
    lineHeight: 1.5,
  },
  // ── Bottom bar ──
  bottomRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    flexWrap: 'wrap',
  },
  ttsBtn: {
    minHeight: 54,
    fontSize: 21,
    fontWeight: 700,
    color: C.sea,
    background: C.surface,
    border: `3px solid ${C.sea}`,
    borderRadius: 14,
    cursor: 'pointer',
    padding: '6px 22px',
    whiteSpace: 'nowrap',
  },
  sourceCredit: {
    fontSize: 15,
    color: C.mutedInk,
    margin: 0,
    lineHeight: 1.5,
  },
  // ── Error details (non-fatal) ──
  errDetails: {
    background: '#FFFBEB',
    border: `1.5px solid ${C.yellowBorder}`,
    borderRadius: 12,
    padding: '10px 14px',
  },
  errSummary: {
    fontSize: 16,
    fontWeight: 700,
    color: C.yellow,
    cursor: 'pointer',
  },
  errList: {
    margin: '8px 0 0 16px',
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  errItem: {
    fontSize: 14,
    color: C.mutedInk,
    lineHeight: 1.5,
  },
}

// ── Global CSS ─────────────────────────────────────────────────────────────────

const GLOBAL_CSS = `
  .rt-back:focus-visible,
  .rt-ctrl:focus-visible,
  .rt-tab:focus-visible,
  .rt-station:focus-visible,
  .rt-chip:focus-visible,
  .rt-input:focus-visible {
    outline: 5px solid ${C.focus};
    outline-offset: 3px;
  }
  .rt-input:focus { outline: 3px solid ${C.sea}; outline-offset: 0; border-color: ${C.seaStrong} !important; }
  .rt-back:hover { background: #EAF2FB; }
  .rt-ctrl:hover { background: #EAF2FB; }
  .rt-tab:hover { background: #EAF2FB; }
  .rt-station:hover, .rt-chip:hover { background: #EAF2FB; }
  .rt-back, .rt-ctrl, .rt-tab, .rt-station, .rt-chip {
    transition: background 0.12s ease, transform 0.07s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .rt-back:active, .rt-ctrl:active { transform: scale(0.97); }
  .rt-tab:active, .rt-station:active, .rt-chip:active { transform: scale(0.96); }
  @media (prefers-reduced-motion: reduce) {
    .rt-back, .rt-ctrl, .rt-tab, .rt-station, .rt-chip {
      transition: none !important;
      transform: none !important;
    }
  }
`
