import { Flower2, MapPin } from 'lucide-react'
import type { SeasonalItem } from '@/lib/jeju/tourist-seasonal'

/**
 * Card for a web-sourced seasonal Jeju sight (from Perplexity sonar).
 * Mirrors FestivalCard / LocalGemCard style for visual consistency:
 *   - same rounded corners, shadow, hover lift
 *   - soft rose-pink header band (distinct from teal festivals and lavender local gems)
 *   - Flower2 icon — covers flowers, foliage, seasonal natural scenes
 *   - 🌸 season_hint line is the hero info (why it's worth visiting RIGHT NOW)
 *   - soft-amber ⚠️ caution when present
 *   - no per-card web badge — the section-level note covers it
 */
const HEADER_BG = '#FCE4EC' // soft rose-pink — distinct from other card types
const ICON_COLOR = '#C2185B'

export function SeasonalCard({ sight, idx }: { sight: SeasonalItem; idx: number }) {
  void idx // used as key in parent
  return (
    <article className="flex flex-col overflow-hidden rounded-[20px] bg-white shadow-[0_8px_28px_-10px_rgba(0,112,122,0.35)] ring-1 ring-[#00A8B5]/10 transition-transform duration-200 hover:-translate-y-1 hover:shadow-[0_16px_36px_-10px_rgba(0,112,122,0.5)]">
      {/* Illustration header band */}
      <div
        className="flex h-24 items-center justify-center"
        style={{ backgroundColor: HEADER_BG }}
      >
        <Flower2 size={40} strokeWidth={1.5} color={ICON_COLOR} aria-hidden />
      </div>

      {/* Content body */}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="line-clamp-2 text-[14px] font-extrabold leading-snug text-[#0A2B30]">
          {sight.name}
        </h3>

        {sight.season_hint && (
          <p className="flex items-center gap-1 rounded-lg bg-[#FCE4EC] px-2 py-1 text-[11px] font-bold text-[#C2185B]">
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
