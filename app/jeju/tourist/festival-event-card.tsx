import { CalendarDays, MapPin } from 'lucide-react'
import type { FestivalEvent } from '@/lib/jeju/tourist-festivals'
import { tintFor } from './card-visuals'

/** Formats YYYY-MM-DD → M.D (drops leading zeros). */
function fmtDate(d: string): string {
  const m = d.match(/^\d{4}-(\d{2})-(\d{2})$/)
  if (!m) return d
  return `${parseInt(m[1]!, 10)}.${parseInt(m[2]!, 10)}`
}

function statusOf(today: string, start: string, end: string): '진행중' | '예정' {
  return today < start ? '예정' : '진행중'
}

/** Color for the status badge. */
function statusColor(status: '진행중' | '예정'): string {
  return status === '진행중' ? '#00707A' : '#7B5EA7'
}

export function FestivalEventCard({
  event,
  onSelect,
}: {
  event: FestivalEvent
  onSelect?: () => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const { bg, iconColor } = tintFor(event.name)
  const status = statusOf(today, event.startDate, event.endDate)
  const badgeColor = statusColor(status)
  const dateStr = `${fmtDate(event.startDate)} ~ ${fmtDate(event.endDate)}`

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
      {/* Header band with hash-tinted bg */}
      <div
        className="flex h-24 items-center justify-center"
        style={{ backgroundColor: bg }}
      >
        <CalendarDays size={40} strokeWidth={1.5} color={iconColor} aria-hidden />
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        {/* Status badge + date range */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-extrabold text-white"
            style={{ backgroundColor: badgeColor }}
          >
            {status}
          </span>
          <span className="text-[10px] font-semibold" style={{ color: badgeColor }}>
            {dateStr}
          </span>
        </div>

        <h3 className="line-clamp-2 text-[14px] font-extrabold leading-snug text-[#0A2B30]">
          {event.name}
        </h3>

        {event.venue && (
          <p className="flex items-center gap-1 text-[11px] font-semibold text-[#00A8B5]">
            <MapPin size={11} strokeWidth={2.5} aria-hidden />
            {event.venue}
          </p>
        )}

        {event.intro && (
          <p className="line-clamp-2 text-[11px] leading-relaxed text-slate-400">
            {event.intro}
          </p>
        )}
      </div>
    </article>
  )
}
