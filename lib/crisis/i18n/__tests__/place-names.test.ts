import { describe, expect, it } from 'vitest'
import { countryDisplayName, regionDisplayName } from '../place-names'

describe('localized place names', () => {
  it('uses Intl.DisplayNames for countries and keeps the admin1 original', () => {
    const turkeyKo = countryDisplayName('TUR', 'ko', 'Turkey')
    expect(['튀르키예', '터키']).toContain(turkeyKo)
    expect(countryDisplayName('GBR', 'en', 'United Kingdom')).toMatch(/United Kingdom|Britain/)
    expect(regionDisplayName('Istanbul', 'TUR', 'ko', 'Turkey')).toBe(`Istanbul · ${turkeyKo}`)
    expect(regionDisplayName('Spain', 'ESP', 'ko', 'Spain')).toBe(countryDisplayName('ESP', 'ko', 'Spain'))
  })
})
