/**
 * Pure hop/stage decisions for the durable deep-analysis pipelines.
 *
 * Kept out of deep-open-run.ts / deep-debate-run.ts (both 'server-only')
 * so the hop-splitting rules are unit-testable, mirroring how
 * generation/policy.ts keeps the runner's numbers out of call sites.
 *
 * Hop budget rationale: the deep routes and the cron tick share a 300s
 * function ceiling. A hop that bundles 18+ model calls (the old
 * two-rounds-plus-consensus deliberation) can be killed mid-flight and
 * repeat from scratch. Every decision here exists to keep one hop's
 * worst case bounded by roughly ONE seat timeout, so a killed worker
 * resumes at the right place instead of repeating finished work.
 */
import {
  LEAGUE_CONSENSUS_TARGET,
  LEAGUE_CONSENSUS_UNAVAILABLE,
  LEAGUE_DELIBERATION_MIN_ROUNDS,
  LEAGUE_STALL_DELTA,
  type LeagueDeepRole,
  type LeagueDeliberationStopReason,
  type LeagueOpenAnalysis,
  type LeagueRoundResult,
} from './deep-types'

/** Debate runs one deliberation round per hop, up to this many rounds. */
export const LEAGUE_DEBATE_MAX_ROUNDS = 2

/**
 * Open analyses run in resume-safe batches of this many seats per hop.
 * 8 seats at up to 240s (DeepSeek) in ONE hop risks the 300s wall; two
 * hops of 4 keep each hop bounded by one slow seat while still filling
 * the board in two poll-visible waves.
 */
export const OPEN_ANALYSES_BATCH_SIZE = 4

/** Every planned seat has a recorded analysis row (ok or definitive failure). */
export function openAnalysesComplete(
  planRoles: readonly LeagueDeepRole[],
  analyses: readonly LeagueOpenAnalysis[]
): boolean {
  if (planRoles.length === 0) return false
  const done = new Set(analyses.map((a) => a.roleId))
  return planRoles.every((r) => done.has(r.roleId))
}

/** Next batch of seats that still need an individual analysis. */
export function pendingOpenAnalysisRoles(
  planRoles: readonly LeagueDeepRole[],
  analyses: readonly LeagueOpenAnalysis[],
  batchSize = OPEN_ANALYSES_BATCH_SIZE
): LeagueDeepRole[] {
  const done = new Set(analyses.map((a) => a.roleId))
  return planRoles.filter((r) => !done.has(r.roleId)).slice(0, Math.max(1, batchSize))
}

export type DeliberationStopDecision = {
  stop: boolean
  reason: LeagueDeliberationStopReason
}

/**
 * Same stop rules the old in-engine loop applied, factored out so the
 * per-hop pipeline and the one-shot script path share one truth:
 * failed/unmeasurable round → error; from MIN_ROUNDS on, target score or
 * a stalled delta ends it; otherwise stop at maxRounds.
 */
export function decideDeliberationStop(
  rounds: readonly LeagueRoundResult[],
  maxRounds: number
): DeliberationStopDecision {
  const last = rounds[rounds.length - 1]
  if (!last) return { stop: false, reason: 'max_rounds' }
  if (!last.ok || last.consensusScore === LEAGUE_CONSENSUS_UNAVAILABLE) {
    return { stop: true, reason: 'error' }
  }
  if (rounds.length >= LEAGUE_DELIBERATION_MIN_ROUNDS) {
    if (last.consensusScore >= LEAGUE_CONSENSUS_TARGET) return { stop: true, reason: 'target_reached' }
    const prev = rounds[rounds.length - 2]?.consensusScore ?? last.consensusScore
    if (last.consensusScore - prev < LEAGUE_STALL_DELTA) return { stop: true, reason: 'stalled' }
  }
  if (rounds.length >= maxRounds) return { stop: true, reason: 'max_rounds' }
  return { stop: false, reason: 'max_rounds' }
}

/** Upcoming open-pipeline stage for a (possibly partial) state. */
export function openStageFor(state: {
  plan?: { roles: LeagueDeepRole[] } | null
  report?: string | null
  analyses?: LeagueOpenAnalysis[] | null
}): 'plan' | 'report' | 'analyses' | 'synthesis' {
  if (!state.plan) return 'plan'
  if (!state.report) return 'report'
  if (!openAnalysesComplete(state.plan.roles ?? [], state.analyses ?? [])) return 'analyses'
  return 'synthesis'
}

/** Upcoming debate-pipeline stage. Vote and chair verdict are separate hops. */
export function debateStageFor(state: {
  plan?: unknown
  report?: unknown
  deliberation?: unknown
  vote?: unknown
}): 'plan' | 'report' | 'deliberate' | 'vote' | 'verdict' {
  if (!state.plan) return 'plan'
  if (!state.report) return 'report'
  if (!state.deliberation) return 'deliberate'
  if (!state.vote) return 'vote'
  return 'verdict'
}
