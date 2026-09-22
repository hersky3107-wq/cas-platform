import { describe, expect, it } from 'vitest'
import {
  classifyCryptoMajorInstrument,
  cryptoMajorFieldPlan,
  cryptoSpotEtfTickers,
  parseBlockchainChart,
  parseCoinGeckoGlobal,
  parseMempoolDifficulty,
  parseMempoolFees,
} from '../crypto-parse'
import { binancePerpSymbol } from '../memecoin-parse'

describe('crypto major isolation', () => {
  it('classifies the five catalog chips and rejects memecoins/gold', () => {
    expect(classifyCryptoMajorInstrument('BTC/USD')).toBe('btc')
    expect(classifyCryptoMajorInstrument('ETH/USD')).toBe('eth')
    expect(classifyCryptoMajorInstrument('SOL/USD')).toBe('sol')
    expect(classifyCryptoMajorInstrument('XRP/USD')).toBe('xrp')
    expect(classifyCryptoMajorInstrument('BNB/USD')).toBe('bnb')
    expect(classifyCryptoMajorInstrument('DOGE/USD')).toBeNull()
    expect(classifyCryptoMajorInstrument('XAU/USD')).toBeNull()
  })

  it('maps all five onto 1:1 Binance USDT-M (no 1000x)', () => {
    expect(binancePerpSymbol('XRP/USD')).toBe('XRPUSDT')
    expect(binancePerpSymbol('BNB/USD')).toBe('BNBUSDT')
    expect(cryptoMajorFieldPlan('XRP/USD')!.binanceSymbol).toBe('XRPUSDT')
    expect(cryptoMajorFieldPlan('BNB/USD')!.binanceSymbol).toBe('BNBUSDT')
  })

  it('BTC gets on-chain + dominance + IBIT/FBTC; ETH gets ETH dominance + ETHA; SOL/XRP/BNB skip both', () => {
    const btc = cryptoMajorFieldPlan('BTC/USD')!
    expect(btc.onChainBtc).toBe(true)
    expect(btc.btcDominance).toBe(true)
    expect(btc.ethDominance).toBe(false)
    expect(btc.deribitIv).toBe(true)
    expect(btc.etfTickers).toEqual(['IBIT', 'FBTC'])
    expect(btc.farsideEth).toBe(false)
    expect(cryptoSpotEtfTickers('BTC/USD')).toEqual(['IBIT', 'FBTC'])

    const eth = cryptoMajorFieldPlan('ETH/USD')!
    expect(eth.onChainBtc).toBe(false)
    expect(eth.ethDominance).toBe(true)
    expect(eth.btcDominance).toBe(false)
    expect(eth.deribitIv).toBe(true)
    expect(eth.etfTickers).toEqual(['ETHA'])
    expect(eth.farsideEth).toBe(true)

    for (const id of ['SOL/USD', 'XRP/USD', 'BNB/USD'] as const) {
      const plan = cryptoMajorFieldPlan(id)!
      expect(plan.onChainBtc, id).toBe(false)
      expect(plan.btcDominance, id).toBe(false)
      expect(plan.ethDominance, id).toBe(false)
      expect(plan.etfTickers, id).toEqual([])
      expect(plan.farsideEth, id).toBe(false)
    }
    expect(cryptoMajorFieldPlan('SOL/USD')!.deribitIv).toBe(true)
    expect(cryptoMajorFieldPlan('XRP/USD')!.deribitIv).toBe(false)
    expect(cryptoMajorFieldPlan('BNB/USD')!.deribitIv).toBe(false)
  })
})

describe('free on-chain / dominance parsers', () => {
  it('parses blockchain.info chart last point', () => {
    const parsed = parseBlockchainChart(
      {
        unit: 'TH/s',
        values: [
          { x: 1726531200, y: 100 },
          { x: 1726617600, y: 720.5 },
        ],
      },
      'hash-rate',
    )
    expect(parsed).toMatchObject({ date: '2024-09-18', value: 720.5, unit: 'TH/s' })
  })

  it('parses mempool difficulty + fees', () => {
    const adj = parseMempoolDifficulty({
      progressPercent: 45.2,
      difficultyChange: 2.1,
      estimatedRetargetDate: 1726617600000,
      remainingBlocks: 1100,
    })
    expect(adj).toMatchObject({
      progressPct: 45.2,
      changePct: 2.1,
      remainingBlocks: 1100,
    })
    if ('unavailable' in adj) throw new Error(adj.unavailable)
    expect(adj.estimatedDate).toBe('2024-09-18T00:00:00.000Z')

    const fees = parseMempoolFees({ fastestFee: 8, halfHourFee: 5, hourFee: 3, economyFee: 1 })
    expect(fees).toMatchObject({ fastest: 8, halfHour: 5, hour: 3, economy: 1, unit: 'sat/vB' })
  })

  it('parses CoinGecko global dominance', () => {
    const parsed = parseCoinGeckoGlobal({
      data: { market_cap_percentage: { btc: 57.2, eth: 12.4 }, updated_at: 1726617600 },
    })
    expect(parsed).toMatchObject({ date: '2024-09-18', btcPct: 57.2, ethPct: 12.4 })
  })
})
