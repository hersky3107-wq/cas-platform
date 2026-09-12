/**
 * 낙서 구궁 / 흉방 — textbook fixtures, not values derived from the code.
 *
 * 1988 年盤 (uic.jp 九星気学):
 *   입춘 전 四緑중궁 → 오황살 북서, 암검살 남동, 세파(卯년) 서
 *   입춘 후 三碧중궁 → 오황살 서, 암검살 동, 세파(辰년) 북서
 */
import { describe, expect, it } from 'vitest'
import { CALENDAR_ENGINE_VERSION, nineStar } from '..'
import { flyBoard, nineStarDirections, palaceHoldingStar, sepaDirection, starInPalace } from '../luoshu'

describe('낙서 구궁 home square', () => {
  it('陽遁 중궁 5 is the 4 9 2 / 3 5 7 / 8 1 6 square', () => {
    expect(flyBoard(5, 'yang').cells.map((cell) => cell.star.number)).toEqual([4, 9, 2, 3, 5, 7, 8, 1, 6])
  })

  it('陰遁 중궁 5 is the complementary 逆飛 square, not the home 낙서', () => {
    expect(flyBoard(5, 'yin').cells.map((cell) => cell.star.number)).toEqual([6, 1, 8, 7, 5, 3, 2, 9, 4])
  })
})

describe('陽遁 順飛 vs 陰遁 逆飛', () => {
  it('陽遁: 중궁 4 → 오황 at palace 6 (북서)', () => {
    expect(starInPalace(6, 4, 'yang')).toBe(5)
    expect(palaceHoldingStar(flyBoard(4, 'yang'), 5)?.direction).toBe('northwest')
  })

  it('陰遁: 중궁 2 → 오황 at palace 2 (남서)', () => {
    expect(starInPalace(2, 2, 'yin')).toBe(5)
    expect(palaceHoldingStar(flyBoard(2, 'yin'), 5)?.direction).toBe('southwest')
  })
})

describe('연반 오황살 — published 구성 calendar (uic.jp 1988)', () => {
  it('陽遁 年盤: 1988-03-15 三碧중궁 → 오황살 서', () => {
    // 입춘 후 戊辰. Engine year star is 3. uic.jp 1988 年盤: 五黄 西, 暗剣 東.
    const r = nineStar({ date: '1988-03-15', time: '12:00', timezone: 'Asia/Seoul' })
    expect(r.year.number).toBe(3)
    expect(r.yearBoard.dun).toBe('yang')
    expect(palaceHoldingStar(r.yearBoard, 5)?.direction).toBe('west')
    expect(palaceHoldingStar(r.yearBoard, 5)?.direction).not.toBe('center')
    expect(r.yearBranchIndex).toBe(4) // 辰
    expect(sepaDirection(r.yearBranchIndex)).toBe('northwest')
  })

  it('陽遁 年盤: 1988-01-15 四緑중궁 (입춘 전) → 오황살 북서', () => {
    const r = nineStar({ date: '1988-01-15', time: '12:00', timezone: 'Asia/Seoul' })
    expect(r.year.number).toBe(4)
    expect(palaceHoldingStar(r.yearBoard, 5)?.direction).toBe('northwest')
    expect(r.yearBranchIndex).toBe(3) // 卯
    expect(sepaDirection(r.yearBranchIndex)).toBe('west')
  })
})

describe('日盤 中宮図 (順飛; 9rando 일성 fixtures)', () => {
  it('1987-12-22 일성 1 → 일반 오황 남 (一白 中宮図)', () => {
    const r = nineStar({ date: '1987-12-22', time: '12:00', timezone: 'Asia/Tokyo' })
    expect(r.day.number).toBe(1)
    expect(r.dayBoard.dun).toBe('yang')
    expect(palaceHoldingStar(r.dayBoard, 5)?.direction).toBe('south')
  })

  it('1988-06-21 일성 2 → 일반 오황 북동 (二黒 中宮図)', () => {
    const r = nineStar({ date: '1988-06-21', time: '12:00', timezone: 'Asia/Tokyo' })
    expect(r.day.number).toBe(2)
    expect(r.dayBoard.dun).toBe('yang')
    expect(palaceHoldingStar(r.dayBoard, 5)?.direction).toBe('northeast')
  })
})

describe('본명살 / 길방 / 오황 중궁', () => {
  it('1951 사록 본명 on 1988 三碧 연반 → 본명살 북서, 본명적살 남동', () => {
    // sajuplus: 1951 → 사록목성. uic.jp 1988 年盤: 四緑 sits 北西; 對沖 南東.
    const natal = nineStar({ date: '1951-06-15', time: '12:00', timezone: 'Asia/Seoul' })
    const current = nineStar({ date: '1988-03-15', time: '12:00', timezone: 'Asia/Seoul' })
    expect(natal.year.number).toBe(4)
    const dirs = nineStarDirections(
      current.yearBoard,
      current.monthBoard,
      natal.year.number,
      current.yearBranchIndex,
      current.monthBranchIndex,
    )
    expect(dirs.killings.ohwang).toBe('west')
    expect(dirs.killings.amgeom).toBe('east')
    expect(dirs.killings.honmei).toBe('northwest')
    expect(dirs.killings.honmeiOpposite).toBe('southeast')
    expect(dirs.killings.sepa).toBe('northwest')
    expect(dirs.gilbangYear).toEqual(['southwest'])
    expect(dirs.gilbang).toEqual(['southwest'])
  })

  it('오황 in 중궁 → 오황살/암검살 없음 (not “all directions”)', () => {
    const year = flyBoard(5, 'yang')
    const month = flyBoard(8, 'yang')
    const dirs = nineStarDirections(year, month, 4, 4, 3)
    expect(dirs.killings.ohwang).toBeNull()
    expect(dirs.killings.amgeom).toBeNull()
    expect(dirs.killings.honmei).toBe('southeast')
  })
})

describe('calendar engine version', () => {
  it('tracks CALENDAR_ENGINE_VERSION', () => {
    expect(CALENDAR_ENGINE_VERSION).toBe('1.5.0')
  })
})
