import {
  Mountain,
  UtensilsCrossed,
  ShoppingBag,
  PartyPopper,
  Compass,
  MapPin,
  type LucideIcon,
} from 'lucide-react'
import type { VisitJejuPlace } from '@/lib/jeju/connectors'

type CategoryStyle = {
  /** Pastel background for the illustration header band. */
  headerBg: string
  /** Deep-tone icon color (on the pastel bg). */
  iconColor: string
  Icon: LucideIcon
}

/**
 * Keyed by the FRIENDLY display label (e.g. "가볼 곳", "맛집") that the page
 * passes in — NOT by the raw API categoryLabel — so the card is decoupled from
 * API naming quirks.
 */
const CARD_STYLES: Record<string, CategoryStyle> = {
  '가볼 곳': { headerBg: '#CCEEF4', iconColor: '#006B78', Icon: Mountain },
  맛집: { headerBg: '#FFD4B0', iconColor: '#B84A00', Icon: UtensilsCrossed },
  쇼핑: { headerBg: '#FFE89E', iconColor: '#8A5900', Icon: ShoppingBag },
  축제: { headerBg: '#FFD0DD', iconColor: '#A0204A', Icon: PartyPopper },
  테마: { headerBg: '#C4F0E4', iconColor: '#0A6B4E', Icon: Compass },
}

const DEFAULT_STYLE: CategoryStyle = {
  headerBg: '#E4F4F8',
  iconColor: '#006B78',
  Icon: MapPin,
}

function styleFor(label: string): CategoryStyle {
  return CARD_STYLES[label] ?? DEFAULT_STYLE
}

export function PlaceCard({
  place,
  displayLabel,
  onSelect,
}: {
  place: VisitJejuPlace
  displayLabel: string
  onSelect?: () => void
}) {
  const { headerBg, iconColor, Icon } = styleFor(displayLabel)

  return (
    <article
      onClick={onSelect}
      onKeyDown={
        onSelect
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect()
              }
            }
          : undefined
      }
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      className={`flex flex-col overflow-hidden rounded-[20px] bg-white shadow-[0_8px_28px_-10px_rgba(0,112,122,0.35)] ring-1 ring-[#00A8B5]/10 transition-transform duration-200 hover:-translate-y-1 hover:shadow-[0_16px_36px_-10px_rgba(0,112,122,0.5)] ${
        onSelect ? 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00A8B5]' : ''
      }`}
    >
      {/* Illustration header band */}
      <div
        className="flex h-24 items-center justify-center"
        style={{ backgroundColor: headerBg }}
      >
        <Icon size={40} strokeWidth={1.5} color={iconColor} aria-hidden />
      </div>

      {/* Content body */}
      <div className="flex flex-1 flex-col gap-2 p-4">
        {/* Category badge */}
        <span
          className="self-start rounded-full px-2.5 py-0.5 text-[10px] font-bold"
          style={{ backgroundColor: headerBg, color: iconColor }}
        >
          {displayLabel}
        </span>

        <h3 className="line-clamp-2 text-[14px] font-extrabold leading-snug text-[#0A2B30]">
          {place.title}
        </h3>

        {place.region && (
          <p className="flex items-center gap-1 text-[11px] font-semibold text-[#00A8B5]">
            <MapPin size={11} strokeWidth={2.5} aria-hidden />
            {place.region}
          </p>
        )}

        {place.introduction && (
          <p className="line-clamp-1 text-[11px] leading-relaxed text-slate-400">
            {place.introduction}
          </p>
        )}

        {place.tags.length > 0 && (
          <div className="mt-auto flex flex-wrap gap-1 pt-1">
            {place.tags.slice(0, 3).map((t, i) => (
              <span
                key={`${t}-${i}`}
                className="rounded-full bg-[#F0FAFB] px-2 py-0.5 text-[10px] font-semibold text-[#00A8B5]"
              >
                #{t.replace(/^#/, '')}
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  )
}
