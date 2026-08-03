'use client'

/**
 * 날씨·재난·환경 — Gunpo resident merged chip (weather + air quality).
 *
 * Fires BOTH existing endpoints on mount with Promise.allSettled:
 *   GET /api/gunpo/resident/weather     (KMA 특보 + 초단기실황 + 중기예보)
 *   GET /api/gunpo/resident/environment (AirKorea 대기질, 당동/산본동)
 * Weather uses an 8s client-side timeout. Environment has NO artificial early
 * abort — AirKorea is slow upstream (~17–36s) but the data does arrive, so we
 * wait for it. Sections render in a FIXED order (특보 → 날씨 → 대기질) and
 * degrade independently to "정보 없음" on failure — the page never throws.
 *
 * The old /resident/weather and /resident/environment routes stay intact for
 * lib/gunpo/resident/chat.ts (pullCacheContext) and direct URL access.
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
interface EnvironmentPayload {
  ok: true
  dust: DustInfo | null
  freshnessNote: string
  updatedAt: string
  errors: string[]
}
type EnvironmentResult = EnvironmentPayload | { ok: false; error: string }

const WEATHER_TIMEOUT_MS = 8_000

function gradeClass(grade: string | null): string {
  if (!grade) return 'bg-[#F1F5F9] text-[#64748B]'
  if (grade === '좋음') return 'bg-[#DCFCE7] text-[#166534]'
  if (grade === '보통') return 'bg-[#DBEAFE] text-[#1E40AF]'
  if (grade === '나쁨') return 'bg-[#FFEDD5] text-[#C2410C]'
  return 'bg-[#FEE2E2] text-[#991B1B]'
}

function fmtRetrieval(meta: ContextMeta): string {
  const date = meta.retrievedAt.slice(0, 10)
  return meta.asOf ? `🔍 검색 · ${meta.asOf} 기준 · ${date} 조회` : `🔍 검색 · ${date} 조회`
}

function SectionShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-5 shadow-sm">
      <h2 className="mb-2 text-lg font-black text-[#1E3A8A]">{title}</h2>
      {children}
    </section>
  )
}

function EmptyNote({ label }: { label: string }) {
  return <p className="text-base font-semibold text-[#64748B]">{label}</p>
}

export default function GunpoWeatherEnvPage() {
  const router = useRouter()
  const [weather, setWeather] = useState<WeatherPayload | null>(null)
  const [environment, setEnvironment] = useState<EnvironmentPayload | null>(null)
  const [weatherLoading, setWeatherLoading] = useState(true)
  const [envLoading, setEnvLoading] = useState(true)
  const [weatherError, setWeatherError] = useState<string | null>(null)
  const [envError, setEnvError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const fetchData = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setWeatherLoading(true)
    setEnvLoading(true)
    setWeatherError(null)
    setEnvError(null)

    const weatherPromise = (async (): Promise<WeatherResult> => {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), WEATHER_TIMEOUT_MS),
      )
      const res = (await Promise.race([
        fetch('/api/gunpo/resident/weather', { signal: ctrl.signal, cache: 'no-store' }),
        timeout,
      ])) as Response
      return (await res.json()) as WeatherResult
    })()

    // No client-side timeout — AirKorea often takes 17–36s; wait for it.
    const envPromise = (async (): Promise<EnvironmentResult> => {
      const res = await fetch('/api/gunpo/resident/environment', {
        signal: ctrl.signal,
        cache: 'no-store',
      })
      return (await res.json()) as EnvironmentResult
    })()

    // Settle independently so slow AirKorea doesn't block the weather sections.
    void weatherPromise
      .then((json) => {
        if (!json.ok) {
          setWeatherError((json as { ok: false; error: string }).error)
          setWeather(null)
        } else {
          setWeather(json as WeatherPayload)
        }
      })
      .catch(() => {
        setWeatherError('날씨 정보를 불러오지 못했어요. 잠시 후 다시 해주세요.')
        setWeather(null)
      })
      .finally(() => setWeatherLoading(false))

    void envPromise
      .then((json) => {
        if (!json.ok) {
          setEnvError((json as { ok: false; error: string }).error)
          setEnvironment(null)
        } else {
          setEnvironment(json as EnvironmentPayload)
        }
      })
      .catch(() => {
        setEnvError('환경 정보를 불러오지 못했어요. 잠시 후 다시 해주세요.')
        setEnvironment(null)
      })
      .finally(() => setEnvLoading(false))
  }, [])

  useEffect(() => {
    void fetchData()
    return () => {
      abortRef.current?.abort()
    }
  }, [fetchData])

  const anyLoading = weatherLoading || envLoading
  const anyError = weatherError || envError
  const mergedErrors = [...(weather?.errors ?? []), ...(environment?.errors ?? [])]

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
        <h1 className="text-2xl font-black text-white">🌦 날씨·재난·환경</h1>
      </div>

      <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
        {anyLoading && (
          <div className="flex flex-col items-center gap-3 py-12" aria-live="polite" aria-busy="true">
            <span className="text-5xl">⏳</span>
            <p className="text-xl font-bold text-[#334155]">날씨·환경 정보 불러오는 중…</p>
          </div>
        )}

        {anyError && (
          <div className="flex flex-col items-center gap-4 rounded-2xl border-2 border-red-300 bg-red-50 p-6" role="alert">
            <p className="text-lg font-bold text-red-700">⚠ {weatherError ?? envError}</p>
            <button
              type="button"
              onClick={() => void fetchData()}
              className="min-h-[48px] rounded-xl bg-[#1E3A8A] px-6 text-lg font-bold text-white"
            >
              다시 시도
            </button>
          </div>
        )}

        {/* (a) 재난·기상특보 — weather response */}
        <SectionShell title="재난·기상특보">
          {weatherLoading ? (
            <EmptyNote label="불러오는 중…" />
          ) : weatherError ? (
            <EmptyNote label="정보 없음" />
          ) : weather?.warning.text ? (
            <p className="whitespace-pre-line text-base leading-relaxed text-[#334155]">{weather.warning.text}</p>
          ) : (
            <EmptyNote label="정보 없음" />
          )}
        </SectionShell>

        {/* (b) 날씨 실황·예보 — weather response */}
        <SectionShell title="날씨 실황·예보">
          {weatherLoading ? (
            <EmptyNote label="불러오는 중…" />
          ) : weatherError ? (
            <EmptyNote label="정보 없음" />
          ) : weather ? (
            <div className="flex flex-col gap-4">
              <div>
                <h3 className="mb-1 text-sm font-bold text-[#475569]">초단기실황</h3>
                {weather.current.text ? (
                  <p className="whitespace-pre-line text-base leading-relaxed text-[#334155]">{weather.current.text}</p>
                ) : (
                  <EmptyNote label="실황 정보 없음" />
                )}
              </div>
              <div>
                <h3 className="mb-1 text-sm font-bold text-[#475569]">중기예보 (11일)</h3>
                {weather.midterm.text ? (
                  <p className="whitespace-pre-line text-base leading-relaxed text-[#334155]">{weather.midterm.text}</p>
                ) : (
                  <EmptyNote label="중기예보 정보 없음" />
                )}
              </div>
              {(weather.context || weather.contextMeta) && (
                <div>
                  <h3 className="mb-1 text-sm font-bold text-[#475569]">생활 기상 요약</h3>
                  {weather.context ? (
                    <p className="text-base leading-relaxed text-[#334155]">{weather.context}</p>
                  ) : (
                    <EmptyNote label="요약 정보 없음" />
                  )}
                  <p className="mt-2 inline-block rounded-lg bg-[#E0E7FF] px-3 py-1 text-sm font-bold text-[#1E3A8A]">
                    {fmtRetrieval(weather.contextMeta)}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <EmptyNote label="정보 없음" />
          )}
        </SectionShell>

        {/* (c) 대기질 — environment response */}
        <SectionShell title="대기질">
          {envLoading ? (
            <EmptyNote label="불러오는 중…" />
          ) : envError ? (
            <EmptyNote label="정보 없음" />
          ) : environment?.dust ? (
            <>
              <div className="mb-2 flex flex-wrap gap-2">
                <span className={`rounded-lg px-3 py-2 text-sm font-bold ${gradeClass(environment.dust.khaiGrade)}`}>
                  통합대기환경지수 {environment.dust.khai ?? '—'} ({environment.dust.khaiGrade ?? '정보 없음'})
                </span>
                <span className={`rounded-lg px-3 py-2 text-sm font-bold ${gradeClass(environment.dust.pm10Grade)}`}>
                  미세먼지 {environment.dust.pm10 ?? '—'}㎍/㎥ ({environment.dust.pm10Grade ?? '정보 없음'})
                </span>
                <span className={`rounded-lg px-3 py-2 text-sm font-bold ${gradeClass(environment.dust.pm25Grade)}`}>
                  초미세먼지 {environment.dust.pm25 ?? '—'}㎍/㎥ ({environment.dust.pm25Grade ?? '정보 없음'})
                </span>
                <span className={`rounded-lg px-3 py-2 text-sm font-bold ${gradeClass(environment.dust.o3Grade)}`}>
                  오존 {environment.dust.o3 ?? '—'}ppm ({environment.dust.o3Grade ?? '정보 없음'})
                </span>
              </div>
              <p className="text-sm text-[#64748B]">
                {environment.dust.stationLabel ?? '측정소 정보 없음'}{' '}
                {environment.dust.asOf ? `· ${environment.dust.asOf}` : ''}
              </p>
            </>
          ) : (
            <EmptyNote label="정보 없음" />
          )}
        </SectionShell>

        <FriendlyErrors errors={mergedErrors} />

        <p className="pt-2 text-center text-sm font-semibold text-[#64748B]">
          자료: 기상청 + 🔍 검색 · 한국환경공단 에어코리아
        </p>
      </div>
    </div>
  )
}
