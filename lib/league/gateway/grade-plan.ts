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
 *  - no executor on tier 1/2, and a remaining source is 'operator_manual'
 *    → 'operator_manual': the operator supplies published evidence; the
 *    program maps that fact onto the round's side pair. Permanent fallback
 *    even after official APIs land.
 *  - any other ladder with no executor → 'unsupported': the round is left
 *    ungraded with an explicit series error instead of being silently
 *    graded against a price feed that does not apply.
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
  | { source: 'operator_manual' }
  | { source: 'unsupported'; tier1Kind: string }

/**
 * Ledger categories that have no price executor. A missing adapter used to
 * fall through to the legacy price path; for these categories that would
 * stamp `not_price_instrument`. They wait for operator evidence instead.
 */
export const OPERATOR_FALLBACK_CATEGORIES: readonly string[] = [
  'sports',
  'politics_election',
  'entertainment_awards',
]

export function withCategoryFallback(plan: GradePlan, category: string): GradePlan {
  if (
    plan.source === 'price_series' &&
    plan.tier1 === 'legacy' &&
    OPERATOR_FALLBACK_CATEGORIES.includes(category)
  ) {
    return { source: 'operator_manual' }
  }
  return plan
}

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
  const sources = adapter.gradeSources(slots)
  const [tier1] = sources
  if (tier1.tier === 1 && tier1.kind === 'twelve_data') {
    return { source: 'price_series', tier1 }
  }
  if (sources.some((s) => s.kind === 'operator_manual')) {
    return { source: 'operator_manual' }
  }
  return { source: 'unsupported', tier1Kind: tier1.kind }
}
