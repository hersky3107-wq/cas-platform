import 'server-only'

import {
  planLeagueDebateMeeting,
  renderLeagueChairVerdict,
  runLeagueDeliberation,
  runLeagueMotionVote,
} from './deep-debate-engine'
import { generateLeaguePreReport } from './deep-open-engine'
import { remapOpenPlanExaone } from './deep-open-replacement-policy'
import type { LeagueDeepContext } from './deep-context'
import type { LeagueLocale } from './i18n/locales'
import { runWithOutputLanguage } from './deep-output-language'
import type { DeepDebateResult } from './deep-debate-types'
import type { DeepProviderMeta } from './deep-store'
import type { LeagueDebateMeetingPlan, LeagueDeliberation } from './deep-types'

export type { DeepDebateResult } from './deep-debate-types'

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
  deliberation?: LeagueDeliberation
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
  if (!state.plan) return 'plan'
  if (!state.report) return 'report'
  if (!state.deliberation) return 'deliberate'
  return 'verdict'
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
    const deliberation = await runLeagueDeliberation({
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

  const vote = await runLeagueMotionVote({
    question: state.question,
    deliberation: state.deliberation,
  })
  const verdict = await renderLeagueChairVerdict({
    question: state.question,
    briefing: state.report ?? null,
    context: state.context,
    deliberation: state.deliberation,
    vote,
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

export async function runDeepDebate(ctx: LeagueDeepContext): Promise<DeepDebateResult> {
  return runWithOutputLanguage(ctx.outputLanguage, async () => {
    let state = seedDebateState(ctx)
    for (let i = 0; i < 6; i += 1) {
      const step = await advanceDebateState(state)
      if (step.done) return step.result
      state = step.state
    }
    return failResult(state, 'debate did not finish')
  })
}
