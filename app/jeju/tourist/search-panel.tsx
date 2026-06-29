'use client'

import { useState, useRef } from 'react'
import { Search, Loader2 } from 'lucide-react'
import type { VisitJejuPlace } from '@/lib/jeju/connectors'
import type { LocalGem } from '@/lib/jeju/tourist-local'
import type { FestivalItem } from '@/lib/jeju/tourist-festivals'
import type { SeasonalItem } from '@/lib/jeju/tourist-seasonal'
import type { IslandInfo } from '@/lib/jeju/tourist-ferry'
import { PlaceCard } from './place-card'
import { LocalGemCard } from './local-gem-card'
import { FestivalCard } from './festival-card'
import { SeasonalCard } from './seasonal-card'
import { IslandCard } from './island-card'
import { CoursePanel } from './course-panel'
import { displayLabelForPlace } from './category-labels'

type RecommendResult =
  | { ok: true; intro: string; recommendations: VisitJejuPlace[] }
  | { ok: false; error: string }

type LocalResult = { ok: true; gems: LocalGem[] } | { ok: false; error: string }

type FestivalResult =
  | { ok: true; festivals: FestivalItem[] }
  | { ok: false; error: string }

type SeasonalResult =
  | { ok: true; sights: SeasonalItem[] }
  | { ok: false; error: string }

type IslandResult =
  | { ok: true; islands: IslandInfo[] }
  | { ok: false; error: string }

/** Base mixed-category query for the "관광객은 잘 모르는" chip. */
const LOCAL_BASE_QUERY =
  '관광객이 잘 모르는 제주의 좋은 장소를 종류별로 골고루: 로컬 맛집, 현지인 카페, 잘 알려지지 않은 자연 명소, 전시·박물관·문화공간을 섞어서 추천'

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

/** Static chips (visual only) — all remaining chips are now functional. */
const STATIC_CHIPS: Array<{ emoji: string; label: string; bg: string; fg: string }> = []

type Mode = 'search' | 'local' | 'festival' | 'seasonal' | 'rainy' | 'islands' | 'course'

export function SearchPanel() {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<Mode>('search')
  const [intro, setIntro] = useState<string | null>(null)
  const [results, setResults] = useState<VisitJejuPlace[] | null>(null)
  const [gems, setGems] = useState<LocalGem[] | null>(null)
  const [festivals, setFestivals] = useState<FestivalItem[] | null>(null)
  const [sights, setSights] = useState<SeasonalItem[] | null>(null)
  const [islands, setIslands] = useState<IslandInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const variationIdx = useRef(0)

  function resetResults() {
    setIntro(null)
    setResults(null)
    setGems(null)
    setFestivals(null)
    setSights(null)
    setIslands(null)
    setError(null)
  }

  // Free-text recommendation (VisitJeju flow).
  async function runSearch() {
    const q = query.trim()
    if (!q || loading) return

    setLoading(true)
    setMode('search')
    resetResults()

    try {
      const res = await fetch('/api/jeju/tourist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      })
      const data = (await res.json()) as RecommendResult
      if (data.ok) {
        setIntro(data.intro)
        setResults(data.recommendations)
      } else {
        setError(data.error || '추천을 불러오지 못했어요. 다시 시도해 주세요.')
      }
    } catch {
      setError('연결이 원활하지 않아요. 잠시 후 다시 시도해 주세요.')
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

    try {
      const res = await fetch('/api/jeju/tourist-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      })
      const data = (await res.json()) as LocalResult
      if (data.ok) {
        setGems(data.gems)
      } else {
        setError(data.error || '추천을 불러오지 못했어요. 다시 시도해 주세요.')
      }
    } catch {
      setError('연결이 원활하지 않아요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }

  // Current/upcoming festivals (VisitJeju c5 + AI date filter), fired by the chip.
  async function runFestivals() {
    if (loading) return

    setLoading(true)
    setMode('festival')
    resetResults()

    try {
      const res = await fetch('/api/jeju/tourist-festivals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const data = (await res.json()) as FestivalResult
      if (data.ok) {
        setFestivals(data.festivals)
      } else {
        setError(data.error || '축제 정보를 불러오지 못했어요. 다시 시도해 주세요.')
      }
    } catch {
      setError('연결이 원활하지 않아요. 잠시 후 다시 시도해 주세요.')
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

    try {
      const res = await fetch('/api/jeju/tourist-seasonal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const data = (await res.json()) as SeasonalResult
      if (data.ok) {
        setSights(data.sights)
      } else {
        setError(data.error || '제주 풍경 정보를 불러오지 못했어요. 다시 시도해 주세요.')
      }
    } catch {
      setError('연결이 원활하지 않아요. 잠시 후 다시 시도해 주세요.')
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

    try {
      const res = await fetch('/api/jeju/tourist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: RAINY_QUERY }),
      })
      const data = (await res.json()) as RecommendResult
      if (data.ok) {
        setIntro(data.intro)
        setResults(data.recommendations)
      } else {
        setError(data.error || '추천을 불러오지 못했어요. 다시 시도해 주세요.')
      }
    } catch {
      setError('연결이 원활하지 않아요. 잠시 후 다시 시도해 주세요.')
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

    try {
      const res = await fetch('/api/jeju/tourist-ferry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const data = (await res.json()) as IslandResult
      if (data.ok) {
        setIslands(data.islands)
      } else {
        setError(data.error || '섬 여행 정보를 불러오지 못했어요. 다시 시도해 주세요.')
      }
    } catch {
      setError('연결이 원활하지 않아요. 잠시 후 다시 시도해 주세요.')
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

  const canSubmit = query.trim() !== '' && !loading
  const loadingMsg =
    mode === 'local'
      ? '제주 구석구석 찾아보는 중…'
      : mode === 'festival'
        ? '지금 열리는 축제 찾는 중…'
        : mode === 'seasonal'
          ? '지금 제주 풍경 살펴보는 중…'
          : mode === 'rainy'
            ? '비 와도 좋은 곳 찾는 중…'
            : mode === 'islands'
              ? '제주 섬 여행 정보 찾는 중…'
              : '제주를 살펴보는 중…'

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
            placeholder="제주에서 뭐 하고 싶으세요?"
            className="w-full bg-transparent text-[15px] font-medium text-[#0A2B30] placeholder:text-[#00A8B5]/60 focus:outline-none"
          />
          <button
            type="button"
            onClick={runSearch}
            disabled={!canSubmit}
            className="shrink-0 rounded-full bg-[#00A8B5] px-4 py-1.5 text-sm font-bold text-white shadow-sm transition-opacity disabled:opacity-40"
          >
            찾기
          </button>
        </div>
      </div>

      {/* Signature feature — AI 여행 코스 (its own row, chip-style but distinct) */}
      <div className="mt-4">
        <button
          type="button"
          onClick={openCourse}
          disabled={loading}
          className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[14px] font-extrabold shadow-sm transition-transform hover:-translate-y-0.5 disabled:opacity-50 ${
            mode === 'course'
              ? 'bg-[#0A2B30] text-white'
              : 'bg-[#0A2B30]/90 text-white'
          }`}
        >
          <span aria-hidden>🗺️</span>
          AI 여행 코스 짜기
        </button>
      </div>

      {/* Chips: one functional local chip + static placeholders */}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={runLocal}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-bold shadow-sm transition-transform hover:-translate-y-0.5 disabled:opacity-50"
          style={{ backgroundColor: '#EDE7FB', color: '#6B4FB8' }}
        >
          <span aria-hidden>👀</span>
          관광객은 잘 모르는
        </button>
        <button
          type="button"
          onClick={runFestivals}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-bold shadow-sm transition-transform hover:-translate-y-0.5 disabled:opacity-50"
          style={{ backgroundColor: '#D9F6FA', color: '#00707A' }}
        >
          <span aria-hidden>🎪</span>
          이번 주 축제
        </button>
        <button
          type="button"
          onClick={runSeasonal}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-bold shadow-sm transition-transform hover:-translate-y-0.5 disabled:opacity-50"
          style={{ backgroundColor: '#FCE4EC', color: '#C2185B' }}
        >
          <span aria-hidden>🌸</span>
          지금 제주 풍경
        </button>
        <button
          type="button"
          onClick={runRainy}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-bold shadow-sm transition-transform hover:-translate-y-0.5 disabled:opacity-50"
          style={{ backgroundColor: '#E3F0FF', color: '#1C6DD0' }}
        >
          <span aria-hidden>☔</span>
          비 와도 좋은 곳
        </button>
        <button
          type="button"
          onClick={runIslands}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-bold shadow-sm transition-transform hover:-translate-y-0.5 disabled:opacity-50"
          style={{ backgroundColor: '#DBEAFE', color: '#1D4ED8' }}
        >
          <span aria-hidden>⛴️</span>
          섬 여행
        </button>
        {STATIC_CHIPS.map((chip) => (
          <span
            key={chip.label}
            className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-bold shadow-sm"
            style={{ backgroundColor: chip.bg, color: chip.fg }}
          >
            <span aria-hidden>{chip.emoji}</span>
            {chip.label}
          </span>
        ))}
      </div>

      {/* Loading state */}
      {loading && (
        <div className="mt-6 flex flex-col items-center gap-2 rounded-[20px] bg-white/70 p-8 text-center backdrop-blur">
          <Loader2 size={28} className="animate-spin text-[#00A8B5]" aria-hidden />
          <p className="text-sm font-semibold text-[#00707A]">{loadingMsg}</p>
        </div>
      )}

      {/* Inline error (friendly, not a dump) */}
      {!loading && error && (
        <div className="mt-6 flex items-center gap-2 rounded-[18px] bg-[#FFF3DC] px-4 py-3.5 text-sm font-semibold text-[#B84A00]">
          <span aria-hidden>🍊</span>
          {error}
        </div>
      )}

      {/* AI 여행 코스 — self-contained input + loading + tabs + timeline */}
      {mode === 'course' && <CoursePanel />}

      {/* Free-text recommendation results (VisitJeju) */}
      {!loading && mode === 'search' && results && results.length > 0 && (
        <section className="mt-6">
          {intro && (
            <p className="rounded-[18px] bg-white/80 px-4 py-3 text-sm font-semibold leading-relaxed text-[#00707A] shadow-sm backdrop-blur">
              {intro}
            </p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {results.map((place) => (
              <PlaceCard
                key={place.contentsId}
                place={place}
                displayLabel={displayLabelForPlace(place)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Rainy-day indoor places (VisitJeju, official data) */}
      {!loading && mode === 'rainy' && results && results.length > 0 && (
        <section className="mt-6">
          <h3 className="text-base font-extrabold tracking-tight text-[#1C6DD0]">
            ☔ 비 와도 좋은 곳
          </h3>
          <p className="mt-1.5 rounded-[14px] bg-[#E3F0FF] px-3.5 py-2.5 text-[12px] font-semibold leading-relaxed text-[#1C6DD0]">
            비짓제주 공식 정보 기반
          </p>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {results.map((place) => (
              <PlaceCard
                key={place.contentsId}
                place={place}
                displayLabel={displayLabelForPlace(place)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Local "hidden gems" results (web-sourced) */}
      {!loading && mode === 'local' && gems && gems.length > 0 && (
        <section className="mt-6">
          <h3 className="text-base font-extrabold tracking-tight text-[#6B4FB8]">
            👀 관광객은 잘 모르는 제주
          </h3>
          <p className="mt-1.5 rounded-[14px] bg-[#F2EFFC] px-3.5 py-2.5 text-[12px] font-semibold leading-relaxed text-[#5B3EA8]">
            🌐 웹에서 찾은 정보예요 · 공식 등록 정보가 아니니 방문 전 확인하세요
          </p>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {gems.map((gem, i) => (
              <LocalGemCard key={`${gem.name}-${i}`} gem={gem} />
            ))}
          </div>
        </section>
      )}

      {/* Current/upcoming festivals (web-sourced via sonar, AI date-filtered) */}
      {!loading && mode === 'festival' && festivals && festivals.length > 0 && (
        <section className="mt-6">
          <h3 className="text-base font-extrabold tracking-tight text-[#00707A]">
            🎪 이번 주 제주 축제
          </h3>
          <p className="mt-1.5 rounded-[14px] bg-[#D4F5F0] px-3.5 py-2.5 text-[12px] font-semibold leading-relaxed text-[#00707A]">
            🌐 웹에서 찾은 실시간 정보예요 · 행사 일정은 변동될 수 있으니 방문 전 확인하세요
          </p>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {festivals.map((festival, idx) => (
              <FestivalCard key={`${idx}-${festival.name}`} festival={festival} idx={idx} />
            ))}
          </div>
        </section>
      )}

      {/* Current seasonal sights (web-sourced via sonar, date-aware) */}
      {!loading && mode === 'seasonal' && sights && sights.length > 0 && (
        <section className="mt-6">
          <h3 className="text-base font-extrabold tracking-tight text-[#C2185B]">
            🌸 지금 제주 풍경
          </h3>
          <p className="mt-1.5 rounded-[14px] bg-[#FCE4EC] px-3.5 py-2.5 text-[12px] font-semibold leading-relaxed text-[#C2185B]">
            🌐 웹에서 찾은 실시간 정보예요 · 현장 상황은 변동될 수 있어요
          </p>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {sights.map((sight, idx) => (
              <SeasonalCard key={`${idx}-${sight.name}`} sight={sight} idx={idx} />
            ))}
          </div>
        </section>
      )}

      {/* Jeju ferry-accessible islands (web-sourced via sonar) */}
      {!loading && mode === 'islands' && islands && islands.length > 0 && (
        <section className="mt-6">
          <h3 className="text-base font-extrabold tracking-tight text-[#1D4ED8]">
            ⛴️ 배 타고 가는 제주 섬
          </h3>
          <p className="mt-1.5 rounded-[14px] bg-[#DBEAFE] px-3.5 py-2.5 text-[12px] font-semibold leading-relaxed text-[#1D4ED8]">
            🌐 웹에서 찾은 정보예요 · 시간표·요금은 자주 바뀌니 방문 전 운항사 확인 필수
          </p>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {islands.map((island, idx) => (
              <IslandCard key={`${idx}-${island.name}`} island={island} idx={idx} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
