/**
 * View-time rationale glossary. "base rate" is a historical frequency, never
 * a policy interest rate. SMA is a moving average when the locale translates it.
 *
 * The base-rate gloss depends on the round: price categories count how often
 * the price rose; every other category counts how often the event happened.
 */

import type { LeagueLocale } from './i18n/locales'

const BASE_RATE = /\bbase\s+rates?\b/i

/** Korean mistranslation of "base rate" as the policy interest rate. */
export const KO_BASE_RATE_INTEREST = '기준 금리'

export const KO_BASE_RATE_GLOSS = '기저율(과거 같은 기간 상승 비율)'
export const KO_BASE_RATE_GLOSS_OCCURRENCE = '기저율(과거 같은 기간 발생 비율)'

/** Ledger categories whose outcome is a price (or price index) going up or down. */
const PRICE_CATEGORIES = new Set<string>([
  'stock',
  'etf_index',
  'bond_rate',
  'gold_metal',
  'macro_econ',
  'commodity_energy',
  'crypto_spot',
  'crypto_perps',
  'fx',
  'futures_derivatives',
  'memecoin',
  'real_estate',
])

export function isPriceBaseRateCategory(category?: string | null): boolean {
  return !!category && PRICE_CATEGORIES.has(category)
}

type GlossaryRow = {
  baseRatePrice: string
  baseRateOccurrence: string
  /** Text only the price gloss contains; a cached non-price translation holding it is stale. */
  priceMarker: string
  sma: string
  neverInterest: string
}

const GLOSSARY: Record<Exclude<LeagueLocale, 'en'>, GlossaryRow> = {
  ko: {
    baseRatePrice: KO_BASE_RATE_GLOSS,
    baseRateOccurrence: KO_BASE_RATE_GLOSS_OCCURRENCE,
    priceMarker: '같은 기간 상승 비율',
    sma: '이동평균선',
    neverInterest: 'Never write 기준 금리 for "base rate".',
  },
  ja: {
    baseRatePrice: 'ベースレート（過去の同期間で上昇した割合）',
    baseRateOccurrence: 'ベースレート（過去の同期間で起きた割合）',
    priceMarker: '同期間で上昇した割合',
    sma: '移動平均線',
    neverInterest: 'Never translate "base rate" as 政策金利 or 基準金利.',
  },
  'zh-TW': {
    baseRatePrice: '基準機率（過去同期上漲比例）',
    baseRateOccurrence: '基準機率（過去同期發生比例）',
    priceMarker: '過去同期上漲比例',
    sma: '移動平均線',
    neverInterest: 'Never translate "base rate" as a central-bank policy rate (基準利率).',
  },
  fr: {
    baseRatePrice: 'taux de base (part des hausses sur la même période passée)',
    baseRateOccurrence: 'taux de base (part des cas survenus sur la même période passée)',
    priceMarker: 'part des hausses sur la même période passée',
    sma: 'moyenne mobile',
    neverInterest: 'Never translate "base rate" as a taux directeur / interest rate.',
  },
  es: {
    baseRatePrice: 'tasa base (proporción de subidas en el mismo periodo pasado)',
    baseRateOccurrence: 'tasa base (proporción de casos ocurridos en el mismo periodo pasado)',
    priceMarker: 'proporción de subidas en el mismo periodo pasado',
    sma: 'media móvil',
    neverInterest: 'Never translate "base rate" as a tasa de interés / tipo oficial.',
  },
  ar: {
    baseRatePrice: 'المعدل الأساسي (نسبة الارتفاع في الفترة المماثلة سابقًا)',
    baseRateOccurrence: 'المعدل الأساسي (نسبة الحدوث في الفترة المماثلة سابقًا)',
    priceMarker: 'نسبة الارتفاع في الفترة المماثلة',
    sma: 'المتوسط المتحرك',
    neverInterest: 'Never translate "base rate" as an interest rate (سعر الفائدة).',
  },
  pt: {
    baseRatePrice: 'taxa-base (parcela de altas no mesmo período passado)',
    baseRateOccurrence: 'taxa-base (parcela de ocorrências no mesmo período passado)',
    priceMarker: 'parcela de altas no mesmo período passado',
    sma: 'média móvel',
    neverInterest: 'Never translate "base rate" as a taxa de juros.',
  },
}

/** Locale gloss for "base rate" on this category; null for English (no translation step). */
export function baseRateGloss(locale: LeagueLocale, category?: string | null): string | null {
  if (locale === 'en') return null
  const row = GLOSSARY[locale]
  return isPriceBaseRateCategory(category) ? row.baseRatePrice : row.baseRateOccurrence
}

export function rationaleTranslationGlossary(locale: LeagueLocale, category?: string | null): string {
  if (locale === 'en') return ''
  const row = GLOSSARY[locale]
  const meaning = isPriceBaseRateCategory(category)
    ? 'how often the price rose over the same span in the past'
    : 'how often this kind of event happened over the same span in the past'
  return [
    'Glossary (required):',
    `- "base rate" means ${meaning}. Translate it as: ${baseRateGloss(locale, category)}. ${row.neverInterest}`,
    `- "SMA" / "simple moving average" translates as: ${row.sma}. Keep the window number (SMA50 → 50 ${row.sma}).`,
  ].join('\n')
}

/** True when a Korean translation turned "base rate" into the policy interest rate. */
export function rejectsBaseRateMistranslation(
  source: string,
  translated: string,
  locale: LeagueLocale,
): boolean {
  if (locale !== 'ko') return false
  if (!BASE_RATE.test(source)) return false
  return translated.includes(KO_BASE_RATE_INTEREST)
}

/** True when a non-price round's translation carries the price-rise gloss. */
export function hasWrongBaseRateGloss(translated: string, locale: LeagueLocale, category?: string | null): boolean {
  if (locale === 'en' || isPriceBaseRateCategory(category)) return false
  return translated.includes(GLOSSARY[locale].priceMarker)
}
