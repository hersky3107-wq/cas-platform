/**
 * 한라산 둘레길 — 8 fixed courses (static, no API).
 *
 * Source: 제주특별자치도 · 제주데이터허브 (2021 기준).
 * Official site: https://www.hallasan.go.kr (한라산국립공원)
 *
 * These 8 courses form the full 둘레길 loop around Hallasan. Data is stable
 * (course routes rarely change) so a static constant is the right choice —
 * no projectKey / API token needed.
 */

export interface DullegilCourse {
  /** Korean course name */
  name: string
  /** Distance in km */
  distanceKm: number
  /** Starting point (Korean) */
  start: string
  /** Ending point (Korean) */
  end: string
}

export const DULLEGIL_COURSES: readonly DullegilCourse[] = [
  { name: '천아숲길',      distanceKm: 8.7,  start: '천아수원지',           end: '보림농장 삼거리' },
  { name: '돌오름길',      distanceKm: 8.0,  start: '보림농장 삼거리',       end: '거린사슴오름 입구' },
  { name: '산림휴양길',    distanceKm: 2.3,  start: '서귀포자연휴양림 입구', end: '무오법정사 입구' },
  { name: '동백길',        distanceKm: 11.3, start: '무오법정사',            end: '돈내코 탐방로' },
  { name: '수악길',        distanceKm: 16.7, start: '돈내코 탐방로',         end: '사려니오름' },
  { name: '시험림길',      distanceKm: 7.4,  start: '사려니숲길(물찻오름)', end: '수악길 27지점' },
  { name: '사려니숲길',    distanceKm: 16.0, start: '사려니숲 입구',         end: '사려니오름 입구' },
  { name: '절물(조릿대)길', distanceKm: 3.0, start: '사려니숲 입구',         end: '절물자연휴양림 입구' },
]

/** Returns all 8 Hallasan Dullegil courses. */
export function getDullegil(): readonly DullegilCourse[] {
  return DULLEGIL_COURSES
}
