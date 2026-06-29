import { Sparkles, MapPin } from 'lucide-react'
import type { LocalGem } from '@/lib/jeju/tourist-local'

/**
 * Card for a web-sourced local gem (from Perplexity). Mirrors PlaceCard's
 * illustrated look (same radius/shadow/hover, pastel header band, friendly icon,
 * tag pills) for visual consistency. The `verified` field is intentionally
 * ignored in the UI — the section-level note already flags the web-sourced origin.
 *
 * Distinct from VisitJeju cards via:
 *   - 📍 area labeled softly as "참고 지역" (sonar area can be imprecise),
 *   - a soft-amber caution line when the model flagged one.
 */
const HEADER_BG = '#E7E2FB' // soft lavender — visually distinct from VisitJeju pastels
const ICON_COLOR = '#6B4FB8'

export function LocalGemCard({ gem, onSelect }: { gem: LocalGem; onSelect?: () => void }) {
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
      {/* Illustration header band — no per-card web badge; section note covers it */}
      <div
        className="relative flex h-24 items-center justify-center"
        style={{ backgroundColor: HEADER_BG }}
      >
        <Sparkles size={40} strokeWidth={1.5} color={ICON_COLOR} aria-hidden />
      </div>

      {/* Content body */}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="line-clamp-2 text-[14px] font-extrabold leading-snug text-[#0A2B30]">
          {gem.name}
        </h3>

        {gem.area && (
          <p className="flex items-center gap-1 text-[11px] font-semibold text-[#00A8B5]">
            <MapPin size={11} strokeWidth={2.5} aria-hidden />
            참고 지역: {gem.area}
          </p>
        )}

        {gem.description && (
          <p className="line-clamp-2 text-[11px] leading-relaxed text-slate-400">
            {gem.description}
          </p>
        )}

        {gem.caution && (
          <p className="flex items-start gap-1 rounded-lg bg-[#FFF6E5] px-2 py-1 text-[10px] font-medium leading-relaxed text-[#B8860B]">
            <span aria-hidden>⚠️</span>
            <span>{gem.caution}</span>
          </p>
        )}

        {gem.tags.length > 0 && (
          <div className="mt-auto flex flex-wrap gap-1 pt-1">
            {gem.tags.slice(0, 3).map((t, i) => (
              <span
                key={`${t}-${i}`}
                className="rounded-full bg-[#F2EFFC] px-2 py-0.5 text-[10px] font-semibold text-[#6B4FB8]"
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
