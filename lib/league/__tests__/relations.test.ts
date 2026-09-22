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

  it('does not drop gold_metal TAN / GLD relations', () => {
    expect(relationsFor('XAG/USD')!.related.map((r) => r.symbol)).toContain('TAN')
    expect(relationsFor('XAU/USD')!.related.map((r) => r.symbol)).toContain('GLD')
  })
})
