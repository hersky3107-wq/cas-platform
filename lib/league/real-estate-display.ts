/**
 * Card copy for PROPERTY:... The stored proposition is already Korean.
 * The headline must not show the raw instrument id.
 */

import type { LeagueUiPack } from './i18n/dictionary'
import type { LeagueLocale } from './i18n/locales'
import { decodePropertyInstrument, formatPropertyProposition, propertyHeadlineLabel } from './gateway/adapters/real-estate-catalog'

export function propertyInstrumentDisplay(instrument: string, locale: LeagueLocale): string | null {
  return propertyHeadlineLabel(instrument, locale === 'ko' ? 'ko' : 'en')
}

export function formatPropertyHorizonLabel(instrument: string, t: LeagueUiPack): string | null {
  const parts = decodePropertyInstrument(instrument)
  if (!parts) return null
  return parts.region.cadence === 'quarter' ? t.header.realEstateHorizonQuarterly : t.header.realEstateHorizonMonthly
}

export function propertyDaysUntilPublication(resolvesAt: string, now: Date = new Date()): number {
  const ymd = resolvesAt.slice(0, 10)
  const [year, month, day] = ymd.split('-').map(Number)
  if (!year || !month || !day) return NaN
  const target = Date.UTC(year, month - 1, day)
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.round((target - today) / 86_400_000)
}

function formatPublicationDate(ymd: string, locale: LeagueLocale): string {
  const [year, month, day] = ymd.split('-').map(Number)
  if (!year || !month || !day) return ymd
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(locale, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function formatPropertyGradeLine(args: {
  instrument: string
  resolvesAt: string
  locale: LeagueLocale
  t: LeagueUiPack
  now?: Date
}): string | null {
  if (!decodePropertyInstrument(args.instrument)) return null
  const ymd = args.resolvesAt.slice(0, 10)
  const days = propertyDaysUntilPublication(args.resolvesAt, args.now ?? new Date())
  if (!Number.isFinite(days)) return null
  return args.t.header.realEstateGrade(formatPublicationDate(ymd, args.locale), days)
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
