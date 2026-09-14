import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  catalogRoundNeedsPriceAnchor,
  decidePriceAnchorGate,
  hasUsableAnchor,
  MARKET_DATA_UNAVAILABLE_CODE,
  propositionNeedsPriceAnchor,
} from '../price-anchor-policy'

describe('propositionNeedsPriceAnchor', () => {
  it('requires an anchor for close-higher and for a missing kind (DB default)', () => {
    expect(propositionNeedsPriceAnchor('binary_close_higher')).toBe(true)
    expect(propositionNeedsPriceAnchor(null)).toBe(true)
    expect(propositionNeedsPriceAnchor(undefined)).toBe(true)
  })

  it('does not require an anchor for subject-outcome or threshold', () => {
    expect(propositionNeedsPriceAnchor('binary_subject_outcome')).toBe(false)
    expect(propositionNeedsPriceAnchor('binary_threshold')).toBe(false)
  })
})

describe('hasUsableAnchor', () => {
  it('accepts a finite number and rejects null/NaN', () => {
    expect(hasUsableAnchor(231.45)).toBe(true)
    expect(hasUsableAnchor(0)).toBe(true)
    expect(hasUsableAnchor(null)).toBe(false)
    expect(hasUsableAnchor(undefined)).toBe(false)
    expect(hasUsableAnchor(Number.NaN)).toBe(false)
  })
})

describe('decidePriceAnchorGate', () => {
  it('fails a price round with no persisted anchor', () => {
    expect(decidePriceAnchorGate({ propositionKind: 'binary_close_higher', anchorPrice: null })).toEqual({
      action: 'fail',
      reason: 'missing_anchor',
    })
  })

  it('proceeds when the price round already has an anchor', () => {
    expect(decidePriceAnchorGate({ propositionKind: 'binary_close_higher', anchorPrice: 305.59 })).toEqual({
      action: 'proceed',
    })
  })

  it('leaves subject-outcome and threshold rounds alone even with no anchor', () => {
    expect(decidePriceAnchorGate({ propositionKind: 'binary_subject_outcome', anchorPrice: null })).toEqual({
      action: 'proceed',
    })
    expect(decidePriceAnchorGate({ propositionKind: 'binary_threshold', anchorPrice: null })).toEqual({
      action: 'proceed',
    })
  })
})

describe('catalog chips', () => {
  it('every catalog ranked open needs a price anchor', () => {
    expect(catalogRoundNeedsPriceAnchor()).toBe(true)
  })
})

describe('POST /api/league/generate charge ordering', () => {
  it('runs ensurePriceRoundAnchor after the press decision and before any deduction or receipt consume', () => {
    const src = readFileSync(join(__dirname, '../../../app/api/league/generate/route.ts'), 'utf8')
    const decision = src.indexOf('const decision = decideGeneratePress')
    const gate = src.indexOf('const anchor = await ensurePriceRoundAnchor')
    const consume = src.indexOf('await consumeGatewayReceipt')
    const deduct = src.indexOf('await deductCreditsBalance')
    expect(decision).toBeGreaterThan(-1)
    expect(gate).toBeGreaterThan(decision)
    expect(consume).toBeGreaterThan(gate)
    expect(deduct).toBeGreaterThan(gate)
    expect(src).toContain(MARKET_DATA_UNAVAILABLE_CODE)
  })
})
