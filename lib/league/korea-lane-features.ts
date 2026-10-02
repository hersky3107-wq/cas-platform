/**
 * Korean-lane product gates. Classification is ALWAYS `admissionStockLane`
 * (declared KR nationality OR KR IP) — do not invent a second classifier.
 */
import { admissionStockLane } from './stock-lane'
import type { JurisdictionInput } from './jurisdiction/resolve'

export const KR_DEEP_DISABLED_CATEGORIES: 'all' | readonly string[] = 'all'

type LaneViewer = {
  isAdmin?: boolean
  jurisdiction: JurisdictionInput
}

function categoryCovered(category: string | null | undefined): boolean {
  if (KR_DEEP_DISABLED_CATEGORIES === 'all') return true
  if (!category) return false
  return KR_DEEP_DISABLED_CATEGORIES.includes(category)
}

/**
 * UI + policy: Korean-lane viewer and a covered category.
 * Admin is NOT exempt here (the hub still hides the buttons).
 * The API layer additionally requires `!viewer.isAdmin` before 403.
 */
export function isDeepDisabledForViewer(viewer: LaneViewer, category: string | null | undefined): boolean {
  if (admissionStockLane(viewer.jurisdiction) !== 'korea') return false
  return categoryCovered(category)
}

/** Non-admin Korean-lane viewers are blocked from deep-open / deep-debate. */
export function isKrLaneDeepApiBlocked(viewer: LaneViewer, category: string | null | undefined): boolean {
  return Boolean(!viewer.isAdmin && isDeepDisabledForViewer(viewer, category))
}
