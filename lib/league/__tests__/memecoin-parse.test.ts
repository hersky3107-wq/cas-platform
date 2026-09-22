import { describe, expect, it } from 'vitest'
import {
  binancePerpSymbol,
  classifyMemecoinInstrument,
  memecoinFieldPlan,
  parseFearGreedJson,
  parseTakerRatio,
  parseTopTraderLs,
} from '../memecoin-parse'

describe('Binance 1000x perp mapping', () => {
  it('maps catalog pairs onto live USDT-M contracts (SHIB/PEPE/BONK are 1000x)', () => {
    expect(binancePerpSymbol('DOGE/USD')).toBe('DOGEUSDT')
    expect(binancePerpSymbol('SHIB/USD')).toBe('1000SHIBUSDT')
    expect(binancePerpSymbol('PEPE/USD')).toBe('1000PEPEUSDT')
    expect(binancePerpSymbol('WIF/USD')).toBe('WIFUSDT')
    expect(binancePerpSymbol('BONK/USD')).toBe('1000BONKUSDT')
    expect(binancePerpSymbol('SHIB/USD')).not.toBe('SHIBUSDT')
    expect(binancePerpSymbol('PEPE/USD')).not.toBe('PEPEUSDT')
    expect(binancePerpSymbol('BONK/USD')).not.toBe('BONKUSDT')
  })

  it('still maps majors used by crypto_spot funding/OI', () => {
    expect(binancePerpSymbol('BTC/USD')).toBe('BTCUSDT')
    expect(binancePerpSymbol('ETH/USD')).toBe('ETHUSDT')
    expect(binancePerpSymbol('SOL/USD')).toBe('SOLUSDT')
    expect(binancePerpSymbol('XRP/USD')).toBe('XRPUSDT')
    expect(binancePerpSymbol('BNB/USD')).toBe('BNBUSDT')
    expect(binancePerpSymbol('ADA/USD')).toBe('ADAUSDT')
  })
})

describe('memecoin field plan isolation', () => {
  it('classifies the five chips and rejects gold/fx', () => {
    expect(classifyMemecoinInstrument('DOGE/USD')).toBe('doge')
    expect(classifyMemecoinInstrument('WIF/USD')).toBe('wif')
    expect(classifyMemecoinInstrument('XAU/USD')).toBeNull()
    expect(memecoinFieldPlan('EUR/USD')).toBeNull()
  })

  it('DOGE/SHIB get BTC+ETH; PEPE gets ETH not SOL; WIF/BONK get SOL not ETH', () => {
    expect(memecoinFieldPlan('DOGE/USD')!.hostMajors).toEqual(['BTC/USD', 'ETH/USD'])
    expect(memecoinFieldPlan('SHIB/USD')!.hostMajors).toEqual(['BTC/USD', 'ETH/USD'])
    expect(memecoinFieldPlan('PEPE/USD')!.hostMajors).toEqual(['ETH/USD'])
    expect(memecoinFieldPlan('PEPE/USD')!.hostMajors).not.toContain('SOL/USD')
    expect(memecoinFieldPlan('WIF/USD')!.hostMajors).toEqual(['SOL/USD', 'BTC/USD'])
    expect(memecoinFieldPlan('BONK/USD')!.hostMajors).toEqual(['SOL/USD', 'BTC/USD'])
    expect(memecoinFieldPlan('WIF/USD')!.hostMajors).not.toContain('ETH/USD')
    expect(memecoinFieldPlan('SHIB/USD')!.binanceSymbol).toBe('1000SHIBUSDT')
  })
})

describe('Fear & Greed + Binance ratio parsers', () => {
  it('parses Alternative.me /fng payload (latest first)', () => {
    const parsed = parseFearGreedJson({
      data: [
        { value: '64', value_classification: 'Greed', timestamp: '1726617600' },
        { value: '58', value_classification: 'Greed', timestamp: '1726531200' },
      ],
    })
    expect(parsed).not.toHaveProperty('unavailable')
    if ('unavailable' in parsed) throw new Error(parsed.unavailable)
    expect(parsed.latest).toMatchObject({ value: 64, classification: 'Greed', date: '2024-09-18' })
    expect(parsed.week).toHaveLength(2)
  })

  it('parses top-trader L/S and taker buy/sell rows', () => {
    const ls = parseTopTraderLs(
      [{ symbol: '1000SHIBUSDT', longShortRatio: '1.25', longAccount: '0.555', shortAccount: '0.445', timestamp: 1726617600000 }],
      '1000SHIBUSDT',
      '1h',
    )
    expect(ls).toMatchObject({
      symbol: '1000SHIBUSDT',
      longShortRatio: 1.25,
      longAccountPct: 55.5,
      shortAccountPct: 44.5,
    })
    const taker = parseTakerRatio(
      [{ buySellRatio: '1.08', buyVol: '1000', sellVol: '900', timestamp: 1726617600000 }],
      'DOGEUSDT',
      '1h',
    )
    expect(taker).toMatchObject({ symbol: 'DOGEUSDT', buySellRatio: 1.08, buyVol: 1000, sellVol: 900 })
  })
})
