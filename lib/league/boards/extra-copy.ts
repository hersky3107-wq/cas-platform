import { isExtraSeatId } from '../extra/seats'
import { getLeagueUiPack } from '../i18n/dictionary'
import type { LeagueLocale } from '../i18n/locales'

export type ExtraSeatCopy = { name: string; role: string | null; basis: string | null }

/**
 * Extra-seat name, role and basis for the boards, and the single import point
 * for `lib/league/extra/descriptions.ts`. Without it, names come from the card
 * pack and role/basis are null (the extras header then lists names only).
 */
export function extraSeatCopy(locale: LeagueLocale, modelId: string): ExtraSeatCopy | null {
  if (!isExtraSeatId(modelId)) return null
  return { name: getLeagueUiPack(locale).extraCompare.seat[modelId], role: null, basis: null }
}

/** Role/basis captions for the extras header; null while role/basis are null. */
export function extraRoleLabels(_locale: LeagueLocale): { role: string; basis: string } | null {
  return null
}
