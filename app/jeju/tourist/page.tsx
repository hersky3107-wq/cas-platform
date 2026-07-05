import {
  fetchVisitJejuPlaces,
  getVisitJejuPool,
  pickFeaturedVisitJejuPlaces,
  FEATURED_BUCKET_TARGETS,
  type VisitJejuPlace,
} from '@/lib/jeju/connectors'
import { FeaturedGrid } from './featured-grid'
import { SearchPanel } from './search-panel'
import { TouristHeader } from './tourist-header'

// Always fetch fresh; featured subset is re-sampled every request from the cached pool.
export const dynamic = 'force-dynamic'
// Give enough headroom for 15s-timeout pool fetch + fallback + 1s wait + one retry.
export const maxDuration = 60

const CURATED_COUNT = 8

/**
 * Server-renders the Korean (kr) featured sample. Non-Korean UI locales re-fetch
 * a localized + re-sampled set client-side (see FeaturedGrid) — the server can't
 * know the client locale (it lives in localStorage), so kr is the initial paint.
 */
async function loadFeaturedPlaces(): Promise<VisitJejuPlace[]> {
  let pool = await getVisitJejuPool('kr')
  if (pool.length === 0) {
    const fallback = await fetchVisitJejuPlaces({
      perCategory: 20,
      categories: ['c1', 'c4', 'c5', 'c2', 'c6'],
      locale: 'kr',
    })
    pool = fallback.ok ? fallback.places : []
  }
  const picks = pickFeaturedVisitJejuPlaces(pool, {
    count: CURATED_COUNT,
    bucketTargets: FEATURED_BUCKET_TARGETS,
  })

  // Both pool and fallback returned nothing — VisitJeju had a transient blip.
  // Retry fetchVisitJejuPlaces once after a short delay before giving up.
  if (picks.length === 0) {
    await new Promise<void>((r) => setTimeout(r, 1_000))
    const retry = await fetchVisitJejuPlaces({
      perCategory: 20,
      categories: ['c1', 'c4', 'c5', 'c2', 'c6'],
      locale: 'kr',
    })
    const retryPool = retry.ok ? retry.places : []
    return pickFeaturedVisitJejuPlaces(retryPool, {
      count: CURATED_COUNT,
      bucketTargets: FEATURED_BUCKET_TARGETS,
    })
  }

  return picks
}

// ─── UI helpers ──────────────────────────────────────────────────────────────

/** Jeju sunrise scene — Seongsan Ilchulbong + sea with waves + sun + visible flower accents.
 *  Pure CSS/SVG, no image files. Scenery lives in the bottom ~38 vh so upper content stays clear. */
function JejuScenery() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {/* Warm horizon glow — radiates up from the waterline */}
      <div
        className="absolute inset-x-0 bottom-0"
        style={{
          height: '52%',
          background:
            'linear-gradient(to top, rgba(255,192,88,0.22) 0%, rgba(255,216,140,0.11) 38%, transparent 100%)',
        }}
      />

      {/* ── Full scene SVG ───────────────────────────────────────────────────── */}
      <svg
        className="absolute bottom-0 left-0 w-full"
        viewBox="0 0 1000 245"
        preserveAspectRatio="none"
        style={{ height: 'clamp(150px, 38vh, 300px)' }}
      >
        <defs>
          {/* Canola — 5-petal, golden yellow */}
          <g id="fl-canola">
            <circle cx="0"     cy="-4.5" r="2.8" fill="#F5C518" />
            <circle cx="4.28"  cy="-1.39" r="2.8" fill="#F5C518" />
            <circle cx="2.64"  cy="3.64"  r="2.8" fill="#F5C518" />
            <circle cx="-2.64" cy="3.64"  r="2.8" fill="#F5C518" />
            <circle cx="-4.28" cy="-1.39" r="2.8" fill="#F5C518" />
            <circle cx="0"     cy="0"     r="2.0" fill="#FFE055" />
          </g>
          {/* Camellia — 5-petal, warm red */}
          <g id="fl-camellia">
            <circle cx="0"     cy="-5.2"  r="3.5" fill="#E8405A" />
            <circle cx="4.95"  cy="-1.60" r="3.5" fill="#E8405A" />
            <circle cx="3.06"  cy="4.21"  r="3.5" fill="#E8405A" />
            <circle cx="-3.06" cy="4.21"  r="3.5" fill="#E8405A" />
            <circle cx="-4.95" cy="-1.60" r="3.5" fill="#E8405A" />
            <circle cx="0"     cy="0"     r="2.2" fill="#FF7A90" />
          </g>
          {/* Cherry blossom — 5-petal, soft pink */}
          <g id="fl-cherry">
            <circle cx="0"     cy="-3.8"  r="2.2" fill="#F8C0D0" />
            <circle cx="3.62"  cy="-1.17" r="2.2" fill="#F8C0D0" />
            <circle cx="2.24"  cy="3.07"  r="2.2" fill="#F8C0D0" />
            <circle cx="-2.24" cy="3.07"  r="2.2" fill="#F8C0D0" />
            <circle cx="-3.62" cy="-1.17" r="2.2" fill="#F8C0D0" />
            <circle cx="0"     cy="0"     r="1.5" fill="#FDE8F0" />
          </g>
        </defs>

        {/* ── Sun: outer halo → mid ring → bright core ── */}
        <circle cx="548" cy="26" r="80" fill="#FFE0A8" fillOpacity="0.14" />
        <circle cx="548" cy="26" r="54" fill="#FFD070" fillOpacity="0.30" />
        <circle cx="548" cy="26" r="36" fill="#FFE898" fillOpacity="0.40" />

        {/* ── Sea ── */}
        <rect x="0" y="188" width="1000" height="57" fill="#9ACCD8" fillOpacity="0.30" />
        <rect x="0" y="210" width="1000" height="35" fill="#7AB8C8" fillOpacity="0.18" />

        {/* ── Seongsan Ilchulbong silhouette ── */}
        <path
          d="
            M 0 190
            L 180 190
            C 244 190 298 185 340 177
            C 388 167 430 144 464 113
            C 490 88 511 62 527 46
            C 536 35 542 30 548 28
            C 554 30 560 35 569 46
            C 585 64 606 92 632 119
            C 666 151 702 172 738 183
            C 770 189 818 191 876 190
            L 1000 190
            L 1000 245 L 0 245 Z
          "
          fill="#1C3840"
          fillOpacity="0.22"
        />
        {/* Inner core — subtle depth shadow */}
        <path
          d="
            M 432 190
            C 450 173 472 147 494 117
            C 512 92 528 68 540 50
            C 544 39 548 33 550 31
            C 552 33 556 39 560 50
            C 572 69 590 96 612 123
            C 640 155 668 178 695 188
            Z
          "
          fill="#12303A"
          fillOpacity="0.15"
        />

        {/* ── Wave lines ── */}
        <path
          d="M 0 191 Q 125 187 250 191 Q 375 195 500 191 Q 625 187 750 191 Q 875 195 1000 191"
          stroke="#B8DCE5" strokeOpacity="0.55" strokeWidth="1.5" fill="none"
        />
        <path
          d="M 0 201 Q 100 198 200 201 Q 300 204 400 201 Q 500 198 600 201 Q 700 204 800 201 Q 900 198 1000 201"
          stroke="#A4CEDE" strokeOpacity="0.38" strokeWidth="1.2" fill="none"
        />
        <path
          d="M 0 211 Q 160 208 320 211 Q 480 214 640 211 Q 800 208 1000 211"
          stroke="#96C4D4" strokeOpacity="0.28" strokeWidth="1.0" fill="none"
        />

        {/* ── Flowers: drawn last so they sit in front of everything ── */}
        {/* Left shore */}
        <use href="#fl-canola"   transform="translate(30,  222)" opacity="0.55" />
        <use href="#fl-camellia" transform="translate(70,  217)" opacity="0.48" />
        <use href="#fl-cherry"   transform="translate(112, 225)" opacity="0.52" />
        <use href="#fl-canola"   transform="translate(158, 220)" opacity="0.50" />
        <use href="#fl-cherry"   transform="translate(206, 226)" opacity="0.46" />
        <use href="#fl-camellia" transform="translate(255, 218)" opacity="0.44" />
        <use href="#fl-canola"   transform="translate(304, 224)" opacity="0.40" />
        {/* Near mountain base — slightly softer since partially "behind" the scene */}
        <use href="#fl-cherry"   transform="translate(388, 229)" opacity="0.36" />
        <use href="#fl-canola"   transform="translate(620, 228)" opacity="0.36" />
        {/* Right shore */}
        <use href="#fl-camellia" transform="translate(694, 220)" opacity="0.42" />
        <use href="#fl-cherry"   transform="translate(740, 226)" opacity="0.48" />
        <use href="#fl-canola"   transform="translate(786, 219)" opacity="0.52" />
        <use href="#fl-camellia" transform="translate(834, 224)" opacity="0.46" />
        <use href="#fl-cherry"   transform="translate(882, 220)" opacity="0.50" />
        <use href="#fl-canola"   transform="translate(930, 226)" opacity="0.54" />
        <use href="#fl-camellia" transform="translate(970, 218)" opacity="0.44" />
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
  const picks = (await loadFeaturedPlaces()) ?? []

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
        {/* 1. Top bar — live clock, translated title, date, weather + language toggle */}
        <TouristHeader />

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
        {picks.length === 0 ? <EmptyState /> : <FeaturedGrid initialItems={picks} />}

        {/* Source attribution */}
        <p className="mt-6 text-center text-[11px] text-[#00707A]/60">
          정보·이미지 출처: 비짓제주(제주관광공사)
        </p>
      </div>
    </main>
  )
}
