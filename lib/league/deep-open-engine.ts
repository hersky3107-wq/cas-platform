import { callLeagueDeepModel, parseJsonObject } from './deep-model'
import {
  LEAGUE_DEEP_BRAND_LABEL,
  LEAGUE_DEEP_OPEN_ROSTER,
  fallbackOpenRoles,
  leagueAnalystSystemPrompt,
  leagueAnalystUserPrompt,
  leagueOpenOrchestratorSystemPrompt,
  leaguePreReportSystemPrompt,
  leagueSynthesisSystemPrompt,
} from './deep-prompts'
import type { LeagueDeepRole, LeagueOpenAnalysis, LeagueOpenMeetingPlan, LeaguePreReport } from './deep-types'

const OPEN_SET = new Set<string>(LEAGUE_DEEP_OPEN_ROSTER)

function asOpenRole(raw: unknown, fallbackProvider: string): LeagueDeepRole | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const provider = typeof o.provider === 'string' && OPEN_SET.has(o.provider) ? o.provider : fallbackProvider
  const roleLabel = typeof o.roleLabel === 'string' && o.roleLabel.trim() ? o.roleLabel.trim() : 'Independent analyst'
  const mandate = typeof o.mandate === 'string' && o.mandate.trim() ? o.mandate.trim() : 'Read the league packets from this lens.'
  const roleId = typeof o.roleId === 'string' && o.roleId.trim() ? o.roleId.trim() : provider
  const subQuestion =
    typeof o.subQuestion === 'string' && o.subQuestion.trim() ? o.subQuestion.trim() : mandate
  return {
    roleId,
    roleLabel,
    mandate,
    provider,
    subQuestion,
    isDoubledAngle: o.isDoubledAngle === true,
    doubledGroupId: typeof o.doubledGroupId === 'string' ? o.doubledGroupId : undefined,
  }
}

export function fallbackOpenPlan(question: string): LeagueOpenMeetingPlan {
  const defaults = fallbackOpenRoles()
  return {
    ok: true,
    question,
    rationale: 'Fixed independent-analyst lineup; no government seating.',
    primaryAngleId: 'price',
    searchNeeded: false,
    roles: defaults.map((role, i) => ({
      ...role,
      provider: LEAGUE_DEEP_OPEN_ROSTER[i] ?? 'anthropic',
    })),
  }
}

export async function planLeagueOpenMeeting(params: {
  question: string
  availableDataSummary: string
}): Promise<LeagueOpenMeetingPlan> {
  const question = params.question.trim()
  if (!question) {
    return { ok: false, question, roles: [], rationale: '', primaryAngleId: '', searchNeeded: false, error: 'empty question' }
  }

  const userPrompt = [
    '[Proposition]',
    question,
    '',
    '[Packets already on this round]',
    params.availableDataSummary || '(none)',
    '',
    'Assign 8 independent analyst seats. JSON only.',
  ].join('\n')

  const called = await callLeagueDeepModel({
    provider: 'anthropic',
    systemPrompt: leagueOpenOrchestratorSystemPrompt(),
    userPrompt,
    maxCompletionTokens: 3000,
    modelOverride: 'claude-opus-4-8',
  })

  if (called.error || !called.text) {
    return { ...fallbackOpenPlan(question), rationale: `orchestrator fallback: ${called.error ?? 'empty'}` }
  }

  const parsed = parseJsonObject(called.text)
  const assignments = Array.isArray(parsed?.assignments) ? parsed.assignments : []
  const used = new Set<string>()
  const roles: LeagueDeepRole[] = []
  for (const item of assignments) {
    const role = asOpenRole(item, LEAGUE_DEEP_OPEN_ROSTER[roles.length] ?? 'anthropic')
    if (!role || used.has(role.provider)) continue
    used.add(role.provider)
    roles.push(role)
  }

  if (roles.length !== LEAGUE_DEEP_OPEN_ROSTER.length) {
    return fallbackOpenPlan(question)
  }

  return {
    ok: true,
    question,
    roles,
    rationale: typeof parsed?.rationale === 'string' ? parsed.rationale : '',
    primaryAngleId: typeof parsed?.primaryAngleId === 'string' ? parsed.primaryAngleId : 'primary',
    searchNeeded: false,
  }
}

export async function generateLeaguePreReport(params: {
  question: string
  context: string
}): Promise<LeaguePreReport> {
  const question = params.question.trim()
  const context = params.context.trim()
  if (!question) return { ok: false, report: null, error: 'empty question' }
  if (!context) return { ok: false, report: null, error: 'empty packet context' }

  const called = await callLeagueDeepModel({
    provider: 'anthropic',
    systemPrompt: leaguePreReportSystemPrompt(),
    userPrompt: ['[Proposition]', question, '', '[Round packets — no extra search]', context].join('\n'),
    maxCompletionTokens: 8000,
  })
  if (called.error || !called.text) {
    return { ok: false, report: null, error: called.error ?? 'empty briefing' }
  }
  return { ok: true, report: called.text }
}

export async function runLeagueOpenAnalyses(params: {
  question: string
  plan: LeagueOpenMeetingPlan
  briefing: string
  context: string
  /** Optional subset — the durable pipeline batches seats across hops (resume-safe). */
  roles?: LeagueDeepRole[]
}): Promise<LeagueOpenAnalysis[]> {
  const planRoles = params.plan.roles.length > 0 ? params.plan.roles : fallbackOpenPlan(params.question).roles
  const roles = params.roles && params.roles.length > 0 ? params.roles : planRoles
  const settled = await Promise.allSettled(
    roles.map(async (role) => {
      const called = await callLeagueDeepModel({
        provider: role.provider,
        systemPrompt: leagueAnalystSystemPrompt(role.roleLabel, role.mandate),
        userPrompt: leagueAnalystUserPrompt({
          question: params.question,
          subQuestion: role.subQuestion ?? role.mandate,
          briefing: params.briefing,
          context: params.context,
        }),
        maxCompletionTokens: 8000,
      })
      const base: LeagueOpenAnalysis = {
        roleId: role.roleId,
        roleLabel: role.roleLabel,
        provider: role.provider,
        subQuestion: role.subQuestion ?? role.mandate,
        isDoubledAngle: role.isDoubledAngle === true,
        ok: false,
        analysis: null,
      }
      if (called.error || !called.text || called.text.length < 80) {
        return { ...base, error: called.error ?? 'analyst returned empty text' }
      }
      return { ...base, ok: true, analysis: called.text }
    })
  )

  return settled.map((s, i) => {
    if (s.status === 'fulfilled') return s.value
    const role = roles[i]!
    return {
      roleId: role.roleId,
      roleLabel: role.roleLabel,
      provider: role.provider,
      subQuestion: role.subQuestion ?? role.mandate,
      isDoubledAngle: role.isDoubledAngle === true,
      ok: false,
      analysis: null,
      error: s.reason instanceof Error ? s.reason.message : 'analyst rejected',
    }
  })
}

export async function synthesizeLeagueOpenBrief(params: {
  question: string
  briefing: string
  analyses: LeagueOpenAnalysis[]
}): Promise<{ ok: boolean; synthesis: string | null; error?: string }> {
  if (!params.question.trim()) return { ok: false, synthesis: null, error: 'empty question' }
  if (!params.briefing.trim()) return { ok: false, synthesis: null, error: 'empty briefing' }

  const analysesBlock = params.analyses
    .map((a, i) => {
      const brand = LEAGUE_DEEP_BRAND_LABEL[a.provider] ?? a.provider
      const body = a.ok && a.analysis ? a.analysis : `(failed: ${a.error ?? 'unknown'})`
      return `── ${i + 1}. ${brand} (${a.roleLabel}) ──\n${a.subQuestion}\n${body}`
    })
    .join('\n\n')

  const called = await callLeagueDeepModel({
    provider: 'anthropic',
    systemPrompt: leagueSynthesisSystemPrompt(),
    userPrompt: [
      '[Proposition]',
      params.question,
      '',
      '[Packet briefing]',
      params.briefing,
      '',
      '[Independent analyses]',
      analysesBlock,
    ].join('\n'),
    maxCompletionTokens: 5000,
    modelOverride: 'claude-opus-4-8',
  })
  if (called.error || !called.text) {
    return { ok: false, synthesis: null, error: called.error ?? 'empty synthesis' }
  }
  return { ok: true, synthesis: called.text }
}
