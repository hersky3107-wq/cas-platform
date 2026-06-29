import { Mountain, Ruler, ArrowRight, ExternalLink } from 'lucide-react'
import type { DullegilCourse } from '@/lib/jeju/hallasan-dullegil'
import { tintForOlle } from './card-visuals'

const OFFICIAL_URL = 'https://www.hallasan.go.kr'

export function DullegilCard({ course }: { course: DullegilCourse }) {
  const { bg, iconColor } = tintForOlle(course.name)

  return (
    <article className="flex flex-col overflow-hidden rounded-[20px] bg-white shadow-[0_8px_28px_-10px_rgba(26,122,70,0.3)] ring-1 ring-[#1A7A46]/10 transition-transform duration-200 hover:-translate-y-1 hover:shadow-[0_16px_36px_-10px_rgba(26,122,70,0.45)]">

      <div
        className="flex h-24 items-center justify-center"
        style={{ backgroundColor: bg }}
      >
        <Mountain size={38} strokeWidth={1.5} color={iconColor} aria-hidden />
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="text-[15px] font-extrabold leading-snug text-[#0A2B15]">
          {course.name}
        </h3>

        <p className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: iconColor }}>
          <Ruler size={11} strokeWidth={2.5} aria-hidden />
          {course.distanceKm}km
        </p>

        <p className="flex items-start gap-1 text-[11px] font-semibold text-slate-500">
          <ArrowRight size={11} strokeWidth={2.5} className="mt-px shrink-0" aria-hidden />
          <span>
            {course.start}
            <span className="mx-0.5 text-slate-300">→</span>
            {course.end}
          </span>
        </p>

        <a
          href={OFFICIAL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-auto inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-bold transition-opacity hover:opacity-80"
          style={{ backgroundColor: bg, color: iconColor }}
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink size={11} strokeWidth={2.5} aria-hidden />
          한라산국립공원 공식 사이트
        </a>
      </div>
    </article>
  )
}
