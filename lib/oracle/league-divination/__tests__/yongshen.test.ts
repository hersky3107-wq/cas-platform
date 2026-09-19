/**
 * 육효 용신 ranks — textbook fixtures, not values derived from the picker.
 *
 * 乾 본궁 午月: 子死 寅休 辰相 午旺 申囚 戌相.
 * 姤 (一世) 복장 妻财; 세효=1 丑, 응효=4 午.
 */
import { describe, expect, it } from 'vitest'
import { buildLiuyao } from '../../engines/draw'
import {
  compareShiYing,
  monthPhasePolarity,
  pickYongshenLine,
  polarityFromLine,
  voteIching,
  yongshenPolarity,
} from '../yongshen'

const QIAN_WU = buildLiuyao({
  seed: 'qian-wu',
  values: [7, 7, 7, 7, 7, 7],
  monthElement: 'fire',
  dayElement: 'water',
})

const GOU_WU = buildLiuyao({
  seed: 'gou-wu',
  values: [8, 7, 7, 7, 7, 7],
  monthElement: 'fire',
  dayElement: 'water',
})

describe('월령 polarity (classical 강/약; 휴 is rest)', () => {
  it('maps 旺/相 to plus and 囚/死 to minus', () => {
    expect(monthPhasePolarity('旺')).toBe('plus')
    expect(monthPhasePolarity('相')).toBe('plus')
    expect(monthPhasePolarity('囚')).toBe('minus')
    expect(monthPhasePolarity('死')).toBe('minus')
  })

  it('never treats 休 as strength', () => {
    expect(monthPhasePolarity('休')).toBeNull()
  })
})

describe('乾 본궁 午月 용신 (classical line labels)', () => {
  it('locks the textbook 왕상휴수사 row', () => {
    expect(QIAN_WU.primary.hanja).toBe('乾')
    expect(QIAN_WU.lines.map((line) => line.monthPhase)).toEqual(['死', '休', '相', '旺', '囚', '相'])
    expect(QIAN_WU.lines.map((line) => line.relative)).toEqual(['子孙', '妻财', '父母', '官鬼', '兄弟', '父母'])
  })

  it('官鬼 on 午 is 旺 → up', () => {
    const pick = pickYongshenLine(QIAN_WU, '官鬼')
    expect(pick.source).toBe('yongshen')
    expect(pick.line.position).toBe(4)
    expect(pick.line.monthPhase).toBe('旺')
    expect(voteIching(QIAN_WU, '官鬼', 'direction').vote).toBe('up')
  })

  it('兄弟 on 申 is 囚 → down', () => {
    expect(voteIching(QIAN_WU, '兄弟', 'direction').vote).toBe('down')
  })

  it('子孙 on 子 is 死 → down', () => {
    expect(voteIching(QIAN_WU, '子孙', 'direction').vote).toBe('down')
  })

  it('妻财 on 寅 is 休, so 월령 is skipped and 일건 decides', () => {
    const hit = polarityFromLine(QIAN_WU.lines[1]!)
    expect(QIAN_WU.lines[1]!.monthPhase).toBe('休')
    expect(hit?.signal).toBe('dayRelation')
    // 子水 생 寅木 — PRODUCT: 생 → plus (actor ignored)
    expect(hit?.polarity).toBe('plus')
    expect(voteIching(QIAN_WU, '妻财', 'direction').vote).toBe('up')
  })

  it('父母 prefers the 动爻 when one parent line moves, else the bottom 相 line', () => {
    const still = pickYongshenLine(QIAN_WU, '父母')
    expect(still.line.position).toBe(3)
    expect(still.discardedPositions).toEqual([6])

    const moving = buildLiuyao({
      seed: 'qian-parent-dong',
      values: [7, 7, 7, 7, 7, 9],
      monthElement: 'fire',
      dayElement: 'water',
    })
    const pick = pickYongshenLine(moving, '父母')
    expect(pick.line.position).toBe(6)
    expect(pick.line.changing).toBe(true)
  })
})

describe('복장 fallback is 세효 월령 (one documented fallback, never neutral)', () => {
  it('姤 has 妻财 복장 and reads 세효 丑 相 → up', () => {
    expect(GOU_WU.primary.hanja).toBe('姤')
    expect(GOU_WU.hiddenRelatives).toEqual(['妻财'])
    expect(GOU_WU.shi).toBe(1)
    expect(GOU_WU.lines[0]!.monthPhase).toBe('相')
    const result = yongshenPolarity(GOU_WU, '妻财')
    expect(result.pick.source).toBe('bokjang_shi')
    expect(result.pick.line.position).toBe(1)
    expect(result.hit.signal).toBe('monthPhase')
    expect(result.hit.polarity).toBe('plus')
    expect(voteIching(GOU_WU, '妻财', 'direction').vote).toBe('up')
  })
})

describe('세응 compare by 왕상휴수사 ranks (classical)', () => {
  it('姤 午: 세효 丑 相 vs 응효 午 旺 → B (旺 > 相)', () => {
    expect(GOU_WU.ying).toBe(4)
    expect(GOU_WU.lines[0]!.monthPhase).toBe('相')
    expect(GOU_WU.lines[3]!.monthPhase).toBe('旺')
    expect(compareShiYing(GOU_WU)).toEqual({ vote: 'b', signal: 'shi_ying.monthPhase' })
    expect(voteIching(GOU_WU, '官鬼', 'pick_one').vote).toBe('b')
  })

  it('乾 午: 세 戌 相 vs 응 辰 相, equal 월령', () => {
    expect(QIAN_WU.shi).toBe(6)
    expect(QIAN_WU.ying).toBe(3)
    expect(QIAN_WU.lines[5]!.monthPhase).toBe('相')
    expect(QIAN_WU.lines[2]!.monthPhase).toBe('相')
    // 일건 both 극 vs 子水 (토극수) → still tied → PRODUCT 세 wins
    expect(compareShiYing(QIAN_WU).vote).toBe('a')
    expect(compareShiYing(QIAN_WU).signal).toBe('shi_ying.product_shi_wins')
  })
})
