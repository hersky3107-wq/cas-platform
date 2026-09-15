import 'server-only'

import {
  assembleLeagueDeliberation,
  planLeagueDebateMeeting,
  renderLeagueChairVerdict,
  runLeagueDeliberationRound,
  runLeagueMotionVote,
} from './deep-debate-engine'
import { generateLeaguePreReport } from './deep-open-engine'
import { LEAGUE_DEBATE_MAX_ROUNDS, debateStageFor, decideDeliberationStop } from './deep-pipeline'
import { remapOpenPlanExaone } from './deep-open-replacement-policy'
import type { LeagueDeepContext } from './deep-context'
import type { LeagueLocale } from './i18n/locales'
import { runWithOutputLanguage } from './deep-output-language'
import type { DeepDebateResult } from './deep-debate-types'
import type { DeepProviderMeta } from './deep-store'
import type {
  LeagueDebateMeetingPlan,
  LeagueDeliberation,
  LeagueRoundResult,
  LeagueVoteResult,
} from './deep-types'

export type { DeepDebateResult } from './deep-debate-types'

/**
 * Hop map (one hop = one runner lease, bounded by ~one seat timeout):
 *   plan → report → deliberate (ONE round per hop, rounds accumulate in
 *   `rounds`) → vote (9-seat ballot) → verdict (single chair call).
 * The old shape bundled both deliberation rounds plus consensus into one
 * 18-call hop and vote+verdict into another 10-call hop — past the 300s
 * function wall on a slow day, so a killed worker repeated everything.
 */
export type DebatePipelineState = {
  instrument: string
  category: string
  proposition: string
  question: string
  context: string
  availableDataSummary: string
  snapshot: LeagueDeepContext['snapshot']
  outputLanguage: LeagueLocale
  plan?: LeagueDebateMeetingPlan
  report?: string | null
  /** Completed deliberation rounds, one hop each (resume-safe). */
  rounds?: LeagueRoundResult[]
  /** Set when the stop rule fires; unlocks the vote hop. */
  deliberation?: LeagueDeliberation
  /** Set by the vote hop; unlocks the chair-verdict hop. */
  vote?: LeagueVoteResult
  result?: DeepDebateResult
}

export function seedDebateState(ctx: LeagueDeepContext): DebatePipelineState {
  return {
    instrument: ctx.instrument,
    category: ctx.category,
    proposition: ctx.proposition,
    question: ctx.question,
    context: ctx.context,
    availableDataSummary: ctx.availableDataSummary,
    snapshot: ctx.snapshot,
    outputLanguage: ctx.outputLanguage,
  }
}

export function upcomingDebateStage(state: DebatePipelineState): string {
  return debateStageFor(state)
}

export function providersFromDebateState(state: DebatePipelineState): DeepProviderMeta[] {
  return (state.plan?.roles ?? []).map((r) => ({ provider: r.provider, roleLabel: r.roleLabel }))
}

function seedFromReport(
  report: string | null,
  roles: { roleId: string; roleLabel: string }[]
): { roleId: string; roleLabel: string; ok: boolean; revised: string | null }[] {
  if (!report?.trim()) return []
  const first = roles[0]
  return [
    {
      roleId: first?.roleId ?? 'brief',
      roleLabel: first?.roleLabel ?? 'Pre-report',
      ok: true,
      revised: report,
    },
  ]
}

function failResult(state: DebatePipelineState, error: string): DeepDebateResult {
  return {
    ok: false,
    kind: 'debate',
    instrument: state.instrument,
    proposition: state.proposition,
    briefing: state.report ?? null,
    consensusScore: null,
    vote: null,
    verdict: null,
    error,
  }
}

export type DebateAdvance =
  | { done: false; stage: string; state: DebatePipelineState }
  | { done: true; result: DeepDebateResult; state: DebatePipelineState }

export async function advanceDebateState(state: DebatePipelineState): Promise<DebateAdvance> {
  if (state.result?.ok) {
    return { done: true, result: state.result, state }
  }

  if (!state.plan) {
    const plan = await planLeagueDebateMeeting({
      question: state.question,
      availableDataSummary: state.availableDataSummary,
    })
    if (!plan.ok || plan.roles.length === 0) {
      const result = failResult(state, plan.error ?? 'orchestrator failed')
      return { done: true, result, state: { ...state, plan, result } }
    }
    return { done: false, stage: 'plan', state: { ...state, plan: remapOpenPlanExaone(plan) } }
  }

  if (!state.report) {
    const pre = await generateLeaguePreReport({
      question: state.question,
      context: state.context,
    })
    if (!pre.ok || !pre.report?.trim()) {
      const result = failResult(state, pre.error ?? 'pre-report failed')
      return { done: true, result, state: { ...state, report: pre.report, result } }
    }
    return { done: false, stage: 'report', state: { ...state, report: pre.report } }
  }

  if (!state.deliberation) {
    // ONE deliberation round per hop. Rounds accumulate in `rounds` and
    // persist between leases; the stop rule decides when the debate is
    // settled and the assembled deliberation unlocks the vote hop.
    const priorRounds = state.rounds ?? []
    const round = await runLeagueDeliberationRound({
      question: state.question,
      roles: state.plan.roles,
      seedAnalyses: seedFromReport(state.report, state.plan.roles),
      priorRounds,
    })
    const rounds = [...priorRounds, round]
    const decision = decideDeliberationStop(rounds, LEAGUE_DEBATE_MAX_ROUNDS)
    if (!decision.stop) {
      return { done: false, stage: 'deliberate', state: { ...state, rounds } }
    }
    const deliberation = assembleLeagueDeliberation(
      rounds,
      decision.reason,
      decision.reason === 'error' ? round.error ?? 'consensus failed' : undefined
    )
    if (!deliberation.ok) {
      const result = failResult({ ...state, rounds }, deliberation.error ?? 'deliberation failed')
      return { done: true, result, state: { ...state, rounds, deliberation, result } }
    }
    return { done: false, stage: 'deliberate', state: { ...state, rounds, deliberation } }
  }

  if (!state.vote) {
    // Vote hop: the 9-seat advisory ballot, separated from the chair call.
    // A failed ballot does not fail the run (matches the old behavior —
    // the chair writes with whatever ballot summary exists).
    const vote = await runLeagueMotionVote({
      question: state.question,
      deliberation: state.deliberation,
    })
    return { done: false, stage: 'vote', state: { ...state, vote } }
  }

  const verdict = await renderLeagueChairVerdict({
    question: state.question,
    briefing: state.report ?? null,
    context: state.context,
    deliberation: state.deliberation,
    vote: state.vote,
  })
  const result: DeepDebateResult = {
    ok: verdict.ok,
    kind: 'debate',
    instrument: state.instrument,
    proposition: state.proposition,
    briefing: state.report ?? null,
    consensusScore: verdict.consensusScore,
    vote: {
      approve: state.vote.approveCount,
      oppose: state.vote.opposeCount,
      conditional: state.vote.conditionalCount,
      abstain: state.vote.abstainCount,
      summary: state.vote.summary,
    },
    verdict: {
      judgment: verdict.judgment,
      keyIssues: verdict.keyIssues,
      minorityReport: verdict.minorityReport,
    },
    error: verdict.ok ? undefined : verdict.error,
  }
  return { done: true, result, state: { ...state, result } }
}

export async function runDeepDebate(ctx: LeagueDeepContext): Promise<DeepDebateResult> {
  return runWithOutputLanguage(ctx.outputLanguage, async () => {
    let state = seedDebateState(ctx)
    // plan + report + up to LEAGUE_DEBATE_MAX_ROUNDS deliberation hops +
    // vote + verdict; margin on top.
    for (let i = 0; i < 10; i += 1) {
      const step = await advanceDebateState(state)
      if (step.done) return step.result
      state = step.state
    }
    return failResult(state, 'debate did not finish')
  })
}
