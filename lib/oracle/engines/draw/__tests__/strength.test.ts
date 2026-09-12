/**
 * 육효 왕쇠 / 복장 — textbook fixtures, not values derived from the implementation.
 *
 * 월령 왕상휴수사 vs 午 (fire) is the canonical five-row table:
 *   화=旺, 토=相 (火生土), 목=休 (木生火), 금=囚 (火克金), 수=死 (水克火).
 * 姤 (一世 of 乾 palace) is the 복장 case: 납갑 丑亥酉午申戌 vs 건궁 금 has
 * no wood, so 妻财 is missing.
 */
import { describe, expect, it } from 'vitest'
import {
  ELEMENT_GENERATES as CALENDAR_GENERATES,
  ELEMENT_OVERCOMES as CALENDAR_OVERCOMES,
} from '../../calendar/relations'
import { buildLiuyao } from '../iching'
import { changingActions, dayRelation, hiddenRelatives, monthPhase } from '../strength'
import { ELEMENT_GENERATES, ELEMENT_OVERCOMES } from '../tables'

describe('오행 tables are the calendar cycle, not a second derivation', () => {
  it('locks draw ELEMENT_GENERATES / ELEMENT_OVERCOMES to calendar/relations', () => {
    expect(ELEMENT_GENERATES).toEqual(CALENDAR_GENERATES)
    expect(ELEMENT_OVERCOMES).toEqual(CALENDAR_OVERCOMES)
  })
})

describe('월령 왕상휴수사 (午 month = fire)', () => {
  // Textbook: 月令 旺相休囚死 against 午火. 囚/死 direction is the pair
  // people reverse — 囚 = month overcomes the line, 死 = line overcomes month.
  it('maps each line element to the classical label', () => {
    expect(monthPhase('fire', 'fire')).toBe('旺')
    expect(monthPhase('earth', 'fire')).toBe('相')
    expect(monthPhase('wood', 'fire')).toBe('休')
    expect(monthPhase('metal', 'fire')).toBe('囚')
    expect(monthPhase('water', 'fire')).toBe('死')
  })

  it('applies that table to 乾 본궁 lines in a 午 month', () => {
    const reading = buildLiuyao({
      seed: 'qian-wu',
      values: [7, 7, 7, 7, 7, 7],
      monthElement: 'fire',
    })
    expect(reading.lines.map((line) => line.branch)).toEqual(['子', '寅', '辰', '午', '申', '戌'])
    expect(reading.lines.map((line) => line.monthPhase)).toEqual(['死', '休', '相', '旺', '囚', '相'])
  })
})

describe('일건 (子 day = water, 생/극/비화)', () => {
  it('reads 일진 지지 vs the line, direction preserved', () => {
    expect(dayRelation('water', 'water')).toEqual({ kind: '비화', actor: 'same' })
    expect(dayRelation('water', 'wood')).toEqual({ kind: '생', actor: 'day' }) // 水生木
    expect(dayRelation('water', 'fire')).toEqual({ kind: '극', actor: 'day' }) // 水克火
    expect(dayRelation('water', 'metal')).toEqual({ kind: '생', actor: 'line' }) // 金生水
    expect(dayRelation('water', 'earth')).toEqual({ kind: '극', actor: 'line' }) // 土克水
  })

  it('applies that table to 乾 본궁 lines on a 子 day', () => {
    const reading = buildLiuyao({
      seed: 'qian-zi',
      values: [7, 7, 7, 7, 7, 7],
      dayElement: 'water',
    })
    expect(reading.lines.map((line) => line.dayRelation)).toEqual([
      { kind: '비화', actor: 'same' },
      { kind: '생', actor: 'day' },
      { kind: '극', actor: 'line' },
      { kind: '극', actor: 'day' },
      { kind: '생', actor: 'line' },
      { kind: '극', actor: 'line' },
    ])
  })
})

describe('동효 생극', () => {
  it('records 水生木 and 水克火 from 乾 초효 노양, nothing else', () => {
    // 乾 with old-yang first line: 子(water) moves. Textbook 상생·상극:
    // water generates wood (寅, line 2), water overcomes fire (午, line 4).
    const reading = buildLiuyao({
      seed: 'qian-dong',
      values: [9, 7, 7, 7, 7, 7],
    })
    expect(reading.lines.map((line) => line.element)).toEqual(['water', 'wood', 'earth', 'fire', 'metal', 'earth'])
    expect(changingActions(reading.lines)).toEqual([
      { from: 1, to: 2, action: '생' },
      { from: 1, to: 4, action: '극' },
    ])
    expect(reading.changingActions).toEqual([
      { from: 1, to: 2, action: '생' },
      { from: 1, to: 4, action: '극' },
    ])
    expect(reading.lines[1]!.fromChanging).toEqual([{ position: 1, action: '생' }])
    expect(reading.lines[3]!.fromChanging).toEqual([{ position: 1, action: '극' }])
    expect(reading.lines[0]!.fromChanging).toEqual([])
  })
})

describe('복장', () => {
  it('lists 妻财 as missing on 姤 (乾 palace 一世)', () => {
    // 姤 납갑: 丑亥酉午申戌. 건궁 금: 형제=금, 자손=수, 처재=목, 관귀=화, 부모=토.
    // No wood line → 妻财 is 복장. Textbook inventory, not 伏神 placement.
    const reading = buildLiuyao({ seed: 'gou-bokjang', values: [8, 7, 7, 7, 7, 7] })
    expect(reading.primary.hanja).toBe('姤')
    expect(reading.palace).toBe('乾')
    expect(reading.lines.map((line) => line.branch)).toEqual(['丑', '亥', '酉', '午', '申', '戌'])
    expect(reading.lines.map((line) => line.relative)).toEqual(['父母', '子孙', '兄弟', '官鬼', '兄弟', '父母'])
    expect(hiddenRelatives(reading.lines)).toEqual(['妻财'])
    expect(reading.hiddenRelatives).toEqual(['妻财'])
  })

  it('is empty on 乾 본궁, which carries all five 육친', () => {
    const reading = buildLiuyao({ seed: 'qian-full', values: [7, 7, 7, 7, 7, 7] })
    expect(reading.hiddenRelatives).toEqual([])
  })
})
