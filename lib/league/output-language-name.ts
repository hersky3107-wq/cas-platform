import type { LeagueLocale } from './i18n/locales'

/** Client-safe: the per-hop language lock (AsyncLocalStorage) lives in deep-output-language. */
export const OUTPUT_LANGUAGE_NAME: Record<LeagueLocale, string> = {
  en: 'English',
  ko: 'Korean',
  ja: 'Japanese',
  'zh-TW': 'Traditional Chinese',
  fr: 'French',
  ar: 'Arabic',
  es: 'Spanish',
  pt: 'Portuguese',
}
