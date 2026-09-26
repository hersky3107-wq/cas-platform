import { describe, expect, it } from 'vitest'
import { eokbu, fourPillars, nineStar, sukuyou, tenGods, tzolkin } from '../../engines/calendar'
import { natalChart } from '../../engines/astro'
import { ichingDraw, runeDraw, tarotDraw } from '../../engines/draw'
import { nameReading } from '../../engines/name'
import { numerology } from '../../engines/numerology'
import { prism } from '../../engines/prism'
import { ziweiChart } from '../../engines/ziwei'
import { sanitizeCalculation } from '../../runner/public-computation'
import { ORACLE_DEFAULT_COORDS } from '../../runner/conventions'
import { chartsFromComputations } from '../charts'
import { extractNativeFindings } from '../native'
import { talismanFromStoredSession } from '../from-session'
import { LIVE_ACCESS } from './fixture'

function wrapSaju() {
  const pillars = fourPillars({ date: '1988-03-15', time: '04:30', timezone: 'Asia/Seoul' })
  return {
    system: 'saju',
    result: { pillars, fiveElements: {}, tenGods: tenGods(pillars.day.stem, pillars), eokbu: eokbu(pillars) },
  }
}

function realRows() {
  return [
    wrapSaju(),
    {
      system: 'ziwei',
      result: {
        chart: ziweiChart({ birthDate: '1988-03-15', birthTime: '04:30', tz: 'Asia/Seoul', sex: 'male' }),
      },
    },
    {
      system: 'astro',
      result: {
        natal: natalChart({
          date: '1988-03-15',
          time: '04:30',
          tz: 'Asia/Seoul',
          lat: ORACLE_DEFAULT_COORDS.lat,
          lng: ORACLE_DEFAULT_COORDS.lng,
          timeKnown: true,
        }),
      },
    },
    {
      system: 'prism',
      result: {
        prism: prism({
          birthDate: '1988-03-15',
          mbti: 'INFJ',
          colors: { impulse: 'crimson', need: 'sage', identity: 'indigo' },
          microCheck: [3, 3, 3, 3] as const,
          atDate: '2026-08-15',
        }),
      },
    },
    { system: 'iching', result: { draw: ichingDraw({ seed: 'talisman-iching-1988' }) } },
    {
      system: 'tarot',
      result: { draw: tarotDraw({ seed: 'talisman-tarot-1988', spread: 5, pickedPositions: [1, 2, 3, 4, 5] }) },
    },
    { system: 'name', result: { reading: nameReading({ surname: '김', givenName: '지수', locale: 'ko' }) } },
    {
      system: 'ninestar',
      result: { natal: nineStar({ date: '1988-03-15', time: '12:00', timezone: 'Asia/Seoul' }) },
    },
    { system: 'runes', result: { draw: runeDraw({ seed: 'talisman-runes-1988', count: 3, pickedPositions: [1, 2, 3] }) } },
    {
      system: 'numerology',
      result: { numbers: numerology({ birthDate: '1988-03-15', latinName: 'Kim Jisu', atDate: '2026-08-15' }) },
    },
    { system: 'sukuyou', result: { natal: sukuyou({ date: '1988-03-15', time: '12:00', timezone: 'Asia/Seoul' }) } },
    { system: 'tzolkin', result: { natal: tzolkin({ date: '1988-03-15' }) } },
  ]
}

describe('chartsFromComputations', () => {
  it('lets every native extractor field survive publicComputation sanitization', () => {
    const rows = realRows()
    for (const row of rows) {
      expect(sanitizeCalculation(row.result, row.system)).not.toBeNull()
    }
    const { charts, arrival } = chartsFromComputations(rows)
    expect(arrival.nativeMissing).toEqual([])
    expect(charts.saju?.eokbu.yongsin).toBe('fire')
    expect(charts.saju?.tenGods.day.branch).toBeTruthy()
    expect(charts.ziwei?.siHua.ji).toBeTruthy()
    expect(charts.ziwei?.palaces.length).toBe(12)
    expect(charts.astro?.elementBalance).toBeTruthy()
    expect(typeof charts.astro?.bodies.Sun.longitude).toBe('number')
    expect(charts.prism?.warningDomain).toBeTruthy()
    expect(Array.isArray(charts.iching?.hiddenRelatives)).toBe(true)
    expect(charts.tarot?.cards.length).toBe(5)
    expect(charts.name?.supported).toBe(true)
    expect(charts.ninestar?.yearBoard.cells).toHaveLength(9)
    expect(charts.ninestar?.yearBranchIndex).toBeTypeOf('number')
  })

  it('does not store 구성 흉방; extractNativeFindings computes nineStarDirections from boards', () => {
    const natal = nineStar({ date: '1988-03-15', time: '12:00', timezone: 'Asia/Seoul' })
    expect(natal).not.toHaveProperty('killings')
    expect(JSON.stringify(natal)).not.toContain('오황살')
    const { charts } = chartsFromComputations([
      { system: 'ninestar', result: { natal } },
    ])
    const findings = extractNativeFindings(charts)
    expect(findings.ninestar?.killings.some((k) => k.name === '오황살')).toBe(true)
  })

  it('sanitized charts produce the same native findings as unsanitized engine objects', () => {
    const { charts } = chartsFromComputations(realRows())
    const findings = extractNativeFindings(charts)
    expect(findings.saju?.gisin).toBe('water')
    expect(findings.ziwei?.maleficPalaces.length).toBeGreaterThan(0)
    expect(findings.ninestar?.gilbang).toBeDefined()
  })

  it('talismanFromStoredSession is on-demand and refuses stub/partial', () => {
    const rows = realRows()
    const live = talismanFromStoredSession({
      session: { status: 'done', prompt_version: LIVE_ACCESS.promptVersion },
      computations: rows,
      deficiency: { wood: 0, fire: 2, earth: 0, metal: 0, water: 8 },
      purpose: null,
    })
    expect(live.reason).toBe('ok')
    expect(live.computation?.fudan.glyph).toBe('BINDRUNE')
    expect(live.computation?.centre.source).toBe('eokbu')

    const stub = talismanFromStoredSession({
      session: { status: 'done', prompt_version: 'stub-0' },
      computations: rows,
      deficiency: { fire: 8 },
    })
    expect(stub.computation).toBeNull()
    expect(stub.reason).toBe('gate')
  })
})
