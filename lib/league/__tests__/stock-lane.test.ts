import { describe, expect, it } from 'vitest'
import { admissionStockLane, isGlobalStockInstrument } from '../stock-lane'
import { encodeStockInstrument } from '../gateway/adapters/stock-catalog'

describe('admissionStockLane', () => {
  it('sends either Korean signal alone to the Korea lane', () => {
    expect(admissionStockLane({ declaredCountry: 'KR', ipCountry: 'US' })).toBe('korea')
    expect(admissionStockLane({ declaredCountry: 'US', ipCountry: 'KR' })).toBe('korea')
    expect(admissionStockLane({ declaredCountry: 'KR', ipCountry: null })).toBe('korea')
    expect(admissionStockLane({ declaredCountry: null, ipCountry: 'KR' })).toBe('korea')
  })

  it('sends everyone else to the global lane', () => {
    expect(admissionStockLane({ declaredCountry: 'US', ipCountry: 'US' })).toBe('global')
    expect(admissionStockLane({ declaredCountry: 'JP', ipCountry: 'JP' })).toBe('global')
    expect(admissionStockLane({ declaredCountry: null, ipCountry: null })).toBe('global')
    expect(admissionStockLane({ declaredCountry: 'US', ipCountry: null })).toBe('global')
  })

  it('treats catalog tickers and STOCK: rows as the global listing', () => {
    expect(isGlobalStockInstrument('AAPL')).toBe(true)
    expect(isGlobalStockInstrument(encodeStockInstrument({ exchange: 'NASDAQ', symbol: 'MSFT' })!)).toBe(true)
    expect(isGlobalStockInstrument('BTC/USD')).toBe(false)
    expect(isGlobalStockInstrument('XAU/USD')).toBe(false)
  })
})
