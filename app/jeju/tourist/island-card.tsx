import { MapPin, Clock, Banknote, Building2, Phone, ExternalLink } from 'lucide-react'
import type { IslandInfo } from '@/lib/jeju/tourist-ferry'
import { iconForIsland, tintFor } from './card-visuals'

export function IslandCard({
  island,
  idx,
  onSelect,
}: {
  island: IslandInfo
  idx: number
  onSelect?: () => void
}) {
  void idx // used as key in parent
  const Icon = iconForIsland(island.name, island.charm)
  const { bg, iconColor } = tintFor(island.name)

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
        <h3 className="text-[15px] font-extrabold leading-snug text-[#0A2B30]">
          {island.name}
        </h3>

        {island.charm && (
          <p
            className="rounded-lg px-2 py-1 text-[11px] font-bold leading-snug"
            style={{ backgroundColor: bg, color: iconColor }}
          >
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

        {island.terminal && !island.ferryInfo && (
          <p className="flex items-center gap-1 text-[11px] font-semibold text-slate-500">
            <Building2 size={11} strokeWidth={2.5} aria-hidden />
            {island.terminal}
          </p>
        )}

        {island.phone && !island.ferryInfo && (
          <p className="flex items-center gap-1 text-[11px] font-semibold text-slate-500">
            <Phone size={11} strokeWidth={2.5} aria-hidden />
            {island.phone}
          </p>
        )}

        {/* Verified ferry booking links + terminal note */}
        {island.ferryInfo && (
          <div className="mt-0.5 flex flex-col gap-1.5">
            {island.ferryInfo.links.map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#E6F6FA] px-2.5 py-1.5 text-[11px] font-bold text-[#006E7A] transition-colors hover:bg-[#CCF0F6]"
              >
                <ExternalLink size={10} strokeWidth={2.5} aria-hidden />
                {link.label}
              </a>
            ))}
            <p className="whitespace-pre-line rounded-lg bg-[#F0F9FC] px-2.5 py-1.5 text-[10px] font-medium leading-relaxed text-slate-500">
              {island.ferryInfo.note}
            </p>
          </div>
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
