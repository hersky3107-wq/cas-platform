import 'server-only'

import { PERPLEXITY_SONAR_DEEP_RESEARCH_MODEL } from '@/lib/ai/router'
import { supabaseAdmin } from '@/lib/supabase/server'
import { categoryDeepGuards } from './deep-prompts'
import { callLeagueDeepModel } from './deep-model'
import type { LeagueDeepContext } from './deep-context'
import {
  admitEvidenceClaim,
  classifySourceTier,
  renderEvidenceDossier,
  type EvidenceFinding,
} from './deep-report-dossier'
import {
  assignDebateSides,
  bilingualResearchQueries,
  languageLockLine,
  leagueDeepResearchCapUsd,
  reportStageFor,
  researchPathForCap,
  type DebateSide,
  type PlannedQuery,
  type ResearchPath,
} from './deep-report-policy'
import { chairUserPrompt, openingUserPrompt, rebuttalUserPrompt } from './deep-report-prompts'
import type { LeagueLocale } from './i18n/locales'
import { RESEARCH_ANGLES, type ResearchAngle } from './deep-report-policy'

export type ReportTurn = {
  provider: string
  model: string
  side: DebateSide
  text: string | null
  ok: boolean
}

export type ReportResearch = {
  path: ResearchPath
  dossier: string
  findings: EvidenceFinding[]
}

export type ReportPipelineState = {
  roundId: string
  instrument: string
  category: string
  proposition: string
  context: string
  outputLanguage: LeagueLocale
  research?: ReportResearch
  openings?: ReportTurn[]
  rebuttals?: ReportTurn[]
  chairReport?: string | null
  fortySeatAggregate?: string
  result?: { ok: boolean; report: string | null; error?: string }
}

const RESEARCH_TIMEOUT_MS = 150_000
const DEBATE_TIMEOUT_MS = 90_000
const CHAIR_TIMEOUT_MS = 120_000

export function seedReportState(ctx: LeagueDeepContext): ReportPipelineState {
  return {
    roundId: ctx.roundId,
    instrument: ctx.instrument,
    category: ctx.category,
    proposition: ctx.proposition,
    context: ctx.context,
    outputLanguage: ctx.outputLanguage,
  }
}

export function upcomingReportStage(state: ReportPipelineState): string {
  if (state.result?.ok) return 'done'
  return reportStageFor(state)
}

function systemFor(locale: LeagueLocale, role: string): string {
  return [role, languageLockLine(locale), 'Packet and dossier only. No new web browsing beyond what you were given.'].join('\n')
}

async function searchSeat(params: {
  provider: string
  model: string
  searchTool: boolean
  prompt: string
  timeoutMs: number
}): Promise<string | null> {
  const called = await callLeagueDeepModel({
    provider: params.provider,
    systemPrompt: 'Return dated findings with URLs. Say none found when empty. Never invent a date or a number.',
    userPrompt: params.prompt,
    maxCompletionTokens: 1800,
    timeoutMs: params.timeoutMs,
    modelOverride: params.model,
    searchTool: params.searchTool,
  })
  return called.text
}

function findingsFromText(provider: string, text: string, category: string): EvidenceFinding[] {
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line.length > 12)
  const out: EvidenceFinding[] = []
  for (const line of lines.slice(0, 24)) {
    const claim = admitEvidenceClaim(line.replace(/^[-*]\s*/, ''), category)
    if (!claim) continue
    const url = claim.match(/https?:\/\/\S+/)?.[0]?.replace(/[),.;]+$/, '') ?? null
    const date = claim.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1] ?? null
    const angle = RESEARCH_ANGLES[out.length % RESEARCH_ANGLES.length]!
    out.push({
      angle: angle as ResearchAngle,
      claim,
      url,
      date,
      tier: classifySourceTier(url, claim),
      provider,
    })
  }
  return out
}

function queryBlock(queries: PlannedQuery[]): string {
  return queries.map((row) => `[${row.lang}/${row.angle}] ${row.text}`).join('\n')
}

function chunkQueries(queries: PlannedQuery[], size: number): PlannedQuery[][] {
  const out: PlannedQuery[][] = []
  for (let i = 0; i < queries.length; i += size) out.push(queries.slice(i, i + size))
  return out
}

export async function runReportResearch(state: ReportPipelineState): Promise<ReportResearch> {
  const cap = leagueDeepResearchCapUsd()
  const path = researchPathForCap(cap)
  const queries = bilingualResearchQueries(state.proposition, state.outputLanguage)
  const instructions = [
    languageLockLine(state.outputLanguage),
    `Proposition: ${state.proposition}`,
    'Run every query below. One finding per line, in the viewer language, with a date and a source URL when you have them.',
    'Say none found when a query is empty. Never invent a date or a number.',
    queryBlock(queries),
  ].join('\n')

  const seats =
    path === 'deep'
      ? [
          searchSeat({
            provider: 'perplexity',
            model: PERPLEXITY_SONAR_DEEP_RESEARCH_MODEL,
            searchTool: false,
            prompt: instructions,
            timeoutMs: RESEARCH_TIMEOUT_MS,
          }),
          searchSeat({
            provider: 'google',
            model: 'gemini-3.6-flash',
            searchTool: true,
            prompt: instructions,
            timeoutMs: RESEARCH_TIMEOUT_MS,
          }),
          searchSeat({
            provider: 'xai',
            model: 'grok-4.3',
            searchTool: true,
            prompt: instructions,
            timeoutMs: RESEARCH_TIMEOUT_MS,
          }),
          searchSeat({
            provider: 'anthropic',
            model: 'claude-sonnet-5',
            searchTool: true,
            prompt: instructions,
            timeoutMs: RESEARCH_TIMEOUT_MS,
          }),
        ]
      : chunkQueries(queries, Math.ceil(queries.length / 4) || 1).map((group) =>
          searchSeat({
            provider: 'perplexity',
            model: 'sonar',
            searchTool: false,
            prompt: [
              languageLockLine(state.outputLanguage),
              `Proposition: ${state.proposition}`,
              'Standard search only. One finding per line with date and URL. Say none found when empty.',
              queryBlock(group),
            ].join('\n'),
            timeoutMs: RESEARCH_TIMEOUT_MS,
          }),
        )

  const settled = await Promise.all(seats)
  const findings: EvidenceFinding[] = []
  settled.forEach((text, i) => {
    const label = path === 'deep' ? (['perplexity', 'google', 'xai', 'anthropic'][i] ?? 'search') : 'perplexity'
    if (text) findings.push(...findingsFromText(label, text, state.category))
  })
  return {
    path,
    findings,
    dossier: renderEvidenceDossier({
      locale: state.outputLanguage,
      category: state.category,
      findings,
      fallback: path === 'standard_fallback',
    }),
  }
}

async function speak(params: {
  provider: string
  model: string
  systemPrompt: string
  userPrompt: string
}): Promise<string | null> {
  const called = await callLeagueDeepModel({
    provider: params.provider,
    systemPrompt: params.systemPrompt,
    userPrompt: params.userPrompt,
    maxCompletionTokens: 1400,
    timeoutMs: DEBATE_TIMEOUT_MS,
    modelOverride: params.model,
  })
  return called.text
}

export async function runReportOpenings(state: ReportPipelineState): Promise<ReportTurn[]> {
  const seats = assignDebateSides(state.roundId)
  const dossier = state.research?.dossier ?? ''
  const settled = await Promise.all(
    seats.map(async (seat) => {
      const text = await speak({
        provider: seat.provider,
        model: seat.model,
        systemPrompt: systemFor(state.outputLanguage, `Opening argument for ${seat.side}.`),
        userPrompt: openingUserPrompt({
          locale: state.outputLanguage,
          proposition: state.proposition,
          packet: state.context,
          dossier,
          side: seat.side,
          model: seat.model,
        }),
      })
      return { provider: seat.provider, model: seat.model, side: seat.side, text, ok: Boolean(text && text.length > 40) }
    }),
  )
  return settled
}

export async function runReportRebuttals(state: ReportPipelineState): Promise<ReportTurn[]> {
  const openings = state.openings ?? []
  const dossier = state.research?.dossier ?? ''
  const settled = await Promise.all(
    openings.map(async (seat) => {
      const opposite = openings
        .filter((row) => row.side !== seat.side && row.text)
        .map((row) => `${row.model}: ${row.text}`)
        .join('\n\n')
      const text = await speak({
        provider: seat.provider,
        model: seat.model,
        systemPrompt: systemFor(state.outputLanguage, `Rebuttal and final probability for ${seat.side}.`),
        userPrompt: rebuttalUserPrompt({
          locale: state.outputLanguage,
          proposition: state.proposition,
          packet: state.context,
          dossier,
          side: seat.side,
          ownOpening: seat.text ?? '',
          oppositeOpenings: opposite || '(none)',
        }),
      })
      return { provider: seat.provider, model: seat.model, side: seat.side, text, ok: Boolean(text && text.length > 40) }
    }),
  )
  return settled
}

export async function loadFortySeatAggregate(roundId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('model_predictions')
    .select('predicted_direction, league_tier')
    .eq('round_id', roundId)
  if (error || !data) return '40-seat aggregate unavailable.'
  const counts = new Map<string, number>()
  for (const row of data as { predicted_direction?: string | null }[]) {
    const key = (row.predicted_direction ?? 'unknown').trim() || 'unknown'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const parts = [...counts.entries()].map(([key, n]) => `${key}: ${n}`)
  return `n=${data.length}. Distribution: ${parts.join(', ') || 'none'}.`
}

export async function runReportChair(state: ReportPipelineState): Promise<{ report: string | null; aggregate: string }> {
  const aggregate = await loadFortySeatAggregate(state.roundId)
  const openings = (state.openings ?? []).map((row) => `${row.model} (${row.side}): ${row.text ?? ''}`).join('\n\n')
  const rebuttals = (state.rebuttals ?? []).map((row) => `${row.model} (${row.side}): ${row.text ?? ''}`).join('\n\n')
  const called = await callLeagueDeepModel({
    provider: 'anthropic',
    systemPrompt: systemFor(state.outputLanguage, 'Chair of the deep report.'),
    userPrompt: chairUserPrompt({
      locale: state.outputLanguage,
      proposition: state.proposition,
      packet: state.context,
      dossier: state.research?.dossier ?? '',
      openings,
      rebuttals,
      fortySeatAggregate: aggregate,
      categoryNote: categoryDeepGuards(state.category).join('\n'),
    }),
    maxCompletionTokens: 4000,
    timeoutMs: CHAIR_TIMEOUT_MS,
    modelOverride: 'claude-opus-5-5',
  })
  return { report: called.text, aggregate }
}

export type ReportAdvance =
  | { done: false; stage: string; state: ReportPipelineState }
  | { done: true; result: { ok: boolean; report: string | null; error?: string }; state: ReportPipelineState }

export async function advanceReportState(state: ReportPipelineState): Promise<ReportAdvance> {
  if (state.result?.ok) return { done: true, result: state.result, state }

  if (!state.research) {
    const research = await runReportResearch(state)
    return { done: false, stage: 'research', state: { ...state, research } }
  }
  if (!state.openings) {
    const openings = await runReportOpenings(state)
    if (!openings.some((row) => row.ok)) {
      const result = { ok: false, report: null, error: 'all openings failed' }
      return { done: true, result, state: { ...state, openings, result } }
    }
    return { done: false, stage: 'opening', state: { ...state, openings } }
  }
  if (!state.rebuttals) {
    const rebuttals = await runReportRebuttals(state)
    return { done: false, stage: 'rebuttal', state: { ...state, rebuttals } }
  }
  const chair = await runReportChair(state)
  if (!chair.report?.trim()) {
    const result = { ok: false, report: null, error: 'chair failed' }
    return { done: true, result, state: { ...state, fortySeatAggregate: chair.aggregate, chairReport: null, result } }
  }
  const result = { ok: true, report: chair.report }
  return {
    done: true,
    result,
    state: { ...state, fortySeatAggregate: chair.aggregate, chairReport: chair.report, result },
  }
}
