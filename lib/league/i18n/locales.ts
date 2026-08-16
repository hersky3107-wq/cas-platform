/**
 * AI Prediction League — i18n locales (Layer A).
 *
 * Scope matches the app's existing locale set (see `lib/landing/content.ts`,
 * `lib/synod/ui-labels.ts`) plus `pt` as a STRUCTURAL STUB: it exists as a
 * type member and has a dictionary entry so Brazil can attach later with zero
 * structural change, but it is not in `LEAGUE_SELECTABLE_LOCALES` (not offered
 * in the language toggle yet) and its dictionary entry currently just spreads
 * English (see `dictionary.ts`).
 */
export const LEAGUE_LOCALES = ['en', 'ko', 'ja', 'zh-TW', 'fr', 'ar', 'es', 'pt'] as const
export type LeagueLocale = (typeof LEAGUE_LOCALES)[number]

/** Locales with a real, filled-in translation (offered in the UI toggle). `pt` is excluded until translated. */
export const LEAGUE_SELECTABLE_LOCALES: readonly LeagueLocale[] = [
  'en',
  'ko',
  'ja',
  'zh-TW',
  'fr',
  'ar',
  'es',
]

export const LEAGUE_RTL_LOCALES: readonly LeagueLocale[] = ['ar']

export function isRtlLocale(locale: LeagueLocale): boolean {
  return LEAGUE_RTL_LOCALES.includes(locale)
}

export function localeDir(locale: LeagueLocale): 'ltr' | 'rtl' {
  return isRtlLocale(locale) ? 'rtl' : 'ltr'
}

/** Normalizes a raw tag (e.g. from a browser, a DB column, an Accept-Language entry) to a known LeagueLocale, or null. */
export function normalizeLeagueLocale(raw: string | null | undefined): LeagueLocale | null {
  if (!raw) return null
  const tag = raw.trim().toLowerCase().replace('_', '-')
  if (!tag) return null
  if (tag.startsWith('ko')) return 'ko'
  if (tag.startsWith('ja')) return 'ja'
  if (tag.startsWith('zh-tw') || tag.startsWith('zh-hk') || tag.includes('hant')) return 'zh-TW'
  // Bare 'zh' (no script/region hint) is ambiguous — do not guess Traditional vs Simplified.
  if (tag.startsWith('fr')) return 'fr'
  if (tag.startsWith('ar')) return 'ar'
  if (tag.startsWith('es')) return 'es'
  if (tag.startsWith('pt')) return 'pt'
  if (tag.startsWith('en')) return 'en'
  return null
}
