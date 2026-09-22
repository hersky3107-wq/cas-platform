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

  it('inventory lists EIA crude / natgas / OVX / energy COT when present', () => {
    const text = buildPacketInventory({
      ...inventory,
      instrument: 'WTI/USD',
      category: 'commodity_energy',
      slow: {
        fetchedAt: '2026-09-22T00:00:00.000Z',
        shortVolume: null,
        putCall: { date: '2026-09-21', total: 0.9, index: null, equity: null },
        btcEtfFlow: null,
        insider: null,
        eiaCrude: {
          weekEnding: '2026-09-11',
          commercialStocksMMbbl: 423.429,
          commercialWowChangeMMbbl: -0.64,
          sprMMbbl: 284.957,
          productionKbpd: 13944,
          refineryRunsKbpd: 17330,
          productSuppliedKbpd: 21255,
        },
        cotWti: {
          contract: 'WTI-PHYSICAL',
          date: '2026-09-15',
          openInterest: 1,
          managedMoneyLong: 2,
          managedMoneyShort: 1,
          managedMoneyNet: 1,
        },
        ovx: { date: '2026-09-18', value: 50.39 },
      },
    })
    expect(text).toContain('eia_us_crude_stocks_supply:')
    expect(text).toContain('423.429')
    expect(text).toContain('cot_wti:')
    expect(text).toContain('ovx_crude_vol:')
    expect(text).toContain('50.39')
    expect(text).toContain('put_call:')
    expect(text).not.toContain('eia_us_natgas_storage:')
  })

  it('inventory lists copper COT / IMF copper without crude EIA', () => {
    const text = buildPacketInventory({
      ...inventory,
      instrument: 'CPER',
      category: 'commodity_energy',
      slow: {
        fetchedAt: '2026-09-22T00:00:00.000Z',
        shortVolume: { date: '2026-09-21', shortShares: 1, totalShares: 4, shortPct: 25 },
        putCall: { date: '2026-09-21', total: 0.74, index: null, equity: null },
        btcEtfFlow: null,
        insider: null,
        cotCopper: {
          contract: 'COPPER- #1',
          date: '2026-09-15',
          openInterest: 1,
          managedMoneyLong: 2,
          managedMoneyShort: 1,
          managedMoneyNet: 1,
        },
        copperSpotFred: { date: '2026-07-01', value: 13542.82 },
      },
    })
    expect(text).toContain('cot_copper:')
    expect(text).toContain('fred_imf_copper:')
    expect(text).toContain('13542.82')
    expect(text).not.toContain('eia_us_crude_stocks_supply:')
    expect(text).not.toContain('ovx_crude_vol:')
  })

  it('inventory lists FX FRED/COT fields without energy EIA', () => {
    const text = buildPacketInventory({
      ...inventory,
      instrument: 'EUR/USD',
      category: 'fx',
      slow: {
        fetchedAt: '2026-09-22T00:00:00.000Z',
        shortVolume: null,
        putCall: { date: '2026-09-21', total: 0.81, index: null, equity: null },
        btcEtfFlow: null,
        insider: null,
        fedFunds: { date: '2026-09-18', value: 3.88 },
        cotEur: {
          contract: 'EURO FX',
          date: '2026-09-15',
          openInterest: 1,
          managedMoneyLong: 2,
          managedMoneyShort: 3,
          managedMoneyNet: -1,
        },
        fxCotGap: { note: 'none' },
      },
    })
    expect(text).toContain('fed_funds:')
    expect(text).toContain('cot_eur:')
    expect(text).toContain('fx_cot_gap:')
    expect(text).not.toContain('eia_us_crude_stocks_supply:')
    expect(text).not.toContain('cot_gold:')
  })

  it('inventory lists index_etf VIX/COT fields without energy EIA or gold GVZ', () => {
    const text = buildPacketInventory({
      ...inventory,
      instrument: 'TQQQ',
      category: 'etf_index',
      slow: {
        fetchedAt: '2026-09-22T00:00:00.000Z',
        shortVolume: { date: '2026-09-21', shortShares: 1, totalShares: 4, shortPct: 25 },
        putCall: { date: '2026-09-21', total: 0.81, index: null, equity: null },
        btcEtfFlow: null,
        insider: null,
        vixcls: { date: '2026-09-18', value: 14.81 },
        nasdaqComFred: { date: '2026-09-18', value: 27122.09 },
        cotNq: {
          contract: 'NASDAQ MINI',
          date: '2026-09-15',
          openInterest: 1,
          managedMoneyLong: 2,
          managedMoneyShort: 3,
          managedMoneyNet: -1,
        },
        cotVix: {
          contract: 'VIX',
          date: '2026-09-15',
          openInterest: 1,
          managedMoneyLong: 1,
          managedMoneyShort: 2,
          managedMoneyNet: -1,
        },
      },
    })
    expect(text).toContain('vixcls:')
    expect(text).toContain('fred_nasdaq_composite:')
    expect(text).toContain('cot_nq:')
    expect(text).toContain('cot_vix:')
    expect(text).not.toContain('cot_es:')
    expect(text).not.toContain('eia_us_crude_stocks_supply:')
    expect(text).not.toContain('gvz_gold_vol:')
    expect(text).not.toContain('fed_funds:')
  })

  it('inventory lists memecoin fear-greed / L-S / taker so director does not re-search them', () => {
    const text = buildPacketInventory({
      ...inventory,
      instrument: 'WIF/USD',
      category: 'memecoin',
      crypto: {
        fetchedAt: '2026-09-22T00:00:00.000Z',
        funding: { rate: 0.00012, nextFundingTime: null },
        openInterest: { contracts: 99 },
        markIv: { unavailable: 'no Deribit currency mapping for WIF/USD' },
      },
      slow: {
        fetchedAt: '2026-09-22T00:00:00.000Z',
        shortVolume: null,
        putCall: null,
        btcEtfFlow: { date: '22 Sep 2026', netFlowUsdM: 10 },
        insider: null,
        fearGreed: {
          latest: { date: '2026-09-22', value: 28, classification: 'Fear' },
          week: [{ date: '2026-09-22', value: 28, classification: 'Fear' }],
        },
        topTraderLs: {
          symbol: 'WIFUSDT',
          timestamp: '2026-09-22T01:00:00.000Z',
          period: '1h',
          longShortRatio: 0.9,
        },
        takerRatio: {
          symbol: 'WIFUSDT',
          timestamp: '2026-09-22T01:00:00.000Z',
          period: '1h',
          buySellRatio: 0.88,
        },
      },
    })
    expect(text).toContain('crypto.funding:')
    expect(text).toContain('crypto.funding_rate:')
    expect(text).toContain('crypto.open_interest:')
    expect(text).toContain('crypto.fear_greed:')
    expect(text).toContain('"value":28')
    expect(text).toContain('crypto.top_trader_ls:')
    expect(text).toContain('WIFUSDT')
    expect(text).toContain('crypto.taker_ratio:')
    expect(text).toContain('btc_etf_flow:')
    expect(text).not.toContain('eia_us_crude_stocks_supply:')
    expect(text).not.toContain('gvz_gold_vol:')
    expect(text).not.toContain('fed_funds:')
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
