/**
 * Client-safe proposition locale helpers. Must stay free of the AI router,
 * supabase server clients, and any other server-only module.
 */
import {
  isAirankInstrument,
  parseAirankInstrument,
  decodeAirankInstrument,
  airankPropositionText,
  airankAllPropositions,
} from './ai-ranking/instrument'
import type { LeagueLocale } from './i18n/locales'

export { airankAllPropositions }

export type LocalizedPropositionTarget = {
  proposition_text: string
  category?: string | null
  instrument?: string | null
  propositions?: Record<string, string> | null
}

/**
 * Resolves the proposition text for the viewer's locale.
 *
 * Priority:
 * 1. Viewer's locale from `propositions[locale]` if present.
 * 2. AIRANK: deterministic template from codec in all 8 locales (no LLM).
 * 3. Fallback to `en` then `ko` from `propositions`.
 * 4. Stored `proposition_text`.
 */
export function resolveLocalizedProposition(
  round: LocalizedPropositionTarget,
  locale: LeagueLocale = 'en',
): string {
  if (round.propositions && typeof round.propositions === 'object') {
    const direct = round.propositions[locale]
    if (typeof direct === 'string' && direct.trim()) return direct.trim()
  }

  // AIRANK: render from the codec with templates in all 8 locales (no LLM)
  if (round.category === 'ai_models' || (round.instrument && isAirankInstrument(round.instrument))) {
    const parts =
      (round.instrument ? decodeAirankInstrument(round.instrument) : null) ??
      (round.instrument ? parseAirankInstrument(round.instrument) : null)
    if (parts) {
      return airankPropositionText(parts, locale)
    }
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
