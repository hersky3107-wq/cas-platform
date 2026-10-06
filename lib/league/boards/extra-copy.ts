import { extraDescriptionPack, extraSeatDescription, type ExtraSeatDescription } from '../extra/descriptions'
import { isExtraSeatId } from '../extra/seats'
import type { LeagueLocale } from '../i18n/locales'

export type ExtraSeatCopy = ExtraSeatDescription

/**
 * Extra-seat name, role and basis for the boards, and the single import point
 * for `lib/league/extra/descriptions.ts`, so the boards and the tiles share one text.
 */
export function extraSeatCopy(locale: LeagueLocale, modelId: string): ExtraSeatCopy | null {
  if (!isExtraSeatId(modelId)) return null
  return extraSeatDescription(locale, modelId)
}

/** Role/basis captions for the extras header. */
export function extraRoleLabels(locale: LeagueLocale): { role: string; basis: string } {
  const pack = extraDescriptionPack(locale)
  return { role: pack.roleLabel, basis: pack.basisLabel }
}
