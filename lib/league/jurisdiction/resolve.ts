import { groupForCountry } from './country-groups'
import { isPoliticsBlackoutActive } from './election-blackout'
import { isCategoryAllowedForGroup } from './matrix'
import type { JurisdictionGroup } from './types'

/**
 * AI Prediction League — jurisdiction RESOLUTION (Layer B), pure.
 *
 * Pure and synchronous, mirroring `lib/league/i18n/resolve-locale.ts`'s
 * shape on purpose (same "pure function over pre-extracted signals" style)
 * but otherwise fully independent: no shared types, no shared decision code,
 * no import from the i18n layer.
 */
export type JurisdictionInput = {
  /** Self-declared country from the user's account (nullable — not everyone has declared one). */
  declaredCountry?: string | null
  /** IP-geolocated country for this request (nullable — e.g. local dev, or the header is absent). */
  ipCountry?: string | null
}

export type JurisdictionResolution = {
  declaredGroup: JurisdictionGroup
  ipGroup: JurisdictionGroup
  /** True only when BOTH signals are present and resolve to different groups (a real VPN/mismatch signal, not just one signal being absent). */
  mismatch: boolean
}

export function resolveJurisdictionGroups(input: JurisdictionInput): JurisdictionResolution {
  const declaredGroup = groupForCountry(input.declaredCountry ?? null)
  const ipGroup = groupForCountry(input.ipCountry ?? null)
  const bothPresent = Boolean(input.declaredCountry?.trim()) && Boolean(input.ipCountry?.trim())
  return { declaredGroup, ipGroup, mismatch: bothPresent && declaredGroup !== ipGroup }
}

/**
 * Is `category` visible to a user described by `input`, at time `atMs`?
 *
 * STRICTER-OF-THE-TWO rule: when both a declared country and an IP country
 * are present, the category must be allowed under BOTH of their groups (a
 * boolean AND) — if either signal's jurisdiction denies it, the result is
 * denied. This is the correct generalization of "apply the stricter
 * jurisdiction" for a binary allow/deny matrix: there is no need for (and no
 * such thing as) a single global "which country is stricter" ranking: a
 * jurisdiction can be the stricter one for crypto_perps and the more
 * permissive one for politics_election.
 *
 * When only one signal is present, that signal alone decides. When NEITHER
 * is present, the request is treated as the 'UNKNOWN' group, which
 * default-denies (see `matrix.ts`).
 */
export function isCategoryAllowed(category: string, input: JurisdictionInput, atMs: number = Date.now()): boolean {
  const hasDeclared = Boolean(input.declaredCountry?.trim())
  const hasIp = Boolean(input.ipCountry?.trim())

  if (!hasDeclared && !hasIp) {
    return isCategoryAllowedForGroup('UNKNOWN', category)
  }

  const { declaredGroup, ipGroup } = resolveJurisdictionGroups(input)
  const declaredOk = hasDeclared ? isCategoryAllowedForGroup(declaredGroup, category) : true
  const ipOk = hasIp ? isCategoryAllowedForGroup(ipGroup, category) : true
  let allowed = declaredOk && ipOk

  if (allowed && category === 'politics_election') {
    if (hasDeclared && isPoliticsBlackoutActive(declaredGroup, atMs)) allowed = false
    if (hasIp && isPoliticsBlackoutActive(ipGroup, atMs)) allowed = false
  }

  return allowed
}
