import { describe, expect, it } from 'vitest'
import { catalogIdentityError, CATALOG_INSTRUMENT_IDS, findCatalogInstrument } from '../catalog'
import {
  isPoisonTicker,
  POISON_TICKERS,
  quoteMatchesIdentity,
  resolvedVendorIdentity,
} from '../instrument-identity'

describe('instrument identity', () => {
  it('treats SPX and NDX as poison — Twelve Data 200s them as unrelated equities', () => {
    expect(isPoisonTicker('SPX')).toBe(true)
    expect(isPoisonTicker('NDX')).toBe(true)
    expect(isPoisonTicker('SPX:INDEX')).toBe(true)
    expect(isPoisonTicker('SPY')).toBe(false)
    expect(isPoisonTicker('QQQ')).toBe(false)
    expect(POISON_TICKERS).toEqual(['SPX', 'NDX', 'DJI', 'RUT'])
  })

  it('rejects the live SPX/NDX mis-resolutions against index tokens', () => {
    expect(quoteMatchesIdentity('Stellar AfricaGold Inc.', ['S&P 500'])).toBe(false)
    expect(quoteMatchesIdentity('Nordex SE - Unsponsored ADR', ['Nasdaq', '100'])).toBe(false)
    expect(quoteMatchesIdentity('SPDR S&P 500 ETF Trust', ['S&P 500'])).toBe(true)
    expect(quoteMatchesIdentity('Invesco QQQ Trust Series 1', ['Invesco'])).toBe(true)
  })

  it('requires every token and fails closed on a missing name', () => {
    expect(quoteMatchesIdentity('Silver Spot / US Dollar', ['Silver', 'Spot'])).toBe(true)
    expect(quoteMatchesIdentity('iShares Silver Trust', ['Silver', 'Spot'])).toBe(false)
    expect(quoteMatchesIdentity('iShares Silver Trust', ['iShares', 'Silver'])).toBe(true)
    expect(quoteMatchesIdentity('', ['Apple'])).toBe(false)
    expect(quoteMatchesIdentity(null, ['Apple'])).toBe(false)
  })

  it('catalog expected_name tokens would accept the intended vendor names and reject the poison names', () => {
    const spy = findCatalogInstrument('SPY')!.entry.expected_name
    expect(quoteMatchesIdentity('SPDR S&P 500 ETF Trust', spy)).toBe(true)
    expect(quoteMatchesIdentity('Stellar AfricaGold Inc.', spy)).toBe(false)
    const aapl = findCatalogInstrument('AAPL')!.entry.expected_name
    expect(quoteMatchesIdentity('Apple Inc.', aapl)).toBe(true)
    expect(quoteMatchesIdentity('Stellar AfricaGold Inc.', aapl)).toBe(false)
    for (const id of CATALOG_INSTRUMENT_IDS) {
      expect(isPoisonTicker(id)).toBe(false)
    }
    expect(catalogIdentityError('SPX', 'Stellar AfricaGold Inc.')).toMatch(/refusing SPX/)
    expect(catalogIdentityError('SPY', 'Stellar AfricaGold Inc.')).toMatch(/identity mismatch/)
    expect(catalogIdentityError('SPY', 'SPDR S&P 500 ETF Trust')).toBeNull()
    expect(quoteMatchesIdentity('Platinum Spot / US Dollar', ['Platinum', 'Spot'])).toBe(true)
    expect(catalogIdentityError('XPT/USD', 'Platinum Spot / US Dollar')).toBeNull()
  })

  it('accepts Twelve Data commodity time_series identity via currency_base', () => {
    const xau = resolvedVendorIdentity({
      meta: { currency_base: 'Gold Spot', currency_quote: 'US Dollar', symbol: 'XAU/USD' },
    })
    expect(xau).toBe('Gold Spot / US Dollar')
    expect(catalogIdentityError('XAU/USD', xau, 'XAU/USD')).toBeNull()
    expect(catalogIdentityError('XAG/USD', resolvedVendorIdentity({
      meta: { currency_base: 'Silver Spot', currency_quote: 'US Dollar' },
    }))).toBeNull()
    expect(catalogIdentityError('XPT/USD', resolvedVendorIdentity({
      meta: { currency_base: 'Platinum Spot', currency_quote: 'US Dollar' },
    }))).toBeNull()
  })

  it('accepts a missing display name when the vendor echoed the same ticker', () => {
    expect(catalogIdentityError('GLD', null, 'GLD')).toBeNull()
    expect(catalogIdentityError('GLD', null, 'SLV')).toMatch(/identity mismatch/)
    expect(catalogIdentityError('GLD', null)).toMatch(/missing name/)
  })
})
