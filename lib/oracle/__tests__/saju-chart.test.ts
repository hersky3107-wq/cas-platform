import { describe, expect, it } from 'vitest'
import { fourPillars } from '../engines/calendar/ganzhi'
import { fiveElementBalance } from '../engines/calendar/five-elements'
import { tenGods } from '../engines/calendar/ten-gods'
import { parseSajuChart } from '../saju-chart'

/** Exactly the shape compute.ts writes to oracle_computations.result for saju. */
function sajuCalculation(date: string, time: string | null) {
  const pillars = fourPillars({ date, time, timezone: 'Asia/Seoul' })
  return JSON.parse(
    JSON.stringify({
      pillars,
      fiveElements: fiveElementBalance(pillars),
      tenGods: tenGods(pillars.day.stem, pillars),
      greatLuck: null,
    }),
  ) as unknown
}

describe('parseSajuChart', () => {
  it('reads four pillars in 년월일시 order from real engine output', () => {
    const chart = parseSajuChart(sajuCalculation('1990-03-04', '09:05'))
    expect(chart).not.toBeNull()
    expect(chart!.columns.map((column) => column.key)).toEqual(['year', 'month', 'day', 'hour'])
    expect(chart!.columns.map((column) => column.label)).toEqual([
      '년주',
      '월주',
      '일주',
      '시주',
    ])
    for (const column of chart!.columns) {
      expect(column.stem?.hanja).toMatch(/^.$/)
      expect(column.branch?.hanja).toMatch(/^.$/)
      expect(column.ganzhi).toBe(`${column.stem!.hanja}${column.branch!.hanja}`)
    }
  })

  it('marks 오행 and 십신 on every character', () => {
    const chart = parseSajuChart(sajuCalculation('1990-03-04', '09:05'))!
    for (const column of chart.columns) {
      expect(column.stem!.element).not.toBeNull()
      expect(column.branch!.element).not.toBeNull()
      expect(column.stem!.tenGod).toBeTruthy()
      expect(column.branch!.tenGod).toBeTruthy()
    }
    // The day stem is the reference, so it is labelled 일간, not a 십신.
    expect(chart.columns[2].stem!.tenGod).toBe('일간')
    expect(chart.dayStem).toEqual(chart.columns[2].stem)
  })

  it('counts eight characters with an hour pillar and six without', () => {
    expect(parseSajuChart(sajuCalculation('1990-03-04', '09:05'))!.charCount).toBe(8)
    const noTime = parseSajuChart(sajuCalculation('1990-03-04', null))!
    expect(noTime.charCount).toBe(6)
    expect(noTime.hourUnknown).toBe(true)
    expect(noTime.columns[3].stem).toBeNull()
    expect(noTime.columns[3].missing).toBe(true)
  })

  it('always reports five elements, zero-filled', () => {
    const chart = parseSajuChart(sajuCalculation('1990-03-04', '09:05'))!
    expect(chart.elements.map((entry) => entry.key)).toEqual([
      'wood',
      'fire',
      'earth',
      'metal',
      'water',
    ])
    expect(chart.elements.map((entry) => entry.label)).toEqual(['목', '화', '토', '금', '수'])
    expect(chart.elements.every((entry) => Number.isFinite(entry.count))).toBe(true)
  })

  it('returns null when there is nothing to draw', () => {
    expect(parseSajuChart(null)).toBeNull()
    expect(parseSajuChart({})).toBeNull()
    expect(parseSajuChart({ pillars: {} })).toBeNull()
    expect(parseSajuChart({ pillars: { year: { stem: {} } } })).toBeNull()
  })

  it('degrades one cell instead of throwing on malformed characters', () => {
    const chart = parseSajuChart({
      pillars: {
        year: { stem: { hanja: '庚', hangul: '경', element: 'metal', yinYang: 'yang' }, branch: 42 },
        month: 'nonsense',
      },
      fiveElements: { wood: 'x', fire: 2 },
      tenGods: { year: { stem: '편재' } },
    })
    expect(chart).not.toBeNull()
    expect(chart!.columns[0].stem!.tenGod).toBe('편재')
    expect(chart!.columns[0].branch).toBeNull()
    expect(chart!.columns[1].missing).toBe(true)
    expect(chart!.elements[0].count).toBe(0)
    expect(chart!.elements[1].count).toBe(2)
  })
})
