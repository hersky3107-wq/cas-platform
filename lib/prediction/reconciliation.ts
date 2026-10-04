import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import { fetchDailyCloses, mapInstrumentToTwelveData } from '@/lib/league/market-data'
import { adapterForInstrument, adapterForLedgerCategory } from '@/lib/league/gateway/adapters/registry.server'
import { gradePlanFor } from '@/lib/league/gateway/grade-plan'
import { gradeKrBoxOfficeInstrument } from '@/lib/league/entertainment/kobis'
import { resolveAirankOfficial } from '@/lib/league/ai-ranking/grade.server'
import { VOID_UNRESOLVABLE_REASON } from '@/lib/league/manual-grade/types'
import { parkRoundForManual } from '@/lib/league/manual-grade/queue'
import { decodeKrStockInstrument } from '@/lib/league/korea-equity-catalog'
import { getOfficialClose, getOfficialClosesBetween } from '@/lib/league/korea-market-data'
import { reconcileTwelfthDataAnchor } from '@/lib/league/korea-stock-reconcile'
import {
  createGradingEngine,
  GRADING_SWEEP_SCAN_CAP,
  type GradingRoundRecord,
  type GradingStore,
  type OfficialOutcomeResolution,
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
  'id, instrument, category, resolves_at, opened_at, created_at, anchor_price, anchor_price_at, actual_outcome, resolved_at, ' +
  'grading_busy_until, grading_attempted_at, unresolvable_reason, grading_status'

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
    grading_status:
      row.grading_status === 'needs_grading' ||
      row.grading_status === 'graded' ||
      row.grading_status === 'voided' ||
      row.grading_status === 'auto'
        ? row.grading_status
        : 'auto',
    opened_at: typeof row.opened_at === 'string' ? row.opened_at : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : null,
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
  if (isMissingColumnError(message, 'grading_status')) {
    return `${message} — apply migration 20260927000002_prediction_manual_grading.sql; freeform rounds need grading_status`
  }
  if (isMissingColumnError(message, 'anchor_source')) {
    return `${message} — apply migration 20261003000003_prediction_rounds_anchor_source.sql; KRSTOCK needs anchor_source`
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
    const { data, error } = await supabaseAdmin
      .from('prediction_rounds')
      .select(ROUND_COLUMNS)
      .lt('resolves_at', new Date().toISOString())
      .is('actual_outcome', null)
      .eq('grading_status', 'auto')
      .order('resolves_at', { ascending: true })
      .limit(cap)
    if (error) throw new Error(migrationHint(error.message))
    return ((data ?? []) as unknown as Record<string, unknown>[]).map(asRecord)
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
        grading_status: 'graded',
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

  async saveVoided(roundId, rawOutcome, nowIso) {
    const { data, error } = await supabaseAdmin
      .from('prediction_rounds')
      .update({
        grading_status: 'voided',
        unresolvable_reason: VOID_UNRESOLVABLE_REASON,
        unresolvable_detail: rawOutcome.slice(0, 500),
        grading_attempted_at: nowIso,
        grading_busy_until: null,
      })
      .eq('id', roundId)
      .is('actual_outcome', null)
      .neq('grading_status', 'voided')
      .neq('grading_status', 'graded')
      .select('id')
    if (error) return { ok: false as const, error: migrationHint(error.message) }
    if (!data || data.length === 0) {
      return { ok: false as const, error: 'round was graded or voided by another pass' }
    }
    return { ok: true as const }
  },

  async parkForManual(roundId, nowIso) {
    const { data: row } = await supabaseAdmin
      .from('prediction_rounds')
      .select('proposition_text, category, resolves_at')
      .eq('id', roundId)
      .maybeSingle()
    return parkRoundForManual(
      roundId,
      nowIso,
      row
        ? {
            proposition: String((row as { proposition_text?: string }).proposition_text ?? ''),
            category: String((row as { category?: string }).category ?? ''),
            resolvesAt: String((row as { resolves_at?: string }).resolves_at ?? ''),
          }
        : undefined
    )
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
async function loadKrStockAnchorFacts(roundId: string): Promise<{
  anchorSource: string | null
  anchorSessionDate: string | null
} | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('prediction_rounds')
      .select('anchor_source, anchor_session_date')
      .eq('id', roundId)
      .maybeSingle()
    if (error) {
      if (isMissingColumnError(error.message, 'anchor_source')) return null
      throw new Error(migrationHint(error.message))
    }
    if (!data) return null
    const row = data as { anchor_source?: unknown; anchor_session_date?: unknown }
    return {
      anchorSource: typeof row.anchor_source === 'string' ? row.anchor_source : null,
      anchorSessionDate:
        typeof row.anchor_session_date === 'string' ? row.anchor_session_date.slice(0, 10) : null,
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : ''
    if (isMissingColumnError(message, 'anchor_source')) return null
    throw e
  }
}

async function markAnchorOfficialVerified(roundId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('prediction_rounds')
    .update({ anchor_source: 'krx_official_verified' })
    .eq('id', roundId)
    .eq('anchor_source', 'twelvedata')
  if (error && !isMissingColumnError(error.message, 'anchor_source')) {
    console.warn(`[prediction/grading] round ${roundId} could not mark krx_official_verified: ${error.message}`)
  }
}

async function beforeGradeKrStock(round: GradingRoundRecord): Promise<'continue' | 'park' | 'defer'> {
  const parts = decodeKrStockInstrument(round.instrument)
  if (!parts) return 'continue'
  const facts = await loadKrStockAnchorFacts(round.id)
  if (!facts || facts.anchorSource !== 'twelvedata') return 'continue'
  if (!facts.anchorSessionDate) return 'defer'
  if (!Number.isFinite(round.anchor_price) || (round.anchor_price ?? 0) <= 0) return 'defer'
  const official = await getOfficialClose(parts.market, parts.code, facts.anchorSessionDate)
  const decision = reconcileTwelfthDataAnchor({
    anchorSource: facts.anchorSource,
    storedAnchor: round.anchor_price as number,
    official,
  })
  if (decision.action === 'verify') {
    await markAnchorOfficialVerified(round.id)
    return 'continue'
  }
  if (decision.action === 'park_manual') return 'park'
  if (decision.action === 'wait') return 'defer'
  return 'continue'
}

async function fetchKrxOfficialCloses(instrument: string, startDate: string, endDate: string) {
  const parts = decodeKrStockInstrument(instrument)
  if (!parts) return { ok: false as const, error: 'not a KRSTOCK instrument' }
  const bars = await getOfficialClosesBetween(parts.market, parts.code, startDate, endDate)
  return { ok: true as const, bars }
}

function planForInstrument(instrument: string, category?: string) {
  const adapter = adapterForInstrument(instrument) ?? (category ? adapterForLedgerCategory(category) : null)
  return gradePlanFor(adapter, instrument)
}

async function fetchSeriesViaGradePlan(instrument: string, startDate: string, endDate: string) {
  const plan = planForInstrument(instrument)
  if (plan.source === 'price_series') {
    if (decodeKrStockInstrument(instrument)) {
      return fetchKrxOfficialCloses(instrument, startDate, endDate)
    }
    return fetchDailyCloses(instrument, startDate, endDate)
  }
  // operator_manual / official lists are not price executors.
  if (plan.source === 'operator_manual' || plan.source === 'kobis' || plan.source === 'lmarena') {
    return { ok: false as const, error: `${plan.source}: awaiting official snapshot` }
  }
  return { ok: false as const, error: `no grading executor for tier-1 source '${plan.tier1Kind}' yet` }
}

async function resolveOfficialOutcome(
  instrument: string,
  round: GradingRoundRecord,
): Promise<OfficialOutcomeResolution | ResolvedOutcome | null> {
  const plan = planForInstrument(instrument, round.category)
  if (plan.source === 'lmarena') {
    return resolveAirankOfficial(instrument, round.opened_at ?? round.created_at ?? null)
  }
  if (plan.source !== 'kobis') return null
  const grade = await gradeKrBoxOfficeInstrument(instrument)
  if (!grade) return null
  return {
    rawOutcome: grade.rawOutcome,
    actualDirection: grade.direction,
    anchorPrice: 0,
    anchorPriceAt: new Date().toISOString(),
    resolutionPrice: grade.resolutionPrice,
    resolutionSessionDate: grade.resolutionSessionDate,
  }
}

const engine = createGradingEngine({
  store: supabaseGradingStore,
  fetchSeries: fetchSeriesViaGradePlan,
  isPriceInstrument: (instrument) =>
    planForInstrument(instrument).source === 'price_series' &&
    (decodeKrStockInstrument(instrument) !== null || mapInstrumentToTwelveData(instrument) !== null),
  resolveOfficialOutcome,
  beforeGrade: beforeGradeKrStock,
})

/**
 * THE ONLY TWO GRADING ENTRY POINTS. Neither takes a selector — see the
 * contract at the top of `./grading-core.ts`.
 *
 * Freeform (no Twelve Data executor) rounds are parked as `needs_grading`
 * inside the engine (`parkForManual`) — never price-graded, never retried
 * against a feed. Telegram fires once on the first park.
 */
export async function gradeRoundOnRead(roundId: string) {
  return engine.gradeRoundOnRead(roundId)
}

export async function gradeAllDueRounds() {
  const report = await engine.gradeAllDueRounds()
  return report
}

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
