import { describe, expect, it } from 'vitest'
import { LEAGUE_LOCALES, LEAGUE_SELECTABLE_LOCALES, isRtlLocale, localeDir, normalizeLeagueLocale } from '../locales'
import { LEAGUE_UI, getLeagueUiPack } from '../dictionary'
import { resolveLeagueLocale } from '../resolve-locale'

describe('normalizeLeagueLocale', () => {
  it('maps common Accept-Language / navigator.language style tags to known locales', () => {
    expect(normalizeLeagueLocale('ko-KR')).toBe('ko')
    expect(normalizeLeagueLocale('ja')).toBe('ja')
    expect(normalizeLeagueLocale('zh-TW')).toBe('zh-TW')
    expect(normalizeLeagueLocale('zh-Hant-TW')).toBe('zh-TW')
    expect(normalizeLeagueLocale('fr-FR')).toBe('fr')
    expect(normalizeLeagueLocale('ar-SA')).toBe('ar')
    expect(normalizeLeagueLocale('es-MX')).toBe('es')
    expect(normalizeLeagueLocale('pt-BR')).toBe('pt')
    expect(normalizeLeagueLocale('en-US')).toBe('en')
  })

  it('returns null for unrecognized or empty input, never throws', () => {
    expect(normalizeLeagueLocale(null)).toBeNull()
    expect(normalizeLeagueLocale(undefined)).toBeNull()
    expect(normalizeLeagueLocale('')).toBeNull()
    expect(normalizeLeagueLocale('de-DE')).toBeNull()
  })

  it('does not guess a Chinese script variant from a bare "zh" tag', () => {
    expect(normalizeLeagueLocale('zh')).toBeNull()
  })
})

describe('resolveLeagueLocale (priority order)', () => {
  it('prefers the logged-in profile locale over everything else', () => {
    const locale = resolveLeagueLocale({ profileLocale: 'ko', acceptLanguage: 'fr-FR', ipCountry: 'JP' })
    expect(locale).toBe('ko')
  })

  it('falls back to Accept-Language when there is no profile preference', () => {
    const locale = resolveLeagueLocale({ profileLocale: null, acceptLanguage: 'fr-FR,fr;q=0.9,en;q=0.8', ipCountry: 'JP' })
    expect(locale).toBe('fr')
  })

  it('falls back to an IP-region hint when Accept-Language is absent/unparseable', () => {
    const locale = resolveLeagueLocale({ profileLocale: null, acceptLanguage: null, ipCountry: 'KR' })
    expect(locale).toBe('ko')
  })

  it('defaults to English when no signal resolves to anything', () => {
    const locale = resolveLeagueLocale({ profileLocale: null, acceptLanguage: null, ipCountry: null })
    expect(locale).toBe('en')
    const locale2 = resolveLeagueLocale({ profileLocale: null, acceptLanguage: 'de-DE', ipCountry: 'DE' })
    expect(locale2).toBe('en')
  })
})

describe('RTL handling', () => {
  it('flags only Arabic as RTL among the current locale set', () => {
    for (const locale of LEAGUE_LOCALES) {
      expect(isRtlLocale(locale)).toBe(locale === 'ar')
      expect(localeDir(locale)).toBe(locale === 'ar' ? 'rtl' : 'ltr')
    }
  })
})

describe('dictionary completeness', () => {
  it('has a dictionary entry for every locale, including the pt stub', () => {
    for (const locale of LEAGUE_LOCALES) {
      expect(LEAGUE_UI[locale]).toBeDefined()
      expect(getLeagueUiPack(locale).disclaimer.short.length).toBeGreaterThan(0)
      expect(getLeagueUiPack(locale).disclaimer.long.length).toBeGreaterThan(0)
    }
  })

  it('excludes the pt stub from the selectable (toggle) locale list', () => {
    expect(LEAGUE_SELECTABLE_LOCALES).not.toContain('pt')
    expect(LEAGUE_LOCALES).toContain('pt')
  })

  it('pt currently mirrors English verbatim (structural stub, not yet translated)', () => {
    expect(LEAGUE_UI.pt).toEqual(LEAGUE_UI.en)
  })

  it('falls back to English for an unrecognized key via getLeagueUiPack', () => {
    // @ts-expect-error deliberately passing a bad key to exercise the fallback
    expect(getLeagueUiPack('xx')).toBe(LEAGUE_UI.en)
  })

  it('every real (non-stub) locale renders a distinct, non-empty consensus headline', () => {
    const seen = new Set<string>()
    for (const locale of LEAGUE_SELECTABLE_LOCALES) {
      const headline = LEAGUE_UI[locale].headline.majority(6, 8, 'up', 58)
      expect(headline.length).toBeGreaterThan(0)
      seen.add(headline)
    }
    // en/ko/ja/zh-TW/fr/ar/es should all read differently
    expect(seen.size).toBe(LEAGUE_SELECTABLE_LOCALES.length)
  })
})
