import { callPlatformModel } from '@/lib/ai/platform-providers'
import {
  buildAnalystSystemPrompt,
  buildAnalystUserPrompt,
  runJejuOpenAnalyses,
  type JejuOpenAnalysis,
  type JejuOpenAnalysisRole,
  type JejuOpenMeetingPlan,
} from '@/lib/motie/open-brief'
import type { JejuExecutedSearch } from '@/lib/motie/deep'
import {
  isLeagueOpenReplacementSeat,
  LEAGUE_OPEN_REPLACEMENT_PLATFORM_ID,
  LEAGUE_OPEN_REPLACEMENT_PROVIDER,
} from './deep-open-replacement-policy'

export {
  isLeagueOpenReplacementSeat,
  LEAGUE_DEAD_OPEN_PROVIDER,
  LEAGUE_OPEN_REPLACEMENT_PLATFORM_ID,
  LEAGUE_OPEN_REPLACEMENT_PROVIDER,
  remapOpenPlanExaone,
} from './deep-open-replacement-policy'

/**
 * Friendli removed LGAI-EXAONE/K-EXAONE-2.0-750B-A37B from serverless on
 * 2026-09-06. The 8-seat deep-open roster still assigned that seat, so a
 * 50-credit buyer got 7 briefs. Replacement is GLM-5.2 (premier, MIT,
 * $1.19/$3.74) — probed 2026-09-14 on a real warroom analyst prompt:
 * 1043 Korean chars, both required sections, $0.0035, 33s.
 */

export async function runLeagueOpenAnalyses(params: {
  question: string
  plan: JejuOpenMeetingPlan
  briefing: string
  context: string
  searches?: JejuExecutedSearch[]
}): Promise<JejuOpenAnalysis[]> {
  const liveRoles = params.plan.roles.filter((role) => !isLeagueOpenReplacementSeat(role.provider))
  const swapRoles = params.plan.roles.filter((role) => isLeagueOpenReplacementSeat(role.provider))

  const [live, swapped] = await Promise.all([
    liveRoles.length > 0
      ? runJejuOpenAnalyses({
          question: params.question,
          plan: { ...params.plan, roles: liveRoles },
          briefing: params.briefing,
          context: params.context,
          councilMode: 'warroom',
          searches: params.searches,
        })
      : Promise.resolve([] as JejuOpenAnalysis[]),
    Promise.all(swapRoles.map((role) => runReplacementAnalyst(role, params))),
  ])

  const byRoleId = new Map<string, JejuOpenAnalysis>()
  for (const row of [...live, ...swapped]) byRoleId.set(row.roleId, row)
  return params.plan.roles.map((role) => {
    const hit = byRoleId.get(role.roleId)
    if (hit) return hit
    return {
      roleId: role.roleId,
      roleLabel: role.roleLabel,
      provider: LEAGUE_OPEN_REPLACEMENT_PROVIDER as JejuOpenAnalysis['provider'],
      subQuestion: role.subQuestion,
      isDoubledAngle: role.isDoubledAngle,
      ok: false,
      analysis: null,
      error: 'replacement seat produced no row',
    }
  })
}

async function runReplacementAnalyst(
  role: JejuOpenAnalysisRole,
  params: { question: string; briefing: string; context: string; searches?: JejuExecutedSearch[] }
): Promise<JejuOpenAnalysis> {
  const labeled: JejuOpenAnalysisRole = {
    ...role,
    provider: LEAGUE_OPEN_REPLACEMENT_PROVIDER as JejuOpenAnalysisRole['provider'],
  }
  const base: JejuOpenAnalysis = {
    roleId: role.roleId,
    roleLabel: role.roleLabel,
    provider: labeled.provider,
    subQuestion: role.subQuestion,
    isDoubledAngle: role.isDoubledAngle,
    ok: false,
    analysis: null,
  }
  try {
    const called = await callPlatformModel({
      id: LEAGUE_OPEN_REPLACEMENT_PLATFORM_ID,
      systemPrompt: buildAnalystSystemPrompt(labeled, 'warroom'),
      userPrompt: buildAnalystUserPrompt({
        question: params.question,
        role: labeled,
        briefing: params.briefing,
        context: params.context,
        councilMode: 'warroom',
        searches: params.searches,
      }),
      maxCompletionTokens: 8000,
      timeoutMs: 120_000,
    })
    const text = called.text?.trim() ?? ''
    if (called.error || text.length < 80) {
      return { ...base, error: called.error ?? 'replacement analyst returned empty text' }
    }
    return { ...base, ok: true, analysis: text }
  } catch (e: unknown) {
    return { ...base, error: e instanceof Error ? e.message : 'replacement analyst threw' }
  }
}
