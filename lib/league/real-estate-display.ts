/**
 * Card copy for PROPERTY:... The stored proposition is already Korean.
 * The headline must not show the raw instrument id.
 */

import type { LeagueLocale } from './i18n/locales'
import { decodePropertyInstrument, formatPropertyProposition, propertyHeadlineLabel } from './gateway/adapters/real-estate-catalog'

export function propertyInstrumentDisplay(instrument: string, locale: LeagueLocale): string | null {
  return propertyHeadlineLabel(instrument, locale === 'ko' ? 'ko' : 'en')
}

export function propertyPropositionDisplay(instrument: string, stored: string, locale: LeagueLocale): string {
  const parts = decodePropertyInstrument(instrument) ?? decodePropertyInstrument(stored)
  if (!parts) return stored
  if (locale === 'ko') return formatPropertyProposition(parts)
  const name = parts.region.nameEn
  const pub = new Date(parts.resolvesAtMs).toISOString().slice(0, 10)
  const change = parts.region.cadence === 'quarter' ? 'quarter-on-quarter' : 'month-on-month'
  const bar = parts.thresholdBp != null ? `above ${(parts.thresholdBp / 100).toFixed(2)}%` : 'up'
  return `[${parts.region.publisherKo} release ${pub}, reference ${parts.refMonth}] ${name} ${parts.region.seriesEn} ${change} ${bar}?`
}
