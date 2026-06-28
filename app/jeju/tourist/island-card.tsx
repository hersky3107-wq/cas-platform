import { Ship, MapPin, Clock, Banknote, Building2, Phone } from 'lucide-react'
import type { IslandInfo } from '@/lib/jeju/tourist-ferry'

/**
 * Card for a Jeju ferry-accessible island (from Perplexity sonar).
 * Mirrors FestivalCard / SeasonalCard style for visual consistency:
 *   - same rounded corners, shadow, hover lift
 *   - soft ocean-blue header band (distinct from other card types)
 *   - Ship icon — fits the ferry/island context perfectly
 *   - charm line is the hero info (why this island is worth the trip)
 *   - departure / duration / fare rows for quick ferry reference
 *   - soft-amber ⚠️ caution (schedule/fare verification reminder)
 *   - no per-card web badge — the section-level note covers it
 */
const HEADER_BG = '#DBEAFE' // soft ocean-blue
const ICON_COLOR = '#1D4ED8'

export function IslandCard({ island, idx }: { island: IslandInfo; idx: number }) {
  void idx // used as key in parent
  return (
    <article className="flex flex-col overflow-hidden rounded-[20px] bg-white shadow-[0_8px_28px_-10px_rgba(0,112,122,0.35)] ring-1 ring-[#00A8B5]/10 transition-transform duration-200 hover:-translate-y-1 hover:shadow-[0_16px_36px_-10px_rgba(0,112,122,0.5)]">
      {/* Illustration header band */}
      <div
        className="flex h-24 items-center justify-center"
        style={{ backgroundColor: HEADER_BG }}
      >
        <Ship size={40} strokeWidth={1.5} color={ICON_COLOR} aria-hidden />
      </div>

      {/* Content body */}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="text-[15px] font-extrabold leading-snug text-[#0A2B30]">
          {island.name}
        </h3>

        {island.charm && (
          <p className="rounded-lg bg-[#DBEAFE] px-2 py-1 text-[11px] font-bold leading-snug text-[#1D4ED8]">
            {island.charm}
          </p>
        )}

        {island.departurePoint && (
          <p className="flex items-center gap-1 text-[11px] font-semibold text-[#00A8B5]">
            <MapPin size={11} strokeWidth={2.5} aria-hidden />
            출발: {island.departurePoint}
          </p>
        )}

        {island.duration && (
          <p className="flex items-center gap-1 text-[11px] font-semibold text-slate-500">
            <Clock size={11} strokeWidth={2.5} aria-hidden />
            {island.duration}
          </p>
        )}

        {island.fareNote && (
          <p className="flex items-center gap-1 text-[11px] font-semibold text-slate-500">
            <Banknote size={11} strokeWidth={2.5} aria-hidden />
            {island.fareNote}
          </p>
        )}

        {island.terminal && (
          <p className="flex items-center gap-1 text-[11px] font-semibold text-slate-500">
            <Building2 size={11} strokeWidth={2.5} aria-hidden />
            {island.terminal}
          </p>
        )}

        {island.phone && (
          <p className="flex items-center gap-1 text-[11px] font-semibold text-slate-500">
            <Phone size={11} strokeWidth={2.5} aria-hidden />
            {island.phone}
          </p>
        )}

        {island.caution && (
          <p className="flex items-start gap-1 rounded-lg bg-[#FFF6E5] px-2 py-1 text-[10px] font-medium leading-relaxed text-[#B8860B]">
            <span aria-hidden>⚠️</span>
            <span>{island.caution}</span>
          </p>
        )}
      </div>
    </article>
  )
}
