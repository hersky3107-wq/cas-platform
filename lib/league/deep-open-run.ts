import 'server-only'

import {
  generateLeaguePreReport,
  planLeagueOpenMeeting,
  runLeagueOpenAnalyses,
  synthesizeLeagueOpenBrief,
} from './deep-open-engine'
import { remapOpenPlanExaone } from './deep-open-replacement-policy'
import type { LeagueDeepContext } from './deep-context'
import type { LeagueLocale } from './i18n/locales'
import { runWithOutputLanguage } from './deep-output-language'
import type { LeagueOpenAnalysis, LeagueOpenMeetingPlan } from './deep-types'
import type { DeepProviderMeta } from './deep-store'

export type DeepOpenResult = {
  ok: boolean
  kind: 'open'
  instrument: string
  proposition: string
  briefing: string | null
  analyses: { provider: string; roleLabel: string; content: string | null; ok: boolean }[]
  synthesis: string | null
  error?: string
}

export type OpenPipelineState = {
  instrument: string
  category: string
  proposition: string
  question: string
  context: string
  availableDataSummary: string
  snapshot: LeagueDeepContext['snapshot']
  outputLanguage: LeagueLocale
  plan?: LeagueOpenMeetingPlan
  report?: string | null
  analyses?: LeagueOpenAnalysis[]
  result?: DeepOpenResult
}

export function seedOpenState(ctx: LeagueDeepContext): OpenPipelineState {
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

export function upcomingOpenStage(state: OpenPipelineState): string {
  if (!state.plan) return 'plan'
  if (!state.report) return 'report'
  if (!state.analyses) return 'analyses'
  return 'synthesis'
}

export function providersFromOpenState(state: OpenPipelineState): DeepProviderMeta[] {
  if (state.plan?.roles?.length) {
    return state.plan.roles.map((r) => ({ provider: r.provider, roleLabel: r.roleLabel }))
  }
  return (state.analyses ?? []).map((a) => ({ provider: a.provider, roleLabel: a.roleLabel }))
}

function failResult(state: OpenPipelineState, error: string): DeepOpenResult {
  return {
    ok: false,
    kind: 'open',
    instrument: state.instrument,
    proposition: state.proposition,
    briefing: state.report ?? null,
    analyses: (state.analyses ?? []).map((a) => ({
      provider: a.provider,
      roleLabel: a.roleLabel,
      content: a.analysis,
      ok: a.ok,
    })),
    synthesis: null,
    error,
  }
}

export type OpenAdvance =
  | { done: false; stage: string; state: OpenPipelineState }
  | { done: true; result: DeepOpenResult; state: OpenPipelineState }

export async function advanceOpenState(state: OpenPipelineState): Promise<OpenAdvance> {
  if (state.result?.ok) {
    return { done: true, result: state.result, state }
  }

  if (!state.plan) {
    const plan = await planLeagueOpenMeeting({
      question: state.question,
      availableDataSummary: state.availableDataSummary,
    })
    if (!plan.ok) {
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

  if (!state.analyses) {
    const analyses = await runLeagueOpenAnalyses({
      question: state.question,
      plan: state.plan,
      briefing: state.report,
      context: state.context,
    })
    const anyOk = analyses.some((a) => a.ok)
    if (!anyOk) {
      const result = failResult({ ...state, analyses }, 'all analyses failed')
      return { done: true, result, state: { ...state, analyses, result } }
    }
    return { done: false, stage: 'analyses', state: { ...state, analyses } }
  }

  const synthesis = await synthesizeLeagueOpenBrief({
    question: state.question,
    briefing: state.report,
    analyses: state.analyses,
  })
  const result: DeepOpenResult = {
    ok: synthesis.ok,
    kind: 'open',
    instrument: state.instrument,
    proposition: state.proposition,
    briefing: state.report,
    analyses: state.analyses.map((a) => ({
      provider: a.provider,
      roleLabel: a.roleLabel,
      content: a.analysis,
      ok: a.ok,
    })),
    synthesis: synthesis.synthesis,
    error: synthesis.ok ? undefined : synthesis.error ?? 'synthesis failed',
  }
  return { done: true, result, state: { ...state, result } }
}

export async function runDeepOpen(ctx: LeagueDeepContext): Promise<DeepOpenResult> {
  return runWithOutputLanguage(ctx.outputLanguage, async () => {
    let state = seedOpenState(ctx)
    for (let i = 0; i < 6; i += 1) {
      const step = await advanceOpenState(state)
      if (step.done) return step.result
      state = step.state
    }
    return failResult(state, 'open analysis did not finish')
  })
}
