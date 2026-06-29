import { Flower2, MapPin } from 'lucide-react'
import type { SeasonalItem } from '@/lib/jeju/tourist-seasonal'
import { iconForSeasonal, tintFor } from './card-visuals'

export function SeasonalCard({
  sight,
  idx,
  onSelect,
}: {
  sight: SeasonalItem
  idx: number
  onSelect?: () => void
}) {
  void idx // used as key in parent
  const Icon = iconForSeasonal(sight.name, sight.season_hint, sight.description)
  const { bg, iconColor } = tintFor(sight.name)

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
      <div
        className="flex h-24 items-center justify-center"
        style={{ backgroundColor: bg }}
      >
        <Icon size={40} strokeWidth={1.5} color={iconColor} aria-hidden />
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="line-clamp-2 text-[14px] font-extrabold leading-snug text-[#0A2B30]">
          {sight.name}
        </h3>

        {sight.season_hint && (
          <p
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold"
            style={{ backgroundColor: bg, color: iconColor }}
          >
            <Flower2 size={11} strokeWidth={2.5} aria-hidden />
            {sight.season_hint}
          </p>
        )}

        {sight.area && (
          <p className="flex items-center gap-1 text-[11px] font-semibold text-[#00A8B5]">
            <MapPin size={11} strokeWidth={2.5} aria-hidden />
            참고 지역: {sight.area}
          </p>
        )}

        {sight.description && (
          <p className="line-clamp-2 text-[11px] leading-relaxed text-slate-400">
            {sight.description}
          </p>
        )}

        {sight.caution && (
          <p className="flex items-start gap-1 rounded-lg bg-[#FFF6E5] px-2 py-1 text-[10px] font-medium leading-relaxed text-[#B8860B]">
            <span aria-hidden>⚠️</span>
            <span>{sight.caution}</span>
          </p>
        )}
      </div>
    </article>
  )
}
