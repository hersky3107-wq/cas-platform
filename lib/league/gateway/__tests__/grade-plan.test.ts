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
  it('stocks (twelve_data tier-1) → the existing price-series path', () => {
    const plan = gradePlanFor(stocks, 'AAPL')
    expect(plan.source).toBe('price_series')
    if (plan.source === 'price_series' && plan.tier1 !== 'legacy') {
      expect(plan.tier1).toMatchObject({ tier: 1, kind: 'twelve_data' })
      expect(plan.tier1.tier === 1 && plan.tier1.endpoint).toContain('AAPL')
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
})

describe('the reconciliation engine actually consults the plan (consumption proof)', () => {
  const src = readFileSync(join(__dirname, '../../../prediction/reconciliation.ts'), 'utf8')

  it('fetchSeries and isPriceInstrument both route through gradePlanFor', () => {
    expect(src).toContain('fetchSeries: fetchSeriesViaGradePlan')
    expect(src.match(/gradePlanFor\(/g)!.length).toBeGreaterThanOrEqual(2)
  })

  it('the twelve_data executor is still the hardened fetchDailyCloses — no new price path', () => {
    expect(src).toContain('return fetchDailyCloses(instrument, startDate, endDate)')
  })

  it('gradeRoundOnRead is wrapped so operator_manual is refused before the engine claims', () => {
    expect(src).toContain("planForRound(round.instrument, round.category).source === 'operator_manual'")
    expect(src).toContain('return engine.gradeRoundOnRead(roundId)')
    expect(src).toContain("reason: 'not_due'")
  })
})
