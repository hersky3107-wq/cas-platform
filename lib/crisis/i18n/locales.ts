/**
 * CrisisWatch reuses the league locale set and normalizer so one language
 * vocabulary is shared across the app. Crisis resolution order is its own:
 * saved toggle > Accept-Language > IP country > en.
 */
export {
  LEAGUE_LOCALES as CRISIS_LOCALES,
  LEAGUE_SELECTABLE_LOCALES as CRISIS_SELECTABLE_LOCALES,
  isRtlLocale,
  localeDir,
  normalizeLeagueLocale as normalizeCrisisLocale,
  type LeagueLocale as CrisisLocale,
} from '@/lib/league/i18n/locales'

export const CRISIS_LANG_COOKIE = 'crisis_lang'
export const CRISIS_LANG_STORAGE = 'crisis_lang'

export const CRISIS_LOCALE_NAMES: Record<string, string> = {
  en: 'English',
  ko: '한국어',
  ja: '日本語',
  'zh-TW': '繁體中文',
  fr: 'Français',
  ar: 'العربية',
  es: 'Español',
  pt: 'Português',
}
