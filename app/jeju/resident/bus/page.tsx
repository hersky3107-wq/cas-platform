'use client'

/**
 * 버스·교통 — resident mode.
 *
 * REUSES the shared Jeju bus infrastructure (lib/jeju/bus.ts) via the existing
 * shared API routes (/api/jeju/bus/nearby|arrivals|route) — the same endpoints
 * the tourist module uses. This page only imports TYPES from bus.ts (erased at
 * compile time) and never touches the server-only module or the tourist UI.
 *
 * Two modes:
 *   쉬운 버스  — GPS → nearest stop → big arrival cards, 저상버스 badge, TTS,
 *               30s auto-refresh, and a no-GPS fallback (제주시/서귀포시 anchors).
 *   자세히 보기 — fuller nearby + route-number search, resident large styling.
 *
 * Accessibility: ≥20/24/32 fonts, high contrast, ≥60px targets, TTS ko-KR
 * (cancel-before-speak), reduced-motion, focus-visible. No localStorage.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ResidentLoading } from '@/app/jeju/resident/_components/Loading'
import type { BusStation, BusArrival, BusRoute } from '@/lib/jeju/bus'
import { residentHome } from '@/app/jeju/resident/_lib/origin'

const C = {
  bg: '#FBF4E6',
  surface: '#FFFFFF',
  ink: '#12263A',
  inkSoft: '#3C4C60',
  sea: '#0E4E8A',
  seaStrong: '#0A3A66',
  focus: '#E8590C',
  muted: '#5E5A50',
  warnBg: '#FCE8E6',
  warnBorder: '#B91C1C',
  warnInk: '#7F1D1D',
  lowBg: '#E4F3E6',
  lowBorder: '#2E7D32',
  lowInk: '#1B5E20',
}

type NearbyResult = { ok: true; data: BusStation[] } | { ok: false; error: string }
type ArrivalsResult = { ok: true; data: BusArrival[] } | { ok: false; error: string }
type RouteResult = { ok: true; data: BusRoute } | { ok: false; error: string }

type View = 'entry' | 'simple' | 'detail'
type DetailTab = 'nearby' | 'route'

/** No-GPS fallback anchors, grouped by city (reuse of tourist anchor coords). */
const ANCHORS: Record<'제주시' | '서귀포시', Array<{ label: string; lat: number; lng: number }>> = {
  제주시: [
    { label: '제주공항', lat: 33.5063, lng: 126.4929 },
    { label: '제주시청', lat: 33.4996, lng: 126.5312 },
    { label: '제주버스터미널', lat: 33.4996, lng: 126.5135 },
    { label: '동문시장', lat: 33.5125, lng: 126.5267 },
  ],
  서귀포시: [
    { label: '서귀포시청', lat: 33.2542, lng: 126.56 },
    { label: '월드컵경기장', lat: 33.2491, lng: 126.5091 },
    { label: '중문', lat: 33.2496, lng: 126.4116 },
  ],
}

function googleMapsUrl(stopName: string, lat: number, lng: number): string {
  const query = encodeURIComponent(`${stopName} ${lat},${lng}`)
  return `https://www.google.com/maps/search/?api=1&query=${query}`
}

function formatArrival(sec: number): string {
  if (sec <= 60) return '곧 도착'
  return `${Math.round(sec / 60)}분 뒤`
}

export default function ResidentBusPage() {
  const router = useRouter()

  const [view, setView] = useState<View>('entry')
  const [ttsSupported, setTtsSupported] = useState(false)

  // Shared nearby/arrivals state (used by both 쉬운 버스 and 자세히 보기 nearby)
  const [gpsState, setGpsState] = useState<'idle' | 'locating' | 'ok' | 'failed'>('idle')
  const [loadingStations, setLoadingStations] = useState(false)
  const [stations, setStations] = useState<BusStation[] | null>(null)
  const [activeStation, setActiveStation] = useState<BusStation | null>(null)
  const [arrivals, setArrivals] = useState<BusArrival[] | null>(null)
  const [loadingArrivals, setLoadingArrivals] = useState(false)
  const [fallbackCity, setFallbackCity] = useState<'제주시' | '서귀포시' | null>(null)

  // Detail route-search state
  const [detailTab, setDetailTab] = useState<DetailTab>('nearby')
  const [routeNo, setRouteNo] = useState('')
  const [route, setRoute] = useState<BusRoute | null>(null)
  const [loadingRoute, setLoadingRoute] = useState(false)
  const [routeError, setRouteError] = useState<string | null>(null)

  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) setTtsSupported(true)
  }, [])

  // ── TTS ────────────────────────────────────────────────────────────────────

  const speak = useCallback(
    (text: string) => {
      if (!ttsSupported || typeof window === 'undefined' || !text) return
      try {
        window.speechSynthesis.cancel()
        const u = new SpeechSynthesisUtterance(text)
        u.lang = 'ko-KR'
        u.rate = 0.92
        window.speechSynthesis.speak(u)
      } catch {
        /* no-op */
      }
    },
    [ttsSupported]
  )

  const stopSpeaking = useCallback(() => {
    if (ttsSupported && typeof window !== 'undefined') {
      try { window.speechSynthesis.cancel() } catch { /* no-op */ }
    }
  }, [ttsSupported])

  useEffect(() => () => stopSpeaking(), [stopSpeaking])

  const clearRefresh = useCallback(() => {
    if (refreshTimer.current) {
      clearInterval(refreshTimer.current)
      refreshTimer.current = null
    }
  }, [])

  useEffect(() => () => clearRefresh(), [clearRefresh])

  // ── Data fetching (reuses shared API routes) ────────────────────────────────

  const fetchArrivals = useCallback(async (station: BusStation, opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setLoadingArrivals(true)
      setArrivals(null)
    }
    setActiveStation(station)
    try {
      const res = await fetch('/api/jeju/bus/arrivals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId: station.nodeId }),
      })
      const data = (await res.json()) as ArrivalsResult
      setArrivals(data.ok ? data.data : [])
    } catch {
      setArrivals([])
    } finally {
      setLoadingArrivals(false)
    }
  }, [])

  const loadStations = useCallback(
    async (lat: number, lng: number, autoPickNearest: boolean) => {
      setLoadingStations(true)
      setStations(null)
      setActiveStation(null)
      setArrivals(null)
      try {
        const res = await fetch('/api/jeju/bus/nearby', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lat, lng }),
        })
        const data = (await res.json()) as NearbyResult
        if (data.ok && data.data.length > 0) {
          setStations(data.data)
          if (autoPickNearest) void fetchArrivals(data.data[0]!)
        } else {
          setStations([])
        }
      } catch {
        setStations([])
      } finally {
        setLoadingStations(false)
      }
    },
    [fetchArrivals]
  )

  const startLocate = useCallback(() => {
    clearRefresh()
    setFallbackCity(null)
    setStations(null)
    setActiveStation(null)
    setArrivals(null)
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsState('failed')
      return
    }
    setGpsState('locating')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsState('ok')
        void loadStations(pos.coords.latitude, pos.coords.longitude, true)
      },
      () => {
        setGpsState('failed')
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    )
  }, [clearRefresh, loadStations])

  // Auto-refresh arrivals every 30s while a station is open.
  useEffect(() => {
    clearRefresh()
    if (!activeStation) return
    refreshTimer.current = setInterval(() => {
      void fetchArrivals(activeStation, { silent: true })
    }, 30000)
    return clearRefresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStation?.nodeId])

  const searchRoute = useCallback(async () => {
    const no = routeNo.trim()
    if (!no || loadingRoute) return
    stopSpeaking()
    setLoadingRoute(true)
    setRouteError(null)
    setRoute(null)
    try {
      const res = await fetch('/api/jeju/bus/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routeNo: no }),
      })
      const data = (await res.json()) as RouteResult
      if (data.ok) setRoute(data.data)
      else setRouteError(data.error === 'NO_ROUTE' ? '그 번호의 버스를 찾지 못했어요. 번호를 다시 확인해 주세요.' : '지금은 확인이 어려워요. 잠시 후 다시 시도해 주세요.')
    } catch {
      setRouteError('연결에 문제가 있어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoadingRoute(false)
    }
  }, [routeNo, loadingRoute, stopSpeaking])

  // ── Speech builders ──────────────────────────────────────────────────────

  const arrivalLine = useCallback((station: BusStation, a: BusArrival): string => {
    const time = a.arrTimeSec <= 60 ? '곧' : `${Math.round(a.arrTimeSec / 60)}분 뒤`
    const low = a.lowFloor ? ', 타기 편한 낮은 버스입니다' : ''
    return `${a.routeNo}번 버스가 ${time} 도착합니다. ${a.stopsAway}정거장 전${low}.`
  }, [])

  const speakArrivals = useCallback(
    (station: BusStation, list: BusArrival[]) => {
      if (list.length === 0) {
        speak(`${station.nodeNm}. 지금 오는 버스가 없어요.`)
        return
      }
      const head = `${station.nodeNm}입니다. 오는 버스를 알려드릴게요. `
      const body = list.slice(0, 6).map((a) => arrivalLine(station, a)).join(' ')
      speak(head + body)
    },
    [speak, arrivalLine]
  )

  // ── Navigation ─────────────────────────────────────────────────────────────

  const goHome = useCallback(() => {
    stopSpeaking()
    clearRefresh()
    router.push(residentHome())
  }, [router, stopSpeaking, clearRefresh])

  const backToEntry = useCallback(() => {
    stopSpeaking()
    clearRefresh()
    setView('entry')
    setGpsState('idle')
    setStations(null)
    setActiveStation(null)
    setArrivals(null)
    setFallbackCity(null)
    setRoute(null)
    setRouteError(null)
    setRouteNo('')
  }, [stopSpeaking, clearRefresh])

  const enterSimple = useCallback(() => {
    stopSpeaking()
    setView('simple')
    startLocate()
  }, [stopSpeaking, startLocate])

  const enterDetail = useCallback(() => {
    stopSpeaking()
    setView('detail')
    setDetailTab('nearby')
    setGpsState('idle')
    setStations(null)
    setActiveStation(null)
    setArrivals(null)
  }, [stopSpeaking])

  // ── Render helpers ───────────────────────────────────────────────────────

  const renderArrivalCard = (station: BusStation, a: BusArrival, i: number) => (
    <div key={`${a.routeId}-${i}`} style={styles.busCard}>
      <div style={styles.busCardTop}>
        <span style={styles.busNo}>{a.routeNo}</span>
        <span style={styles.busTime}>{formatArrival(a.arrTimeSec)}</span>
      </div>
      <div style={styles.busMeta}>{a.stopsAway}정거장 전{a.routeType ? `  ·  ${a.routeType}` : ''}</div>
      {a.lowFloor && (
        <div style={styles.lowBadge}>
          <span aria-hidden>♿</span> 낮은 버스 (타기 편해요)
        </div>
      )}
      {ttsSupported && (
        <button
          type="button"
          className="bs-read"
          style={styles.cardReadBtn}
          onClick={() => speak(arrivalLine(station, a))}
          aria-label={`${a.routeNo}번 버스 안내 읽어주기`}
        >
          <span aria-hidden>🔊</span> 읽어주기
        </button>
      )}
    </div>
  )

  const renderArrivalsBlock = (station: BusStation) => (
    <section style={styles.resultWrap} aria-live="polite">
      <div style={styles.stationHead}>
        <div style={styles.stationName}>{station.nodeNm}</div>
        {typeof station.distance === 'number' && (
          <div style={styles.stationDist}>내 위치에서 약 {station.distance}m</div>
        )}
        <div style={styles.stationBtnRow}>
          {ttsSupported && arrivals && (
            <button type="button" className="bs-read" style={styles.readBtn} onClick={() => speakArrivals(station, arrivals)} aria-label="오는 버스 전체 읽어주기">
              <span aria-hidden>🔊</span> 전체 읽어주기
            </button>
          )}
          <button
            type="button"
            className="bs-ctrl"
            style={styles.refreshBtn}
            onClick={() => fetchArrivals(station)}
            aria-label="도착 시간 새로고침"
          >
            <span aria-hidden>🔄</span> 새로고침
          </button>
        </div>
      </div>

      {loadingArrivals ? (
        <ResidentLoading steps={['버스 도착 시간을 확인하고 있어요']} ttsSupported={false} />
      ) : arrivals && arrivals.length > 0 ? (
        <div style={styles.busList}>{arrivals.map((a, i) => renderArrivalCard(station, a, i))}</div>
      ) : (
        <p style={styles.calmNote}>지금은 오는 버스가 없어요. 잠시 후 새로고침을 눌러 보세요.</p>
      )}
    </section>
  )

  const renderOtherStations = () => {
    if (!stations || stations.length <= 1) return null
    const others = stations.filter((s) => s.nodeId !== activeStation?.nodeId).slice(0, 6)
    if (others.length === 0) return null
    return (
      <div style={styles.otherWrap}>
        <h3 style={styles.otherHeading}>가까운 다른 정류소</h3>
        {others.map((s) => (
          <button key={s.nodeId} type="button" className="bs-station" style={styles.stationBtn} onClick={() => { stopSpeaking(); fetchArrivals(s) }} aria-label={`${s.nodeNm} 정류소 버스 보기`}>
            <span style={styles.stationBtnName}>{s.nodeNm}</span>
            {typeof s.distance === 'number' && <span style={styles.stationBtnDist}>{s.distance}m</span>}
          </button>
        ))}
      </div>
    )
  }

  const renderFallback = () => (
    <section style={styles.card}>
      <p style={styles.calmNote}>
        위치를 확인하지 못했어요. 괜찮아요 — 아래에서 가까운 곳을 골라 주세요.
      </p>
      {!fallbackCity ? (
        <div style={styles.cityRow}>
          <button type="button" className="bs-kind" style={styles.kindBtn} onClick={() => setFallbackCity('제주시')} aria-label="제주시 선택">제주시</button>
          <button type="button" className="bs-kind" style={styles.kindBtn} onClick={() => setFallbackCity('서귀포시')} aria-label="서귀포시 선택">서귀포시</button>
        </div>
      ) : (
        <>
          <div style={styles.anchorTopRow}>
            <span style={styles.anchorCityLabel}>{fallbackCity}</span>
            <button type="button" className="bs-ctrl" style={styles.smallCtrl} onClick={() => setFallbackCity(null)} aria-label="지역 다시 고르기">지역 바꾸기</button>
          </div>
          <div style={styles.anchorList}>
            {ANCHORS[fallbackCity].map((anchor) => (
              <button
                key={anchor.label}
                type="button"
                className="bs-station"
                style={styles.stationBtn}
                onClick={() => { stopSpeaking(); void loadStations(anchor.lat, anchor.lng, true) }}
                aria-label={`${anchor.label} 근처 정류소 보기`}
              >
                <span style={styles.stationBtnName}>{anchor.label} 근처</span>
                <span aria-hidden style={styles.stationBtnArrow}>→</span>
              </button>
            ))}
          </div>
        </>
      )}
      <button type="button" className="bs-primary" style={styles.retryLocateBtn} onClick={startLocate} aria-label="내 위치로 다시 찾기">
        <span aria-hidden>📍</span> 내 위치로 다시 찾기
      </button>
    </section>
  )

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={styles.root}>
      <style>{GLOBAL_CSS}</style>

      <main style={styles.frame}>
        <div style={styles.topBar}>
          <button type="button" className="bs-ctrl" style={styles.ctrlBtn} onClick={goHome} aria-label="처음으로 돌아가기">
            <span aria-hidden>↩</span> 처음으로
          </button>
          {view !== 'entry' && (
            <button type="button" className="bs-ctrl" style={styles.ctrlBtn} onClick={backToEntry} aria-label="버스 메뉴로">
              <span aria-hidden>≡</span> 메뉴
            </button>
          )}
        </div>

        {/* ── ENTRY ────────────────────────────────────────────────────────── */}
        {view === 'entry' && (
          <>
            <header style={styles.header}>
              <span style={styles.headerEmoji} aria-hidden>🚌</span>
              <h1 style={styles.h1}>버스·교통</h1>
              {ttsSupported && (
                <button type="button" className="bs-read" style={styles.readBtn} onClick={() => speak('버스와 교통입니다. 쉬운 버스는 가까운 정류소에서 오는 버스를 바로 알려드려요. 자세히 보기는 버스 번호로 찾을 수 있어요.')} aria-label="이 화면 읽어주기">
                  <span aria-hidden>🔊</span> 읽어주기
                </button>
              )}
            </header>

            <button type="button" className="bs-hero" style={styles.heroBtn} onClick={enterSimple} aria-label="쉬운 버스 — 가까운 정류소에서 오는 버스 보기">
              <span style={styles.heroEmoji} aria-hidden>🚌</span>
              <span style={styles.heroTitle}>쉬운 버스</span>
              <span style={styles.heroSub}>내 가까운 정류소에서<br />오는 버스를 바로 알려드려요</span>
            </button>

            <button type="button" className="bs-secondary" style={styles.secondaryBtn} onClick={enterDetail} aria-label="자세히 보기 — 버스 번호로 찾기, 여러 정류소 보기">
              <span style={styles.secEmoji} aria-hidden>📋</span>
              <span style={styles.secText}>
                <span style={styles.secTitle}>자세히 보기</span>
                <span style={styles.secSub}>버스 번호로 찾기 · 정류소 여러 곳 보기</span>
              </span>
              <span style={styles.secArrow} aria-hidden>→</span>
            </button>
          </>
        )}

        {/* ── 쉬운 버스 ─────────────────────────────────────────────────────── */}
        {view === 'simple' && (
          <>
            <header style={styles.header}>
              <span style={styles.headerEmoji} aria-hidden>🚌</span>
              <h1 style={styles.h1}>쉬운 버스</h1>
            </header>

            {gpsState === 'locating' && (
              <ResidentLoading steps={['가까운 버스 정류소를 찾고 있어요', '잠시만 기다려 주세요']} ttsSupported={ttsSupported} />
            )}

            {gpsState === 'failed' && renderFallback()}

            {gpsState === 'ok' && loadingStations && (
              <ResidentLoading steps={['가까운 버스 정류소를 찾고 있어요']} ttsSupported={false} />
            )}

            {gpsState === 'ok' && !loadingStations && stations && stations.length === 0 && (
              <section style={styles.card}>
                <p style={styles.calmNote}>가까운 곳에 버스 정류소를 찾지 못했어요.</p>
                <button type="button" className="bs-primary" style={styles.retryLocateBtn} onClick={startLocate}>
                  <span aria-hidden>📍</span> 다시 찾기
                </button>
              </section>
            )}

            {/* When falling back via anchors, stations load without GPS too */}
            {gpsState === 'failed' && loadingStations && (
              <ResidentLoading steps={['가까운 버스 정류소를 찾고 있어요']} ttsSupported={false} />
            )}

            {activeStation && renderArrivalsBlock(activeStation)}
            {activeStation && renderOtherStations()}
          </>
        )}

        {/* ── 자세히 보기 ───────────────────────────────────────────────────── */}
        {view === 'detail' && (
          <>
            <header style={styles.header}>
              <span style={styles.headerEmoji} aria-hidden>📋</span>
              <h1 style={styles.h1}>자세히 보기</h1>
            </header>

            <div style={styles.tabRow}>
              <button
                type="button"
                className="bs-kind"
                style={detailTab === 'nearby' ? { ...styles.tabBtn, ...styles.tabBtnOn } : styles.tabBtn}
                onClick={() => { stopSpeaking(); setDetailTab('nearby') }}
                aria-pressed={detailTab === 'nearby'}
              >
                📍 가까운 정류소
              </button>
              <button
                type="button"
                className="bs-kind"
                style={detailTab === 'route' ? { ...styles.tabBtn, ...styles.tabBtnOn } : styles.tabBtn}
                onClick={() => { stopSpeaking(); setDetailTab('route') }}
                aria-pressed={detailTab === 'route'}
              >
                🔢 버스 번호 찾기
              </button>
            </div>

            {detailTab === 'nearby' && (
              <>
                <button type="button" className="bs-primary" style={styles.retryLocateBtn} onClick={startLocate} aria-label="내 위치로 정류소 찾기">
                  <span aria-hidden>📍</span> 내 위치로 정류소 찾기
                </button>

                {gpsState === 'locating' && <ResidentLoading steps={['가까운 버스 정류소를 찾고 있어요']} ttsSupported={ttsSupported} />}
                {gpsState === 'failed' && renderFallback()}
                {loadingStations && <ResidentLoading steps={['가까운 버스 정류소를 찾고 있어요']} ttsSupported={false} />}

                {/* Station chooser (detail = pick from full list) */}
                {!loadingStations && stations && stations.length > 0 && (
                  <div style={styles.otherWrap}>
                    <h3 style={styles.otherHeading}>가까운 정류소</h3>
                    {stations.slice(0, 12).map((s) => (
                      <button
                        key={s.nodeId}
                        type="button"
                        className="bs-station"
                        style={activeStation?.nodeId === s.nodeId ? { ...styles.stationBtn, ...styles.stationBtnOn } : styles.stationBtn}
                        onClick={() => { stopSpeaking(); fetchArrivals(s) }}
                        aria-label={`${s.nodeNm} 정류소 버스 보기`}
                      >
                        <span style={styles.stationBtnName}>{s.nodeNm}</span>
                        {typeof s.distance === 'number' && <span style={styles.stationBtnDist}>{s.distance}m</span>}
                      </button>
                    ))}
                  </div>
                )}
                {!loadingStations && stations && stations.length === 0 && (
                  <p style={styles.calmNote}>가까운 정류소를 찾지 못했어요.</p>
                )}

                {activeStation && renderArrivalsBlock(activeStation)}
              </>
            )}

            {detailTab === 'route' && (
              <section style={styles.card}>
                <p style={styles.lead}>버스 번호를 넣어 주세요.</p>
                <div style={styles.routeInputRow}>
                  <input
                    className="bs-input"
                    style={styles.routeInput}
                    value={routeNo}
                    onChange={(e) => setRouteNo(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') searchRoute() }}
                    placeholder="예: 240"
                    inputMode="numeric"
                    aria-label="버스 번호 입력"
                  />
                  <button
                    type="button"
                    className="bs-primary"
                    style={routeNo.trim() ? styles.searchBtn : { ...styles.searchBtn, opacity: 0.45, cursor: 'not-allowed' }}
                    onClick={searchRoute}
                    disabled={!routeNo.trim() || loadingRoute}
                    aria-disabled={!routeNo.trim() || loadingRoute}
                  >
                    <span aria-hidden>🔍</span> 찾기
                  </button>
                </div>

                {loadingRoute && <ResidentLoading steps={['버스 노선을 찾고 있어요']} ttsSupported={false} />}
                {!loadingRoute && routeError && <p style={styles.errorLine} role="alert">{routeError}</p>}

                {!loadingRoute && route && (
                  <div style={styles.routeWrap}>
                    <div style={styles.routeHead}>
                      <span style={styles.busNo}>{route.routeNo}</span>
                      {route.routeType && <span style={styles.routeType}>{route.routeType}</span>}
                    </div>
                    {route.startNode && route.endNode && (
                      <p style={styles.routeEnds}>{route.startNode} ↔ {route.endNode}</p>
                    )}
                    <h3 style={styles.otherHeading}>지나가는 정류소</h3>
                    <ol style={styles.stopOl}>
                      {route.stops.map((stop, i) => (
                        <li key={`${stop.nodeId}-${i}`} style={styles.stopItem}>
                          <span style={styles.stopSeq}>{stop.seq}</span>
                          <span style={styles.stopName}>{stop.nodeNm}</span>
                          {Number.isFinite(stop.lat) && Number.isFinite(stop.lng) && stop.lat !== 0 && (
                            <a href={googleMapsUrl(stop.nodeNm, stop.lat, stop.lng)} target="_blank" rel="noopener noreferrer" style={styles.mapLink} aria-label={`${stop.nodeNm} 지도 보기`}>
                              지도 <span aria-hidden>↗</span>
                            </a>
                          )}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: '100dvh', background: C.bg, color: C.ink,
    fontFamily: "'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif",
    display: 'flex', justifyContent: 'center', padding: '0 16px 40px', boxSizing: 'border-box',
  },
  frame: { width: '100%', maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 18 },
  topBar: {
    display: 'flex', justifyContent: 'space-between', gap: 12,
    position: 'sticky', top: 0, background: C.bg, paddingTop: 10, paddingBottom: 8, zIndex: 5,
  },
  ctrlBtn: {
    flex: 1, minHeight: 58, fontSize: 21, fontWeight: 700, color: C.ink,
    background: C.surface, border: `3px solid ${C.ink}`, borderRadius: 14, cursor: 'pointer', padding: '6px 12px',
  },
  header: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 },
  headerEmoji: { fontSize: 46, lineHeight: 1 },
  h1: { fontSize: 34, fontWeight: 900, color: C.ink, margin: 0, textAlign: 'center', lineHeight: 1.25 },
  // entry
  heroBtn: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
    width: '100%', minHeight: 200, background: C.sea, border: 'none', borderRadius: 22,
    padding: '28px 24px', cursor: 'pointer', boxShadow: '0 8px 28px rgba(10,92,122,0.28)', boxSizing: 'border-box',
  },
  heroEmoji: { fontSize: 60, lineHeight: 1 },
  heroTitle: { fontSize: 40, fontWeight: 900, color: '#FFFFFF', lineHeight: 1.15 },
  heroSub: { fontSize: 22, fontWeight: 600, color: '#BFD9F5', textAlign: 'center', lineHeight: 1.5 },
  secondaryBtn: {
    display: 'flex', alignItems: 'center', gap: 16, width: '100%', minHeight: 100,
    background: C.surface, border: `3px solid ${C.sea}`, borderRadius: 18, padding: '18px 20px',
    cursor: 'pointer', textAlign: 'left', boxSizing: 'border-box',
  },
  secEmoji: { fontSize: 40, lineHeight: 1, flexShrink: 0 },
  secText: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1 },
  secTitle: { fontSize: 26, fontWeight: 900, color: C.ink, lineHeight: 1.25 },
  secSub: { fontSize: 19, fontWeight: 500, color: C.inkSoft, lineHeight: 1.45 },
  secArrow: { fontSize: 30, fontWeight: 900, color: C.sea, flexShrink: 0 },
  // buttons
  readBtn: {
    alignSelf: 'center', minHeight: 60, fontSize: 22, fontWeight: 700, color: C.sea, background: '#FFFFFF',
    border: `3px solid ${C.sea}`, borderRadius: 14, cursor: 'pointer', padding: '8px 26px',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  refreshBtn: {
    minHeight: 60, fontSize: 21, fontWeight: 800, color: C.ink, background: '#FFFFFF',
    border: `3px solid ${C.ink}`, borderRadius: 14, cursor: 'pointer', padding: '8px 20px',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  retryLocateBtn: {
    minHeight: 72, fontSize: 24, fontWeight: 800, color: '#FFFFFF', background: C.sea,
    border: 'none', borderRadius: 16, cursor: 'pointer', padding: '12px 24px',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  // station arrivals
  resultWrap: { display: 'flex', flexDirection: 'column', gap: 14 },
  stationHead: {
    background: C.surface, borderRadius: 18, padding: '20px 20px',
    display: 'flex', flexDirection: 'column', gap: 12, boxShadow: '0 6px 22px rgba(15,34,51,0.10)',
  },
  stationName: { fontSize: 30, fontWeight: 900, color: C.ink, lineHeight: 1.3, wordBreak: 'keep-all' },
  stationDist: { fontSize: 19, fontWeight: 700, color: C.muted },
  stationBtnRow: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  busList: { display: 'flex', flexDirection: 'column', gap: 14 },
  busCard: {
    display: 'block', background: C.surface, border: `2px solid #E0D2B4`, borderRadius: 16,
    padding: '18px 20px', boxShadow: '0 3px 12px rgba(15,34,51,0.06)',
  },
  busCardTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  busNo: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 38, fontWeight: 900, color: '#FFFFFF', background: C.sea,
    borderRadius: 14, padding: '4px 20px', minWidth: 90,
  },
  busTime: { fontSize: 30, fontWeight: 900, color: C.warnBorder },
  busMeta: { fontSize: 20, fontWeight: 700, color: C.inkSoft, marginTop: 10 },
  lowBadge: {
    display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 12,
    fontSize: 22, fontWeight: 900, color: C.lowInk, background: C.lowBg,
    border: `3px solid ${C.lowBorder}`, borderRadius: 12, padding: '8px 16px',
  },
  cardReadBtn: {
    marginTop: 14, width: '100%', minHeight: 56, fontSize: 20, fontWeight: 700, color: C.sea,
    background: '#EAF2FB', border: `2px solid ${C.sea}`, borderRadius: 12, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  // other stations
  otherWrap: { display: 'flex', flexDirection: 'column', gap: 12 },
  otherHeading: { fontSize: 24, fontWeight: 900, color: C.ink, margin: '6px 0 0' },
  stationBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    width: '100%', minHeight: 68, background: C.surface, border: `2px solid #E0D2B4`,
    borderRadius: 14, padding: '12px 20px', cursor: 'pointer', textAlign: 'left', boxSizing: 'border-box',
  },
  stationBtnOn: { border: `3px solid ${C.sea}`, background: '#EAF2FB' },
  stationBtnName: { fontSize: 23, fontWeight: 800, color: C.ink, wordBreak: 'keep-all' },
  stationBtnDist: { fontSize: 19, fontWeight: 700, color: C.muted, flexShrink: 0 },
  stationBtnArrow: { fontSize: 26, fontWeight: 900, color: C.sea, flexShrink: 0 },
  // fallback / city
  card: {
    background: C.surface, borderRadius: 20, padding: '24px 22px 28px',
    display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 6px 22px rgba(15,34,51,0.10)',
  },
  calmNote: { fontSize: 22, lineHeight: 1.55, color: C.inkSoft, fontWeight: 700, margin: 0, textAlign: 'center' },
  lead: { fontSize: 24, lineHeight: 1.5, color: C.ink, fontWeight: 800, margin: 0, textAlign: 'center' },
  cityRow: { display: 'flex', gap: 14 },
  kindBtn: {
    flex: 1, minHeight: 90, fontSize: 28, fontWeight: 900, color: '#FFFFFF', background: C.sea,
    border: `3px solid ${C.seaStrong}`, borderRadius: 18, cursor: 'pointer',
  },
  anchorTopRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  anchorCityLabel: { fontSize: 24, fontWeight: 900, color: C.ink },
  smallCtrl: {
    minHeight: 52, fontSize: 19, fontWeight: 700, color: C.sea, background: '#FFFFFF',
    border: `2px solid ${C.sea}`, borderRadius: 12, cursor: 'pointer', padding: '6px 16px',
  },
  anchorList: { display: 'flex', flexDirection: 'column', gap: 12 },
  // tabs (detail)
  tabRow: { display: 'flex', gap: 12 },
  tabBtn: {
    flex: 1, minHeight: 72, fontSize: 21, fontWeight: 800, color: C.sea, background: '#EAF2FB',
    border: `2px solid ${C.sea}`, borderRadius: 14, cursor: 'pointer', padding: '8px 10px',
  },
  tabBtnOn: { background: C.sea, color: '#FFFFFF' },
  // route search
  routeInputRow: { display: 'flex', gap: 12 },
  routeInput: {
    flex: 1, fontSize: 26, fontWeight: 800, color: C.ink, background: '#FDFBF6',
    border: `3px solid ${C.sea}`, borderRadius: 14, padding: '12px 16px', minHeight: 68,
    boxSizing: 'border-box', textAlign: 'center',
    fontFamily: "'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', sans-serif",
  },
  searchBtn: {
    minHeight: 68, fontSize: 24, fontWeight: 800, color: '#FFFFFF', background: C.sea,
    border: 'none', borderRadius: 14, cursor: 'pointer', padding: '10px 22px',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexShrink: 0,
  },
  errorLine: { fontSize: 21, color: C.warnInk, fontWeight: 700, margin: 0, textAlign: 'center' },
  routeWrap: { display: 'flex', flexDirection: 'column', gap: 12 },
  routeHead: { display: 'flex', alignItems: 'center', gap: 12 },
  routeType: { fontSize: 20, fontWeight: 800, color: C.sea, background: '#EAF2FB', borderRadius: 10, padding: '4px 14px' },
  routeEnds: { fontSize: 21, fontWeight: 700, color: C.inkSoft, margin: 0, lineHeight: 1.5, wordBreak: 'keep-all' },
  stopOl: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 },
  stopItem: {
    display: 'flex', alignItems: 'center', gap: 12, background: C.surface,
    border: `2px solid #E0D2B4`, borderRadius: 12, padding: '12px 16px',
  },
  stopSeq: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    width: 40, height: 40, borderRadius: '50%', background: '#EAF2FB',
    fontSize: 19, fontWeight: 900, color: C.sea,
  },
  stopName: { fontSize: 22, fontWeight: 700, color: C.ink, flex: 1, wordBreak: 'keep-all', lineHeight: 1.35 },
  mapLink: {
    fontSize: 18, fontWeight: 800, color: C.sea, background: '#EAF2FB', borderRadius: 10,
    padding: '8px 14px', textDecoration: 'none', flexShrink: 0,
  },
}

const GLOBAL_CSS = `
  .bs-ctrl:focus-visible, .bs-read:focus-visible, .bs-primary:focus-visible,
  .bs-secondary:focus-visible, .bs-hero:focus-visible, .bs-station:focus-visible,
  .bs-kind:focus-visible, .bs-input:focus-visible {
    outline: 5px solid ${C.focus}; outline-offset: 3px;
  }
  .bs-input:focus { outline: 4px solid ${C.sea}; outline-offset: 0; border-color: ${C.seaStrong} !important; }
  .bs-hero:hover, .bs-primary:hover, .bs-kind:hover { background: ${C.seaStrong}; }
  .bs-secondary:hover, .bs-station:hover { background: #EAF2FB; }
  .bs-ctrl, .bs-read, .bs-primary, .bs-secondary, .bs-hero, .bs-station, .bs-kind {
    transition: transform 0.08s ease, background 0.15s ease; -webkit-tap-highlight-color: transparent;
  }
  .bs-hero:active, .bs-secondary:active, .bs-primary:active, .bs-station:active, .bs-kind:active, .bs-ctrl:active {
    transform: scale(0.98);
  }
  @media (prefers-reduced-motion: reduce) {
    .bs-ctrl, .bs-read, .bs-primary, .bs-secondary, .bs-hero, .bs-station, .bs-kind {
      transition: none !important; transform: none !important;
    }
  }
`
