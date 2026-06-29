import { fetchVisitJejuPlaces, type VisitJejuPlace } from '@/lib/jeju/connectors'
import { FeaturedGrid } from './featured-grid'
import { SearchPanel } from './search-panel'
import { DISPLAY_LABEL } from './category-labels'

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

/** Subtle Jeju sunrise scene — Seongsan Ilchulbong silhouette + soft glow + faint flower dots.
 *  Pure CSS/SVG, no image files. All elements at very low opacity so content stays primary. */
function JejuScenery() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {/* Extra warm horizon glow — reinforces the sunrise gradient */}
      <div
        className="absolute inset-x-0 bottom-0"
        style={{
          height: '50%',
          background:
            'linear-gradient(to top, rgba(255,208,112,0.14) 0%, rgba(255,228,168,0.07) 42%, transparent 100%)',
        }}
      />

      {/* ── Scene SVG: sun disc · sea · Seongsan Ilchulbong silhouette ── */}
      <svg
        className="absolute bottom-0 left-0 w-full"
        viewBox="0 0 1000 220"
        preserveAspectRatio="none"
        style={{ height: 'clamp(130px, 34vh, 275px)' }}
      >
        {/* Soft sun disc — partially occluded by the peak (sunrise behind mountain) */}
        <circle cx="548" cy="20" r="46" fill="#FFD070" fillOpacity="0.28" />
        <circle cx="548" cy="20" r="30" fill="#FFE898" fillOpacity="0.20" />

        {/* Sea surface band */}
        <rect x="0" y="194" width="1000" height="26" fill="#9ACCD8" fillOpacity="0.16" />

        {/* Seongsan Ilchulbong — broad tuff-cone dome rising from the sea.
            Wide low dome with gentle symmetric slopes; peak centred slightly right
            so it reads as a landmark rather than just a hill. */}
        <path
          d="
            M 0 195
            L 182 195
            C 245 195 298 190 340 182
            C 388 172 430 149 464 118
            C 490 93 511 67 527 51
            C 536 40 542 35 548 33
            C 554 35 560 40 569 51
            C 585 69 606 97 632 124
            C 666 156 702 177 738 188
            C 770 194 818 196 876 195
            L 1000 195
            L 1000 220 L 0 220 Z
          "
          fill="#1C3840"
          fillOpacity="0.19"
        />

        {/* Subtle inner core for depth — very slightly darker centre */}
        <path
          d="
            M 430 195
            C 448 178 470 152 492 122
            C 510 97 526 73 538 55
            C 543 44 547 38 550 36
            C 553 38 557 44 562 55
            C 573 74 590 101 612 128
            C 640 160 668 183 695 193
            Z
          "
          fill="#12303A"
          fillOpacity="0.13"
        />

        {/* Sea-horizon shimmer line */}
        <line x1="0" y1="195" x2="1000" y2="195" stroke="#8EC8D8" strokeOpacity="0.20" strokeWidth="1.5" />
      </svg>

      {/* ── Faint flower accent dots: canola-yellow + camellia-red ── */}
      {/* Left cluster */}
      <div className="absolute" style={{ bottom: '8%', left: '7%' }}>
        <div className="absolute h-2 w-2 rounded-full bg-[#F5D020]" style={{ opacity: 0.20 }} />
        <div className="absolute h-1.5 w-1.5 rounded-full bg-[#F5D020]" style={{ opacity: 0.16, top: '10px', left: '14px' }} />
        <div className="absolute h-1.5 w-1.5 rounded-full bg-[#E8405A]" style={{ opacity: 0.13, top: '3px', left: '24px' }} />
        <div className="absolute h-1 w-1 rounded-full bg-[#F5D020]" style={{ opacity: 0.17, top: '17px', left: '6px' }} />
      </div>
      {/* Right cluster */}
      <div className="absolute" style={{ bottom: '10%', right: '11%' }}>
        <div className="absolute h-2 w-2 rounded-full bg-[#E8405A]" style={{ opacity: 0.12 }} />
        <div className="absolute h-1.5 w-1.5 rounded-full bg-[#F5D020]" style={{ opacity: 0.19, top: '7px', left: '13px' }} />
        <div className="absolute h-1 w-1 rounded-full bg-[#F5D020]" style={{ opacity: 0.16, top: '16px', left: '4px' }} />
        <div className="absolute h-1.5 w-1.5 rounded-full bg-[#E8405A]" style={{ opacity: 0.11, top: '9px', left: '22px' }} />
      </div>
      {/* Centre-bottom scatter */}
      <div className="absolute" style={{ bottom: '6%', left: '44%' }}>
        <div className="absolute h-1.5 w-1.5 rounded-full bg-[#F5D020]" style={{ opacity: 0.15 }} />
        <div className="absolute h-1 w-1 rounded-full bg-[#E8405A]" style={{ opacity: 0.11, top: '9px', left: '10px' }} />
      </div>
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
    <main
      className="relative min-h-screen overflow-hidden text-[#0A2B30]"
      style={{
        background:
          'linear-gradient(to bottom, #7FD8E8 0%, #BCE8F2 40%, #D8EEF4 65%, #F0E4CC 100%)',
      }}
    >
      <JejuScenery />

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

        {/* 2. Search input + chips + AI recommendation results (client component) */}
        <SearchPanel />

        {/* 4. Section header */}
        <div className="mt-10 flex items-end justify-between">
          <h2 className="text-xl font-extrabold tracking-tight text-[#00707A]">
            지금 뜨는 제주
          </h2>
          <span className="text-xs font-semibold text-[#00A8B5]">실시간 비짓제주</span>
        </div>

        {/* 5. Curated illustrated cards — 2 cols mobile, 3 cols desktop */}
        {curated.length === 0 ? <EmptyState /> : <FeaturedGrid items={curated} />}

        {/* Source attribution */}
        <p className="mt-6 text-center text-[11px] text-[#00707A]/60">
          정보·이미지 출처: 비짓제주(제주관광공사)
        </p>
      </div>
    </main>
  )
}
