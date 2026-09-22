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
