'use client'

import { useState, useRef, useEffect } from 'react'
import { Search, Loader2, RefreshCw } from 'lucide-react'
import type { VisitJejuPlace } from '@/lib/jeju/connectors'
import type { LocalGem } from '@/lib/jeju/tourist-local'
import type { SeasonalItem } from '@/lib/jeju/tourist-seasonal'
import type { IslandInfo } from '@/lib/jeju/tourist-ferry'
import type { OlleCourseView } from '@/lib/jeju/tourist-olle'
import type { FestivalEvent } from '@/lib/jeju/tourist-festivals'
import { PlaceCard } from './place-card'
import { LocalGemCard } from './local-gem-card'
import { SeasonalCard } from './seasonal-card'
import { IslandCard } from './island-card'
import { OlleCard } from './olle-card'
import { DullegilCard } from './dullegil-card'
import { FestivalEventCard } from './festival-event-card'
import { CoursePanel } from './course-panel'
import { BusPanel } from './bus-panel'
import { WeatherPanel } from './weather-panel'
import { TravelHelpPanel } from './travel-help-panel'
import { ComingSoonPanel } from './coming-soon-panel'
import { ShoppingPanel } from './shopping-panel'
import { PlaceDetailModal } from './place-detail-modal'
import {
  type PlaceDetail,
  detailFromVisitJeju,
  detailFromLocalGem,
  detailFromSeasonal,
  detailFromIsland,
  detailFromFestivalEvent,
} from './place-detail'
import { localizedDisplayLabel } from './category-labels'
import { getDullegil } from '@/lib/jeju/hallasan-dullegil'
import { useTouristUi } from '@/components/jeju/useTouristUi'

type RecommendResult =
  | { ok: true; intro: string; recommendations: VisitJejuPlace[] }
  | { ok: false; error: string }

type LocalResult = { ok: true; gems: LocalGem[] } | { ok: false; error: string }

type FestivalResult =
  | { ok: true; type: 'sonar'; events: FestivalEvent[] }
  | { ok: true; type: 'fallback'; festivals: VisitJejuPlace[] }
  | { ok: false; error: string }

type SeasonalResult =
  | { ok: true; sights: SeasonalItem[] }
  | { ok: false; error: string }

type IslandResult =
  | { ok: true; islands: IslandInfo[] }
  | { ok: false; error: string }

type OlleResult =
  | { ok: true; courses: OlleCourseView[] }
  | { ok: false; error: string }

type OreumResult =
  | { ok: true; oreum: VisitJejuPlace[] }
  | { ok: false; error: string }

/** Base mixed-category query for the "관광객은 잘 모르는" chip. */
const LOCAL_BASE_QUERY = '관광객이 잘 모르는 제주의 좋은 장소를 종류별로 골고루: 잘 알려지지 않은 자연 명소(폭포·오름·해변·숲), 전시·박물관·문화공간, 현지인 카페, 로컬 맛집을 고르게 섞어서 추천. 맛집·카페로 치우치지 말고 자연·문화 명소를 충분히 포함.'

/** Area/angle suffixes rotated on each tap to diversify results. */
const LOCAL_VARIATION_SUFFIXES = [
  ' (제주 동부 위주로)',
  ' (제주 서부 위주로)',
  ' (서귀포·남부 위주로)',
  ' (제주시 원도심·북부 위주로)',
  ' (중산간·내륙 위주로)',
  ' (덜 알려진 곳 위주로 색다르게)',
]

/** Fixed query for the "비 와도 좋은 곳" chip — VisitJeju indoor-focus. */
const RAINY_QUERY =
  '비 오는 날에도 좋은 제주의 제대로 된 실내 명소를 우선 추천: 미술관·박물관·전시관·뮤지엄·아쿠아리움·실내 테마공간 위주. 동네 소규모 공방·원데이클래스·게임장 같은 곳은 가급적 제외하고, 비 와도 충분히 즐길 만한 규모 있는 실내 명소 위주로.'

// ── Loading UX constants ──────────────────────────────────────────────────────

/** Client-side AbortController timeout (ms). Generous: only kills truly dead connections. */
const FETCH_TIMEOUT: Record<string, number> = {
  sonar: 70_000,   // sonar chips: 70s (above 60s maxDuration)
  course: 100_000, // course: 100s (above 90s maxDuration)
  cached: 25_000,  // olle/oreum: 25s (fast cached GET)
}

/**
 * fetch() that transparently retries ONCE (~1s later) on any network or timeout
 * failure. The loading spinner stays active during the retry — no error is shown
 * until both attempts have failed. The second failure is re-thrown so the caller
 * can surface the right error (AbortError → timedOut, otherwise errConnection).
 */
async function fetchWithOneRetry(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string },
  timeoutMs: number
): Promise<Response> {
  const attempt = async (): Promise<Response> => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      return await fetch(url, { ...opts, signal: ctrl.signal })
    } finally {
      clearTimeout(timer)
    }
  }
  try {
    return await attempt()
  } catch {
    await new Promise<void>((r) => setTimeout(r, 1_000))
    return attempt() // second attempt — throws on failure, caught by caller
  }
}

type Mode = 'search' | 'local' | 'festival' | 'seasonal' | 'rainy' | 'islands' | 'olle' | 'oreum' | 'course' | 'bus' | 'weather' | 'help' | 'shopping' | 'comingsoon'

export function SearchPanel() {
  const { t, locale } = useTouristUi()
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<Mode>('search')
  const [intro, setIntro] = useState<string | null>(null)
  const [results, setResults] = useState<VisitJejuPlace[] | null>(null)
  const [gems, setGems] = useState<LocalGem[] | null>(null)
  const [festivalData, setFestivalData] = useState<FestivalResult | null>(null)
  const [sights, setSights] = useState<SeasonalItem[] | null>(null)
  const [islands, setIslands] = useState<IslandInfo[] | null>(null)
  const [olleCourses, setOlleCourses] = useState<OlleCourseView[] | null>(null)
  const [oreumList, setOreumList] = useState<VisitJejuPlace[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<PlaceDetail | null>(null)
  const variationIdx = useRef(0)
  const [timedOut, setTimedOut] = useState(false)
  const [msgIdx, setMsgIdx] = useState(0)
  const retryFnRef = useRef<(() => void) | null>(null)

  // Rotate loading messages every 6 s while a fetch is in flight.
  useEffect(() => {
    if (!loading) return
    setMsgIdx(0)
    const id = setInterval(() => setMsgIdx((n) => n + 1), 6_000)
    return () => clearInterval(id)
  }, [loading])

  function resetResults() {
    setIntro(null)
    setResults(null)
    setGems(null)
    setFestivalData(null)
    setSights(null)
    setIslands(null)
    setOlleCourses(null)
    setOreumList(null)
    setError(null)
    setTimedOut(false)
  }

  // Free-text recommendation (VisitJeju flow).
  async function runSearch() {
    const q = query.trim()
    if (!q || loading) return

    setLoading(true)
    setMode('search')
    resetResults()
    retryFnRef.current = runSearch

    try {
      const res = await fetchWithOneRetry(
        '/api/jeju/tourist',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q, locale }) },
        FETCH_TIMEOUT.sonar
      )
      const data = (await res.json()) as RecommendResult
      if (data.ok) {
        setIntro(data.intro)
        setResults(data.recommendations)
      } else {
        setError(data.error || t.errRecommend)
      }
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') { setTimedOut(true) } else {
        setError(t.errConnection)
      }
    } finally {
      setLoading(false)
    }
  }

  // Local "hidden gems" recommendation (Perplexity flow), fired by the chip.
  async function runLocal() {
    if (loading) return

    // Append a rotating area/angle suffix so repeated taps explore different regions.
    const suffix = LOCAL_VARIATION_SUFFIXES[variationIdx.current % LOCAL_VARIATION_SUFFIXES.length]
    variationIdx.current += 1
    const q = LOCAL_BASE_QUERY + suffix

    setLoading(true)
    setMode('local')
    resetResults()
    retryFnRef.current = runLocal

    try {
      const res = await fetchWithOneRetry(
        '/api/jeju/tourist-local',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q, locale }) },
        FETCH_TIMEOUT.sonar
      )
      const data = (await res.json()) as LocalResult
      if (data.ok) {
        setGems(data.gems)
      } else {
        setError(data.error || t.errRecommend)
      }
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') { setTimedOut(true) } else {
        setError(t.errConnection)
      }
    } finally {
      setLoading(false)
    }
  }

  // Jeju festivals/events — sonar (currently-running/upcoming) with c5 fallback.
  async function runFestivals() {
    if (loading) return

    setLoading(true)
    setMode('festival')
    resetResults()
    retryFnRef.current = runFestivals

    try {
      const res = await fetchWithOneRetry(
        '/api/jeju/tourist-festivals',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locale }) },
        FETCH_TIMEOUT.sonar
      )
      const data = (await res.json()) as FestivalResult
      if (data.ok) {
        setFestivalData(data)
      } else {
        setError(data.error || t.errFestival)
      }
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') { setTimedOut(true) } else {
        setError(t.errConnection)
      }
    } finally {
      setLoading(false)
    }
  }

  // Current seasonal sights (sonar, date-aware), fired by the chip.
  async function runSeasonal() {
    if (loading) return

    setLoading(true)
    setMode('seasonal')
    resetResults()
    retryFnRef.current = runSeasonal

    try {
      const res = await fetchWithOneRetry(
        '/api/jeju/tourist-seasonal',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locale }) },
        FETCH_TIMEOUT.sonar
      )
      const data = (await res.json()) as SeasonalResult
      if (data.ok) {
        setSights(data.sights)
      } else {
        setError(data.error || t.errSeasonal)
      }
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') { setTimedOut(true) } else {
        setError(t.errConnection)
      }
    } finally {
      setLoading(false)
    }
  }

  // Rainy-day indoor places (VisitJeju flow with fixed query), fired by the chip.
  async function runRainy() {
    if (loading) return

    setLoading(true)
    setMode('rainy')
    resetResults()
    retryFnRef.current = runRainy

    try {
      const res = await fetchWithOneRetry(
        '/api/jeju/tourist',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: RAINY_QUERY, locale }) },
        FETCH_TIMEOUT.sonar
      )
      const data = (await res.json()) as RecommendResult
      if (data.ok) {
        setIntro(data.intro)
        setResults(data.recommendations)
      } else {
        setError(data.error || t.errRecommend)
      }
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') { setTimedOut(true) } else {
        setError(t.errConnection)
      }
    } finally {
      setLoading(false)
    }
  }

  // Jeju ferry-accessible islands overview (sonar), fired by the chip.
  async function runIslands() {
    if (loading) return

    setLoading(true)
    setMode('islands')
    resetResults()
    retryFnRef.current = runIslands

    try {
      const res = await fetchWithOneRetry(
        '/api/jeju/tourist-ferry',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
        FETCH_TIMEOUT.sonar
      )
      const data = (await res.json()) as IslandResult
      if (data.ok) {
        setIslands(data.islands)
      } else {
        setError(data.error || t.errIslands)
      }
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') { setTimedOut(true) } else {
        setError(t.errConnection)
      }
    } finally {
      setLoading(false)
    }
  }

  // Jeju Olle trail courses (odcloud public data), fired by the chip.
  async function runOlle() {
    if (loading) return

    setLoading(true)
    setMode('olle')
    resetResults()
    retryFnRef.current = runOlle

    try {
      const res = await fetchWithOneRetry('/api/jeju/tourist-olle', {}, FETCH_TIMEOUT.cached)
      const data = (await res.json()) as OlleResult
      if (data.ok) {
        setOlleCourses(data.courses)
      } else {
        setError(data.error || t.errOlle)
      }
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') { setTimedOut(true) } else {
        setError(t.errConnection)
      }
    } finally {
      setLoading(false)
    }
  }

  // Oreum (volcanic cones) from official public data, fired by the chip.
  async function runOreum() {
    if (loading) return

    setLoading(true)
    setMode('oreum')
    resetResults()
    retryFnRef.current = runOreum

    try {
      const res = await fetchWithOneRetry('/api/jeju/tourist-oreum', {}, FETCH_TIMEOUT.cached)
      const data = (await res.json()) as OreumResult
      if (data.ok) {
        setOreumList(data.oreum)
      } else {
        setError(data.error || t.errOreum)
      }
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') { setTimedOut(true) } else {
        setError(t.errConnection)
      }
    } finally {
      setLoading(false)
    }
  }

  // AI 여행 코스 — opens the dedicated input panel (no immediate fetch).
  function openCourse() {
    if (loading) return
    setMode('course')
    resetResults()
  }

  // 🚌 Bus — opens the dedicated bus panel (self-contained, no immediate fetch).
  function openBus() {
    if (loading) return
    setMode('bus')
    resetResults()
  }

  // 🌦️ Weather — opens the multi-region forecast panel (self-contained).
  function openWeather() {
    if (loading) return
    setMode('weather')
    resetResults()
  }

  // 🆘 Travel Help — opens the foreigner help panel (self-contained).
  function openHelp() {
    if (loading) return
    setMode('help')
    resetResults()
  }

  // 🛍 Shopping — opens the merged shopping list panel (self-contained fetch).
  function openShopping() {
    if (loading) return
    setMode('shopping')
    resetResults()
  }

  // 🌉 Coming Soon — opens the non-functional vision/proposal panel.
  function openComingSoon() {
    if (loading) return
    setMode('comingsoon')
    resetResults()
  }

  const canSubmit = query.trim() !== '' && !loading

  // Derive the current rotating message for the active mode (localized).
  const LOADING_MSGS: Record<Mode, string[]> = {
    search: t.loadSearch,
    local: t.loadLocal,
    festival: t.loadFestival,
    seasonal: t.loadSeasonal,
    rainy: t.loadRainy,
    islands: t.loadIslands,
    olle: t.loadOlle,
    oreum: t.loadOreum,
    course: t.loadCourse,
    bus: [t.busLoadNearby],
    weather: [t.wLoading],
    help: [t.helpExchangeLoading],
    shopping: t.loadShopping,
    comingsoon: [t.csHeading],
  }
  const msgArr = LOADING_MSGS[mode] ?? t.loadSearch
  const currentLoadingMsg = msgArr[msgIdx % msgArr.length]

  // Core content chips (Korean-first audience) — uniform soft pill style.
  const contentChips: Array<{ mode: Mode; emoji: string; label: string; onClick: () => void }> = [
    { mode: 'local', emoji: '👀', label: t.chipLocal, onClick: runLocal },
    { mode: 'festival', emoji: '🎪', label: t.chipFestival, onClick: runFestivals },
    { mode: 'seasonal', emoji: '🌸', label: t.chipSeasonal, onClick: runSeasonal },
    { mode: 'weather', emoji: '🌦️', label: t.chipWeather, onClick: openWeather },
    { mode: 'rainy', emoji: '☔', label: t.chipRainy, onClick: runRainy },
    { mode: 'islands', emoji: '⛴️', label: t.chipIslands, onClick: runIslands },
    { mode: 'olle', emoji: '🥾', label: t.chipOlle, onClick: runOlle },
    { mode: 'oreum', emoji: '🏔', label: t.chipOreum, onClick: runOreum },
    { mode: 'bus', emoji: '🚌', label: t.chipBus, onClick: openBus },
  ]

  // Foreigner-oriented chips — distinct accent group, placed last. Labels carry
  // their own 🌐 marker so they read as one "for foreign visitors" set.
  const foreignerChips: Array<{ mode: Mode; label: string; onClick: () => void }> = [
    { mode: 'help', label: t.chipTravelHelp, onClick: openHelp },
    { mode: 'shopping', label: t.chipShopping, onClick: openShopping },
    { mode: 'comingsoon', label: t.chipComingSoon, onClick: openComingSoon },
  ]

  return (
    <div>
      {/* Search input — functional (free-text → VisitJeju flow) */}
      <div className="mt-5">
        <div className="flex items-center gap-2 rounded-[18px] bg-white px-4 py-3.5 shadow-[0_12px_30px_-14px_rgba(0,112,122,0.55)] ring-1 ring-[#00A8B5]/15">
          <Search size={20} className="shrink-0 text-[#00A8B5]" aria-hidden />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runSearch()
            }}
            placeholder={t.searchPlaceholder}
            className="w-full bg-transparent text-[15px] font-medium text-[#0A2B30] placeholder:text-[#00A8B5]/60 focus:outline-none"
          />
          <button
            type="button"
            onClick={runSearch}
            disabled={!canSubmit}
            className="shrink-0 rounded-full bg-[#00A8B5] px-4 py-1.5 text-sm font-bold text-white shadow-sm transition-opacity disabled:opacity-40"
          >
            {t.searchButton}
          </button>
        </div>
      </div>

      {/* Hero — AI 여행 코스: the flagship action, visually dominant */}
      <div className="mt-5">
        <button
          type="button"
          onClick={openCourse}
          disabled={loading}
          className={`flex w-full items-center justify-center gap-2 rounded-[18px] bg-gradient-to-r from-[#00A8B5] to-[#0A2B30] px-5 py-3.5 text-[15px] font-extrabold text-white shadow-[0_14px_30px_-12px_rgba(0,112,122,0.85)] transition-transform hover:-translate-y-0.5 disabled:opacity-50 ${
            mode === 'course' ? 'ring-2 ring-[#0A2B30] ring-offset-2 ring-offset-transparent' : ''
          }`}
        >
          <span aria-hidden>🗺️</span>
          {t.chipCourse}
        </button>
      </div>

      {/* Core content chips — uniform soft pill style, one coherent palette */}
      <div className="mt-3 flex flex-wrap gap-2">
        {contentChips.map((chip) => {
          const active = mode === chip.mode
          return (
            <button
              key={chip.mode}
              type="button"
              onClick={chip.onClick}
              disabled={loading}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-bold shadow-sm ring-1 transition-transform hover:-translate-y-0.5 disabled:opacity-50 ${
                active
                  ? 'bg-[#00A8B5] text-white ring-[#00A8B5]'
                  : 'bg-white/85 text-[#00707A] ring-[#00A8B5]/25 hover:ring-[#00A8B5]/50'
              }`}
            >
              <span aria-hidden>{chip.emoji}</span>
              {chip.label}
            </button>
          )
        })}
      </div>

      {/* Foreigner chips — distinct warm accent, grouped together at the end */}
      <div className="mt-2.5 flex flex-wrap gap-2">
        {foreignerChips.map((chip) => {
          const active = mode === chip.mode
          return (
            <button
              key={chip.mode}
              type="button"
              onClick={chip.onClick}
              disabled={loading}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-bold shadow-sm ring-1 transition-transform hover:-translate-y-0.5 disabled:opacity-50 ${
                active
                  ? 'bg-[#B84A00] text-white ring-[#B84A00]'
                  : 'bg-[#FFF3DC] text-[#B84A00] ring-[#E8A85C]/45 hover:ring-[#E8A85C]/80'
              }`}
            >
              {chip.label}
            </button>
          )
        })}
      </div>

      {/* Loading state — spinning + rotating reassurance */}
      {loading && (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-[20px] bg-white/70 p-8 text-center backdrop-blur">
          <Loader2 size={28} className="animate-spin text-[#00A8B5]" aria-hidden />
          <p
            key={currentLoadingMsg}
            className="text-sm font-semibold text-[#00707A] transition-opacity duration-500"
          >
            {currentLoadingMsg}
          </p>
        </div>
      )}

      {/* Timed-out soft retry — only for truly dead connections, never scary */}
      {!loading && timedOut && (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-[20px] bg-white/80 px-6 py-6 text-center shadow-sm backdrop-blur">
          <p className="text-sm font-semibold text-[#00707A]">{t.retryMessage}</p>
          <button
            type="button"
            onClick={() => retryFnRef.current?.()}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#00A8B5] px-5 py-2 text-sm font-bold text-white shadow-sm transition-opacity hover:opacity-90"
          >
            <RefreshCw size={14} aria-hidden />
            {t.retryButton}
          </button>
        </div>
      )}

      {/* Inline error (friendly, not a dump) */}
      {!loading && !timedOut && error && (
        <div className="mt-6 flex items-center gap-2 rounded-[18px] bg-[#FFF3DC] px-4 py-3.5 text-sm font-semibold text-[#B84A00]">
          <span aria-hidden>🍊</span>
          {error}
        </div>
      )}

      {/* AI 여행 코스 — self-contained input + loading + tabs + timeline */}
      {mode === 'course' && <CoursePanel />}

      {/* 🚌 버스 — self-contained nearby-stations + arrivals + route lookup */}
      {mode === 'bus' && <BusPanel />}

      {/* 🌦️ 날씨 — self-contained multi-region multi-day forecast */}
      {mode === 'weather' && <WeatherPanel />}

      {/* 🆘 여행 도움 — exchange rates + emergency + consulates + tips */}
      {mode === 'help' && <TravelHelpPanel onOpenBus={openBus} />}

      {/* 🛍 쇼핑 — merged duty-free + markets + general shops (self-contained fetch) */}
      {mode === 'shopping' && <ShoppingPanel />}

      {/* 🌉 준비 중 — non-functional vision/policy-proposal showcase */}
      {mode === 'comingsoon' && <ComingSoonPanel />}

      {/* Free-text recommendation results (VisitJeju) */}
      {!loading && mode === 'search' && results && results.length > 0 && (
        <section className="mt-6">
          {intro && (
            <p className="rounded-[18px] bg-white/80 px-4 py-3 text-sm font-semibold leading-relaxed text-[#00707A] shadow-sm backdrop-blur">
              {intro}
            </p>
          )}
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((place) => (
              <PlaceCard
                key={place.contentsId}
                place={place}
                displayLabel={localizedDisplayLabel(place, t)}
                onSelect={() => setDetail(detailFromVisitJeju(place, localizedDisplayLabel(place, t)))}
              />
            ))}
          </div>
        </section>
      )}

      {/* Rainy-day indoor places (VisitJeju, official data) */}
      {!loading && mode === 'rainy' && results && results.length > 0 && (
        <section className="mt-6">
          <h3 className="text-base font-extrabold tracking-tight text-[#1C6DD0]">
            {t.headingRainy}
          </h3>
          <p className="mt-1.5 rounded-[14px] bg-[#E3F0FF] px-3.5 py-2.5 text-[12px] font-semibold leading-relaxed text-[#1C6DD0]">
            {t.noteRainy}
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((place) => (
              <PlaceCard
                key={place.contentsId}
                place={place}
                displayLabel={localizedDisplayLabel(place, t)}
                onSelect={() => setDetail(detailFromVisitJeju(place, localizedDisplayLabel(place, t)))}
              />
            ))}
          </div>
        </section>
      )}

      {/* Local "hidden gems" results (official nature/culture + sonar local blend) */}
      {!loading && mode === 'local' && gems && gems.length > 0 && (
        <section className="mt-6">
          <h3 className="text-base font-extrabold tracking-tight text-[#6B4FB8]">
            {t.headingLocal}
          </h3>
          <p className="mt-1.5 rounded-[14px] bg-[#F2EFFC] px-3.5 py-2.5 text-[12px] font-semibold leading-relaxed text-[#5B3EA8]">
            {t.noteLocal}
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {gems.map((gem, i) => (
              <LocalGemCard
                key={`${gem.name}-${i}`}
                gem={gem}
                onSelect={() => setDetail(detailFromLocalGem(gem))}
              />
            ))}
          </div>
        </section>
      )}

      {/* Jeju festivals/events — sonar-sourced (currently running/upcoming) */}
      {!loading && mode === 'festival' && festivalData?.ok && festivalData.type === 'sonar' && (
        <section className="mt-6">
          <h3 className="text-base font-extrabold tracking-tight text-[#00707A]">
            {t.headingFestivalSonar}
          </h3>
          <p className="mt-1.5 rounded-[14px] bg-[#D4F5F0] px-3.5 py-2.5 text-[12px] font-semibold leading-relaxed text-[#00707A]">
            {t.noteFestivalSonar}
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {festivalData.events.map((event, i) => (
              <FestivalEventCard
                key={`${event.name}-${i}`}
                event={event}
                onSelect={() => setDetail(detailFromFestivalEvent(event))}
              />
            ))}
          </div>
        </section>
      )}

      {/* Jeju festivals/events — c5 fallback (general festival listing, no live dates) */}
      {!loading && mode === 'festival' && festivalData?.ok && festivalData.type === 'fallback' && (
        <section className="mt-6">
          <h3 className="text-base font-extrabold tracking-tight text-[#00707A]">
            {t.headingFestivalFallback}
          </h3>
          <p className="mt-1.5 rounded-[14px] bg-[#D4F5F0] px-3.5 py-2.5 text-[12px] font-semibold leading-relaxed text-[#00707A]">
            {t.noteFestivalFallback}
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {festivalData.festivals.map((place) => (
              <PlaceCard
                key={place.contentsId}
                place={place}
                displayLabel={localizedDisplayLabel(place, t)}
                onSelect={() => setDetail(detailFromVisitJeju(place, localizedDisplayLabel(place, t)))}
              />
            ))}
          </div>
        </section>
      )}

      {/* Current seasonal sights (web-sourced via sonar, date-aware) */}
      {!loading && mode === 'seasonal' && sights && sights.length > 0 && (
        <section className="mt-6">
          <h3 className="text-base font-extrabold tracking-tight text-[#C2185B]">
            {t.headingSeasonal}
          </h3>
          <p className="mt-1.5 rounded-[14px] bg-[#FCE4EC] px-3.5 py-2.5 text-[12px] font-semibold leading-relaxed text-[#C2185B]">
            {t.noteSeasonal}
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sights.map((sight, idx) => (
              <SeasonalCard
                key={`${idx}-${sight.name}`}
                sight={sight}
                idx={idx}
                onSelect={() => setDetail(detailFromSeasonal(sight))}
              />
            ))}
          </div>
        </section>
      )}

      {/* Jeju ferry-accessible islands (web-sourced via sonar) */}
      {!loading && mode === 'islands' && islands && islands.length > 0 && (
        <section className="mt-6">
          <h3 className="text-base font-extrabold tracking-tight text-[#1D4ED8]">
            {t.headingIslands}
          </h3>
          <p className="mt-1.5 rounded-[14px] bg-[#DBEAFE] px-3.5 py-2.5 text-[12px] font-semibold leading-relaxed text-[#1D4ED8]">
            {t.noteIslands}
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {islands.map((island, idx) => (
              <IslandCard
                key={`${idx}-${island.name}`}
                island={island}
                idx={idx}
                onSelect={() => setDetail(detailFromIsland(island))}
              />
            ))}
          </div>
        </section>
      )}

      {/* Jeju oreum (volcanic cones) from official public data */}
      {!loading && mode === 'oreum' && oreumList && oreumList.length > 0 && (
        <section className="mt-6">
          <h3 className="text-base font-extrabold tracking-tight text-[#C05621]">
            {t.headingOreum}
          </h3>
          <p className="mt-1.5 rounded-[14px] bg-[#FDE8D8] px-3.5 py-2.5 text-[12px] font-semibold leading-relaxed text-[#C05621]">
            {t.noteOreum}
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {oreumList.map((place) => (
              <PlaceCard
                key={place.contentsId}
                place={place}
                displayLabel={t.catOreum}
                onSelect={() => setDetail(detailFromVisitJeju(place, t.catOreum))}
              />
            ))}
          </div>
        </section>
      )}

      {/* Hallasan Dullegil — static 8 courses, shown alongside Oreum */}
      {!loading && mode === 'oreum' && (
        <section className="mt-8">
          <h3 className="text-base font-extrabold tracking-tight text-[#1A7A46]">
            {t.headingDullegil}
          </h3>
          <p className="mt-1.5 rounded-[14px] bg-[#D1F2E1] px-3.5 py-2.5 text-[12px] font-semibold leading-relaxed text-[#1A7A46]">
            {t.noteDullegil}
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {getDullegil().map((course) => (
              <DullegilCard key={course.name} course={course} />
            ))}
          </div>
        </section>
      )}

      {/* Jeju Olle trail courses (odcloud public data) */}
      {!loading && mode === 'olle' && olleCourses && olleCourses.length > 0 && (
        <section className="mt-6">
          <h3 className="text-base font-extrabold tracking-tight text-[#1A7A46]">
            {t.headingOlle}
          </h3>
          <p className="mt-1.5 rounded-[14px] bg-[#D1F2E1] px-3.5 py-2.5 text-[12px] font-semibold leading-relaxed text-[#1A7A46]">
            {t.noteOlle}
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {olleCourses.map((course) => (
              <OlleCard key={`${course.courseNo}-${course.name}`} course={course} />
            ))}
          </div>
        </section>
      )}

      {/* Shared detail modal (bottom-sheet on mobile, centered on desktop) */}
      <PlaceDetailModal detail={detail} onClose={() => setDetail(null)} />
    </div>
  )
}
