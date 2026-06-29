import { MapPin, Clock } from 'lucide-react'
import type { Course, CourseStop } from '@/lib/jeju/tourist-course'

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

const DEFAULT_TIMING: TimingStyle = {
  dot: '#00A8B5',
  badgeBg: '#D9F6FA',
  text: '#00707A',
  label: '일정',
  emoji: '🧭',
}

/** Match by substring so minor wording variants still color correctly. */
function timingStyle(timing: string | null): TimingStyle {
  const t = timing ?? ''
  if (t.includes('오전') || t.includes('아침'))
    return { dot: '#F5A623', badgeBg: '#FFF1D6', text: '#B8740A', label: timing || '오전', emoji: '🌅' }
  if (t.includes('점심'))
    return { dot: '#6BBF4F', badgeBg: '#E8F6E0', text: '#3E8E2F', label: timing || '점심', emoji: '🍽️' }
  if (t.includes('오후'))
    return { dot: '#2196F3', badgeBg: '#E3F2FD', text: '#1565C0', label: timing || '오후', emoji: '☀️' }
  if (t.includes('저녁') || t.includes('밤') || t.includes('야간'))
    return { dot: '#7E57C2', badgeBg: '#EDE7F6', text: '#5E35B1', label: timing || '저녁', emoji: '🌇' }
  return timing ? { ...DEFAULT_TIMING, label: timing } : DEFAULT_TIMING
}

function StopRow({ stop }: { stop: CourseStop }) {
  const ts = timingStyle(stop.timing)
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
          {stop.category && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#00A8B5]">
              <MapPin size={11} strokeWidth={2.5} aria-hidden />
              {stop.category}
            </span>
          )}
          <span
            className="text-[10px] font-semibold text-slate-400"
            title={stop.source === 'web' ? '웹에서 보완한 정보' : '비짓제주 공식 정보'}
          >
            {stop.source === 'web' ? '🌐 웹 보완' : '📋 공식'}
          </span>
        </div>

        {/* description */}
        {stop.description && (
          <p className="mt-2 text-[12px] leading-relaxed text-[#4A5C5F]">{stop.description}</p>
        )}
      </div>
    </li>
  )
}

export function CourseTimeline({ course }: { course: Course }) {
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
          <StopRow key={`${course.id}-${stop.order}-${i}`} stop={stop} />
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
        AI가 공공데이터·웹 정보로 구성한 추천 코스예요 · 운영시간·휴무는 방문 전 확인하세요
      </p>
    </div>
  )
}
