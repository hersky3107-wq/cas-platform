'use client'

import { useState } from 'react'
import {
  Bus,
  Loader2,
  MapPin,
  Navigation,
  RefreshCw,
  ChevronLeft,
  Accessibility,
  ExternalLink,
  Search,
} from 'lucide-react'
import type { BusStation, BusArrival, BusRoute } from '@/lib/jeju/bus'
import { useTouristUi } from '@/components/jeju/useTouristUi'

type NearbyResult = { ok: true; data: BusStation[] } | { ok: false; error: string }
type ArrivalsResult = { ok: true; data: BusArrival[] } | { ok: false; error: string }
type RouteResult = { ok: true; data: BusRoute } | { ok: false; error: string }

type Tab = 'nearby' | 'route'

/** Preset Jeju anchor points — GPS fallback so the feature works without geolocation. */
const ANCHORS: Array<{ key: 'anchorAirport' | 'anchorJejuCity' | 'anchorSeogwipoCity' | 'anchorSeongsan' | 'anchorJungmun'; lat: number; lng: number }> = [
  { key: 'anchorAirport', lat: 33.5063, lng: 126.4929 },
  { key: 'anchorJejuCity', lat: 33.4996, lng: 126.5312 },
  { key: 'anchorSeogwipoCity', lat: 33.2542, lng: 126.56 },
  { key: 'anchorSeongsan', lat: 33.4587, lng: 126.9425 },
  { key: 'anchorJungmun', lat: 33.2496, lng: 126.4116 },
]

function googleMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
}

export function BusPanel() {
  const { t } = useTouristUi()
  const [tab, setTab] = useState<Tab>('nearby')

  // Nearby state
  const [stations, setStations] = useState<BusStation[] | null>(null)
  const [loadingStations, setLoadingStations] = useState(false)
  const [locating, setLocating] = useState(false)
  const [activeStation, setActiveStation] = useState<BusStation | null>(null)
  const [arrivals, setArrivals] = useState<BusArrival[] | null>(null)
  const [loadingArrivals, setLoadingArrivals] = useState(false)
  const [nearbyError, setNearbyError] = useState<string | null>(null)

  // Route state
  const [routeNo, setRouteNo] = useState('')
  const [route, setRoute] = useState<BusRoute | null>(null)
  const [loadingRoute, setLoadingRoute] = useState(false)
  const [routeError, setRouteError] = useState<string | null>(null)

  // ── Nearby flow ──────────────────────────────────────────────────────────
  async function fetchStations(lat: number, lng: number) {
    setLoadingStations(true)
    setNearbyError(null)
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
      if (data.ok) {
        setStations(data.data)
      } else {
        setNearbyError(t.busErr)
      }
    } catch {
      setNearbyError(t.busErr)
    } finally {
      setLoadingStations(false)
    }
  }

  function useMyLocation() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setNearbyError(t.busLocationHelp)
      return
    }
    setLocating(true)
    setNearbyError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        void fetchStations(pos.coords.latitude, pos.coords.longitude)
      },
      () => {
        // Denied / unavailable → fall back to preset anchors (always shown below).
        setLocating(false)
        setNearbyError(t.busLocationHelp)
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    )
  }

  async function openStation(station: BusStation) {
    setActiveStation(station)
    setLoadingArrivals(true)
    setArrivals(null)
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
  }

  // ── Route flow ───────────────────────────────────────────────────────────
  async function searchRoute() {
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
      const data = (await res.json()) as RouteResult
      if (data.ok) {
        setRoute(data.data)
      } else {
        setRouteError(data.error === 'NO_ROUTE' ? t.busRouteNotFound : t.busErr)
      }
    } catch {
      setRouteError(t.busErr)
    } finally {
      setLoadingRoute(false)
    }
  }

  function formatArrival(sec: number): string {
    if (sec <= 60) return t.busArrivingSoon
    const mins = Math.round(sec / 60)
    return `${t.busMinPrefix}${mins}${t.busMinUnit}`
  }

  return (
    <section className="mt-6">
      <h3 className="text-base font-extrabold tracking-tight text-[#0A2B30]">{t.busHeading}</h3>

      {/* Tabs */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {([
          { key: 'nearby' as Tab, emoji: '📍', label: t.busTabNearby },
          { key: 'route' as Tab, emoji: '🔢', label: t.busTabRoute },
        ]).map((opt) => {
          const selected = tab === opt.key
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => setTab(opt.key)}
              className={`rounded-[14px] px-3 py-2.5 text-[13px] font-extrabold transition-all ${
                selected
                  ? 'bg-[#00A8B5] text-white shadow-[0_8px_18px_-8px_rgba(0,112,122,0.8)]'
                  : 'bg-white text-[#00707A] shadow-sm ring-1 ring-[#00A8B5]/15 hover:-translate-y-0.5'
              }`}
            >
              <span aria-hidden>{opt.emoji}</span> {opt.label}
            </button>
          )
        })}
      </div>

      {/* ── NEARBY TAB ─────────────────────────────────────────────────────── */}
      {tab === 'nearby' && (
        <div className="mt-4">
          {/* Arrivals detail view */}
          {activeStation ? (
            <div className="rounded-[20px] bg-white/80 p-4 shadow-sm backdrop-blur">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setActiveStation(null)
                    setArrivals(null)
                  }}
                  className="inline-flex items-center gap-1 text-[12px] font-bold text-[#00707A] hover:underline"
                >
                  <ChevronLeft size={14} aria-hidden />
                  {t.busBackToStations}
                </button>
                <button
                  type="button"
                  onClick={() => openStation(activeStation)}
                  className="inline-flex items-center gap-1 rounded-full bg-[#F0FAFB] px-2.5 py-1 text-[11px] font-bold text-[#00707A] transition-opacity hover:opacity-80"
                >
                  <RefreshCw size={12} aria-hidden />
                  {t.busRefresh}
                </button>
              </div>

              <h4 className="mt-2 flex items-start gap-1.5 text-[15px] font-extrabold leading-snug text-[#0A2B30]">
                <MapPin size={15} strokeWidth={2.5} className="mt-0.5 shrink-0 text-[#00A8B5]" aria-hidden />
                {activeStation.nodeNm}
              </h4>
              <p className="mt-1 text-[12px] font-bold text-[#00707A]">{t.busArrivalsTitle}</p>

              {loadingArrivals ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm font-semibold text-[#00707A]">
                  <Loader2 size={18} className="animate-spin" aria-hidden />
                  {t.busLoadArrivals}
                </div>
              ) : arrivals && arrivals.length > 0 ? (
                <ul className="mt-3 flex flex-col gap-2">
                  {arrivals.map((a, i) => (
                    <li
                      key={`${a.routeId}-${i}`}
                      className="flex items-center justify-between gap-3 rounded-[14px] bg-white p-3 shadow-[0_6px_18px_-12px_rgba(0,112,122,0.5)] ring-1 ring-[#00A8B5]/10"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="inline-flex shrink-0 items-center rounded-full bg-[#00A8B5] px-2.5 py-1 text-[13px] font-extrabold text-white">
                          {a.routeNo}
                        </span>
                        <div className="min-w-0">
                          {a.lowFloor && (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-[#E8F5E9] px-1.5 py-0.5 text-[10px] font-bold text-[#2E7D32]">
                              <Accessibility size={10} strokeWidth={2.5} aria-hidden />
                              {t.busLowFloor}
                            </span>
                          )}
                          <p className="truncate text-[11px] font-semibold text-slate-400">
                            {a.stopsAway}
                            {t.busStopsUnit}
                          </p>
                        </div>
                      </div>
                      <span className="shrink-0 text-[14px] font-extrabold text-[#C2185B]">
                        {formatArrival(a.arrTimeSec)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 rounded-[14px] bg-[#FFF6E5] px-3.5 py-3 text-[12.5px] font-semibold leading-relaxed text-[#B8860B]">
                  {t.busNoArrivals}
                </p>
              )}
            </div>
          ) : (
            <>
              {/* Location button */}
              <button
                type="button"
                onClick={useMyLocation}
                disabled={locating || loadingStations}
                className="flex w-full items-center justify-center gap-2 rounded-[16px] bg-gradient-to-r from-[#00A8B5] to-[#0A2B30] px-4 py-3 text-[14px] font-extrabold text-white shadow-[0_10px_24px_-12px_rgba(0,112,122,0.8)] transition-opacity disabled:opacity-50"
              >
                {locating ? (
                  <Loader2 size={18} className="animate-spin" aria-hidden />
                ) : (
                  <Navigation size={18} aria-hidden />
                )}
                {locating ? t.busLocating : t.busUseLocation}
              </button>

              {/* Preset anchors fallback (always available) */}
              <p className="mt-4 text-[12px] font-bold text-[#5A7176]">{t.busPresetLabel}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {ANCHORS.map((anchor) => (
                  <button
                    key={anchor.key}
                    type="button"
                    onClick={() => fetchStations(anchor.lat, anchor.lng)}
                    disabled={loadingStations}
                    className="rounded-full bg-white px-3 py-1.5 text-[12px] font-bold text-[#00707A] shadow-sm ring-1 ring-[#00A8B5]/15 transition-transform hover:-translate-y-0.5 disabled:opacity-50"
                  >
                    {t[anchor.key]}
                  </button>
                ))}
              </div>

              {nearbyError && (
                <p className="mt-3 rounded-[12px] bg-[#FFF6E5] px-3 py-2 text-[12px] font-semibold leading-relaxed text-[#B8860B]">
                  {nearbyError}
                </p>
              )}

              {/* Station list */}
              {loadingStations ? (
                <div className="mt-5 flex items-center justify-center gap-2 py-8 text-sm font-semibold text-[#00707A]">
                  <Loader2 size={18} className="animate-spin" aria-hidden />
                  {t.busLoadNearby}
                </div>
              ) : stations && stations.length > 0 ? (
                <>
                  <p className="mt-4 text-[12px] font-semibold text-slate-400">{t.busSelectStationHint}</p>
                  <ul className="mt-2 flex flex-col gap-2">
                    {stations.slice(0, 12).map((s) => (
                      <li key={s.nodeId}>
                        <button
                          type="button"
                          onClick={() => openStation(s)}
                          className="flex w-full items-center justify-between gap-3 rounded-[14px] bg-white p-3 text-left shadow-[0_6px_18px_-12px_rgba(0,112,122,0.5)] ring-1 ring-[#00A8B5]/10 transition-transform hover:-translate-y-0.5"
                        >
                          <span className="flex min-w-0 items-center gap-1.5">
                            <Bus size={15} strokeWidth={2.5} className="shrink-0 text-[#00A8B5]" aria-hidden />
                            <span className="truncate text-[13.5px] font-bold text-[#0A2B30]">{s.nodeNm}</span>
                          </span>
                          {typeof s.distance === 'number' && (
                            <span className="shrink-0 text-[11px] font-bold text-slate-400">
                              {s.distance}
                              {t.busDistanceUnit}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : stations && stations.length === 0 ? (
                <p className="mt-4 rounded-[14px] bg-[#FFF6E5] px-3.5 py-3 text-[12.5px] font-semibold text-[#B8860B]">
                  {t.busNoStations}
                </p>
              ) : null}
            </>
          )}
        </div>
      )}

      {/* ── ROUTE TAB ──────────────────────────────────────────────────────── */}
      {tab === 'route' && (
        <div className="mt-4">
          <div className="flex items-center gap-2 rounded-[16px] bg-white px-4 py-3 shadow-[0_12px_30px_-14px_rgba(0,112,122,0.55)] ring-1 ring-[#00A8B5]/15">
            <Bus size={20} className="shrink-0 text-[#00A8B5]" aria-hidden />
            <input
              type="text"
              inputMode="numeric"
              value={routeNo}
              onChange={(e) => setRouteNo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') searchRoute()
              }}
              placeholder={t.busRoutePlaceholder}
              className="w-full bg-transparent text-[15px] font-medium text-[#0A2B30] placeholder:text-[#00A8B5]/60 focus:outline-none"
            />
            <button
              type="button"
              onClick={searchRoute}
              disabled={loadingRoute || routeNo.trim() === ''}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#00A8B5] px-4 py-1.5 text-sm font-bold text-white shadow-sm transition-opacity disabled:opacity-40"
            >
              {loadingRoute ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Search size={14} aria-hidden />}
              {t.busRouteSearch}
            </button>
          </div>

          {loadingRoute && (
            <div className="mt-5 flex items-center justify-center gap-2 py-8 text-sm font-semibold text-[#00707A]">
              <Loader2 size={18} className="animate-spin" aria-hidden />
              {t.busLoadRoute}
            </div>
          )}

          {!loadingRoute && routeError && (
            <p className="mt-4 rounded-[14px] bg-[#FFF3DC] px-4 py-3.5 text-sm font-semibold text-[#B84A00]">
              <span aria-hidden>🚌 </span>
              {routeError}
            </p>
          )}

          {!loadingRoute && route && (
            <div className="mt-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-[#00A8B5] px-3 py-1 text-[15px] font-extrabold text-white">
                  {route.routeNo}
                </span>
                {route.routeType && (
                  <span className="rounded-full bg-[#F0FAFB] px-2.5 py-0.5 text-[11px] font-bold text-[#00707A]">
                    {route.routeType}
                  </span>
                )}
                {route.startNode && route.endNode && (
                  <span className="text-[12px] font-semibold text-slate-500">
                    {route.startNode} ↔ {route.endNode}
                  </span>
                )}
              </div>

              <p className="mt-4 text-[13px] font-extrabold text-[#0A2B30]">{t.busRouteStopsTitle}</p>
              <ol className="mt-2 flex flex-col gap-1.5">
                {route.stops.map((stop, i) => (
                  <li
                    key={`${stop.nodeId}-${i}`}
                    className="flex items-center justify-between gap-3 rounded-[12px] bg-white px-3 py-2 shadow-[0_4px_14px_-10px_rgba(0,112,122,0.5)] ring-1 ring-[#00A8B5]/10"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#E7FBFD] text-[11px] font-extrabold text-[#00707A]">
                        {stop.seq}
                      </span>
                      <span className="truncate text-[13px] font-semibold text-[#0A2B30]">{stop.nodeNm}</span>
                    </span>
                    {Number.isFinite(stop.lat) && Number.isFinite(stop.lng) && stop.lat !== 0 && (
                      <a
                        href={googleMapsUrl(stop.lat, stop.lng)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#F0FAFB] px-2.5 py-1 text-[11px] font-bold text-[#00707A] transition-opacity hover:opacity-80"
                      >
                        {t.busMapView}
                        <ExternalLink size={10} strokeWidth={2.5} aria-hidden />
                      </a>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
