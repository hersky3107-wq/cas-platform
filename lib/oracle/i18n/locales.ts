/**
 * Oracle UI locales. Same eight tags as League (`lib/league/i18n/locales.ts`).
 * Profile chrome is keyed per locale; Korean is the filled source of truth
 * until the other packs are translated. Engine terms (오격, 시진, 십신,
 * 성명학, 수비학) stay in Korean in every locale.
 */
export const ORACLE_UI_LOCALES = ['en', 'ko', 'ja', 'zh-TW', 'fr', 'ar', 'es', 'pt'] as const
export type OracleUiLocale = (typeof ORACLE_UI_LOCALES)[number]

export const ORACLE_UI_DEFAULT_LOCALE: OracleUiLocale = 'ko'

export const ORACLE_UI_RTL_LOCALES: readonly OracleUiLocale[] = ['ar']

export function isOracleUiLocale(value: string): value is OracleUiLocale {
  return (ORACLE_UI_LOCALES as readonly string[]).includes(value)
}

export function normalizeOracleUiLocale(raw: string | null | undefined): OracleUiLocale {
  if (!raw) return ORACLE_UI_DEFAULT_LOCALE
  const tag = raw.trim().toLowerCase().replace('_', '-')
  if (!tag) return ORACLE_UI_DEFAULT_LOCALE
  if (tag.startsWith('ko')) return 'ko'
  if (tag.startsWith('ja')) return 'ja'
  if (tag.startsWith('zh-tw') || tag.startsWith('zh-hk') || tag.includes('hant')) return 'zh-TW'
  if (tag.startsWith('fr')) return 'fr'
  if (tag.startsWith('ar')) return 'ar'
  if (tag.startsWith('es')) return 'es'
  if (tag.startsWith('pt')) return 'pt'
  if (tag.startsWith('en')) return 'en'
  return ORACLE_UI_DEFAULT_LOCALE
}
