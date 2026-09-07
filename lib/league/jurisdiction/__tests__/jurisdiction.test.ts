import { describe, expect, it } from 'vitest'
import { groupForCountry } from '../country-groups'
import { isCategoryAllowed, resolveJurisdictionGroups } from '../resolve'
import { isCategoryAllowedForGroup } from '../matrix'
import { JURISDICTION_GROUPS } from '../types'

describe('groupForCountry', () => {
  it('maps known countries to their jurisdiction group', () => {
    expect(groupForCountry('US')).toBe('US')
    expect(groupForCountry('GB')).toBe('UK')
    expect(groupForCountry('KR')).toBe('KR')
    expect(groupForCountry('JP')).toBe('JP')
    expect(groupForCountry('CN')).toBe('CN')
    expect(groupForCountry('FR')).toBe('EU')
    expect(groupForCountry('AE')).toBe('ME')
    expect(groupForCountry('sa')).toBe('ME') // case-insensitive
  })

  it('maps an unrecognized-but-real country to OTHER, and no signal at all to UNKNOWN', () => {
    expect(groupForCountry('BR')).toBe('OTHER')
    expect(groupForCountry(null)).toBe('UNKNOWN')
    expect(groupForCountry(undefined)).toBe('UNKNOWN')
    expect(groupForCountry('')).toBe('UNKNOWN')
  })
})

describe('isCategoryAllowed — default-deny + single-signal cases', () => {
  it('default-denies finance/sports when there is no country signal, but allows tech / ai_models', () => {
    expect(isCategoryAllowed('stock', {})).toBe(false)
    expect(isCategoryAllowed('sports', { declaredCountry: null, ipCountry: null })).toBe(false)
    expect(isCategoryAllowed('tech', {})).toBe(true)
    expect(isCategoryAllowed('ai_models', { declaredCountry: null, ipCountry: null })).toBe(true)
  })

  it('default-denies a category the matrix never explicitly allowed for a known group (CN finance)', () => {
    expect(isCategoryAllowed('stock', { ipCountry: 'CN' })).toBe(false)
    expect(isCategoryAllowed('sports', { declaredCountry: 'CN' })).toBe(false)
    expect(isCategoryAllowed('tech', { ipCountry: 'CN' })).toBe(true)
    expect(isCategoryAllowed('ai_models', { declaredCountry: 'CN' })).toBe(true)
  })

  it('allows an explicitly-listed category for a single known signal', () => {
    expect(isCategoryAllowed('stock', { ipCountry: 'KR' })).toBe(true)
    expect(isCategoryAllowed('crypto_perps', { declaredCountry: 'US' })).toBe(true)
    expect(isCategoryAllowed('real_estate', { ipCountry: 'KR' })).toBe(true)
    expect(isCategoryAllowed('tech', { ipCountry: 'KR' })).toBe(true)
    expect(isCategoryAllowed('ai_models', { ipCountry: 'KR' })).toBe(true)
  })

  it('applies the recorded regional restrictions: crypto_perps off in UK/EU/ME', () => {
    expect(isCategoryAllowed('crypto_perps', { ipCountry: 'GB' })).toBe(false)
    expect(isCategoryAllowed('crypto_perps', { ipCountry: 'FR' })).toBe(false)
    expect(isCategoryAllowed('crypto_perps', { ipCountry: 'AE' })).toBe(false)
  })

  it('applies the recorded regional restrictions: futures_derivatives and politics_election off in ME', () => {
    expect(isCategoryAllowed('futures_derivatives', { ipCountry: 'SA' })).toBe(false)
    expect(isCategoryAllowed('politics_election', { ipCountry: 'SA' })).toBe(false)
    // but a "clean" category is still allowed in ME
    expect(isCategoryAllowed('stock', { ipCountry: 'SA' })).toBe(true)
  })
})

describe('isCategoryAllowed — stricter-of-the-two (declared + IP conflict)', () => {
  it('denies when the declared country allows but the IP country denies (VPN into a laxer jurisdiction does not help)', () => {
    // crypto_perps: US allows, GB denies
    expect(isCategoryAllowed('crypto_perps', { declaredCountry: 'US', ipCountry: 'GB' })).toBe(false)
  })

  it('denies when the IP country allows but the declared country denies', () => {
    expect(isCategoryAllowed('crypto_perps', { declaredCountry: 'GB', ipCountry: 'US' })).toBe(false)
  })

  it('allows only when BOTH signals independently allow the category', () => {
    expect(isCategoryAllowed('crypto_perps', { declaredCountry: 'US', ipCountry: 'KR' })).toBe(true)
  })

  it('a KR-declared user visiting from China mainland is denied stock (China effectively off)', () => {
    expect(isCategoryAllowed('stock', { declaredCountry: 'KR', ipCountry: 'CN' })).toBe(false)
  })
})

describe('resolveJurisdictionGroups mismatch flag', () => {
  it('flags a mismatch only when both signals are present and resolve to different groups', () => {
    expect(resolveJurisdictionGroups({ declaredCountry: 'KR', ipCountry: 'CN' }).mismatch).toBe(true)
    expect(resolveJurisdictionGroups({ declaredCountry: 'KR', ipCountry: 'KR' }).mismatch).toBe(false)
    expect(resolveJurisdictionGroups({ declaredCountry: 'KR', ipCountry: null }).mismatch).toBe(false)
    expect(resolveJurisdictionGroups({}).mismatch).toBe(false)
  })
})

describe('matrix default-deny shape (data-table sanity)', () => {
  it('CN keeps finance/sports/politics off; tech and ai_models are on', () => {
    for (const category of ['stock', 'crypto_spot', 'sports', 'politics_election', 'memecoin']) {
      expect(isCategoryAllowedForGroup('CN', category)).toBe(false)
    }
    expect(isCategoryAllowedForGroup('CN', 'tech')).toBe(true)
    expect(isCategoryAllowedForGroup('CN', 'ai_models')).toBe(true)
  })

  it('tech and ai_models are on in every jurisdiction group', () => {
    for (const group of JURISDICTION_GROUPS) {
      expect(isCategoryAllowedForGroup(group, 'tech'), group).toBe(true)
      expect(isCategoryAllowedForGroup(group, 'ai_models'), group).toBe(true)
    }
  })

  it('an unknown/unlisted category string is denied everywhere, never throws', () => {
    expect(isCategoryAllowedForGroup('US', 'not_a_real_category')).toBe(false)
    expect(isCategoryAllowed('not_a_real_category', { ipCountry: 'US' })).toBe(false)
  })
})
