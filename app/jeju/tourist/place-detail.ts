import type { VisitJejuPlace } from '@/lib/jeju/connectors'
import type { LocalGem } from '@/lib/jeju/tourist-local'
import type { SeasonalItem } from '@/lib/jeju/tourist-seasonal'
import type { IslandInfo } from '@/lib/jeju/tourist-ferry'

/**
 * Normalized detail shape so ONE modal can render every card type
 * (VisitJeju rich + web/sonar honest). Pure data — safe to import from both
 * server and client components.
 */
export interface PlaceDetail {
  title: string
  /** region / area line under the title. */
  subtitle?: string
  description?: string
  address?: string
  lat?: number | null
  lng?: number | null
  /** Kept in the shape for future re-enable; modal rendering is disabled. */
  imageUrl?: string | null
  tags?: string[]
  phone?: string
  openingHours?: string
  caution?: string
  /** Extra labeled rows for web items (period/charm/fare/duration/departure/season). */
  infoRows?: { label: string; value: string }[]
  /** Source attribution shown in the modal footer. */
  sourceLabel: string
  /** True for web/sonar-sourced items (no reliable coords). */
  isWeb: boolean
  /**
   * Best string to search on a map.
   * - VisitJeju: coords used directly in URL builders; mapQuery is kept clean as fallback.
   * - web/sonar: ONLY the short place name + "제주" (no region suffixes, no special chars).
   */
  mapQuery: string
  /**
   * Concrete searchable location string, or null when the item has no single
   * point location (campaigns, area-wide events). When null the modal hides
   * map buttons and shows an "no specific location" note instead.
   * Always null for isWeb items with non-specific names/venues.
   * Always equal to mapQuery for VisitJeju items (coords override anyway).
   */
  mapTarget: string | null
  /**
   * Optional note shown below the map section (instead of the default
   * "특정 장소 미지정" box) when mapTarget is null. Used for festivals/events
   * that may have a named venue but where confident map links are inappropriate.
   */
  mapNote?: string
}

// ── Non-specific venue markers — items containing these are not point-searchable ──
const NONSPECIFIC_MARKERS = /일원|일대|곳곳|전역|캠페인|전체|전도|일부|한국|대한민국/

/** Returns true if the given string looks like a concrete, searchable location. */
function isConcretePlaceName(name: string): boolean {
  if (!name.trim()) return false
  return !NONSPECIFIC_MARKERS.test(name)
}

/**
 * Strips characters/patterns that break map searches:
 *   - Korean book/quote marks: 『』「」《》〈〉【】
 *   - Dashes used as separators (em-dash, en-dash, ―, horizontal bar, plain dash)
 *   - Anything after a common title separator (·, —, -, <, >, =)
 *   - Korean sub-unit suffixes that search engines treat as noise
 *     (읍/면/리/동/로/길 when following digits or as standalone tokens)
 *   - Double spaces
 */
function cleanName(raw: string): string {
  return raw
    .replace(/[『』「」《》〈〉【】]/g, '')   // Korean quotation/bracket marks
    .replace(/[—–―\-·].*$/u, '')             // everything from a separator onward
    .replace(/<[^>]*>/g, '')                  // HTML-like tags
    .replace(/[<>=]/g, '')                    // stray comparison chars
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Builds a SHORT, clean name-search query for sonar/web items.
 * Uses ONLY the cleaned place name + 제주. Never appends region/area labels —
 * those cause maps to misfire on "제주시" or "서귀포시" admin names.
 */
function buildWebMapQuery(name: string): string {
  const clean = cleanName(name)
  return /제주/.test(clean) ? clean : `${clean} 제주`
}

/**
 * For VisitJeju items: coords go directly into URL builders, so mapQuery
 * is the cleaned title only (used as fallback when coords are null).
 */
function buildVisitJejuFallbackQuery(title: string): string {
  const clean = cleanName(title)
  return /제주/.test(clean) ? clean : `${clean} 제주`
}

// ── Normalizers ───────────────────────────────────────────────────────────────

export function detailFromVisitJeju(place: VisitJejuPlace, displayLabel: string): PlaceDetail {
  const mq = buildVisitJejuFallbackQuery(place.title)
  return {
    title: place.title,
    subtitle: place.region || undefined,
    description: place.introduction || undefined,
    address: place.address || undefined,
    lat: place.lat,
    lng: place.lng,
    imageUrl: place.imageUrl,           // kept in shape; modal doesn't render it yet
    tags: place.tags,
    phone: place.phone,
    openingHours: place.openingHours,
    infoRows: displayLabel ? [{ label: '분류', value: displayLabel }] : undefined,
    sourceLabel: '비짓제주(제주관광공사) 공식 정보',
    isWeb: false,
    mapQuery: mq,
    // VisitJeju always has a usable target (coords or at least a specific place name).
    mapTarget: mq,
  }
}

export function detailFromLocalGem(gem: LocalGem): PlaceDetail {
  const mq = buildWebMapQuery(gem.name)
  const mapTarget = isConcretePlaceName(gem.name) ? mq : null
  return {
    title: gem.name,
    subtitle: gem.area || undefined,
    description: gem.description || undefined,
    tags: gem.tags,
    caution: gem.caution || undefined,
    sourceLabel: '웹에서 찾은 정보',
    isWeb: true,
    mapQuery: mq,
    mapTarget,
  }
}

export function detailFromSeasonal(sight: SeasonalItem): PlaceDetail {
  const infoRows: { label: string; value: string }[] = []
  if (sight.season_hint) infoRows.push({ label: '지금', value: sight.season_hint })
  const mq = buildWebMapQuery(sight.name)
  const mapTarget = isConcretePlaceName(sight.name) ? mq : null
  return {
    title: sight.name,
    subtitle: sight.area || undefined,
    description: sight.description || undefined,
    caution: sight.caution || undefined,
    infoRows: infoRows.length > 0 ? infoRows : undefined,
    sourceLabel: '웹에서 찾은 정보',
    isWeb: true,
    mapQuery: mq,
    mapTarget,
  }
}

export function detailFromIsland(island: IslandInfo): PlaceDetail {
  const infoRows: { label: string; value: string }[] = []
  if (island.charm) infoRows.push({ label: '매력', value: island.charm })
  if (island.departurePoint) infoRows.push({ label: '출발', value: island.departurePoint })
  if (island.duration) infoRows.push({ label: '소요시간', value: island.duration })
  if (island.fareNote) infoRows.push({ label: '요금', value: island.fareNote })
  if (island.terminal) infoRows.push({ label: '터미널', value: island.terminal })
  const mq = buildWebMapQuery(island.name)
  // Islands are always concrete places.
  const mapTarget = isConcretePlaceName(island.name) ? mq : null
  return {
    title: island.name,
    description: island.charm || undefined,
    phone: island.phone || undefined,
    caution: island.caution || undefined,
    infoRows: infoRows.length > 0 ? infoRows : undefined,
    sourceLabel: '웹에서 찾은 정보',
    isWeb: true,
    mapQuery: mq,
    mapTarget,
  }
}

// ── Map-link builders ─────────────────────────────────────────────────────────

/**
 * Google Maps: coordinate pin when lat/lng present (accurate), else clean name search.
 */
export function googleMapsUrl(detail: PlaceDetail): string {
  if (detail.lat != null && detail.lng != null) {
    return `https://www.google.com/maps/search/?api=1&query=${detail.lat},${detail.lng}`
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(detail.mapQuery)}`
}

/**
 * Naver Maps: coord form when lat/lng present, else clean name search.
 * Naver v5 search URL: /v5/search/{query} — confirmed working for place names.
 */
export function naverMapsUrl(detail: PlaceDetail): string {
  if (detail.lat != null && detail.lng != null) {
    // Naver map flyto: opens at exact coords with a pin.
    return `https://map.naver.com/v5/search/${encodeURIComponent(detail.mapQuery)}?c=${detail.lng},${detail.lat},15,0,0,0,dh`
  }
  return `https://map.naver.com/v5/search/${encodeURIComponent(detail.mapQuery)}`
}

/**
 * Kakao Maps: clean name search (Kakao's coord-query form requires a developer
 * app key; the simple q= search always works without one).
 */
export function kakaoMapsUrl(detail: PlaceDetail): string {
  return `https://map.kakao.com/?q=${encodeURIComponent(detail.mapQuery)}`
}
