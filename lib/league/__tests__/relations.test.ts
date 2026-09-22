import { describe, expect, it } from 'vitest'
import { relationsFor } from '../relations'

describe('commodities_energy related ETFs', () => {
  it('WTI/USD maps to USO, Brent, XLE, XOP, UUP, VIXY', () => {
    expect(relationsFor('WTI/USD')!.related.map((r) => r.symbol)).toEqual([
      'USO',
      'XBR/USD',
      'XLE',
      'XOP',
      'UUP',
      'VIXY',
    ])
  })

  it('XBR/USD maps to BNO, WTI, XLE, UUP, VIXY', () => {
    expect(relationsFor('XBR/USD')!.related.map((r) => r.symbol)).toEqual([
      'BNO',
      'WTI/USD',
      'XLE',
      'UUP',
      'VIXY',
    ])
  })

  it('UNG maps to WTI, BOIL, KOLD, XLE, UUP', () => {
    expect(relationsFor('UNG')!.related.map((r) => r.symbol)).toEqual([
      'WTI/USD',
      'BOIL',
      'KOLD',
      'XLE',
      'UUP',
    ])
  })

  it('CPER maps to COPX, FCX, XLB, UUP, VIXY — not EIA crude peers', () => {
    expect(relationsFor('CPER')!.related.map((r) => r.symbol)).toEqual(['COPX', 'FCX', 'XLB', 'UUP', 'VIXY'])
  })

  it('grains map to sibling grain ETFs + DBA + UUP', () => {
    expect(relationsFor('CORN')!.related.map((r) => r.symbol)).toEqual(['WEAT', 'SOYB', 'DBA', 'UUP'])
    expect(relationsFor('WEAT')!.related.map((r) => r.symbol)).toEqual(['CORN', 'SOYB', 'DBA', 'UUP'])
    expect(relationsFor('SOYB')!.related.map((r) => r.symbol)).toEqual(['CORN', 'WEAT', 'DBA', 'UUP'])
  })

  it('COFF maps to DBA + UUP (JO is delisted)', () => {
    expect(relationsFor('COFF')!.related.map((r) => r.symbol)).toEqual(['DBA', 'UUP'])
    expect(relationsFor('JO')).toBeNull()
  })

  it('does not drop gold_metal TAN / GLD relations', () => {
    expect(relationsFor('XAG/USD')!.related.map((r) => r.symbol)).toContain('TAN')
    expect(relationsFor('XAU/USD')!.related.map((r) => r.symbol)).toContain('GLD')
  })
})

describe('fx related ETFs', () => {
  it('EUR/USD maps to FXE, EZU, GBP/USD, UUP, VIXY', () => {
    expect(relationsFor('EUR/USD')!.related.map((r) => r.symbol)).toEqual(['FXE', 'EZU', 'GBP/USD', 'UUP', 'VIXY'])
  })

  it('USD/JPY maps to FXY, EWJ, UUP, TLT, USD/KRW', () => {
    expect(relationsFor('USD/JPY')!.related.map((r) => r.symbol)).toEqual(['FXY', 'EWJ', 'UUP', 'TLT', 'USD/KRW'])
  })

  it('USD/KRW maps to EWY plus Asia dollar peers and UUP', () => {
    expect(relationsFor('USD/KRW')!.related.map((r) => r.symbol)).toEqual(['EWY', 'USD/JPY', 'USD/CNH', 'UUP'])
  })

  it('crosses map to both legs’ ETFs and omit UUP', () => {
    expect(relationsFor('JPY/KRW')!.related.map((r) => r.symbol)).toEqual(['EWY', 'EWJ', 'USD/KRW', 'USD/JPY'])
    expect(relationsFor('EUR/JPY')!.related.map((r) => r.symbol)).toEqual(['FXE', 'FXY', 'EUR/USD', 'USD/JPY'])
    expect(relationsFor('GBP/JPY')!.related.map((r) => r.symbol)).toEqual(['FXB', 'FXY', 'GBP/USD', 'USD/JPY'])
    expect(relationsFor('JPY/KRW')!.related.map((r) => r.symbol)).not.toContain('UUP')
    expect(relationsFor('EUR/JPY')!.asiaLinks).toEqual(['ja'])
    expect(relationsFor('JPY/KRW')!.asiaLinks).toEqual(['ko', 'ja'])
  })

  it('GBP/USD, USD/CNH, AUD/USD are catalogued', () => {
    expect(relationsFor('GBP/USD')!.related.map((r) => r.symbol)).toEqual(['FXB', 'EUR/USD', 'UUP', 'VIXY'])
    expect(relationsFor('USD/CNH')!.related.map((r) => r.symbol)).toEqual(['USD/KRW', 'USD/JPY', 'UUP'])
    expect(relationsFor('AUD/USD')!.related.map((r) => r.symbol)).toEqual(['USD/CNH', 'USD/JPY', 'UUP'])
  })
})

describe('index_etf related ETFs', () => {
  it('SPY includes XLF; QQQ includes SMH+XLK', () => {
    expect(relationsFor('SPY')!.related.map((r) => r.symbol)).toEqual(['QQQ', 'XLF', 'VIXY', 'TLT', 'HYG', 'UUP'])
    expect(relationsFor('QQQ')!.related.map((r) => r.symbol)).toEqual(['SPY', 'SMH', 'XLK', 'VIXY', 'TLT'])
  })

  it('leverage isolation: TQQQ/SQQQ stay on Nasdaq peers; UPRO/SPXU stay on S&P; SOXL stays on semis', () => {
    expect(relationsFor('TQQQ')!.related.map((r) => r.symbol)).toEqual(['QQQ', 'SMH', 'XLK', 'VIXY'])
    expect(relationsFor('SQQQ')!.related.map((r) => r.symbol)).toEqual(['QQQ', 'SMH', 'XLK', 'VIXY'])
    expect(relationsFor('TQQQ')!.related.map((r) => r.symbol)).not.toContain('SPY')
    expect(relationsFor('UPRO')!.related.map((r) => r.symbol)).toEqual(['SPY', 'XLF', 'VIXY', 'TLT'])
    expect(relationsFor('SPXU')!.related.map((r) => r.symbol)).toEqual(['SPY', 'XLF', 'VIXY', 'TLT'])
    expect(relationsFor('UPRO')!.related.map((r) => r.symbol)).not.toContain('QQQ')
    expect(relationsFor('SOXL')!.related.map((r) => r.symbol)).toEqual(['SMH', 'SOXS', 'XLK', 'VIXY'])
    expect(relationsFor('SOXL')!.related.map((r) => r.symbol)).not.toContain('SPY')
    expect(relationsFor('SOXL')!.related.map((r) => r.symbol)).not.toContain('QQQ')
  })

  it('country ETFs keep regional peers and asia links', () => {
    expect(relationsFor('EWJ')!.related.map((r) => r.symbol)).toEqual(['FXY', 'USD/JPY', 'VIXY', 'TLT'])
    expect(relationsFor('EWJ')!.asiaLinks).toEqual(['ja'])
    expect(relationsFor('EWY')!.asiaLinks).toEqual(['ko'])
    expect(relationsFor('EWT')!.asiaLinks).toEqual(['zh'])
    expect(relationsFor('FEZ')!.related.map((r) => r.symbol)).toContain('EZU')
  })
})

describe('crypto major related isolation', () => {
  it('BTC keeps QQQ/GLD/UUP/VIXY; ETH keeps BTC/SOL; SOL/XRP/BNB are BTC/ETH beta', () => {
    expect(relationsFor('BTC/USD')!.related.map((r) => r.symbol)).toEqual([
      'ETH/USD',
      'QQQ',
      'VIXY',
      'UUP',
      'GLD',
    ])
    expect(relationsFor('ETH/USD')!.related.map((r) => r.symbol)).toEqual(['BTC/USD', 'SOL/USD', 'QQQ', 'UUP'])
    expect(relationsFor('SOL/USD')!.related.map((r) => r.symbol)).toEqual(['BTC/USD', 'ETH/USD', 'VIXY'])
    expect(relationsFor('XRP/USD')!.related.map((r) => r.symbol)).toEqual(['BTC/USD', 'ETH/USD', 'VIXY'])
    expect(relationsFor('BNB/USD')!.related.map((r) => r.symbol)).toEqual(['BTC/USD', 'ETH/USD', 'VIXY'])
    expect(relationsFor('XRP/USD')!.related.map((r) => r.symbol)).not.toContain('SOL/USD')
    expect(relationsFor('BNB/USD')!.related.map((r) => r.symbol)).not.toContain('QQQ')
  })
})

describe('memecoin related isolation', () => {
  it('DOGE/SHIB keep BTC+ETH; PEPE is ETH not SOL; WIF/BONK are SOL not ETH', () => {
    expect(relationsFor('DOGE/USD')!.related.map((r) => r.symbol)).toEqual(['BTC/USD', 'ETH/USD', 'SHIB/USD', 'VIXY'])
    expect(relationsFor('SHIB/USD')!.related.map((r) => r.symbol)).toEqual(['BTC/USD', 'ETH/USD', 'DOGE/USD'])
    expect(relationsFor('PEPE/USD')!.related.map((r) => r.symbol)).toEqual(['ETH/USD', 'DOGE/USD', 'VIXY'])
    expect(relationsFor('PEPE/USD')!.related.map((r) => r.symbol)).not.toContain('SOL/USD')
    expect(relationsFor('WIF/USD')!.related.map((r) => r.symbol)).toEqual(['SOL/USD', 'BTC/USD', 'BONK/USD', 'VIXY'])
    expect(relationsFor('BONK/USD')!.related.map((r) => r.symbol)).toEqual(['SOL/USD', 'BTC/USD', 'WIF/USD', 'VIXY'])
    expect(relationsFor('WIF/USD')!.related.map((r) => r.symbol)).not.toContain('ETH/USD')
    expect(relationsFor('BONK/USD')!.related.map((r) => r.symbol)).not.toContain('ETH/USD')
  })
})
