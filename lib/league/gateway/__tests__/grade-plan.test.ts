/**
 * gradeSources is CONSUMED, not just declared: resolution asks the adapter how
 * to grade via `gradePlanFor`, and the reconciliation engine's injected
 * fetchers route through it (source-asserted below). The price path for
 * binary_close_higher is untouched — a twelve_data tier-1 resolves to the same
 * `fetchDailyCloses` call as before.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { gradePlanFor, withCategoryFallback } from '../grade-plan'
import { createStocksAdapter } from '../adapters/stocks'
import type { PriceSeriesIo } from '../adapters/price-series-packet'
import type { CategoryAdapter } from '../types'

const DEAD_IO: PriceSeriesIo = {
  fetchDataPacket: async () => {
    throw new Error('io must not be called')
  },
  fetchMarketConsensus: async () => {
    throw new Error('io must not be called')
  },
  fetchCryptoContext: async () => {
    throw new Error('io must not be called')
  },
  getResearchPacket: async () => {
    throw new Error('io must not be called')
  },
  fetchRelatedInstruments: async () => {
    throw new Error('io must not be called')
  },
  fetchSlowData: async () => {
    throw new Error('io must not be called')
  },
}

const stocks = createStocksAdapter(DEAD_IO)

/** A future adapter whose tier-1 grading source is NOT a price series. */
const officialApiAdapter = {
  ...stocks,
  category_id: 'sports',
  ledger_category: 'sports',
  gradeSources: () =>
    [
      { tier: 1, kind: 'official_api', endpoint: 'league fixtures API (official final result)' },
      { tier: 2, kind: 'perplexity_sourced', require_url: true },
      { tier: 3, kind: 'operator_manual', require_url: true },
    ] as const,
} as unknown as CategoryAdapter

/** Malformed ladder: non-price tier-1 and no operator_manual fallback. */
const noFallbackAdapter = {
  ...stocks,
  category_id: 'sports',
  ledger_category: 'sports',
  gradeSources: () =>
    [
      { tier: 1, kind: 'official_api', endpoint: 'league fixtures API (official final result)' },
      { tier: 2, kind: 'perplexity_sourced', require_url: true },
      { tier: 2, kind: 'perplexity_sourced', require_url: true },
    ] as const,
} as unknown as CategoryAdapter

describe('gradePlanFor — resolution asks the adapter', () => {
  it('KRSTOCK krx_official tier-1 still takes the price-series executor (official KRX, not TD)', () => {
    const plan = gradePlanFor(stocks, 'KRSTOCK:KOSPI:005930')
    expect(plan.source).toBe('price_series')
    if (plan.source === 'price_series' && plan.tier1 !== 'legacy') {
      expect(plan.tier1).toMatchObject({ tier: 1, kind: 'krx_official' })
    } else {
      throw new Error('expected krx_official tier-1')
    }
  })

  it('stocks (twelve_data tier-1) → the existing price-series path', () => {
    const plan = gradePlanFor(stocks, 'AAPL')
    expect(plan.source).toBe('price_series')
    if (plan.source === 'price_series' && plan.tier1 !== 'legacy') {
      expect(plan.tier1).toMatchObject({ tier: 1, kind: 'twelve_data' })
      expect(plan.tier1.tier === 1 && plan.tier1.kind === 'twelve_data' && plan.tier1.endpoint).toContain('AAPL')
    } else {
      throw new Error('expected a consulted tier-1 source, not legacy')
    }
  })

  it('no adapter (legacy category / off-catalog instrument) → price series, unchanged', () => {
    expect(gradePlanFor(null, 'MSFT')).toEqual({ source: 'price_series', tier1: 'legacy' })
  })

  it('adapterless sports / politics / entertainment fall through to operator_manual', () => {
    const legacy = gradePlanFor(null, 'MATCH:MUN-LIV-20260901')
    expect(legacy).toEqual({ source: 'price_series', tier1: 'legacy' })
    expect(withCategoryFallback(legacy, 'sports')).toEqual({ source: 'operator_manual' })
    expect(withCategoryFallback(legacy, 'politics_election')).toEqual({ source: 'operator_manual' })
    expect(withCategoryFallback(legacy, 'entertainment_awards')).toEqual({ source: 'operator_manual' })
    expect(withCategoryFallback(legacy, 'tech')).toEqual({ source: 'operator_manual' })
    expect(withCategoryFallback(legacy, 'real_estate')).toEqual({ source: 'operator_manual' })
    expect(withCategoryFallback(legacy, 'stock')).toEqual(legacy)
  })

  it('a non-price tier-1 with operator_manual routes to the operator, never price-grades', () => {
    expect(gradePlanFor(officialApiAdapter, 'MATCH:MUN-LIV-20260901')).toEqual({
      source: 'operator_manual',
    })
  })

  it('a non-price ladder with no operator_manual stays unsupported', () => {
    expect(gradePlanFor(noFallbackAdapter, 'MATCH:MUN-LIV-20260901')).toEqual({
      source: 'unsupported',
      tier1Kind: 'official_api',
    })
  })

  it('lmarena official_api tier-1 is the AIRANK auto-grade path, never operator_manual', () => {
    const airankAdapter = {
      ...stocks,
      category_id: 'ai_models',
      ledger_category: 'ai_models',
      gradeSources: () =>
        [
          { tier: 1, kind: 'official_api', endpoint: 'lmarena:leaderboard' },
          { tier: 2, kind: 'perplexity_sourced', require_url: true },
          { tier: 3, kind: 'operator_manual', require_url: true },
        ] as const,
    } as unknown as CategoryAdapter
    expect(gradePlanFor(airankAdapter, 'AIRANK:text:overall:brand_rank1:OpenAI:20261104')).toEqual({
      source: 'lmarena',
      tier1: { tier: 1, kind: 'official_api', endpoint: 'lmarena:leaderboard' },
    })
  })
})

describe('the reconciliation engine actually consults the plan (consumption proof)', () => {
  const src = readFileSync(join(__dirname, '../../../prediction/reconciliation.ts'), 'utf8')

  it('fetchSeries and isPriceInstrument both route through gradePlanFor', () => {
    expect(src).toContain('fetchSeries: fetchSeriesViaGradePlan')
    expect(src).toContain('planForInstrument')
    expect(src.match(/gradePlanFor\(/g)!.length).toBeGreaterThanOrEqual(1)
    expect(src.match(/planForInstrument\(/g)!.length).toBeGreaterThanOrEqual(2)
  })

  it('the twelve_data executor is still the hardened fetchDailyCloses — no new price path', () => {
    expect(src).toContain('return fetchDailyCloses(instrument, startDate, endDate)')
    expect(src).toContain('fetchKrxOfficialCloses')
  })

  it('gradeRoundOnRead parks freeform rounds instead of claiming a price feed', () => {
    expect(src).toContain('parkRoundForManual')
    expect(src).toContain('return engine.gradeRoundOnRead(roundId)')
    expect(src).toContain("grading_status: 'graded'")
  })

  it('AIRANK official path is wired and never parks on the manual queue', () => {
    expect(src).toContain("plan.source === 'lmarena'")
    expect(src).toContain('resolveAirankOfficial')
    const queue = readFileSync(join(__dirname, '../../manual-grade/queue.ts'), 'utf8')
    expect(queue).toContain("plan.source === 'lmarena'")
  })

  it('API-Football official path is wired and not parked at resolves_at', () => {
    expect(src).toContain("plan.source === 'api_football'")
    expect(src).toContain('gradeFootballMatchInstrument')
    const queue = readFileSync(join(__dirname, '../../manual-grade/queue.ts'), 'utf8')
    expect(queue).toContain("plan.source === 'api_football'")
  })
})
