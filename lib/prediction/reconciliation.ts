import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import { fetchDailyCloses, mapInstrumentToTwelveData } from '@/lib/league/market-data'
import { adapterForInstrument } from '@/lib/league/gateway/adapters/registry.server'
import { gradePlanFor } from '@/lib/league/gateway/grade-plan'
import { planForRound } from '@/lib/league/gateway/plan-for-round'
import {
  createGradingEngine,
  GRADING_SWEEP_SCAN_CAP,
  type GradingRoundRecord,
  type GradingStore,
} from './grading-core'
import { gradingStateOf, type GradingState } from './grading-state'
import { formatOutcomeForKind, gradedSidesFor } from './graded-sides'
import type { ResolutionDirection, ResolvedOutcome, UnresolvableReason } from './resolution'

export type { PredictionCategory } from './categories'
export type { GradingSweepReport, RoundGradingResult } from './grading-core'
export { GRADING_SWEEP_SCAN_CAP } from './grading-core'

/**
 * AI Prediction League — reconciliation (GRADING), DB wiring.
 *
 * THE CREDIBILITY RULE: a round is graded against numbers that were already
 * persisted or already happened, or it is not graded at all.
 *  - baseline   = `prediction_rounds.anchor_price` (+ `anchor_price_at`),
 *                 written at generation time. Never re-derived here.
 *  - resolution = the historical close of the last session inside
 *                 (anchor_price_at, resolves_at], from Twelve Data
 *                 `time_series`. Never a live quote, so grading is
 *                 time-invariant: reconciling three days late produces the
 *                 same grade as reconciling on time.
 *  - direction  = resolution vs anchor, binary up/down, NO flat band.
 *
 * Anything that cannot be resolved honestly (missing anchor, no session in the
 * window, feed failure, exact tie) leaves the round UNGRADED with every
 * `is_correct` NULL, and records WHY (`unresolvable_reason`) so the card and the
 * leaderboard can say so out loud. An ungraded round is acceptable; a wrongly
 * graded one is not.
 *
 * WHEN it runs — and the fact that nobody chooses WHICH rounds run — is
 * `./grading-core.ts`. This file is only the service-role store behind it:
 * every write here is conditioned on the round still being ungraded, so the DB
 * refuses a second grade even if the application logic ever tried.
 *
 * NO CATEGORY SCOPE. The scan takes every due, ungraded round, including the
 * ones with no price feed ('MATCH:…' sports handles): those come back as
 * `not_price_instrument` and are visible as unresolvable instead of sitting
 * ungraded forever with no explanation.
 *
 * ISOLATION: reads/writes ONLY public.prediction_rounds + public.model_predictions
 * via the service-role client. Never touches Verdict Predict or the generic
 * session tables (sessions / scores / session_participants / ai_responses /
 * session_results).
 */

const ROUND_COLUMNS =
  'id, instrument, category, resolves_at, anchor_price, anchor_price_at, actual_outcome, resolved_at, ' +
  'grading_busy_until, grading_attempted_at, unresolvable_reason'

function asRecord(row: Record<string, unknown>): GradingRoundRecord {
  return {
    id: String(row.id),
    instrument: String(row.instrument ?? ''),
    category: String(row.category ?? ''),
    resolves_at: String(row.resolves_at ?? ''),
    anchor_price: typeof row.anchor_price === 'number' ? row.anchor_price : row.anchor_price === null ? null : Number(row.anchor_price) || null,
    anchor_price_at: typeof row.anchor_price_at === 'string' ? row.anchor_price_at : null,
    actual_outcome: typeof row.actual_outcome === 'string' ? row.actual_outcome : null,
    resolved_at: typeof row.resolved_at === 'string' ? row.resolved_at : null,
    grading_busy_until: typeof row.grading_busy_until === 'string' ? row.grading_busy_until : null,
    grading_attempted_at: typeof row.grading_attempted_at === 'string' ? row.grading_attempted_at : null,
    unresolvable_reason: typeof row.unresolvable_reason === 'string' ? row.unresolvable_reason : null,
  }
}

function isMissingColumnError(message: string, column: string): boolean {
  return message.toLowerCase().includes(column) && /does not exist|schema cache/i.test(message)
}

/**
 * The round's answer-contract kind, read at grade time so `gradeChildren` /
 * `saveGraded` can speak the round's side pair WITHOUT changing the
 * `GradingStore` interface (grading-core.ts is untouched). Any failure —
 * including the proposition_kind column not existing yet — falls back to
 * 'binary_close_higher': every pre-kind round is a price round, so the
 * fallback grades exactly as the ledger always did (writers stay valid
 * whether or not the schema migration has been applied).
 */
async function roundPropositionKind(roundId: string): Promise<string> {
  try {
    const { data, error } = await supabaseAdmin
      .from('prediction_rounds')
      .select('proposition_kind')
      .eq('id', roundId)
      .maybeSingle()
    if (error || !data) return 'binary_close_higher'
    const kind = (data as { proposition_kind?: unknown }).proposition_kind
    return typeof kind === 'string' && kind ? kind : 'binary_close_higher'
  } catch {
    return 'binary_close_higher'
  }
}

/** Turns a Postgres "column missing" failure into the migration the operator has to apply. */
function migrationHint(message: string): string {
  if (isMissingColumnError(message, 'anchor_price')) {
    return `${message} — apply migration 20260818000002_league_anchor_price.sql; grading requires a persisted baseline and will not guess one`
  }
  if (isMissingColumnError(message, 'grading_busy_until') || isMissingColumnError(message, 'unresolvable_reason')) {
    return `${message} — apply migration 20260821000002_prediction_grading_state.sql; grading needs its claim/state columns`
  }
  if (isMissingColumnError(message, 'resolution_price') || isMissingColumnError(message, 'resolution_session_date')) {
    return `${message} — apply migration 20260821000001_prediction_resolution_audit.sql; grading is not recorded without its audit trail`
  }
  return message
}

export const supabaseGradingStore: GradingStore = {
  async loadRound(roundId) {
    const { data, error } = await supabaseAdmin
      .from('prediction_rounds')
      .select(ROUND_COLUMNS)
      .eq('id', roundId)
      .maybeSingle()
    if (error) throw new Error(migrationHint(error.message))
    return data ? asRecord(data as unknown as Record<string, unknown>) : null
  },

  async listDueUngraded(cap) {
    // Over-fetch so operator_manual rows (skipped below) cannot hide a
    // price-round that sits behind them in deadline order.
    const { data, error } = await supabaseAdmin
      .from('prediction_rounds')
      .select(ROUND_COLUMNS)
      .lt('resolves_at', new Date().toISOString())
      .is('actual_outcome', null)
      .order('resolves_at', { ascending: true })
      .limit(Math.min(cap * 3, GRADING_SWEEP_SCAN_CAP * 3))
    if (error) throw new Error(migrationHint(error.message))
    return ((data ?? []) as unknown as Record<string, unknown>[])
      .map(asRecord)
      .filter((row) => planForRound(row.instrument, row.category).source !== 'operator_manual')
      .slice(0, cap)
  },

  /**
   * THE LOCK. One conditional UPDATE: still ungraded, already due, and no live
   * lease. Concurrent callers serialize on the row lock and only the first sees
   * its predicate hold, so exactly one gets a row back — the same guarantee
   * `league_deep_runs` gets from its unique key.
   */
  async claim(roundId, leaseUntilIso, nowIso) {
    const { data, error } = await supabaseAdmin
      .from('prediction_rounds')
      .update({ grading_busy_until: leaseUntilIso, grading_attempted_at: nowIso })
      .eq('id', roundId)
      .is('actual_outcome', null)
      .lt('resolves_at', nowIso)
      .or(`grading_busy_until.is.null,grading_busy_until.lt.${nowIso}`)
      .select(ROUND_COLUMNS)
      .maybeSingle()
    if (error) throw new Error(migrationHint(error.message))
    return data ? asRecord(data as unknown as Record<string, unknown>) : null
  },

  /**
   * Writes the grade with the EXACT number and session it was graded against.
   * `.is('actual_outcome', null)` is the second double-grade guard: an expired
   * claim can never overwrite a grade that already exists.
   */
  async saveGraded(roundId, outcome: ResolvedOutcome, nowIso) {
    // Side-pair mapping: byte-identical `outcome.rawOutcome` for
    // close_higher rounds (see lib/prediction/graded-sides.ts).
    const kind = await roundPropositionKind(roundId)
    const { data, error } = await supabaseAdmin
      .from('prediction_rounds')
      .update({
        actual_outcome: formatOutcomeForKind(kind, outcome),
        resolution_price: outcome.resolutionPrice,
        resolution_session_date: outcome.resolutionSessionDate,
        resolved_at: nowIso,
        unresolvable_reason: null,
        unresolvable_detail: null,
        grading_busy_until: null,
      })
      .eq('id', roundId)
      .is('actual_outcome', null)
      .select('id')

    if (error) {
      const hint = migrationHint(error.message)
      console.warn(`[prediction/grading] round ${roundId} not graded: ${hint}`)
      return { ok: false, error: hint }
    }
    if (!data || data.length === 0) {
      // Someone graded it between our claim and this write. Their grade stands.
      return { ok: false, error: 'round was graded by another pass' }
    }
    return { ok: true }
  },

  async saveUnresolvable(roundId, reason: UnresolvableReason, detail, nowIso) {
    const { error } = await supabaseAdmin
      .from('prediction_rounds')
      .update({
        unresolvable_reason: reason,
        unresolvable_detail: detail.slice(0, 500),
        grading_attempted_at: nowIso,
        grading_busy_until: null,
      })
      .eq('id', roundId)
      .is('actual_outcome', null)
    if (error) {
      console.warn(`[prediction/grading] round ${roundId} unresolvable (${reason}) but reason not recorded: ${migrationHint(error.message)}`)
      return
    }
    console.warn(`[prediction/grading] round ${roundId} left UNGRADED — ${reason}: ${detail}`)
  },

  async releaseClaim(roundId) {
    await supabaseAdmin.from('prediction_rounds').update({ grading_busy_until: null }).eq('id', roundId)
  },

  /**
   * Grades the round's children against the round's OWN side pair (its
   * answer contract, via proposition_kind): the engine's binary outcome maps
   * 'up' → side A / 'down' → side B, which for close_higher rounds is the
   * identity — the exact same two UPDATE predicates as the pre-side-token
   * ternary (proved byte-identical in graded-sides.test.ts). Rows with a
   * null direction (abstain/timeout/error) and any token outside the
   * round's pair (the one grandfathered 'flat' row) keep `is_correct = null`:
   * a binary outcome must not manufacture a verdict for an answer it cannot
   * judge.
   */
  async gradeChildren(roundId, direction: ResolutionDirection) {
    const kind = await roundPropositionKind(roundId)
    const { winner, loser } = gradedSidesFor(kind, direction)
    const hit = await supabaseAdmin
      .from('model_predictions')
      .update({ is_correct: true }, { count: 'exact' })
      .eq('round_id', roundId)
      .eq('predicted_direction', winner)
    const miss = await supabaseAdmin
      .from('model_predictions')
      .update({ is_correct: false }, { count: 'exact' })
      .eq('round_id', roundId)
      .eq('predicted_direction', loser)
    if (hit.error || miss.error) return 0
    return (hit.count ?? 0) + (miss.count ?? 0)
  },
}

/**
 * RESOLUTION ASKS THE ADAPTER HOW TO GRADE (`CategoryAdapter.gradeSources`,
 * consumed via `gradePlanFor` — see `lib/league/gateway/grade-plan.ts`).
 * Tier-1 'twelve_data' takes the EXISTING hardened path below, byte-identical:
 * same `fetchDailyCloses`, same window, same `resolveRoundOutcome`. A tier-1
 * source with no executor yet fails the series fetch explicitly, leaving the
 * round honestly ungraded instead of graded against the wrong feed.
 */
async function fetchSeriesViaGradePlan(instrument: string, startDate: string, endDate: string) {
  const plan = gradePlanFor(adapterForInstrument(instrument), instrument)
  if (plan.source === 'price_series') {
    return fetchDailyCloses(instrument, startDate, endDate)
  }
  // operator_manual is a real grade source, not a missing executor. The
  // price engine never fetches a series for it (isPriceInstrument is false).
  if (plan.source === 'operator_manual') {
    return { ok: false as const, error: 'operator_manual: awaiting published evidence' }
  }
  return { ok: false as const, error: `no grading executor for tier-1 source '${plan.tier1Kind}' yet` }
}

const engine = createGradingEngine({
  store: supabaseGradingStore,
  fetchSeries: fetchSeriesViaGradePlan,
  isPriceInstrument: (instrument) =>
    gradePlanFor(adapterForInstrument(instrument), instrument).source === 'price_series' &&
    mapInstrumentToTwelveData(instrument) !== null,
})

/**
 * THE ONLY TWO GRADING ENTRY POINTS. Neither takes a selector — see the
 * contract at the top of `./grading-core.ts`.
 *
 * `gradeRoundOnRead` is wrapped: an operator_manual round is refused here
 * BEFORE the engine claims or writes. GradingRejection has no "awaiting
 * operator" token; `not_due` writes nothing and leaves the row pending.
 * A card view therefore cannot stamp `not_price_instrument`.
 */
export async function gradeRoundOnRead(roundId: string) {
  const round = await supabaseGradingStore.loadRound(roundId)
  if (round && planForRound(round.instrument, round.category).source === 'operator_manual') {
    return {
      outcome: 'rejected' as const,
      roundId: round.id,
      instrument: round.instrument,
      reason: 'not_due' as const,
      state: gradingStateOf(round, Date.now()),
    }
  }
  return engine.gradeRoundOnRead(roundId)
}
export const gradeAllDueRounds = engine.gradeAllDueRounds

/**
 * Fire-and-forget grade-on-read for a page that lists MANY rounds (the record
 * room). Same non-discretionary rule — it walks every due, ungraded round it
 * finds — but per-round throttling (`GRADING_READ_COOLDOWN_MS`) keeps a page
 * view from re-attempting a permanently unresolvable round every time.
 *
 * Never awaited by a read path: a reader waits for nothing, and whatever this
 * grades shows up on their next load.
 */
export async function gradeDueRoundsInBackground(): Promise<void> {
  try {
    const due = await supabaseGradingStore.listDueUngraded(GRADING_SWEEP_SCAN_CAP)
    for (const round of due) await gradeRoundOnRead(round.id)
  } catch (e: unknown) {
    console.warn(`[prediction/grading] background pass aborted: ${e instanceof Error ? e.message : 'unknown error'}`)
  }
}

/** Derived state for one round row — the read paths' source of truth. */
export function gradingStateOfRow(
  row: {
    resolves_at: string
    actual_outcome: string | null
    resolved_at: string | null
    grading_busy_until: string | null
    grading_attempted_at: string | null
    unresolvable_reason: string | null
  },
  nowMs = Date.now()
): GradingState {
  return gradingStateOf(row, nowMs)
}
