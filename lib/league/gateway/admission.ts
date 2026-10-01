import { catalogById } from '../catalog'
import { admissionStockLane } from '../stock-lane'
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
 * Admin still bypasses category visibility and the registered-country check
 * (matching `viewerCanSeeCategory`). The prompt matrix is the single source
 * of truth for the freeform box — admin does not get a hidden prompt.
 *
 * Stocks are the exception: the lane is admission (Korean account OR Korea
 * IP), and the only override is the admin hub toggle. Admin may use the
 * stocks prompt from either lane. Everyone else on the Korea lane is refused
 * before the prompt matrix, with no global chip list attached.
 */
export function leagueGatewayAdmission(
  viewer: GatewayViewer,
  categoryId: string,
  ledgerCategory: string,
  atMs: number = Date.now(),
): RefusalCode | null {
  if (!viewer.isAdmin) {
    if (!isCategoryAllowed(ledgerCategory, viewer.jurisdiction, atMs)) {
      return 'jurisdiction_blocked'
    }

    if (categoryId === 'stocks' && admissionStockLane(viewer.jurisdiction) === 'korea') {
      return 'korea_stock_lane'
    }

    if (!viewer.jurisdiction.declaredCountry?.trim()) {
      return 'registered_country_missing'
    }
  }

  if (categoryId === 'stocks' && viewer.isAdmin) return null

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
