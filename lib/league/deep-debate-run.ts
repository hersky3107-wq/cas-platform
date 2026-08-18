import 'server-only'

import {
  planJejuMeeting,
  runDeliberation,
  runJejuMotionVote,
  renderChairVerdict,
  type JejuMeetingPlan,
  type JejuDeliberation,
  type JejuRevisedAnalysis,
  type JejuExecutedSearch,
} from '@/lib/motie/deep'
import { generateJejuPreReport } from '@/lib/motie/pre-report'
import { SYNOD_DEBATERS } from '@/lib/motie/synod-debate'
import type { LeagueDeepContext } from './deep-context'
import type { DeepDebateResult } from './deep-debate-types'
import type { DeepProviderMeta } from './deep-store'

export type { DeepDebateResult } from './deep-debate-types'

export type DebatePipelineState = {
  instrument: string
  category: string
  proposition: string
  question: string
  context: string
  availableDataSummary: string
  snapshot: LeagueDeepContext['snapshot']
  plan?: JejuMeetingPlan
  report?: string | null
  searches?: JejuExecutedSearch[]
  deliberation?: JejuDeliberation
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
  }
}

export function providersFromDebateState(state: DebatePipelineState): DeepProviderMeta[] {
  return (state.plan?.roles ?? []).map((r) => ({ provider: r.provider, roleLabel: r.roleLabel }))
}

function seedFromReport(
  report: string | null,
  roles: { roleId: string; roleLabel: string; provider: string; isRedTeam?: boolean }[]
): JejuRevisedAnalysis[] {
  if (!report?.trim()) return []
  const first = roles[0]
  return [
    {
      roleId: first?.roleId ?? 'brief',
      roleLabel: first?.roleLabel ?? 'Pre-report',
      provider: (first?.provider ?? 'anthropic') as JejuRevisedAnalysis['provider'],
      isRedTeam: first?.isRedTeam === true,
      ok: true,
      firstPass: report,
      revised: report,
      changed: false,
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

/**
 * One HTTP-sized stage. A one-shot local run took ~346s.
 * start → plan → pre-report → deliberation → vote + chair
 */
export async function advanceDebateState(state: DebatePipelineState): Promise<DebateAdvance> {
  if (state.result?.ok) {
    return { done: true, result: state.result, state }
  }

  if (!state.plan) {
    const plan = await planJejuMeeting({
      question: state.question,
      availableDataSummary: state.availableDataSummary,
      debateBrands: [...SYNOD_DEBATERS],
      councilMode: 'warroom',
    })
    if (!plan.ok || plan.roles.length === 0) {
      const result = failResult(state, plan.error ?? 'orchestrator failed')
      return { done: true, result, state: { ...state, plan, result } }
    }
    return { done: false, stage: 'plan', state: { ...state, plan } }
  }

  if (!state.report) {
    const pre = await generateJejuPreReport({
      question: state.question,
      snapshot: state.snapshot,
      context: state.context,
      mode: 'deliberation',
      councilMode: 'warroom',
    })
    if (!pre.ok || !pre.report?.trim()) {
      const result = failResult(state, pre.error ?? 'pre-report failed')
      return { done: true, result, state: { ...state, report: pre.report, searches: pre.searches, result } }
    }
    return { done: false, stage: 'report', state: { ...state, report: pre.report, searches: pre.searches } }
  }

  if (!state.deliberation) {
    const deliberation = await runDeliberation({
      question: state.question,
      roles: state.plan.roles,
      seedAnalyses: seedFromReport(state.report, state.plan.roles),
      maxRounds: 2,
    })
    if (!deliberation.ok) {
      const result = failResult(state, deliberation.error ?? 'deliberation failed')
      return { done: true, result, state: { ...state, deliberation, result } }
    }
    return { done: false, stage: 'deliberate', state: { ...state, deliberation } }
  }

  const vote = await runJejuMotionVote({
    question: state.question,
    deliberation: state.deliberation,
    councilMode: 'warroom',
  })
  const verdict = await renderChairVerdict({
    question: state.question,
    snapshot: state.snapshot,
    analyses: [],
    searches: state.searches ?? [],
    revised: seedFromReport(state.report ?? null, state.plan.roles),
    rebuttals: [],
    deliberation: state.deliberation,
    brief: state.deliberation.finalScore >= 85,
    vote,
    councilMode: 'warroom',
  })
  const result: DeepDebateResult = {
    ok: verdict.ok,
    kind: 'debate',
    instrument: state.instrument,
    proposition: state.proposition,
    briefing: state.report ?? null,
    consensusScore: verdict.consensusScore,
    vote: {
      approve: vote.approveCount,
      oppose: vote.opposeCount,
      conditional: vote.conditionalCount,
      abstain: vote.abstainCount,
      summary: vote.summary,
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

/** Test/script helper — runs every stage in-process (not for the HTTP route). */
export async function runDeepDebate(ctx: LeagueDeepContext): Promise<DeepDebateResult> {
  let state = seedDebateState(ctx)
  for (let i = 0; i < 6; i += 1) {
    const step = await advanceDebateState(state)
    if (step.done) return step.result
    state = step.state
  }
  return failResult(state, 'debate did not finish')
}
