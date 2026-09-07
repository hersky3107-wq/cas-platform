import 'server-only'

import { adapterForInstrument, adapterForLedgerCategory } from './adapters/registry.server'
import { gradePlanFor, withCategoryFallback, type GradePlan } from './grade-plan'

/**
 * The plan a persisted round actually runs under. Looks up the adapter by
 * instrument first, then by ledger category, then applies the category
 * fallback so adapterless sports / politics / entertainment rounds wait for
 * operator evidence instead of falling through to the legacy price path.
 */
export function planForRound(instrument: string, category: string): GradePlan {
  const adapter = adapterForInstrument(instrument) ?? adapterForLedgerCategory(category)
  return withCategoryFallback(gradePlanFor(adapter, instrument), category)
}
