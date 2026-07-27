'use client'

/**
 * 환경 — Gunpo resident environment chip. Cloned from the AirKorea-dust half
 * of app/jeju/resident/environment/page.tsx ONLY, plus a new EV-charger
 * section (클린하우스/배출요일제/Q&A were not ported — see STEP3 scope).
 *
 * Data: GET /api/gunpo/resident/environment
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FriendlyErrors } from '@/components/gunpo/FriendlyErrors'

interface DustInfo {
  khai: number | null
  khaiGrade: string | null
  pm10: number | null
  pm10Grade: string | null
  pm25: number | null
  pm25Grade: string | null
  o3: number | null
  o3Grade: string | null
  station: string | null
  stationLabel: string | null
  measuredAt: string | null
  asOf: string | null
}
interface EvChargerInfo {
  ok: boolean
  text: string | null
  error: string | null
}
interface EnvironmentPayload {
  ok: true
  dust: DustInfo | null
  evCharger: EvChargerInfo
  freshnessNote: string
  updatedAt: string
  errors: string[]
}
type EnvironmentResult = EnvironmentPayload | { ok: false; error: string }

function gradeClass(grade: string | null): string {
  if (!grade) return 'bg-[#F1F5F9] text-[#64748B]'
  if (grade === '좋음') return 'bg-[#DCFCE7] text-[#166534]'
  if (grade === '보통') return 'bg-[#DBEAFE] text-[#1E40AF]'
  if (grade === '나쁨') return 'bg-[#FFEDD5] text-[#C2410C]'
  return 'bg-[#FEE2E2] text-[#991B1B]'
}

export default function GunpoEnvironmentPage() {
  const router = useRouter()
  const [data, setData] = useState<EnvironmentPayload | null>(null)
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
      const res = await fetch('/api/gunpo/resident/environment', { signal: ctrl.signal, cache: 'no-store' })
      const json = (await res.json()) as EnvironmentResult
      if (!json.ok) {
        setFetchError((json as { ok: false; error: string }).error)
        setData(null)
      } else {
        setData(json as EnvironmentPayload)
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setFetchError('환경 정보를 불러오지 못했어요. 잠시 후 다시 해주세요.')
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
        <h1 className="text-2xl font-black text-white">♻️ 환경</h1>
      </div>

      <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
        {loading && (
          <div className="flex flex-col items-center gap-3 py-12" aria-live="polite" aria-busy="true">
            <span className="text-5xl">⏳</span>
            <p className="text-xl font-bold text-[#334155]">환경 정보 불러오는 중…</p>
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

            <section className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-lg font-black text-[#1E3A8A]">🌫️ 오늘 대기질 (경기)</h2>
              {data.dust ? (
                <>
                  <div className="mb-2 flex flex-wrap gap-2">
                    <span className={`rounded-lg px-3 py-2 text-sm font-bold ${gradeClass(data.dust.khaiGrade)}`}>
                      통합대기환경지수 {data.dust.khai ?? '—'} ({data.dust.khaiGrade ?? '정보 없음'})
                    </span>
                    <span className={`rounded-lg px-3 py-2 text-sm font-bold ${gradeClass(data.dust.pm10Grade)}`}>
                      미세먼지 {data.dust.pm10 ?? '—'}㎍/㎥ ({data.dust.pm10Grade ?? '정보 없음'})
                    </span>
                    <span className={`rounded-lg px-3 py-2 text-sm font-bold ${gradeClass(data.dust.pm25Grade)}`}>
                      초미세먼지 {data.dust.pm25 ?? '—'}㎍/㎥ ({data.dust.pm25Grade ?? '정보 없음'})
                    </span>
                    <span className={`rounded-lg px-3 py-2 text-sm font-bold ${gradeClass(data.dust.o3Grade)}`}>
                      오존 {data.dust.o3 ?? '—'}ppm ({data.dust.o3Grade ?? '정보 없음'})
                    </span>
                  </div>
                  <p className="text-sm text-[#64748B]">
                    {data.dust.stationLabel ?? '측정소 정보 없음'} {data.dust.asOf ? `· ${data.dust.asOf}` : ''}
                  </p>
                </>
              ) : (
                <p className="text-base font-semibold text-[#64748B]">
                  대기질 정보 없음 — 측정소(stationName)가 아직 설정되지 않았을 수 있어요.
                </p>
              )}
            </section>

            <section className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-5 shadow-sm">
              <h2 className="mb-2 text-lg font-black text-[#1E3A8A]">🔌 전기차 충전 인프라</h2>
              {data.evCharger.text ? (
                <p className="whitespace-pre-line text-base leading-relaxed text-[#334155]">{data.evCharger.text}</p>
              ) : (
                <p className="text-base font-semibold text-[#64748B]">
                  {data.evCharger.error ?? '정보 없음'} — 지역 파라미터(rgnNm)가 아직 설정되지 않았어요.
                </p>
              )}
            </section>

            <FriendlyErrors errors={data.errors} />
          </>
        )}

        <p className="pt-2 text-center text-sm font-semibold text-[#64748B]">자료: 한국환경공단 에어코리아 + 환경부/KECO</p>
      </div>
    </div>
  )
}
