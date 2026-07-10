import { MapPin, Clock, Map as MapIcon, ExternalLink, Info } from 'lucide-react'
import type { Course, CourseStop } from '@/lib/jeju/tourist-course'
import type { TouristLocale, TouristUiPack } from '@/lib/jeju/tourist-labels'
import { useTouristUi } from '@/components/jeju/useTouristUi'
import { localizeCourseCategory } from './category-labels'
import {
  detailFromCourseStop,
  googleMapsUrl,
  naverMapsUrl,
  kakaoMapsUrl,
} from './place-detail'

/**
 * Course detail — a vertical timeline that reads as a day's JOURNEY
 * (morning → evening flowing downward), not a flat list.
 *
 * Visual language stays in the bright tourist family (teal accents, soft
 * shadows, rounded cards), but is distinct from the chip-result cards:
 *   - a connecting vertical line threads numbered timing nodes
 *   - each node is color-coded by time of day (오전/점심/오후/저녁)
 *   - each stop card shows name + category + duration + source marker
 */

type TimingStyle = {
  /** node circle bg */
  dot: string
  /** badge bg */
  badgeBg: string
  /** badge / accent text */
  text: string
  label: string
  emoji: string
}

/**
 * Match by substring so minor wording variants still color correctly.
 * Time-of-day labels are localized (the underlying AI timing text stays KO for
 * now); an unrecognized timing falls back to the generic "schedule" label.
 */
function timingStyle(timing: string | null, t: TouristUiPack): TimingStyle {
  const raw = timing ?? ''
  if (raw.includes('오전') || raw.includes('아침'))
    return { dot: '#F5A623', badgeBg: '#FFF1D6', text: '#B8740A', label: t.timeMorning, emoji: '🌅' }
  if (raw.includes('점심'))
    return { dot: '#6BBF4F', badgeBg: '#E8F6E0', text: '#3E8E2F', label: t.timeLunch, emoji: '🍽️' }
  if (raw.includes('오후'))
    return { dot: '#2196F3', badgeBg: '#E3F2FD', text: '#1565C0', label: t.timeAfternoon, emoji: '☀️' }
  if (raw.includes('저녁') || raw.includes('밤') || raw.includes('야간'))
    return { dot: '#7E57C2', badgeBg: '#EDE7F6', text: '#5E35B1', label: t.timeEvening, emoji: '🌇' }
  return {
    dot: '#00A8B5',
    badgeBg: '#D9F6FA',
    text: '#00707A',
    label: timing || t.timeDefault,
    emoji: '🧭',
  }
}

function StopRow({
  stop,
  t,
  locale,
}: {
  stop: CourseStop
  t: TouristUiPack
  locale: TouristLocale
}) {
  const ts = timingStyle(stop.timing, t)
  const categoryLabel = localizeCourseCategory(stop.category, locale, t)
  return (
    <li className="relative flex gap-3.5 pb-5 last:pb-0 sm:gap-4">
      {/* Numbered timing node (sits on top of the connecting line) */}
      <div
        className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[15px] font-extrabold text-white shadow-[0_4px_12px_-3px_rgba(0,0,0,0.35)] ring-4 ring-white"
        style={{ backgroundColor: ts.dot }}
        aria-hidden
      >
        {stop.order}
      </div>

      {/* Stop card */}
      <div className="flex-1 rounded-[18px] bg-white p-3.5 shadow-[0_8px_24px_-12px_rgba(0,112,122,0.4)] ring-1 ring-[#00A8B5]/10">
        {/* timing badge + duration */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-extrabold"
            style={{ backgroundColor: ts.badgeBg, color: ts.text }}
          >
            <span aria-hidden>{ts.emoji}</span>
            {ts.label}
          </span>
          {stop.durationHint && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#F1F5F6] px-2 py-0.5 text-[10px] font-bold text-[#5A7176]">
              <Clock size={10} strokeWidth={2.5} aria-hidden />
              {stop.durationHint}
            </span>
          )}
        </div>

        {/* name + category */}
        <h4 className="mt-2 text-[15px] font-extrabold leading-snug text-[#0A2B30]">
          {stop.name}
        </h4>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {categoryLabel && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#00A8B5]">
              <MapPin size={11} strokeWidth={2.5} aria-hidden />
              {categoryLabel}
            </span>
          )}
          <span
            className="text-[10px] font-semibold text-slate-400"
            title={stop.source === 'web' ? t.srcWebTitle : t.srcOfficialTitle}
          >
            {stop.source === 'web' ? t.srcWeb : t.srcOfficial}
          </span>
        </div>

        {/* description */}
        {stop.description && (
          <p className="mt-2 text-[12px] leading-relaxed text-[#4A5C5F]">{stop.description}</p>
        )}

        {/* Map links — same 3-link UI as the place detail modal.
            Course stops have no coords, so this always uses name search. */}
        <div className="mt-3">
          {(() => {
            const d = detailFromCourseStop(stop)
            if (d.mapTarget === null) {
              return (
                <p className="flex items-start gap-1.5 rounded-[12px] bg-slate-50 px-3 py-2 text-[11px] font-medium leading-relaxed text-slate-500">
                  <Info size={12} strokeWidth={2.5} className="mt-0.5 shrink-0 text-slate-400" aria-hidden />
                  {t.mapNoLocation}
                </p>
              )
            }
            return (
              <>
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-extrabold text-[#0A2B30]">
                  <MapIcon size={12} strokeWidth={2.5} className="text-[#00A8B5]" aria-hidden />
                  {t.mapSearchWeb}
                </p>
                <div className="grid grid-cols-3 gap-1.5">
                  <a
                    href={googleMapsUrl(d)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1 rounded-[10px] bg-[#00A8B5] px-1.5 py-2 text-[11px] font-bold text-white shadow-sm transition-opacity hover:opacity-90"
                  >
                    Google
                    <ExternalLink size={10} strokeWidth={2.5} aria-hidden />
                  </a>
                  <a
                    href={naverMapsUrl(d)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1 rounded-[10px] bg-[#03C75A] px-1.5 py-2 text-[11px] font-bold text-white shadow-sm transition-opacity hover:opacity-90"
                  >
                    {t.mapNaver}
                    <ExternalLink size={10} strokeWidth={2.5} aria-hidden />
                  </a>
                  <a
                    href={kakaoMapsUrl(d)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1 rounded-[10px] bg-[#FEE500] px-1.5 py-2 text-[11px] font-bold text-[#3C1E1E] shadow-sm transition-opacity hover:opacity-90"
                  >
                    {t.mapKakao}
                    <ExternalLink size={10} strokeWidth={2.5} aria-hidden />
                  </a>
                </div>
              </>
            )
          })()}
        </div>
      </div>
    </li>
  )
}

export function CourseTimeline({ course }: { course: Course }) {
  const { t, locale } = useTouristUi()
  return (
    <div>
      {/* concept pitch — the "why this course" */}
      <p className="rounded-[16px] bg-white/80 px-4 py-3 text-[13px] font-semibold leading-relaxed text-[#00707A] shadow-sm backdrop-blur">
        {course.concept}
      </p>

      {/* timeline */}
      <ol className="relative mt-5">
        {/* connecting line, centered under the 40px nodes (left ~20px) */}
        {course.stops.length > 1 && (
          <div
            className="absolute left-[19px] top-3 bottom-6 w-[3px] rounded-full"
            style={{
              background:
                'linear-gradient(to bottom, #F5A623, #6BBF4F, #2196F3, #7E57C2)',
            }}
            aria-hidden
          />
        )}
        {course.stops.map((stop, i) => (
          <StopRow key={`${course.id}-${stop.order}-${i}`} stop={stop} t={t} locale={locale} />
        ))}
      </ol>

      {/* course note */}
      {course.note && (
        <p className="mt-2 flex items-start gap-1.5 rounded-[14px] bg-[#F2EFFC] px-3.5 py-2.5 text-[12px] font-semibold leading-relaxed text-[#5B3EA8]">
          <span aria-hidden>💡</span>
          <span>{course.note}</span>
        </p>
      )}

      {/* honest footer */}
      <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-400">
        {t.courseDisclaimer}
      </p>
    </div>
  )
}
