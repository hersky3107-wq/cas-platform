import { CalendarDays, MapPin } from 'lucide-react'
import type { FestivalItem } from '@/lib/jeju/tourist-festivals'

/**
 * Card for a web-sourced Jeju festival (from Perplexity sonar).
 * Mirrors LocalGemCard's illustrated style for visual consistency:
 *   - same rounded corners, shadow, hover lift
 *   - soft teal-mint header band (distinct from lavender local gems)
 *   - CalendarDays icon fits the festival context better than a circus tent
 *   - 📅 period line is the hero info and is highlighted prominently
 *   - soft-amber ⚠️ caution when present
 *   - no per-card web badge — the section-level note covers it
 */
const HEADER_BG = '#D4F5F0' // soft teal-mint — distinct from lavender (local) and VisitJeju pastels
const ICON_COLOR = '#00707A'

export function FestivalCard({ festival, idx }: { festival: FestivalItem; idx: number }) {
  void idx // used as part of the key prop in the parent; kept here for reference
  return (
    <article className="flex flex-col overflow-hidden rounded-[20px] bg-white shadow-[0_8px_28px_-10px_rgba(0,112,122,0.35)] ring-1 ring-[#00A8B5]/10 transition-transform duration-200 hover:-translate-y-1 hover:shadow-[0_16px_36px_-10px_rgba(0,112,122,0.5)]">
      {/* Illustration header band */}
      <div
        className="flex h-24 items-center justify-center"
        style={{ backgroundColor: HEADER_BG }}
      >
        <CalendarDays size={40} strokeWidth={1.5} color={ICON_COLOR} aria-hidden />
      </div>

      {/* Content body */}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="line-clamp-2 text-[14px] font-extrabold leading-snug text-[#0A2B30]">
          {festival.name}
        </h3>

        {festival.period && (
          <p className="flex items-center gap-1 rounded-lg bg-[#D4F5F0] px-2 py-1 text-[11px] font-bold text-[#00707A]">
            <CalendarDays size={11} strokeWidth={2.5} aria-hidden />
            {festival.period}
          </p>
        )}

        {festival.area && (
          <p className="flex items-center gap-1 text-[11px] font-semibold text-[#00A8B5]">
            <MapPin size={11} strokeWidth={2.5} aria-hidden />
            참고 지역: {festival.area}
          </p>
        )}

        {festival.description && (
          <p className="line-clamp-2 text-[11px] leading-relaxed text-slate-400">
            {festival.description}
          </p>
        )}

        {festival.caution && (
          <p className="flex items-start gap-1 rounded-lg bg-[#FFF6E5] px-2 py-1 text-[10px] font-medium leading-relaxed text-[#B8860B]">
            <span aria-hidden>⚠️</span>
            <span>{festival.caution}</span>
          </p>
        )}
      </div>
    </article>
  )
}
