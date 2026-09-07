import { describe, expect, it } from 'vitest'
import { applyAdapterComposeToRoundInput } from '../hydrate-round-input'
import { createTechAdapter } from '../adapters/tech'
import { createStocksAdapter } from '../adapters/stocks'
import type { PriceSeriesIo } from '../adapters/price-series-packet'

const DEAD_TECH = {
  getResearchPacket: async () => {
    throw new Error('io must not be called')
  },
}

const DEAD_STOCKS: PriceSeriesIo = {
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

const tech = createTechAdapter(DEAD_TECH)
const stocks = createStocksAdapter(DEAD_STOCKS)
const NOW = new Date('2026-09-07T00:00:00.000Z')

const TECH_SEED = {
  proposition_text: 'Apple announces a foldable',
  category: 'tech',
  instrument: 'TECH:AAPL:product_launch:foldable_iphone',
  horizon: '1d',
  resolution_rule: 'placeholder',
  resolves_at: '2026-09-30T12:00:00.000Z',
}

describe('applyAdapterComposeToRoundInput — tech', () => {
  it('persists compose proposition_kind, subject_label, observation_shape — not the caller text', () => {
    const result = applyAdapterComposeToRoundInput(TECH_SEED, tech, NOW)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.input.proposition_kind).toBe('binary_subject_outcome')
    expect(result.input.subject_label).toBe('Apple')
    expect(result.input.observation_shape).toBe('occurrence')
    expect(result.input.proposition_text).toBe(
      'Will Apple publish a product page for a foldable iPhone on its official newsroom by 2026-09-30?',
    )
    expect(result.input.proposition_text).not.toMatch(/announces a foldable/)
    expect(result.input.horizon).toBe('1m')
  })

  it('refuses a caller-forced close_higher on a tech round', () => {
    const result = applyAdapterComposeToRoundInput(
      { ...TECH_SEED, proposition_kind: 'binary_close_higher' },
      tech,
      NOW,
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected fail')
    expect(result.error).toMatch(/does not match the adapter/)
  })

  it('refuses a caller-forced name_match shape on tech', () => {
    const result = applyAdapterComposeToRoundInput(
      { ...TECH_SEED, observation_shape: 'name_match' },
      tech,
      NOW,
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected fail')
    expect(result.error).toMatch(/observation_shape/)
  })

  it('refuses an undecidable tech instrument rather than defaulting to close_higher', () => {
    const result = applyAdapterComposeToRoundInput(
      { ...TECH_SEED, instrument: 'AAPL' },
      tech,
      NOW,
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected fail')
    expect(result.error).toMatch(/cannot compose/)
  })
})

describe('applyAdapterComposeToRoundInput — stocks / adapterless', () => {
  it('a matching close_higher caller value on stocks is accepted', () => {
    const result = applyAdapterComposeToRoundInput(
      {
        proposition_text: 'ignored',
        category: 'stock',
        instrument: 'AAPL',
        horizon: '1d',
        resolution_rule: 'close vs prior close',
        resolves_at: '2026-09-08T20:00:00.000Z',
        proposition_kind: 'binary_close_higher',
      },
      stocks,
      NOW,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.input.proposition_kind).toBe('binary_close_higher')
    expect(result.input.observation_shape).toBeNull()
  })

  it('adapterless cannot force a subject-outcome kind', () => {
    const result = applyAdapterComposeToRoundInput(
      { ...TECH_SEED, category: 'sports', proposition_kind: 'binary_subject_outcome' },
      null,
      NOW,
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected fail')
    expect(result.error).toMatch(/does not match the adapter/)
  })
})
