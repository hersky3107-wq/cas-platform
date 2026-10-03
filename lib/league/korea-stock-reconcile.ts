/**
 * KRSTOCK Twelve Data → official KRX anchor reconciliation. Pure.
 *
 * When a round was opened against a Twelve Data fallback close, the official
 * KRX TDD_CLSPRC for that same session is compared later. A mismatch parks
 * the round for admin review — the stored anchor is never silently rewritten.
 */

import { krxClosesEqual, type KrStockAnchorSource } from './korea-stock-display'

export type OfficialCloseLookup = number | 'not_published' | 'holiday' | 'unknown_code'

export type ReconcileTdAnchorResult =
  | { action: 'noop' }
  | { action: 'verify' }
  | { action: 'wait' }
  | { action: 'park_manual'; official: number; stored: number }

export function reconcileTwelfthDataAnchor(args: {
  anchorSource: KrStockAnchorSource | string | null | undefined
  storedAnchor: number
  official: OfficialCloseLookup
}): ReconcileTdAnchorResult {
  if (args.anchorSource !== 'twelvedata') return { action: 'noop' }
  if (!Number.isFinite(args.storedAnchor) || args.storedAnchor <= 0) return { action: 'wait' }
  if (args.official === 'not_published' || args.official === 'holiday') return { action: 'wait' }
  if (args.official === 'unknown_code') return { action: 'wait' }
  if (krxClosesEqual(args.official, args.storedAnchor)) return { action: 'verify' }
  return { action: 'park_manual', official: args.official, stored: args.storedAnchor }
}
