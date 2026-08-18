import 'server-only'

import { planJejuOpenMeeting, runJejuOpenAnalyses, synthesizeJejuOpenBrief } from '@/lib/motie/open-brief'
import { generateJejuPreReport } from '@/lib/motie/pre-report'
import type { JejuOpenMeetingPlan, JejuOpenAnalysis } from '@/lib/motie/open-brief'
import type { JejuExecutedSearch } from '@/lib/motie/deep'
import type { LeagueDeepContext } from './deep-context'
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
  plan?: JejuOpenMeetingPlan
  report?: string | null
  searches?: JejuExecutedSearch[]
  analyses?: JejuOpenAnalysis[]
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
  }
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

/**
 * One HTTP-sized stage. A one-shot local run of this pipeline took ~227s
 * against a 300s platform cap — splitting is what keeps a kill from
 * landing mid-run with no persisted checkpoint.
 *
 * start → plan → pre-report → analyses → synthesize
 */
export async function advanceOpenState(state: OpenPipelineState): Promise<OpenAdvance> {
  if (state.result?.ok) {
    return { done: true, result: state.result, state }
  }

  if (!state.plan) {
    const plan = await planJejuOpenMeeting({
      question: state.question,
      availableDataSummary: state.availableDataSummary,
      councilMode: 'warroom',
    })
    if (!plan.ok) {
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
      mode: 'briefing',
      councilMode: 'warroom',
    })
    if (!pre.ok || !pre.report?.trim()) {
      const result = failResult(state, pre.error ?? 'pre-report failed')
      return { done: true, result, state: { ...state, report: pre.report, searches: pre.searches, result } }
    }
    return { done: false, stage: 'report', state: { ...state, report: pre.report, searches: pre.searches } }
  }

  if (!state.analyses) {
    const analyses = await runJejuOpenAnalyses({
      question: state.question,
      plan: state.plan,
      briefing: state.report,
      context: state.context,
      councilMode: 'warroom',
      searches: state.searches,
    })
    const anyOk = analyses.some((a) => a.ok)
    if (!anyOk) {
      const result = failResult({ ...state, analyses }, 'all analyses failed')
      return { done: true, result, state: { ...state, analyses, result } }
    }
    return { done: false, stage: 'analyses', state: { ...state, analyses } }
  }

  const synthesis = await synthesizeJejuOpenBrief({
    question: state.question,
    briefing: state.report,
    analyses: state.analyses,
    searches: state.searches,
    councilMode: 'warroom',
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

/** Test/script helper — runs every stage in-process (not for the HTTP route). */
export async function runDeepOpen(ctx: LeagueDeepContext): Promise<DeepOpenResult> {
  let state = seedOpenState(ctx)
  for (let i = 0; i < 6; i += 1) {
    const step = await advanceOpenState(state)
    if (step.done) return step.result
    state = step.state
  }
  return failResult(state, 'open analysis did not finish')
}
