import 'server-only'

import { getOlleCourses, type OlleCourse } from '@/lib/jeju/connectors'

/**
 * Jeju TOURIST mode — Olle trail course list from odcloud (real public data).
 *
 * ISOLATION: 'server-only', no AI call, no DB logging. Just data plumbing:
 * getOlleCourses() (cached 6 h) → derive officialUrl → sort → return.
 * Never throws.
 */

export interface OlleCourseView {
  courseNo: string   // e.g. "1코스", "7-1코스"
  name: string       // e.g. "시흥-광치기"
  distance: string   // e.g. "15.1km"
  duration: string   // e.g. "4~5시간"
  startEnd: string   // e.g. "시흥리정류장-광치기해변"
  officialUrl: string
}

/**
 * Derives the official jejuolle.org course URL from courseNo.
 *
 * Pattern: https://www.jejuolle.org/trail#/road/{NN} where NN is the
 * zero-padded main number + optional sub-suffix (e.g. "01", "07-1", "10-1").
 *
 * Handles: "1코스"→"01", "7-1코스"→"07-1", "10-1코스"→"10-1",
 *          "18-2코스"→"18-2", "21코스"→"21", "3코스(A)"→"03".
 * Falls back to the trail index page on parse failure (no broken links).
 */
function buildOfficialUrl(courseNo: string): string {
  const TRAIL_INDEX = 'https://www.jejuolle.org/trail'
  // Strip 코스, parenthetical variants like "(A)", whitespace
  const cleaned = courseNo.replace(/코스.*$/, '').replace(/\s/g, '').trim()
  if (!cleaned) return TRAIL_INDEX

  // Split on '-': main number + optional sub (e.g. "7-1" → main=7, sub=1)
  const parts = cleaned.split('-')
  const mainNum = parseInt(parts[0] ?? '', 10)
  if (!Number.isFinite(mainNum) || mainNum <= 0) return TRAIL_INDEX

  const paddedMain = String(mainNum).padStart(2, '0')
  const suffix = parts.length > 1 && parts[1] ? `-${parts[1]}` : ''
  return `${TRAIL_INDEX}#/road/${paddedMain}${suffix}`
}

/**
 * Numeric sort key for OlleCourseView: main course number first,
 * then sub-number (0 if none) so 1 < 1-1 < 2, 7 < 7-1 < 8, etc.
 */
function sortKey(courseNo: string): [number, number] {
  const cleaned = courseNo.replace(/코스.*$/, '').replace(/\s/g, '')
  const parts = cleaned.split('-')
  const main = parseInt(parts[0] ?? '', 10)
  const sub = parts.length > 1 ? parseInt(parts[1] ?? '0', 10) : 0
  return [Number.isFinite(main) ? main : 999, Number.isFinite(sub) ? sub : 0]
}

function toView(c: OlleCourse): OlleCourseView {
  return {
    courseNo: c.courseNo,
    name: c.name,
    distance: c.distance,
    duration: c.duration,
    startEnd: c.startEnd,
    officialUrl: buildOfficialUrl(c.courseNo),
  }
}

export async function getOlleList(): Promise<
  { ok: true; courses: OlleCourseView[] } | { ok: false; error: string }
> {
  try {
    const raw = await getOlleCourses()
    if (raw.length === 0) {
      return { ok: false, error: '올레길 정보를 불러오지 못했어요. 다시 시도해 주세요.' }
    }
    const courses = raw
      .map(toView)
      .sort((a, b) => {
        const [am, as_] = sortKey(a.courseNo)
        const [bm, bs] = sortKey(b.courseNo)
        return am !== bm ? am - bm : as_ - bs
      })
    return { ok: true, courses }
  } catch {
    return { ok: false, error: '올레길 정보를 불러오지 못했어요. 다시 시도해 주세요.' }
  }
}
