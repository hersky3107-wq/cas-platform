/**
 * View-time rationale glossary. "base rate" is a historical frequency, never
 * a policy interest rate. SMA is a moving average when the locale translates it.
 */

import type { LeagueLocale } from './i18n/locales'

const BASE_RATE = /\bbase\s+rates?\b/i

/** Korean mistranslation of "base rate" as the policy interest rate. */
export const KO_BASE_RATE_INTEREST = '기준 금리'

export const KO_BASE_RATE_GLOSS = '기저율(과거 같은 기간 상승 비율)'

const GLOSSARY: Record<Exclude<LeagueLocale, 'en'>, { baseRate: string; sma: string; neverInterest: string }> = {
  ko: {
    baseRate: KO_BASE_RATE_GLOSS,
    sma: '이동평균선',
    neverInterest: 'Never write 기준 금리 for "base rate".',
  },
  ja: {
    baseRate: 'ベースレート（過去の同期間で上昇した割合）',
    sma: '移動平均線',
    neverInterest: 'Never translate "base rate" as 政策金利 or 基準金利.',
  },
  'zh-TW': {
    baseRate: '基準機率（過去同期上漲比例）',
    sma: '移動平均線',
    neverInterest: 'Never translate "base rate" as a central-bank policy rate (基準利率).',
  },
  fr: {
    baseRate: 'taux de base (part des hausses sur la même période passée)',
    sma: 'moyenne mobile',
    neverInterest: 'Never translate "base rate" as a taux directeur / interest rate.',
  },
  es: {
    baseRate: 'tasa base (proporción de subidas en el mismo periodo pasado)',
    sma: 'media móvil',
    neverInterest: 'Never translate "base rate" as a tasa de interés / tipo oficial.',
  },
  ar: {
    baseRate: 'المعدل الأساسي (نسبة الارتفاع في الفترة المماثلة سابقًا)',
    sma: 'المتوسط المتحرك',
    neverInterest: 'Never translate "base rate" as an interest rate (سعر الفائدة).',
  },
  pt: {
    baseRate: 'taxa-base (parcela de altas no mesmo período passado)',
    sma: 'média móvel',
    neverInterest: 'Never translate "base rate" as a taxa de juros.',
  },
}

export function rationaleTranslationGlossary(locale: LeagueLocale): string {
  if (locale === 'en') return ''
  const row = GLOSSARY[locale]
  return [
    'Glossary (required):',
    `- "base rate" means how often this kind of outcome happened before. Translate it as: ${row.baseRate}. ${row.neverInterest}`,
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
