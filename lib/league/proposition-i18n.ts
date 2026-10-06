/**
 * Client-safe proposition locale helpers. Must stay free of the AI router,
 * supabase server clients, and any other server-only module.
 */
import {
  decodeAirankInstrument,
  isAirankInstrument,
  parseAirankInstrument,
  airankDisplayProposition,
  airankAllPropositions,
} from './ai-ranking/instrument'
import { restoreTechOpenCasing } from './acronym-casing'
import type { LeagueLocale } from './i18n/locales'
import { sportsPropositionDisplay } from './sports-display'

export { airankAllPropositions }

export type LocalizedPropositionTarget = {
  proposition_text: string
  category?: string | null
  instrument?: string | null
  propositions?: Record<string, string> | null
  horizon?: string | null
}

/**
 * Resolves the proposition text for the viewer's locale.
 *
 * Priority:
 * 1. AIRANK: short display template from the codec (never names the source; stored audit text is skipped).
 * 2. Viewer's locale from `propositions[locale]` if present.
 * 3. Fallback to `en` then `ko` from `propositions`.
 * 4. Stored `proposition_text`.
 */
export function resolveLocalizedProposition(
  round: LocalizedPropositionTarget,
  locale: LeagueLocale = 'en',
): string {
  if (round.category === 'ai_models' || (round.instrument && isAirankInstrument(round.instrument))) {
    const parsed = round.instrument ? parseAirankInstrument(round.instrument) : null
    const parts = parsed && parsed.ok ? parsed.parts : round.instrument ? decodeAirankInstrument(round.instrument) : null
    if (parts) return airankDisplayProposition(parts, locale, round.horizon)
  }

  if (round.category === 'sports' && round.instrument) {
    const shown = sportsPropositionDisplay(round.instrument, round.proposition_text, locale)
    if (shown.trim()) return shown
  }

  return restoreTechOpenCasing(round.instrument, storedProposition(round, locale))
}

function storedProposition(round: LocalizedPropositionTarget, locale: LeagueLocale): string {
  if (round.propositions && typeof round.propositions === 'object') {
    const direct = round.propositions[locale]
    if (typeof direct === 'string' && direct.trim()) return direct.trim()
  }

  // Fallback order: viewer's locale -> en -> ko -> stored proposition_text
  if (round.propositions && typeof round.propositions === 'object') {
    const en = round.propositions.en
    if (typeof en === 'string' && en.trim()) return en.trim()
    const ko = round.propositions.ko
    if (typeof ko === 'string' && ko.trim()) return ko.trim()
  }

  return round.proposition_text
}

/** Localized share text for cards and propositions. */
export function leagueShareText(
  round: LocalizedPropositionTarget,
  locale: LeagueLocale = 'en',
): string {
  return resolveLocalizedProposition(round, locale)
}
