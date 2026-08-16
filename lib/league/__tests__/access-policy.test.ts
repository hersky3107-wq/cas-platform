import { describe, expect, it } from 'vitest'
import {
  ALL_PREDICTION_CATEGORIES,
  isCuratedInstrument,
  tuningForViewer,
  visibleCategoriesFor,
} from '../access-policy'

const CURATED = ['AAPL', 'NVDA', 'BTC/USD', 'EUR/USD'] as const

describe('visibleCategoriesFor', () => {
  it('default-denies a viewer with no jurisdiction signal at all', () => {
    expect(visibleCategoriesFor({ declaredCountry: null, ipCountry: null })).toEqual([])
  })

  it('gives a US viewer the full category set', () => {
    const visible = visibleCategoriesFor({ ipCountry: 'US' })
    expect(visible).toEqual(ALL_PREDICTION_CATEGORIES)
  })

  it('omits crypto_perps for a UK viewer but keeps ordinary finance categories', () => {
    const visible = visibleCategoriesFor({ ipCountry: 'GB' })
    expect(visible).not.toContain('crypto_perps')
    expect(visible).toContain('stock')
    expect(visible).toContain('crypto_spot')
  })

  it('applies stricter-of-the-two across declared vs IP country', () => {
    // US allows crypto_perps, GB denies it — the deny wins.
    expect(visibleCategoriesFor({ declaredCountry: 'US', ipCountry: 'GB' })).not.toContain('crypto_perps')
  })

  it('returns an empty list for a jurisdiction with no allowed categories (CN)', () => {
    expect(visibleCategoriesFor({ declaredCountry: 'CN' })).toEqual([])
  })

  it('never returns a category outside the known universe', () => {
    for (const category of visibleCategoriesFor({ ipCountry: 'KR' })) {
      expect(ALL_PREDICTION_CATEGORIES).toContain(category)
    }
  })
})

describe('isCuratedInstrument', () => {
  it('accepts an exact curated symbol', () => {
    expect(isCuratedInstrument('AAPL', CURATED)).toBe(true)
    expect(isCuratedInstrument('BTC/USD', CURATED)).toBe(true)
  })

  it('tolerates surrounding whitespace from a query string', () => {
    expect(isCuratedInstrument('  AAPL  ', CURATED)).toBe(true)
  })

  it('rejects anything not on the curated list — including near-misses and empties', () => {
    expect(isCuratedInstrument('TSLA', CURATED)).toBe(false)
    expect(isCuratedInstrument('aapl', CURATED)).toBe(false)
    expect(isCuratedInstrument('', CURATED)).toBe(false)
    expect(isCuratedInstrument('   ', CURATED)).toBe(false)
    expect(isCuratedInstrument('005930.KS', CURATED)).toBe(false)
  })
})

describe('tuningForViewer', () => {
  const hostile = {
    tiers: ['premier'] as const,
    concurrency: 64,
    timeoutMs: 600_000,
    maxCompletionTokens: 100_000,
    costCapUsd: 999,
  }

  it('strips every cost knob for a non-admin caller', () => {
    expect(tuningForViewer({ ...hostile, tiers: ['premier'] }, false)).toEqual({})
  })

  it('preserves the knobs for admin operational testing', () => {
    const raw = { ...hostile, tiers: ['premier'] as ('premier' | 'challenger')[] }
    expect(tuningForViewer(raw, true)).toEqual(raw)
  })
})
