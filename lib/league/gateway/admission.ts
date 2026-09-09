import { catalogById } from '../catalog'
import { isCategoryAllowed, isPromptAllowed, resolveJurisdictionGroups } from '../jurisdiction/resolve'
import type { GatewayViewer, RefusalCode } from './types'

/**
 * Gateway admission — pure, category-blind except for table lookups.
 *
 * Runs BEFORE prefilter, normalize, quota, LLM, and charge. Hiding the
 * prompt box is not a defense; this is.
 *
 * Order:
 *   1. category matrix (`isCategoryAllowed`) — e.g. memecoin in Korea
 *   2. registered country missing — do not silently fall back to IP
 *   3. promptAllowed(jurisdiction × category) — stricter-of-the-two
 *
 * Admin bypasses, matching `viewerCanSeeCategory`.
 */
export function leagueGatewayAdmission(
  viewer: GatewayViewer,
  categoryId: string,
  ledgerCategory: string,
  atMs: number = Date.now(),
): RefusalCode | null {
  if (viewer.isAdmin) return null

  if (!isCategoryAllowed(ledgerCategory, viewer.jurisdiction, atMs)) {
    return 'jurisdiction_blocked'
  }

  if (!viewer.jurisdiction.declaredCountry?.trim()) {
    return 'registered_country_missing'
  }

  if (!isPromptAllowed(categoryId, viewer.jurisdiction)) {
    return 'prompt_not_available'
  }

  return null
}

export function admissionForPublicCategory(
  viewer: GatewayViewer,
  categoryId: string,
  atMs: number = Date.now(),
): RefusalCode | null {
  const cat = catalogById(categoryId)
  if (!cat) return 'category_unavailable'
  return leagueGatewayAdmission(viewer, categoryId, cat.ledgerCategory, atMs)
}

/** Notice flags for the hub. Never a hard-block of the league. */
export function jurisdictionNotices(viewer: GatewayViewer): {
  declaredMissing: boolean
  mismatch: boolean
} {
  const declaredMissing = !viewer.isAdmin && !viewer.jurisdiction.declaredCountry?.trim()
  const mismatch = !viewer.isAdmin && resolveJurisdictionGroups(viewer.jurisdiction).mismatch
  return { declaredMissing, mismatch }
}
