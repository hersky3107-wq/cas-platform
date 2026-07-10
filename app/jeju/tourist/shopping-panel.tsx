'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import {
  Loader2,
  RefreshCw,
  Phone,
  Globe,
  Map as MapIcon,
  ExternalLink,
  Info,
  Store,
  Building2,
  ShoppingBag,
} from 'lucide-react'
import { useTouristUi } from '@/components/jeju/useTouristUi'
import {
  detailFromShopping,
  googleMapsUrl,
  naverMapsUrl,
  kakaoMapsUrl,
} from './place-detail'

/**
 * 🛍 Shopping chip — foreigner-facing merged Jeju shopping list.
 *
 * Fetches GET /api/tourist/shopping?locale=... (static landmarks + live
 * VisitJeju c2) and renders three sections:
 *   A. Duty-Free   — JDC sponsor entries pinned + emphasized on top, then other duty-free.
 *   B. Markets & Malls — landmark markets + static 오일장.
 *   C. More Shops  — general c2 long tail, COLLAPSED behind "show more" (20 at a time).
 *
 * Reuses the SAME 3-map link block (Naver/Google/Kakao) as the place-detail
 * modal and course-stop cards, built from each item's lat/lng (coord pin) or
 * cleaned-name fallback via detailFromShopping.
 *
 * UI-only: fetches the route; never imports supabase, never reads env/keys.
 */

/** Output shape of GET /api/tourist/shopping (kept in sync with the route). */
interface ShoppingItem {
  id: string
  name: string
  address: string | null
  phone: string | null
  homepage: string | null
  lat: number | null
  lng: number | null
  category: 'dutyfree' | 'market' | 'mall' | 'shop'
  sponsor: boolean
  note: string | null
  source: 'static' | 'visitjeju'
}

interface ShoppingResponse {
  items: ShoppingItem[]
  counts: { static: number; landmarks: number; general: number; total: number }
  locale: string
  warnings?: string[]
}

/** How many "more shops" to reveal per "show more" tap (mobile perf). */
const MORE_INC = 20
/** Tourist-mode norm: 15s timeout, 1 auto-retry on network/timeout failure. */
const FETCH_TIMEOUT_MS = 15_000

/** One fetch attempt with a hard timeout. */
async function fetchOnce(url: string, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** fetch() that transparently retries ONCE (~1s later) on any failure. */
async function fetchWithOneRetry(url: string, timeoutMs: number): Promise<Response> {
  try {
    return await fetchOnce(url, timeoutMs)
  } catch {
    await new Promise<void>((r) => setTimeout(r, 1_000))
    return fetchOnce(url, timeoutMs) // throws on second failure, caught by caller
  }
}

/** Section heading row with an icon + title. */
function SectionHeading({
  icon,
  title,
  count,
}: {
  icon: React.ReactNode
  title: string
  count: number
}) {
  if (count === 0) return null
  return (
    <h4 className="mt-6 flex items-center gap-1.5 text-[15px] font-extrabold tracking-tight text-[#0A2B30]">
      <span className="text-[#00A8B5]" aria-hidden>
        {icon}
      </span>
      {title}
      <span className="text-[12px] font-bold text-slate-400">({count})</span>
    </h4>
  )
}

/** Inline 3-map link block — mirrors course-timeline.tsx StopRow. */
function MapLinks({ item }: { item: ShoppingItem }) {
  const { t } = useTouristUi()
  const d = detailFromShopping(item)
  if (d.mapTarget === null) {
    return (
      <p className="mt-2.5 flex items-start gap-1.5 rounded-[12px] bg-slate-50 px-3 py-2 text-[11px] font-medium leading-relaxed text-slate-500">
        <Info size={12} strokeWidth={2.5} className="mt-0.5 shrink-0 text-slate-400" aria-hidden />
        {t.mapNoLocation}
      </p>
    )
  }
  return (
    <div className="mt-2.5">
      <p className="mb-1 text-[11px] leading-relaxed text-slate-400">{t.mapHelperHint}</p>
      <div className="grid grid-cols-3 gap-1.5">
        <a
          href={googleMapsUrl(d)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1 rounded-[10px] bg-[#00A8B5] px-1.5 py-2 text-[11px] font-bold text-white shadow-sm transition-opacity hover:opacity-90"
        >
          Google
          <ExternalLink size={10} strokeWidth={2.5} aria-hidden />
        </a>
        <a
          href={naverMapsUrl(d)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1 rounded-[10px] bg-[#03C75A] px-1.5 py-2 text-[11px] font-bold text-white shadow-sm transition-opacity hover:opacity-90"
        >
          {t.mapNaver}
          <ExternalLink size={10} strokeWidth={2.5} aria-hidden />
        </a>
        <a
          href={kakaoMapsUrl(d)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1 rounded-[10px] bg-[#FEE500] px-1.5 py-2 text-[11px] font-bold text-[#3C1E1E] shadow-sm transition-opacity hover:opacity-90"
        >
          {t.mapKakao}
          <ExternalLink size={10} strokeWidth={2.5} aria-hidden />
        </a>
      </div>
    </div>
  )
}

/** Single shopping card. JDC sponsor cards get an emphasized warm border + badge. */
/** Verified landmarks/duty-free (official 064-/1688-type numbers) may show phone. */
function isVerifiedPhoneSource(item: ShoppingItem): boolean {
  return item.source === 'static' || item.category === 'dutyfree' || item.category === 'market'
}

function ShoppingCard({ item }: { item: ShoppingItem }) {
  const { t } = useTouristUi()
  const sponsor = item.sponsor
  const showPhone = isVerifiedPhoneSource(item)
  return (
    <article
      className={`flex flex-col rounded-[18px] bg-white p-4 shadow-[0_8px_24px_-12px_rgba(0,112,122,0.4)] ring-1 ${
        sponsor ? 'ring-[#E8A85C]/70 ring-2' : 'ring-[#00A8B5]/10'
      }`}
    >
      {/* JDC sponsor badge */}
      {sponsor && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-[#FFF3DC] px-2.5 py-0.5 text-[11px] font-extrabold text-[#B84A00] ring-1 ring-[#E8A85C]/60">
            <span aria-hidden>🍊</span>
            {t.shoppingJdcBadgeLabel}
          </span>
        </div>
      )}

      {/* name */}
      <h5 className="text-[15px] font-extrabold leading-snug text-[#0A2B30]">{item.name}</h5>

      {/* address */}
      {item.address && (
        <p className="mt-1 text-[12px] leading-relaxed text-[#4A5C5F]">{item.address}</p>
      )}

      {/* phone + homepage row.
          Privacy/PIPA: phone is shown ONLY for verified landmarks/duty-free
          (source==='static', or category 'dutyfree'/'market') — never for the
          general c2 long tail (source==='visitjeju' && category 'shop'/'mall'),
          which can surface personal mobile numbers scraped from VisitJeju.
          Data is left intact (route/API unchanged) — this is a UI-only gate. */}
      {((showPhone && item.phone) || item.homepage) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {showPhone && item.phone && (
            <a
              href={`tel:${item.phone.replace(/[^0-9+]/g, '')}`}
              className="inline-flex items-center gap-1 text-[12px] font-bold text-[#00A8B5] transition-opacity hover:opacity-80"
            >
              <Phone size={12} strokeWidth={2.5} aria-hidden />
              {item.phone}
            </a>
          )}
          {item.homepage && (
            <a
              href={item.homepage}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[12px] font-bold text-[#1C6DD0] transition-opacity hover:opacity-80"
            >
              <Globe size={12} strokeWidth={2.5} aria-hidden />
              {t.helpOfficialSite}
              <ExternalLink size={10} strokeWidth={2.5} aria-hidden />
            </a>
          )}
        </div>
      )}

      {/* usage note (always shown for duty-free so users aren't misled) */}
      {item.note && (
        <p className="mt-2.5 rounded-[12px] bg-[#F1F5F6] px-3 py-2 text-[11px] font-medium leading-relaxed text-[#5A7176]">
          <span className="font-extrabold text-[#0A2B30]">{t.shoppingUsageLabel}: </span>
          {item.note}
        </p>
      )}

      {/* JDC public-interest caption (sponsor only) */}
      {sponsor && (
        <p className="mt-2 rounded-[12px] bg-[#FFF3DC] px-3 py-2 text-[11px] font-semibold leading-relaxed text-[#B84A00]">
          {t.shoppingJdcBadge}
        </p>
      )}

      <MapLinks item={item} />
    </article>
  )
}

export function ShoppingPanel() {
  const { t, locale } = useTouristUi()
  const [items, setItems] = useState<ShoppingItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [timedOut, setTimedOut] = useState(false)
  const [moreCount, setMoreCount] = useState(0)
  const loadingRef = useRef(false)

  const load = useCallback(async () => {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    setError(null)
    setTimedOut(false)
    setMoreCount(0)
    try {
      const res = await fetchWithOneRetry(
        `/api/tourist/shopping?locale=${encodeURIComponent(locale)}`,
        FETCH_TIMEOUT_MS
      )
      const data = (await res.json()) as ShoppingResponse
      // Route never 500s (degrades to static-only + warnings); warnings are
      // ignored in the UI per spec — items still render.
      setItems(data.items ?? [])
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') {
        setTimedOut(true)
      } else {
        setError(t.errShopping)
      }
      setItems([])
    } finally {
      setLoading(false)
      loadingRef.current = false
    }
  }, [locale, t.errShopping])

  useEffect(() => {
    void load()
  }, [load])

  // Group items into the three sections. Order within duty-free: sponsor first
  // (route already delivers sponsor-first), preserved as-is.
  const dutyFree = items?.filter((i) => i.category === 'dutyfree') ?? []
  const marketsMalls = items?.filter((i) => i.category === 'market' || i.category === 'mall') ?? []
  const moreShops = items?.filter((i) => i.category === 'shop') ?? []
  const visibleMore = moreShops.slice(0, moreCount)
  const remainingMore = moreShops.length - visibleMore.length

  return (
    <section className="mt-6">
      <h3 className="text-base font-extrabold tracking-tight text-[#0A2B30]">{t.shoppingHeading}</h3>
      <p className="mt-1.5 rounded-[14px] bg-[#DBEAFE] px-3.5 py-2.5 text-[12px] font-semibold leading-relaxed text-[#1C6DD0]">
        {t.shoppingNote}
      </p>

      {/* Loading */}
      {loading && (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-[20px] bg-white/70 p-8 text-center backdrop-blur">
          <Loader2 size={28} className="animate-spin text-[#00A8B5]" aria-hidden />
          <p className="text-sm font-semibold text-[#00707A]">{t.loadShopping[0]}</p>
        </div>
      )}

      {/* Timeout soft retry */}
      {!loading && timedOut && (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-[20px] bg-white/80 px-6 py-6 text-center shadow-sm backdrop-blur">
          <p className="text-sm font-semibold text-[#00707A]">{t.retryMessage}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#00A8B5] px-5 py-2 text-sm font-bold text-white shadow-sm transition-opacity hover:opacity-90"
          >
            <RefreshCw size={14} aria-hidden />
            {t.retryButton}
          </button>
        </div>
      )}

      {/* Inline error */}
      {!loading && !timedOut && error && (
        <div className="mt-6 flex items-center gap-2 rounded-[18px] bg-[#FFF3DC] px-4 py-3.5 text-sm font-semibold text-[#B84A00]">
          <span aria-hidden>🍊</span>
          {error}
        </div>
      )}

      {/* Results */}
      {!loading && items && items.length > 0 && (
        <>
          {/* A. Duty-Free — JDC sponsor pinned + emphasized on top */}
          <SectionHeading icon={<ShoppingBag size={16} strokeWidth={2.5} />} title={t.shoppingDutyFree} count={dutyFree.length} />
          {dutyFree.length > 0 && (
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {dutyFree.map((item) => (
                <ShoppingCard key={item.id} item={item} />
              ))}
            </div>
          )}

          {/* B. Markets & Malls */}
          <SectionHeading icon={<Store size={16} strokeWidth={2.5} />} title={t.shoppingMarketsMalls} count={marketsMalls.length} />
          {marketsMalls.length > 0 && (
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {marketsMalls.map((item) => (
                <ShoppingCard key={item.id} item={item} />
              ))}
            </div>
          )}

          {/* C. More Shops — collapsed, reveal 20 at a time */}
          <SectionHeading icon={<Building2 size={16} strokeWidth={2.5} />} title={t.shoppingMoreShops} count={moreShops.length} />
          {moreShops.length > 0 && (
            <>
              {moreCount > 0 && (
                <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {visibleMore.map((item) => (
                    <ShoppingCard key={item.id} item={item} />
                  ))}
                </div>
              )}
              {remainingMore > 0 && (
                <div className="mt-4 flex justify-center">
                  <button
                    type="button"
                    onClick={() => setMoreCount((n) => n + MORE_INC)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-[#00707A] shadow-sm ring-1 ring-[#00A8B5]/25 transition-transform hover:-translate-y-0.5 hover:ring-[#00A8B5]/50"
                  >
                    <MapIcon size={14} strokeWidth={2.5} aria-hidden />
                    {t.shoppingShowMore}
                    <span className="text-[12px] font-semibold text-slate-400">
                      ({remainingMore})
                    </span>
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Empty (no items at all — rare; route always has static landmarks) */}
      {!loading && !error && !timedOut && items && items.length === 0 && (
        <div className="mt-6 rounded-[18px] bg-white/80 px-4 py-6 text-center text-sm font-semibold text-[#00707A] shadow-sm backdrop-blur">
          {t.emptyTitle}
        </div>
      )}
    </section>
  )
}
