'use client'

/**
 * 교통 — Gunpo resident transport chip. Cloned from the bus-board portion of
 * app/jeju/resident/transport/page.tsx (no airport/ferry sections — Gunpo is
 * inland). Shows next-arrival boards for a FIXED list of key stops (금정·
 * 산본·수리산·대야미·군포역 인근) instead of Jeju's GPS "nearby stations" search.
 *
 * Data: GET /api/gunpo/resident/transport
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FriendlyErrors } from '@/components/gunpo/FriendlyErrors'

interface GunpoBusRow {
  routeNo: string
  arrivalMin: number
  stopsAway: number
  vehicleType: string | null
  lowFloor: boolean
}
interface GunpoStopSection {
  nodeId: string
  label: string
  rows: GunpoBusRow[]
  error: string | null
}
interface TransportPayload {
  ok: true
  cityCode: string | null
  stops: GunpoStopSection[]
  freshnessNote: string
  updatedAt: string
  errors: string[]
}
type TransportResult = TransportPayload | { ok: false; error: string }

export default function GunpoTransportPage() {
  const router = useRouter()
  const [data, setData] = useState<TransportPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const fetchData = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch('/api/gunpo/resident/transport', { signal: ctrl.signal, cache: 'no-store' })
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

  useEffect(() => {
    void fetchData()
    return () => abortRef.current?.abort()
  }, [fetchData])

  const notConfigured = data && !data.cityCode && data.stops.length === 0

  return (
    <div className="min-h-dvh bg-[#F3F6FB] text-[#0F172A]">
      <div className="sticky top-0 z-10 flex items-center gap-4 bg-[#1E3A8A] px-4 py-4 shadow-md">
        <button
          type="button"
          onClick={() => router.push('/gunpo/resident/general')}
          className="min-h-[48px] rounded-xl border-2 border-white/30 bg-white/15 px-4 text-lg font-bold text-white transition hover:bg-white/25"
        >
          ← 뒤로
        </button>
        <h1 className="text-2xl font-black text-white">🚌 교통</h1>
      </div>

      <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
        {loading && (
          <div className="flex flex-col items-center gap-3 py-12" aria-live="polite" aria-busy="true">
            <span className="text-5xl">⏳</span>
            <p className="text-xl font-bold text-[#334155]">버스 정보 불러오는 중…</p>
          </div>
        )}

        {!loading && fetchError && (
          <div className="flex flex-col items-center gap-4 rounded-2xl border-2 border-red-300 bg-red-50 p-6" role="alert">
            <p className="text-lg font-bold text-red-700">⚠ {fetchError}</p>
            <button
              type="button"
              onClick={() => void fetchData()}
              className="min-h-[48px] rounded-xl bg-[#1E3A8A] px-6 text-lg font-bold text-white"
            >
              다시 시도
            </button>
          </div>
        )}

        {!loading && data && (
          <>
            <p className="rounded-xl bg-[#E0E7FF] px-4 py-2 text-sm font-semibold text-[#1E3A8A]">{data.freshnessNote}</p>

            {notConfigured ? (
              <section className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-5 shadow-sm">
                <p className="text-base font-semibold text-[#64748B]">지금은 버스 정류소 정보를 불러올 수 없어요.</p>
              </section>
            ) : data.stops.length === 0 ? (
              <section className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-5 shadow-sm">
                <p className="text-base font-semibold text-[#64748B]">현재 도착 예정 버스가 있는 정류소가 없어요.</p>
              </section>
            ) : (
              data.stops.map((stop) => (
                <section key={stop.nodeId} className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-5 shadow-sm">
                  <h2 className="mb-3 text-lg font-black text-[#1E3A8A]">🚏 {stop.label}</h2>
                  <div className="flex flex-col gap-2">
                    {stop.rows.map((row, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-3 rounded-xl bg-[#F1F5F9] px-4 py-3"
                      >
                        <span className="min-w-[56px] text-2xl font-black text-[#1E3A8A]">{row.routeNo}</span>
                        <div className="flex flex-1 flex-col">
                          <span className="text-lg font-bold text-[#0F172A]">{row.arrivalMin}분 후</span>
                          <span className="text-sm text-[#64748B]">남은 정류장 {row.stopsAway}개</span>
                        </div>
                        {row.lowFloor && (
                          <span className="rounded bg-[#DBEAFE] px-2 py-1 text-xs font-bold text-[#1E40AF]">저상</span>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              ))
            )}

            <FriendlyErrors errors={data.errors} />
          </>
        )}

        <p className="pt-2 text-center text-sm font-semibold text-[#64748B]">자료: 국토교통부(TAGO) 버스도착정보</p>
      </div>
    </div>
  )
}
