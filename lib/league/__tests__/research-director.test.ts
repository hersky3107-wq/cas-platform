import { describe, expect, it } from 'vitest'
import {
  allNeedsPresent,
  buildPacketInventory,
  buildStage1Prompt,
  buildStage2Prompt,
  hasAsOfDate,
  isAdmissibleFinding,
  parseDirectorOutput,
  parseStage1Needs,
  parseStage2Coverage,
  selectQueriesFromCoverage,
  QUERY_BUDGET,
  type PacketInventoryInput,
} from '../research-director'

const inventory: PacketInventoryInput = {
  instrument: 'XAU/USD',
  category: 'gold_metal',
  horizon: '1d',
  seriesLength: 1083,
  seriesAsOf: '2026-09-12',
  anchorClose: 4348.45,
  consensus: null,
  crypto: null,
  related: [
    {
      symbol: 'UUP',
      role: 'fx',
      note: 'USD index ETF proxy',
      lastClose: 28.4,
      lastDate: '2026-09-11',
      move1dPct: -0.2,
      corr: { r: -0.4, n: 20 },
      beta: { beta: -0.1, n: 20 },
      leadLag: [],
    },
  ],
  slow: {
    fetchedAt: '2026-09-13T00:00:00.000Z',
    shortVolume: null,
    putCall: null,
    btcEtfFlow: null,
    insider: null,
    realYield10y: { date: '2026-09-11', yieldPct: 1.82 },
    cotGold: {
      contract: 'GOLD',
      date: '2026-09-08',
      openInterest: 411227,
      managedMoneyLong: 145804,
      managedMoneyShort: 10832,
      managedMoneyNet: 134972,
    },
  },
}

describe('research director — two-stage parse', () => {
  it('Stage 1 prompt is category-agnostic: no gold shopping list', () => {
    const p = buildStage1Prompt().toLowerCase()
    for (const banned of ['tips', 'cot', 'dxy', 'central bank', 'real yield', 'commitments of traders']) {
      expect(p, banned).not.toContain(banned)
    }
  })

  it('Stage 1 prompt asks for structural drivers AND near-term catalysts', () => {
    const p = buildStage1Prompt()
    expect(p).toContain('structural_drivers')
    expect(p).toContain('near_term_catalysts')
    expect(p).toMatch(/must NOT collapse/i)
    expect(p).toContain('Category field names the asset class')
  })

  it('parses Stage 1 needs JSON including optional group', () => {
    const parsed = parseStage1Needs(
      '```json\n{"needs":[{"need":"real rates","why":"opportunity cost","group":"structural_drivers"}]}\n```',
    )
    expect(parsed).toEqual([{ need: 'real rates', why: 'opportunity cost', group: 'structural_drivers' }])
  })

  it('Stage 2 marks already_present vs missing; queries only for missing', () => {
    const coverage = parseStage2Coverage(
      JSON.stringify({
        coverage: [
          { need: 'real rates', status: 'already_present', query: null },
          { need: 'central-bank gold buying', status: 'missing', query: 'XAU/USD latest official sector gold demand' },
          { need: 'DXY', status: 'already_present', query: 'should not search' },
        ],
      }),
    )
    expect(coverage).not.toHaveProperty('error')
    const queries = selectQueriesFromCoverage(coverage as Exclude<typeof coverage, { error: string }>, 4, new Set(['en']))
    expect(queries).toEqual([{ q: 'XAU/USD latest official sector gold demand', lang: 'en' }])
    expect(allNeedsPresent(coverage as Exclude<typeof coverage, { error: string }>)).toBe(false)
  })

  it('caps English missing queries at the dispersion-tier budget; language queries are additive', () => {
    const coverage = parseStage2Coverage(
      JSON.stringify({
        coverage: [
          { need: 'a', status: 'missing', query: 'q1', lang: 'en' },
          { need: 'b', status: 'missing', query: 'q2', lang: 'en' },
          { need: 'c', status: 'missing', query: 'q3', lang: 'en' },
          { need: 'd', status: 'missing', query: '중국 금 수요', lang: 'zh' },
        ],
      }),
    )
    expect(coverage).not.toHaveProperty('error')
    const queries = selectQueriesFromCoverage(
      coverage as Exclude<typeof coverage, { error: string }>,
      QUERY_BUDGET.tight,
      new Set(['en', 'zh']),
    )
    expect(queries.filter((q) => q.lang === 'en')).toHaveLength(2)
    expect(queries.filter((q) => q.lang === 'zh')).toEqual([{ q: '중국 금 수요', lang: 'zh' }])
  })

  it('already_present coverage (including UNAVAILABLE inventory) searches nothing', () => {
    const coverage = [
      { need: 'COT', status: 'already_present' as const, query: null },
      { need: 'TIPS', status: 'already_present' as const, query: null },
    ]
    expect(allNeedsPresent(coverage)).toBe(true)
    expect(selectQueriesFromCoverage(coverage, 12, new Set(['en']))).toEqual([])
  })

  it('combined parseDirectorOutput still accepts a single JSON blob', () => {
    const parsed = parseDirectorOutput(
      JSON.stringify({
        needs: [{ need: 'flows', why: 'positioning' }],
        coverage: [{ need: 'flows', status: 'missing', query: 'XAU/USD latest ETF flows' }],
      }),
      4,
      new Set(['en']),
    )
    expect(parsed).not.toHaveProperty('error')
    if ('error' in parsed) throw new Error(parsed.error)
    expect(parsed.queries).toEqual([{ q: 'XAU/USD latest ETF flows', lang: 'en' }])
  })

  it('inventory lists field names so Stage 2 can mark TIPS and COT present', () => {
    const text = buildPacketInventory(inventory)
    expect(text).toContain('real_yield_10y_tips:')
    expect(text).toContain('cot_gold:')
    expect(text).toContain('related.UUP')
    expect(text).toContain('1.82')
  })

  it('inventory lists GVZ / industrial / platinum COT when present', () => {
    const text = buildPacketInventory({
      ...inventory,
      slow: {
        ...inventory.slow!,
        gvz: { date: '2026-09-17', value: 24.98 },
        indpro: { date: '2026-08-01', value: 103.07 },
        cotPlatinum: {
          contract: 'PLATINUM',
          date: '2026-09-15',
          openInterest: 1,
          managedMoneyLong: 2,
          managedMoneyShort: 1,
          managedMoneyNet: 1,
        },
      },
    })
    expect(text).toContain('gvz_gold_vol:')
    expect(text).toContain('24.98')
    expect(text).toContain('us_indpro:')
    expect(text).toContain('cot_platinum:')
  })

  it('Stage 2 prompt still carries the 2026-08-28 dispersion budgets', () => {
    expect(buildStage2Prompt('tight', [])).toContain('Cap English missing queries at 2')
    expect(buildStage2Prompt('normal', [])).toContain('Cap English missing queries at 4')
    expect(buildStage2Prompt('high', ['zh'])).toContain('Cap English missing queries at 12')
    expect(buildStage2Prompt('high', ['zh'])).toContain('zh: Chinese')
  })
})

describe('research director — admissible findings', () => {
  it('requires a number, a date, and a source URL', () => {
    expect(hasAsOfDate('as of 2026-09-11 the print was 1.82')).toBe(true)
    expect(isAdmissibleFinding('Gold at $3500 on 2026-09-11. Source: https://example.com/x')).toBe(true)
    expect(isAdmissibleFinding('Gold at $3500 on 2026-09-11.', ['https://example.com/x'])).toBe(true)
    expect(isAdmissibleFinding('Gold at $3500 on 2026-09-11.')).toBe(false)
    expect(isAdmissibleFinding('Gold moved on 2026-09-11. https://example.com/x')).toBe(false)
    expect(isAdmissibleFinding('Gold at $3500 with no date. https://example.com/x')).toBe(false)
  })
})
