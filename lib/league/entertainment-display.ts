/**
 * Display-time entertainment copy. Stored rounds keep the server proposition.
 * The card localizes SHOW:... the same way it localizes ELECTION: and MATCH:.
 */

import type { LeagueLocale } from './i18n/locales'
import { decodeEntertainmentInstrument, showEventLabel, type ShowParts } from './gateway/adapters/entertainment-catalog'

export function entertainmentHeadlineLabel(instrument: string, locale: LeagueLocale): string | null {
  const parts = decodeEntertainmentInstrument(instrument)
  if (!parts) return null
  const event = showEventLabel(parts, locale === 'ko' ? 'ko' : 'en')
  return `${parts.subject} · ${event}`
}

export function formatEntertainmentPropositionLocalized(parts: ShowParts, locale: LeagueLocale): string {
  return `${parts.subject} ${showEventLabel(parts, locale === 'ko' ? 'ko' : 'en')}`
}

export function entertainmentPropositionDisplay(instrument: string, stored: string, locale: LeagueLocale): string {
  const parts = decodeEntertainmentInstrument(instrument) ?? decodeEntertainmentInstrument(stored)
  if (!parts) return stored
  return formatEntertainmentPropositionLocalized(parts, locale)
}
