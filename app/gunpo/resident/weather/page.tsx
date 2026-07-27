'use client'

/**
 * 날씨·재난 — Gunpo resident weather & disaster chip. Cloned from
 * app/jeju/resident/weather/page.tsx, adapted to the gunpo payload shape
 * (lib/gunpo/resident/weather.ts): current/midterm/warning text blocks +
 * Perplexity 생활 기상 요약, instead of Jeju's structured today/tomorrow/week.
 *
 * Data: GET /api/gunpo/resident/weather
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FriendlyErrors } from '@/components/gunpo/FriendlyErrors'

interface WeatherSection {
  ok: boolean
  text: string | null
  error: string | null
}
interface ContextMeta {
  source: string
  retrievedAt: string
  asOf: string | null
}
interface WeatherPayload {
  ok: true
  region: string
  current: WeatherSection
  midterm: WeatherSection
  warning: WeatherSection
  context: string
  contextMeta: ContextMeta
  freshnessNote: string
  updatedAt: string
  errors: string[]
}
type WeatherResult = WeatherPayload | { ok: false; error: string }

function fmtRetrieval(meta: ContextMeta): string {
  const date = meta.retrievedAt.slice(0, 10)
  return meta.asOf ? `🔍 검색 · ${meta.asOf} 기준 · ${date} 조회` : `🔍 검색 · ${date} 조회`
}

export default function GunpoWeatherPage() {
  const router = useRouter()
  const [data, setData] = useState<WeatherPayload | null>(null)
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
      const res = await fetch('/api/gunpo/resident/weather', { signal: ctrl.signal, cache: 'no-store' })
      const json = (await res.json()) as WeatherResult
      if (!json.ok) {
        setFetchError((json as { ok: false; error: string }).error)
        setData(null)
      } else {
        setData(json as WeatherPayload)
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setFetchError('날씨 정보를 불러오지 못했어요. 잠시 후 다시 해주세요.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchData()
    return () => abortRef.current?.abort()
  }, [fetchData])

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
        <h1 className="text-2xl font-black text-white">🌦 날씨·재난</h1>
      </div>

      <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
        {loading && (
          <div className="flex flex-col items-center gap-3 py-12" aria-live="polite" aria-busy="true">
            <span className="text-5xl">⏳</span>
            <p className="text-xl font-bold text-[#334155]">날씨 불러오는 중…</p>
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
            <p className="rounded-xl bg-[#E0E7FF] px-4 py-2 text-sm font-semibold text-[#1E3A8A]">
              {data.region} · {data.freshnessNote}
            </p>

            <section className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-5 shadow-sm">
              <h2 className="mb-2 text-lg font-black text-[#1E3A8A]">초단기실황</h2>
              {data.current.text ? (
                <p className="whitespace-pre-line text-base leading-relaxed text-[#334155]">{data.current.text}</p>
              ) : (
                <p className="text-base font-semibold text-[#64748B]">
                  {data.current.error ?? '정보 없음'} — 지역 파라미터(nx/ny)가 아직 설정되지 않았어요.
                </p>
              )}
            </section>

            <section className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-5 shadow-sm">
              <h2 className="mb-2 text-lg font-black text-[#1E3A8A]">중기예보 (11일)</h2>
              {data.midterm.text ? (
                <p className="whitespace-pre-line text-base leading-relaxed text-[#334155]">{data.midterm.text}</p>
              ) : (
                <p className="text-base font-semibold text-[#64748B]">
                  {data.midterm.error ?? '정보 없음'} — 지역 파라미터(regId)가 아직 설정되지 않았어요.
                </p>
              )}
            </section>

            <section className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-5 shadow-sm">
              <h2 className="mb-2 text-lg font-black text-[#1E3A8A]">기상특보</h2>
              {data.warning.text ? (
                <p className="whitespace-pre-line text-base leading-relaxed text-[#334155]">{data.warning.text}</p>
              ) : (
                <p className="text-base font-semibold text-[#64748B]">
                  {data.warning.error ?? '정보 없음'} — 지역 파라미터(stnId)가 아직 설정되지 않았어요.
                </p>
              )}
            </section>

            {(data.context || data.contextMeta) && (
              <section className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-5 shadow-sm">
                <h2 className="mb-2 text-lg font-black text-[#1E3A8A]">생활 기상 요약</h2>
                {data.context ? (
                  <p className="text-base leading-relaxed text-[#334155]">{data.context}</p>
                ) : (
                  <p className="text-base font-semibold text-[#64748B]">요약 정보 없음</p>
                )}
                <p className="mt-2 inline-block rounded-lg bg-[#E0E7FF] px-3 py-1 text-sm font-bold text-[#1E3A8A]">
                  {fmtRetrieval(data.contextMeta)}
                </p>
              </section>
            )}

            <FriendlyErrors errors={data.errors} />
          </>
        )}

        <p className="pt-2 text-center text-sm font-semibold text-[#64748B]">자료: 기상청 + 🔍 검색</p>
      </div>
    </div>
  )
}
