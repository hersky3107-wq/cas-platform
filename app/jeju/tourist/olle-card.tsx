import { Footprints, Ruler, Clock, Flag, ExternalLink } from 'lucide-react'
import type { OlleCourseView } from '@/lib/jeju/tourist-olle'
import { tintForOlle } from './card-visuals'

export function OlleCard({ course }: { course: OlleCourseView }) {
  const seed = `${course.courseNo}-${course.name}`
  const { bg, iconColor } = tintForOlle(seed)

  return (
    <article className="flex flex-col overflow-hidden rounded-[20px] bg-white shadow-[0_8px_28px_-10px_rgba(26,122,70,0.3)] ring-1 ring-[#1A7A46]/10 transition-transform duration-200 hover:-translate-y-1 hover:shadow-[0_16px_36px_-10px_rgba(26,122,70,0.45)]">

      <div
        className="relative flex h-24 items-center justify-center"
        style={{ backgroundColor: bg }}
      >
        <span
          className="absolute left-3 top-3 rounded-full px-2.5 py-0.5 text-[11px] font-extrabold tracking-wide"
          style={{ backgroundColor: iconColor, color: '#fff' }}
        >
          {course.courseNo}
        </span>
        <Footprints size={38} strokeWidth={1.5} color={iconColor} aria-hidden />
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="text-[15px] font-extrabold leading-snug text-[#0A2B15]">
          {course.name}
        </h3>

        <p className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: iconColor }}>
          <Ruler size={11} strokeWidth={2.5} aria-hidden />
          {course.distance}
        </p>

        <p className="flex items-center gap-1 text-[11px] font-semibold text-slate-500">
          <Clock size={11} strokeWidth={2.5} aria-hidden />
          {course.duration}
        </p>

        {course.startEnd && (
          <p className="flex items-start gap-1 text-[11px] font-semibold text-slate-500">
            <Flag size={11} strokeWidth={2.5} className="mt-px shrink-0" aria-hidden />
            <span>{course.startEnd}</span>
          </p>
        )}

        <a
          href={course.officialUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-auto inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-bold transition-opacity hover:opacity-80"
          style={{ backgroundColor: bg, color: iconColor }}
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink size={11} strokeWidth={2.5} aria-hidden />
          제주올레 공식 코스 정보
        </a>
      </div>
    </article>
  )
}
