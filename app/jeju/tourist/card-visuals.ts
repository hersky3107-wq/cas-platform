import {
  Mountain,
  UtensilsCrossed,
  ShoppingBag,
  Compass,
  MapPin,
  TreePine,
  Droplets,
  Waves,
  Landmark,
  Palette,
  Coffee,
  CalendarDays,
  Store,
  Flower2,
  Leaf,
  Snowflake,
  Ship,
  Footprints,
  type LucideIcon,
} from 'lucide-react'
import type { VisitJejuPlace } from '@/lib/jeju/connectors'

/** General tourist-mode pastel (bg, iconColor) pairs. */
export const TINT_PALETTE: Array<{ bg: string; iconColor: string }> = [
  { bg: '#C8EEF5', iconColor: '#006B78' }, // teal-mint
  { bg: '#C4F0E4', iconColor: '#0A6B4E' }, // mint-green
  { bg: '#E8E4F9', iconColor: '#5B3EA8' }, // soft lavender
  { bg: '#FFD4B0', iconColor: '#B84A00' }, // warm peach
  { bg: '#D1F2E1', iconColor: '#1A7A46' }, // leaf green
  { bg: '#FDE8D8', iconColor: '#C05621' }, // soft coral
  { bg: '#FFF3C4', iconColor: '#8A5900' }, // soft amber
  { bg: '#DBEAFE', iconColor: '#1D4ED8' }, // sky blue
]

/** Olle/trail cards — green & earth tones only. */
export const OLLE_TINT_PALETTE: Array<{ bg: string; iconColor: string }> = [
  { bg: '#D1F2E1', iconColor: '#1A7A46' }, // leaf green
  { bg: '#C4F0E4', iconColor: '#0A6B4E' }, // mint
  { bg: '#E8F5E9', iconColor: '#2E7D32' }, // pale forest
  { bg: '#FDE8D8', iconColor: '#8B6914' }, // warm sand
  { bg: '#FFF3C4', iconColor: '#6B5B00' }, // trail amber
  { bg: '#C8EEF5', iconColor: '#006B78' }, // coastal teal
  { bg: '#E8E4F9', iconColor: '#4A6741' }, // muted olive-lavender
  { bg: '#FFD4B0', iconColor: '#8B4513' }, // earth peach
]

/** djb2-style hash, always non-negative. Same input → same output. */
export function hashTitle(title: string): number {
  let h = 5381
  for (let i = 0; i < title.length; i++) {
    h = Math.imul(h, 33) ^ title.charCodeAt(i)
  }
  return h >>> 0
}

export function tintFor(title: string): { bg: string; iconColor: string } {
  return TINT_PALETTE[hashTitle(title) % TINT_PALETTE.length]!
}

export function tintForOlle(seed: string): { bg: string; iconColor: string } {
  return OLLE_TINT_PALETTE[hashTitle(seed) % OLLE_TINT_PALETTE.length]!
}

/**
 * Icon from a free-text haystack (tags, title, hints). Used by seasonal/island cards.
 */
export function iconForHay(hay: string, fallback: LucideIcon = MapPin): LucideIcon {
  const h = hay.toLowerCase()

  if (/오름/.test(h)) return Mountain
  if (/폭포|계곡|습지|하천|물/.test(h)) return Droplets
  if (/해변|바다|해수욕|해안|섬|도/.test(h)) return Waves
  if (/눈|설경|상고대|겨울/.test(h)) return Snowflake
  if (/단풍|억새|가을|낙엽/.test(h)) return Leaf
  if (/꽃|수국|유채|벚|메밀|동백|핑크|개화|만개/.test(h)) return Flower2
  if (/숲|수목|생태|자연|식물|나무|녹/.test(h)) return TreePine
  if (/사찰|절|성당|교회|신사/.test(h)) return Landmark
  if (/문화유적|유적|성곽|역사|문화재/.test(h)) return Landmark
  if (/박물관|전시|미술|갤러리|예술|공연|문화/.test(h)) return Palette
  if (/카페|커피|디저트|베이커리/.test(h)) return Coffee
  if (/맛집|음식|식당|레스토랑|먹거리/.test(h)) return UtensilsCrossed
  if (/축제|행사|이벤트/.test(h)) return CalendarDays
  if (/시장/.test(h)) return Store
  if (/쇼핑|기념품/.test(h)) return ShoppingBag
  if (/테마|체험/.test(h)) return Compass
  if (/배|페리|항구|터미널/.test(h)) return Ship
  if (/올레|트레킹|둘레길|걷/.test(h)) return Footprints

  return fallback
}

/** VisitJeju PlaceCard icon selection. */
export function iconForPlace(place: VisitJejuPlace, displayLabel: string): LucideIcon {
  const hay = [
    displayLabel,
    place.categoryLabel,
    place.rawTags,
    ...place.tags,
    place.title,
  ].join(' ')

  const icon = iconForHay(hay, MapPin)

  if (place.categoryCode === 'c4' && icon === MapPin) return UtensilsCrossed
  if (place.categoryCode === 'c5' && icon === MapPin) return CalendarDays
  if (place.categoryCode === 'c2' && icon === MapPin) return ShoppingBag

  return icon
}

/** Seasonal sight — nature/flower bias from name + season_hint + description. */
export function iconForSeasonal(
  name: string,
  seasonHint: string | null,
  description: string
): LucideIcon {
  const hay = [name, seasonHint ?? '', description, '제주 풍경 계절'].join(' ')
  return iconForHay(hay, Flower2)
}

/** Ferry island — waves/island bias; Ship when ferry context is strong. */
export function iconForIsland(name: string, charm: string | null): LucideIcon {
  const hay = [name, charm ?? '', '섬 배'].join(' ')
  if (/배|페리|항구|터미널|출발/.test(hay)) return Ship
  return iconForHay(hay, Waves)
}
