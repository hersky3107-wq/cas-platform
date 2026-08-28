import { describe, expect, it } from 'vitest'
import {
  CRYPTO_IV_HIGH_MIN_PCT,
  CRYPTO_IV_TIGHT_MAX_PCT,
  decideResearchTier,
  EQUITY_DISPERSION_HIGH_MIN_PCT,
  EQUITY_DISPERSION_TIGHT_MAX_PCT,
} from '../research-tier'
import type { ConsensusSnapshot, CryptoSnapshot } from '../closed-book-packet'

function consensusWith(high: number, low: number, recs?: { buy: number; sell: number; hold: number }): ConsensusSnapshot {
  return {
    fetchedAt: '2026-08-28T00:00:00.000Z',
    priceTarget: { high, median: (high + low) / 2, low, average: (high + low) / 2, current: 100, currency: 'USD' },
    recommendations: recs
      ? { strongBuy: 0, buy: recs.buy, hold: recs.hold, sell: recs.sell, strongSell: 0 }
      : { strongBuy: 20, buy: 10, hold: 5, sell: 1, strongSell: 0 },
    lastEarnings: { unavailable: 'n/a' },
    latestRating: { unavailable: 'n/a' },
    epsTrend: { unavailable: 'n/a' },
  }
}

function cryptoWith(iv: number): CryptoSnapshot {
  return {
    fetchedAt: '2026-08-28T00:00:00.000Z',
    funding: { unavailable: 'n/a' },
    openInterest: { unavailable: 'n/a' },
    markIv: { ivPct: iv, instrument: 'BTC-PERPETUAL' },
  }
}

const flatCloses = Array.from({ length: 30 }, () => 100)
const wildCloses = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 100 : 105))

describe('research tier — dispersion-triggered budget (v2 D)', () => {
  it('equity: tight below the dispersion floor', () => {
    // (105-95)/100 = 10% < 15%
    const d = decideResearchTier({ category: 'stock', consensus: consensusWith(105, 95), crypto: null, closes: [], anchorClose: 100 })
    expect(d.tier).toBe('tight')
    expect(d.signal).toContain(`${EQUITY_DISPERSION_TIGHT_MAX_PCT}%`)
  })

  it('equity: high above the dispersion ceiling', () => {
    // (140-90)/100 = 50% >= 30%
    const d = decideResearchTier({ category: 'stock', consensus: consensusWith(140, 90), crypto: null, closes: [], anchorClose: 100 })
    expect(d.tier).toBe('high')
    expect(d.signal).toContain(`${EQUITY_DISPERSION_HIGH_MIN_PCT}%`)
  })

  it('equity: normal in between', () => {
    // (120-100)/100 = 20%
    const d = decideResearchTier({ category: 'stock', consensus: consensusWith(120, 100), crypto: null, closes: [], anchorClose: 100 })
    expect(d.tier).toBe('normal')
  })

  it('equity: a buy/sell analyst split forces high even when dispersion is tight', () => {
    const d = decideResearchTier({
      category: 'stock',
      consensus: consensusWith(105, 95, { buy: 10, sell: 8, hold: 2 }),
      crypto: null,
      closes: [],
      anchorClose: 100,
    })
    expect(d.tier).toBe('high')
    expect(d.signal).toContain('split')
  })

  it('crypto: IV thresholds pick the tier', () => {
    const base = { category: 'crypto_spot', consensus: null, closes: [], anchorClose: null }
    expect(decideResearchTier({ ...base, crypto: cryptoWith(CRYPTO_IV_TIGHT_MAX_PCT - 5) }).tier).toBe('tight')
    expect(decideResearchTier({ ...base, crypto: cryptoWith(55) }).tier).toBe('normal')
    expect(decideResearchTier({ ...base, crypto: cryptoWith(CRYPTO_IV_HIGH_MIN_PCT + 10) }).tier).toBe('high')
  })

  it('fx: realized vol picks the tier', () => {
    expect(decideResearchTier({ category: 'fx', consensus: null, crypto: null, closes: flatCloses, anchorClose: null }).tier).toBe('tight')
    expect(decideResearchTier({ category: 'fx', consensus: null, crypto: null, closes: wildCloses, anchorClose: null }).tier).toBe('high')
  })

  it('no signal at all degrades to normal, never a guess', () => {
    const d = decideResearchTier({ category: 'fx', consensus: null, crypto: null, closes: [], anchorClose: null })
    expect(d.tier).toBe('normal')
    expect(d.signal).toContain('no uncertainty signal')
  })
})
