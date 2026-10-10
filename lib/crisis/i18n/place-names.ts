import { ISO2_TO_ISO3 } from '@/lib/crisis/ingest/iso'
import type { CrisisLocale } from './locales'

const ISO3_TO_ISO2 = new Map(Object.entries(ISO2_TO_ISO3).map(([iso2, iso3]) => [iso3, iso2]))

const INTL_LOCALE: Record<CrisisLocale, string> = {
  en: 'en',
  ko: 'ko',
  ja: 'ja',
  'zh-TW': 'zh-Hant',
  fr: 'fr',
  ar: 'ar',
  es: 'es',
  pt: 'pt',
}

export function iso3ToIso2(iso3: string | null | undefined): string | null {
  if (!iso3) return null
  return ISO3_TO_ISO2.get(iso3.trim().toUpperCase()) ?? null
}

export function countryDisplayName(
  iso3: string | null | undefined,
  locale: CrisisLocale,
  fallback: string,
): string {
  const iso2 = iso3ToIso2(iso3)
  if (!iso2) return fallback
  try {
    return new Intl.DisplayNames([INTL_LOCALE[locale] ?? locale], { type: 'region' }).of(iso2) ?? fallback
  } catch {
    return fallback
  }
}

/** Admin1 keeps its original name; country is shown in the UI language. */
export function regionDisplayName(
  name: string,
  iso3: string | null | undefined,
  locale: CrisisLocale,
  fallbackCountry: string,
): string {
  const country = countryDisplayName(iso3, locale, fallbackCountry)
  if (!country) return name
  if (name === country || name === fallbackCountry) return country
  return `${name} · ${country}`
}
