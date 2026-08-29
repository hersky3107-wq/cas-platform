/**
 * GRADE-PLAN DISPATCH — resolution asks the ADAPTER how a round is graded.
 *
 * `CategoryAdapter.gradeSources` used to be declared but never consumed; this
 * module is where it enters the execution path. The grading engine's injected
 * `fetchSeries` / `isPriceInstrument` (see `lib/prediction/reconciliation.ts`)
 * route through `gradePlanFor` BEFORE any feed call:
 *
 *  - tier-1 kind 'twelve_data'  → the EXISTING hardened price path
 *    (`fetchDailyCloses` → `resolveRoundOutcome`), byte-identical: the plan
 *    only decides WHICH fetcher runs, it never touches windows, baselines,
 *    write-once guards, or the up/down decision.
 *  - any other tier-1 kind      → 'unsupported': no executor exists yet, so the
 *    round is left ungraded with an explicit series error instead of being
 *    silently graded against a price feed that does not apply.
 *  - no adapter for the category → the legacy price path, exactly as before
 *    (every adapterless category today is a price chip; non-price handles like
 *    'MATCH:…' still fail the Twelve Data symbol map and surface as
 *    `not_price_instrument`, unchanged).
 *
 * DISPATCH IS PER INSTRUMENT because that is the engine's series-fetch
 * granularity (`planSeriesFetches` batches one call per instrument). The
 * synthetic `PacketRound` below carries only the instrument — adapters derive
 * grading sources from the entity, never from horizon or proposition text.
 *
 * Pure module — the adapter is a parameter, so tests cover the ladder without
 * server-only imports.
 */

import type { CategoryAdapter, GradeSource } from './types'

export type GradePlan =
  | {
      source: 'price_series'
      /** The consulted tier-1 source ('legacy' when no adapter owns the category). */
      tier1: GradeSource | 'legacy'
    }
  | { source: 'unsupported'; tier1Kind: string }

export function gradePlanFor(adapter: CategoryAdapter | null, instrument: string): GradePlan {
  if (!adapter) return { source: 'price_series', tier1: 'legacy' }

  const slots = adapter.slotsForRound({
    proposition_text: '',
    category: adapter.ledger_category,
    instrument,
    horizon: '',
    resolution_rule: '',
    resolves_at: '',
  })
  const [tier1] = adapter.gradeSources(slots)
  if (tier1.tier === 1 && tier1.kind === 'twelve_data') {
    return { source: 'price_series', tier1 }
  }
  return { source: 'unsupported', tier1Kind: tier1.kind }
}
