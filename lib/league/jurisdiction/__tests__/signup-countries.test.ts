import { describe, expect, it } from 'vitest'
import {
  SIGNUP_COUNTRY_CODES,
  SIGNUP_COUNTRY_LABELS,
  getSignupCountryLabel,
  normalizeSignupCountry,
} from '../signup-countries'

describe('signup-countries', () => {
  it('contains expected list of ISO codes and matches labels table', () => {
    expect(SIGNUP_COUNTRY_CODES.length).toBe(44)
    for (const code of SIGNUP_COUNTRY_CODES) {
      expect(SIGNUP_COUNTRY_LABELS[code]).toBeDefined()
      expect(SIGNUP_COUNTRY_LABELS[code].ko).toContain(code)
      expect(SIGNUP_COUNTRY_LABELS[code].en).toContain(code)
    }
  })

  it('normalizes valid country codes and rejects invalid ones', () => {
    expect(normalizeSignupCountry('kr')).toBe('KR')
    expect(normalizeSignupCountry('US ')).toBe('US')
    expect(normalizeSignupCountry('jp')).toBe('JP')
    expect(normalizeSignupCountry('XX')).toBeNull()
    expect(normalizeSignupCountry('')).toBeNull()
    expect(normalizeSignupCountry(null)).toBeNull()
    expect(normalizeSignupCountry(123)).toBeNull()
  })

  it('returns localized country labels with fallback', () => {
    expect(getSignupCountryLabel('KR', 'ko')).toBe('대한민국 (KR)')
    expect(getSignupCountryLabel('KR', 'en')).toBe('South Korea (KR)')
    expect(getSignupCountryLabel('KR', 'ja')).toBe('韓国 (KR)')
    expect(getSignupCountryLabel('US', 'ko')).toBe('미국 (US)')
    expect(getSignupCountryLabel('US', 'en')).toBe('United States (US)')
    expect(getSignupCountryLabel('JP', 'ko')).toBe('일본 (JP)')
    expect(getSignupCountryLabel('JP', 'en')).toBe('Japan (JP)')
  })
})
