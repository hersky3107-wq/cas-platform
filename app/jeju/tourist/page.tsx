import { fetchVisitJejuPlaces, type VisitJejuPlace } from '@/lib/jeju/connectors'
import { PlaceCard } from './place-card'

// Always fetch fresh; VisitJeju 축제/행사 listings rotate frequently.
export const dynamic = 'force-dynamic'

// ─── Curation constants ───────────────────────────────────────────────────────

/**
 * Substring denylist (case-insensitive). Drops places whose title OR tag string
 * contains any of these — catches private service businesses that VisitJeju
 * miscategorises under 관광지 (e.g. scuba shops, foot-spas, transport companies).
 */
const DENYLIST = [
  '스쿠버',
  '다이빙',
  '족욕',
  '스파',
  '운송',
  '고속',
  '렌터카',
  '클래스',
  '공방',
]

/** Target number of curated picks shown in "지금 뜨는 제주". */
const CURATED_COUNT = 8

/** Per-bucket target sizes: [관광지, 음식점, 쇼핑, 축제] */
const BUCKET_TARGETS: Record<string, number> = {
  c1: 2, // 가볼 곳
  c4: 2, // 맛집
  c2: 2, // 쇼핑
  c5: 2, // 축제
  c6: 1, // 테마 (bonus if available)
}

/** Friendly display label shown on cards, keyed by API categoryCode. */
const DISPLAY_LABEL: Record<string, string> = {
  c1: '가볼 곳',
  c4: '맛집',
  c2: '쇼핑',
  c5: '축제',
  c6: '테마',
}

function isDenied(place: VisitJejuPlace): boolean {
  const haystack = `${place.title} ${place.tags.join(' ')}`.toLowerCase()
  return DENYLIST.some((kw) => haystack.includes(kw))
}

/** Returns true when the title STARTS with a year that is before 2026. */
function isPastYearEvent(place: VisitJejuPlace): boolean {
  const m = place.title.match(/^(20\d{2})/)
  if (!m) return false
  return parseInt(m[1]!, 10) < 2026
}

/**
 * Curate the raw ~32 balanced places down to CURATED_COUNT well-rounded picks:
 *  1. Drop denylist matches entirely.
 *  2. Separate remaining into primary (non-past-year) and deprioritised (past-year).
 *  3. Fill per-bucket targets from primary first, then deprioritised as top-up.
 *  4. If total < CURATED_COUNT after filling targets, backfill from leftovers.
 */
function curate(raw: VisitJejuPlace[]): Array<{ place: VisitJejuPlace; displayLabel: string }> {
  const allowed = raw.filter((p) => !isDenied(p))
  const primary = allowed.filter((p) => !isPastYearEvent(p))
  const deprio = allowed.filter((p) => isPastYearEvent(p))

  // Fill buckets from primary, then deprio as top-up.
  const buckets: Record<string, VisitJejuPlace[]> = {}
  for (const code of Object.keys(BUCKET_TARGETS)) buckets[code] = []

  const leftovers: VisitJejuPlace[] = []

  for (const pool of [primary, deprio]) {
    for (const p of pool) {
      const code = p.categoryCode
      const target = BUCKET_TARGETS[code]
      if (target !== undefined) {
        const bucket = buckets[code]!
        if (bucket.length < target) {
          bucket.push(p)
        } else {
          leftovers.push(p)
        }
      } else {
        leftovers.push(p)
      }
    }
  }

  // Interleave buckets round-robin for visual variety.
  const lists = Object.entries(buckets)
    .filter(([, arr]) => arr.length > 0)
    .map(([code, arr]) => ({ code, arr }))

  const ordered: Array<{ place: VisitJejuPlace; displayLabel: string }> = []
  for (let i = 0; lists.some((l) => i < l.arr.length); i++) {
    for (const { code, arr } of lists) {
      if (i < arr.length) {
        ordered.push({
          place: arr[i]!,
          displayLabel: DISPLAY_LABEL[code] ?? code,
        })
      }
    }
  }

  // Backfill with leftovers (not denied, not yet picked) up to CURATED_COUNT.
  if (ordered.length < CURATED_COUNT) {
    const pickedIds = new Set(ordered.map((o) => o.place.contentsId))
    for (const p of leftovers) {
      if (ordered.length >= CURATED_COUNT) break
      if (!pickedIds.has(p.contentsId)) {
        ordered.push({
          place: p,
          displayLabel: DISPLAY_LABEL[p.categoryCode] ?? p.categoryLabel,
        })
      }
    }
  }

  return ordered.slice(0, CURATED_COUNT)
}

// ─── UI helpers ──────────────────────────────────────────────────────────────

const CATEGORY_CHIPS: Array<{ emoji: string; label: string; bg: string; fg: string }> = [
  { emoji: '🌸', label: '지금 꽃', bg: '#FFE0EC', fg: '#D6336C' },
  { emoji: '🎪', label: '이번 주 축제', bg: '#D9F6FA', fg: '#00707A' },
  { emoji: '☔', label: '비 와도 좋은 곳', bg: '#E3F0FF', fg: '#1C6DD0' },
  { emoji: '🗺️', label: '코스 짜줘', bg: '#FFF1D6', fg: '#FF8C42' },
  { emoji: '⛴️', label: '우도 배편', bg: '#E0FBF2', fg: '#0A8F6E' },
]

/** Soft inline-SVG motifs — let the background breathe. */
function TouristMotifs() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <svg
        className="absolute -top-1 left-0 w-full opacity-60"
        viewBox="0 0 1440 120"
        preserveAspectRatio="none"
        fill="none"
      >
        <path
          d="M0 60 C 240 110 480 10 720 50 C 960 90 1200 20 1440 60 L1440 0 L0 0 Z"
          fill="#FFFFFF"
          fillOpacity="0.35"
        />
      </svg>
      <div className="absolute right-6 top-24 h-24 w-24 rounded-full bg-[#FF8C42] opacity-15 blur-[2px]" />
      <div className="absolute right-20 top-40 h-12 w-12 rounded-full bg-[#FFD23F] opacity-25" />
      <div className="absolute -left-6 top-52 h-28 w-28 rounded-full bg-[#00A8B5] opacity-10" />
      <svg className="absolute left-8 top-[30%] w-40 opacity-50" viewBox="0 0 200 80" fill="#FFFFFF">
        <ellipse cx="60" cy="50" rx="46" ry="26" />
        <ellipse cx="110" cy="44" rx="40" ry="30" />
        <ellipse cx="150" cy="52" rx="34" ry="22" />
      </svg>
      <svg
        className="absolute right-10 top-[58%] w-32 opacity-40"
        viewBox="0 0 200 80"
        fill="#FFFFFF"
      >
        <ellipse cx="60" cy="50" rx="46" ry="26" />
        <ellipse cx="110" cy="44" rx="40" ry="30" />
        <ellipse cx="150" cy="52" rx="34" ry="22" />
      </svg>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="mx-auto mt-6 flex max-w-md flex-col items-center gap-3 rounded-[20px] bg-white/80 p-8 text-center shadow-[0_10px_30px_-12px_rgba(0,112,122,0.35)] backdrop-blur">
      <span className="text-5xl" aria-hidden>
        🍊
      </span>
      <p className="text-base font-bold text-[#00707A]">지금 제주 정보를 불러오지 못했어요.</p>
      <p className="text-sm text-[#00707A]/70">잠시 후 다시 시도해 주세요.</p>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function JejuTouristHomePage() {
  const result = await fetchVisitJejuPlaces()
  const raw: VisitJejuPlace[] = result.ok ? result.places : []
  const curated = curate(raw)

  return (
    <main className="relative min-h-screen overflow-hidden bg-gradient-to-b from-[#7FD8E8] via-[#CFF3F8] to-[#E8FAFC] text-[#0A2B30]">
      <TouristMotifs />

      <div className="relative mx-auto w-full max-w-3xl px-4 pb-16 pt-6">
        {/* 1. Top bar */}
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span
              className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#00A8B5] text-xl text-white shadow-[0_6px_16px_-4px_rgba(0,168,181,0.7)]"
              aria-hidden
            >
              🧭
            </span>
            <h1 className="text-lg font-extrabold tracking-tight text-[#00707A]">
              제주 AI 여행 안내
            </h1>
          </div>
          <span className="flex items-center gap-1 rounded-full bg-white/85 px-3 py-1.5 text-xs font-bold text-[#00707A] shadow-sm backdrop-blur">
            <span aria-hidden>🌥️</span>
            제주시 18° 흐림
          </span>
        </header>

        {/* 2. Search input (visual only) */}
        <div className="mt-5">
          <div className="flex items-center gap-2 rounded-[18px] bg-white px-4 py-3.5 shadow-[0_12px_30px_-14px_rgba(0,112,122,0.55)] ring-1 ring-[#00A8B5]/15">
            <span className="text-xl" aria-hidden>🔍</span>
            <input
              type="text"
              disabled
              placeholder="제주에서 뭐 하고 싶으세요?"
              className="w-full cursor-default bg-transparent text-[15px] font-medium text-[#0A2B30] placeholder:text-[#00A8B5]/60 focus:outline-none"
            />
          </div>
        </div>

        {/* 3. Category chips (visual only) */}
        <div className="mt-4 flex flex-wrap gap-2">
          {CATEGORY_CHIPS.map((chip) => (
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

        {/* 4. Section header */}
        <div className="mt-10 flex items-end justify-between">
          <h2 className="text-xl font-extrabold tracking-tight text-[#00707A]">
            지금 뜨는 제주
          </h2>
          <span className="text-xs font-semibold text-[#00A8B5]">실시간 비짓제주</span>
        </div>

        {/* 5. Curated illustrated cards — 2 cols mobile, 3 cols desktop */}
        {curated.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {curated.map(({ place, displayLabel }) => (
              <PlaceCard key={place.contentsId} place={place} displayLabel={displayLabel} />
            ))}
          </div>
        )}

        {/* Source attribution */}
        <p className="mt-6 text-center text-[11px] text-[#00707A]/60">
          정보·이미지 출처: 비짓제주(제주관광공사)
        </p>
      </div>
    </main>
  )
}
