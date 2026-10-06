import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import { isBrandTableInstrument } from './ai-ranking/brand-table'
import { computeConsensusSnapshot } from './consensus-snapshot'
import type { LeagueDeepContext } from './deep-context'
import { callLeagueDeepModel, type LeagueDeepCallResult } from './deep-model'
import {
  DEEP_RESEARCH_PRESET,
  FALLBACK_RESEARCH_PRESET,
  cancelAgentResearch,
  getAgentResearch,
  isTerminalAgentStatus,
  submitAgentResearch,
  type AgentSnapshot,
} from './deep-perplexity-agent'
import { categoryDeepGuards } from './deep-prompts'
import {
  RESEARCH_FINDINGS_SCHEMA,
  assignEvidenceRefs,
  evidenceBlockForPrompt,
  groundFindingUrls,
  mergeFindings,
  parseResearchFindings,
  type ResearchFinding,
} from './deep-report-findings'
import { ledgerEntry, ledgerLogLine, type ReportLedgerEntry, type ReportLedgerStage } from './deep-report-ledger'
import {
  DEEP_REPORT_CHAIR,
  DEEP_RESEARCH_MAX_WAIT_MS,
  DEEP_RESEARCH_SEATS,
  FALLBACK_RESEARCH_SEATS,
  PROJECTED_DEEP_RESEARCH_USD,
  REPORT_HOP_BUDGET_MS,
  REPORT_MAX_ATTEMPTS,
  REPORT_TIMEOUTS_MS,
  REPORT_TOKENS,
  assignDebateSides,
  bilingualResearchQueries,
  leagueDeepResearchCapUsd,
  reportStageFor,
  researchPathForCap,
  type DebateSide,
  type ResearchPath,
} from './deep-report-policy'
import {
  CHAIR_SYSTEM_PROMPT,
  DEBATER_SYSTEM_PROMPT,
  RESEARCH_SYSTEM_PROMPT,
  chairUserPrompt,
  counterUserPrompt,
  openingUserPrompt,
  rebuttalUserPrompt,
  researchSeatPrompt,
  type SideWords,
} from './deep-report-prompts'
import {
  looksTruncated,
  relationTo40,
  retryInstruction,
  validateChair,
  validateCounterReply,
  validateOpening,
  validateTargetedRebuttal,
  type ChairReport,
  type CounterReply,
  type DebaterOpening,
  type EvidencePoint,
  type ReplyStance,
  type TargetedRebuttal,
  type ReportRelation,
  type Validation,
} from './deep-report-structured'
import { opponentOf, pairDebaters, rebuttalsAwaitCounter, type DebatePair, type PairSeat } from './deep-debate-pairs'
import { deepBrandLabel } from './deep-snapshot'
import { officialRowsForConsensus } from './extra/seats'
import { getLeagueUiPack } from './i18n/dictionary'
import type { LeagueLocale } from './i18n/locales'
import { lookupRosterEntry } from './roster'
import { sideLabelsFor, sidePairOf, type SideRoundContext } from './side-labels'

export type ReportTurn = {
  provider: string
  model: string
  /** Side the seat was assigned to argue. */
  side: DebateSide
  ok: boolean
  attempts: number
  headline: string | null
  points: EvidencePoint[]
  rebuttal: EvidencePoint[]
  finalSide: DebateSide | null
  finalProbability: number | null
  whyChanged: string | null
  /** Round 2: the paired opponent and the claim quoted from their opening. */
  targetModel?: string | null
  quotedClaim?: string | null
  rebuttalText?: string | null
  evidenceRefs?: string[]
  /** Round 3: the answer to the rebuttal that targeted this seat. */
  repliesToModel?: string | null
  stance?: ReplyStance | null
  reply?: string | null
  error?: string | null
  /** Free-form text from runs before the JSON contract. */
  text?: string | null
}

export type ResearchSeatOutcome = {
  provider: string
  model: string
  ok: boolean
  kept: number
  dropped: number
  error?: string | null
}

export type DeepResearchJob = {
  preset: string
  responseId: string | null
  requestId: string | null
  status: string
  submittedAt: string
  error: string | null
  polls: number
}

export type ReportResearch = {
  path: ResearchPath
  findings: ResearchFinding[]
  seats: ResearchSeatOutcome[]
  deep: (DeepResearchJob & { used: boolean; kept: number; dropped: number }) | null
  sourcesFound: number
  /** Text dossier from runs before the JSON contract. */
  dossier?: string
}

export type ResearchPending = {
  path: ResearchPath
  startedAt: string
  seatFindings: ResearchFinding[][]
  seats: ResearchSeatOutcome[]
  deep: DeepResearchJob | null
}

export type FortySeatSummary = {
  side: DebateSide | null
  confidence: number | null
  yes: number
  no: number
  noAnswer: number
  total: number
}

export type ReportChair = ChairReport & { relation: ReportRelation | null; ai40: FortySeatSummary | null }

export type ReportPipelineState = {
  roundId: string
  instrument: string
  category: string
  proposition: string
  context: string
  outputLanguage: LeagueLocale
  sideWords?: SideWords
  research?: ReportResearch
  researchPending?: ResearchPending
  openings?: ReportTurn[]
  openingDraft?: ReportTurn[]
  rebuttals?: ReportTurn[]
  rebuttalDraft?: ReportTurn[]
  counters?: ReportTurn[]
  counterDraft?: ReportTurn[]
  chair?: ReportChair
  chairAttempts?: number
  chairError?: string | null
  fortySeat?: FortySeatSummary | null
  ledger?: ReportLedgerEntry[]
  result?: { ok: boolean; report: string | null; error?: string }
  /** Runs before the JSON contract. */
  chairReport?: string | null
  fortySeatAggregate?: string
}

export type ReportHooks = {
  runId?: string
  /** Persist mid-hop progress (live counters). Called serially. */
  onProgress?: (state: ReportPipelineState) => Promise<void> | void
  now?: () => number
}

const POLL_INTERVAL_MS = 10_000

export function reportSideWords(round: SideRoundContext, locale: LeagueLocale): SideWords {
  const labels = sideLabelsFor(round, getLeagueUiPack(locale), locale)
  return { yes: labels.badge(labels.sides[0]), no: labels.badge(labels.sides[1]) }
}

export function seedReportState(ctx: LeagueDeepContext): ReportPipelineState {
  return {
    roundId: ctx.roundId,
    instrument: ctx.instrument,
    category: ctx.category,
    proposition: ctx.proposition,
    context: ctx.context,
    outputLanguage: ctx.outputLanguage,
    sideWords: reportSideWords(ctx.sideRound ?? { category: ctx.category, instrument: ctx.instrument }, ctx.outputLanguage),
  }
}

export function upcomingReportStage(state: ReportPipelineState): string {
  if (state.result?.ok) return 'done'
  return reportStageFor({
    research: state.research,
    openings: state.openings,
    rebuttals: state.rebuttals,
    counters: state.counters,
  })
}

// ── Hop context ───────────────────────────────────────────────────────────────

type Hop = {
  runId: string
  remaining: () => number
  log: (entry: ReportLedgerEntry) => void
  progress: (patch: Partial<ReportPipelineState>) => void
  flush: () => Promise<void>
  state: () => ReportPipelineState
}

function openHop(initial: ReportPipelineState, hooks: ReportHooks): Hop {
  const now = hooks.now ?? (() => Date.now())
  const started = now()
  let working: ReportPipelineState = { ...initial, ledger: [...(initial.ledger ?? [])] }
  let chain: Promise<void> = Promise.resolve()
  const runId = hooks.runId ?? initial.roundId
  return {
    runId,
    remaining: () => REPORT_HOP_BUDGET_MS - (now() - started),
    log: (entry) => {
      working = { ...working, ledger: [...(working.ledger ?? []), entry] }
      console.log(ledgerLogLine(runId, entry))
    },
    progress: (patch) => {
      working = { ...working, ...patch }
      if (!hooks.onProgress) return
      const snapshot = working
      chain = chain.then(() => Promise.resolve(hooks.onProgress!(snapshot))).catch(() => undefined)
    },
    flush: () => chain,
    state: () => working,
  }
}

function rosterCallOptions(model: string): {
  extraPayload?: Record<string, unknown>
  allowGeminiThinking?: boolean
  anthropicThinking?: 'disabled' | 'enabled' | 'adaptive'
  maxCompletionTokens?: number
} {
  const entry = lookupRosterEntry(model)
  if (!entry || entry.caller.kind !== 'core') return {}
  return {
    extraPayload: entry.caller.extraPayload,
    allowGeminiThinking: entry.caller.allowGeminiThinking,
    anthropicThinking: entry.caller.anthropicThinking,
    maxCompletionTokens: entry.maxCompletionTokens,
  }
}

async function callAndValidate<T>(
  hop: Hop,
  args: {
    stage: ReportLedgerStage
    provider: string
    model: string
    systemPrompt: string
    userPrompt: string
    maxTokens: number
    timeoutMs: number
    searchTool?: boolean
    attempt: number
  },
  validate: (called: LeagueDeepCallResult) => Validation<T>,
): Promise<Validation<T>> {
  const opts = rosterCallOptions(args.model)
  const called = await callLeagueDeepModel({
    provider: args.provider,
    systemPrompt: args.systemPrompt,
    userPrompt: args.userPrompt,
    maxCompletionTokens: Math.max(args.maxTokens, opts.maxCompletionTokens ?? 0),
    timeoutMs: args.timeoutMs,
    modelOverride: args.model,
    searchTool: args.searchTool,
    extraPayload: opts.extraPayload,
    allowGeminiThinking: opts.allowGeminiThinking,
    anthropicThinking: opts.anthropicThinking,
  })
  const checked: Validation<T> = called.error ? { ok: false, reason: called.error } : validate(called)
  hop.log(
    ledgerEntry({
      stage: args.stage,
      provider: args.provider,
      model: args.model,
      ok: checked.ok,
      attempt: args.attempt,
      ms: called.ms,
      promptTokens: called.usage?.promptTokens,
      completionTokens: called.usage?.completionTokens,
      billedUsd: called.usage?.billedUsd,
      toolFeeUsd: called.usage?.toolFeeUsd,
      finishReason: called.finishReason,
      error: checked.ok ? null : checked.reason,
    }),
  )
  return checked
}

function withRetry(prompt: string, reason: string | null): string {
  return reason ? `${prompt}\n\n${retryInstruction(reason)}` : prompt
}

// ── Research ──────────────────────────────────────────────────────────────────

async function runResearchSeat(
  hop: Hop,
  seat: { provider: string; model: string },
  prompt: string,
  category: string,
): Promise<{ findings: ResearchFinding[]; outcome: ResearchSeatOutcome }> {
  let reason: string | null = null
  for (let attempt = 1; attempt <= REPORT_MAX_ATTEMPTS; attempt += 1) {
    const timeoutMs = Math.min(REPORT_TIMEOUTS_MS.researchSeat, hop.remaining() - 20_000)
    if (timeoutMs < 45_000) break
    let kept: ResearchFinding[] = []
    let dropped = 0
    const checked: Validation<true> = await callAndValidate(
      hop,
      {
        stage: 'research',
        provider: seat.provider,
        model: seat.model,
        systemPrompt: RESEARCH_SYSTEM_PROMPT,
        userPrompt: withRetry(prompt, attempt > 1 ? reason : null),
        maxTokens: REPORT_TOKENS.researchSeat,
        timeoutMs,
        searchTool: true,
        attempt,
      },
      (called): Validation<true> => {
        const parsed = parseResearchFindings(called.text, seat.provider, category)
        if (!parsed.parsed) {
          return { ok: false, reason: looksTruncated(called.text, called.finishReason) ? 'truncated' : 'not_json' }
        }
        kept = parsed.findings
        dropped = parsed.dropped
        return { ok: true, value: true }
      },
    )
    if (checked.ok) {
      return { findings: kept, outcome: { ...seat, ok: true, kept: kept.length, dropped } }
    }
    reason = checked.reason
  }
  return { findings: [], outcome: { ...seat, ok: false, kept: 0, dropped: 0, error: reason ?? 'no time left' } }
}

function deepResearchInput(prompt: string): string {
  return `${RESEARCH_SYSTEM_PROMPT}\n\n${prompt}`
}

async function pollDeepJob(
  hop: Hop,
  job: DeepResearchJob,
  nowMs: () => number,
): Promise<{ job: DeepResearchJob; final: AgentSnapshot | null }> {
  let current = job
  while (current.responseId && !isTerminalAgentStatus(current.status)) {
    const responseId = current.responseId
    const snap = await getAgentResearch(responseId)
    current = { ...current, status: snap.status, polls: current.polls + 1, error: snap.error ?? current.error }
    if (isTerminalAgentStatus(snap.status)) return { job: current, final: snap }
    const waited = nowMs() - Date.parse(current.submittedAt)
    if (waited > DEEP_RESEARCH_MAX_WAIT_MS) {
      await cancelAgentResearch(responseId)
      const minutes = Math.round(waited / 60_000)
      console.log(`[league-deep] report run=${hop.runId} perplexity response=${responseId} overdue after ${minutes} min — cancelled`)
      return { job: { ...current, status: 'overdue', error: `no result after ${minutes} min` }, final: null }
    }
    if (hop.remaining() < POLL_INTERVAL_MS + 20_000) break
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  return { job: current, final: null }
}

function deepJobDone(job: DeepResearchJob | null): boolean {
  return !job || !job.responseId || isTerminalAgentStatus(job.status) || job.status === 'overdue'
}

async function stepResearch(hop: Hop, state: ReportPipelineState, nowMs: () => number): Promise<boolean> {
  const sideWords = state.sideWords ?? reportSideWords({ category: state.category, instrument: state.instrument }, state.outputLanguage)
  const prompt = researchSeatPrompt({
    locale: state.outputLanguage,
    proposition: state.proposition,
    sideWords,
    queries: bilingualResearchQueries(state.proposition, state.outputLanguage),
  })

  let pending = state.researchPending
  let final: AgentSnapshot | null = null
  if (!pending) {
    const cap = leagueDeepResearchCapUsd()
    const path = researchPathForCap(cap)
    const preset = path === 'deep' ? DEEP_RESEARCH_PRESET : FALLBACK_RESEARCH_PRESET
    console.log(
      `[league-deep] report run=${hop.runId} research path=${path} preset=${preset} cap=$${cap} projected=$${PROJECTED_DEEP_RESEARCH_USD.toFixed(2)}`,
    )
    const seatDefs = path === 'deep' ? DEEP_RESEARCH_SEATS : FALLBACK_RESEARCH_SEATS
    const seatRuns = seatDefs.map((seat) => runResearchSeat(hop, seat, prompt, state.category))
    const submitStarted = nowMs()
    const submitted = await submitAgentResearch({
      preset,
      input: deepResearchInput(prompt),
      schemaName: 'deepreportfindings',
      schema: RESEARCH_FINDINGS_SCHEMA as unknown as Record<string, unknown>,
      maxOutputTokens: REPORT_TOKENS.perplexity,
    })
    console.log(
      `[league-deep] report run=${hop.runId} perplexity submit preset=${preset} response=${submitted.id ?? '-'} request=${submitted.requestId ?? '-'} status=${submitted.status}${submitted.error ? ` error=${submitted.error.slice(0, 200)}` : ''}`,
    )
    const job: DeepResearchJob = {
      preset,
      responseId: submitted.id,
      requestId: submitted.requestId,
      status: submitted.id ? submitted.status : 'failed',
      submittedAt: new Date(submitStarted).toISOString(),
      error: submitted.error,
      polls: 0,
    }
    if (isTerminalAgentStatus(submitted.status) && submitted.id) final = submitted
    pending = { path, startedAt: new Date(submitStarted).toISOString(), seatFindings: [], seats: [], deep: job }
    hop.progress({ researchPending: pending })
    const seats = await Promise.all(seatRuns)
    pending = { ...pending, seatFindings: seats.map((row) => row.findings), seats: seats.map((row) => row.outcome) }
    hop.progress({ researchPending: pending })
  }

  let job = pending.deep
  if (job && !final && !deepJobDone(job)) {
    const polled = await pollDeepJob(hop, job, nowMs)
    job = polled.job
    final = polled.final
  }
  if (!deepJobDone(job)) {
    hop.progress({ researchPending: { ...pending, deep: job } })
    return false
  }

  let deepFindings: ResearchFinding[] = []
  let deepDropped = 0
  if (job) {
    const parsed = final?.status === 'completed' ? parseResearchFindings(final.text, 'perplexity', state.category) : null
    if (parsed) {
      deepFindings = groundFindingUrls(parsed.findings, final?.searchResults ?? [])
      deepDropped = parsed.dropped
    }
    const ok = Boolean(parsed?.parsed)
    const error = ok ? null : job.error ?? (final?.status === 'completed' ? 'deep research reply was not valid JSON' : `deep research ${job.status}`)
    hop.log(
      ledgerEntry({
        stage: 'research',
        provider: 'perplexity',
        model: final?.model ?? `agent:${job.preset}`,
        ok,
        attempt: 1,
        ms: Math.max(0, nowMs() - Date.parse(job.submittedAt)),
        promptTokens: final?.inputTokens,
        completionTokens: final?.outputTokens,
        billedUsd: final?.costUsd,
        error,
        requestId: job.requestId,
        responseId: job.responseId,
      }),
    )
    job = { ...job, error }
  }

  const findings = assignEvidenceRefs(mergeFindings([deepFindings, ...pending.seatFindings]))
  const research: ReportResearch = {
    path: pending.path,
    findings,
    seats: pending.seats,
    deep: job ? { ...job, used: deepFindings.length > 0, kept: deepFindings.length, dropped: deepDropped } : null,
    sourcesFound: findings.length,
  }
  console.log(
    `[league-deep] report run=${hop.runId} research done sources=${findings.length} deep_used=${research.deep?.used ?? false} deep_status=${job?.status ?? 'none'}${job?.error ? ` deep_reason=${job.error.slice(0, 160)}` : ''}`,
  )
  hop.progress({ research, researchPending: undefined })
  return true
}

// ── Debate ────────────────────────────────────────────────────────────────────

function emptyTurn(seat: { provider: string; model: string; side: DebateSide }): ReportTurn {
  return {
    provider: seat.provider,
    model: seat.model,
    side: seat.side,
    ok: false,
    attempts: 0,
    headline: null,
    points: [],
    rebuttal: [],
    finalSide: null,
    finalProbability: null,
    whyChanged: null,
  }
}

function pointLines(points: EvidencePoint[] | undefined): string {
  return (points ?? []).map((point, i) => `${i + 1}) ${point.text}${point.ref ? ` [${point.ref}]` : ''}`).join('\n')
}

function openingSummary(turn: ReportTurn, sideWords: SideWords): string {
  const word = turn.side === 'yes' ? sideWords.yes : sideWords.no
  return [`${deepBrandLabel(turn.provider)} (argued ${turn.side.toUpperCase()} "${word}"): ${turn.headline ?? ''}`, pointLines(turn.points)].join('\n')
}

function pairSeats(roundId: string, openings: readonly ReportTurn[]): DebatePair[] {
  const seats: PairSeat[] = openings
    .filter((turn) => turn.ok)
    .map((turn) => ({
      provider: turn.provider,
      model: turn.model,
      assignedSide: turn.side,
      finalSide: turn.finalSide,
    }))
  return pairDebaters(roundId, seats)
}

function acceptedNames(seat: { provider: string; model: string }): string[] {
  return [seat.model, deepBrandLabel(seat.provider)]
}

async function stepDebateRound(hop: Hop, round: 'opening' | 'rebuttal'): Promise<boolean> {
  const state = hop.state()
  const sideWords = state.sideWords ?? reportSideWords({ category: state.category, instrument: state.instrument }, state.outputLanguage)
  const evidence = evidenceBlockForPrompt(state.research?.findings ?? [])
  const openings = state.openings ?? []
  const pairs = round === 'rebuttal' ? pairSeats(state.roundId, openings) : []
  const draftKey = round === 'opening' ? 'openingDraft' : 'rebuttalDraft'
  const draft: ReportTurn[] = [...(state[draftKey] ?? assignDebateSides(state.roundId).map(emptyTurn))]
  const openingOk = (turn: ReportTurn) => openings.some((row) => row.provider === turn.provider && row.ok)
  const eligible = (turn: ReportTurn) => round === 'opening' || (openingOk(turn) && opponentOf(pairs, turn.provider) != null)
  const saveDraft = (turns: ReportTurn[]) =>
    hop.progress(round === 'opening' ? { openingDraft: [...turns] } : { rebuttalDraft: [...turns] })

  await Promise.all(
    draft.map(async (turn, index) => {
      if (turn.ok || turn.attempts >= REPORT_MAX_ATTEMPTS || !eligible(turn)) return
      const own = openings.find((row) => row.provider === turn.provider)
      const opponent = opponentOf(pairs, turn.provider)
      const opponentOpening = opponent ? openings.find((row) => row.provider === opponent.provider) : null
      const prompt =
        round === 'opening'
          ? openingUserPrompt({
              locale: state.outputLanguage,
              proposition: state.proposition,
              packet: state.context,
              evidence,
              side: turn.side,
              sideWords,
              model: turn.model,
            })
          : rebuttalUserPrompt({
              locale: state.outputLanguage,
              proposition: state.proposition,
              packet: state.context,
              evidence,
              side: turn.side,
              sideWords,
              ownOpening: own ? openingSummary(own, sideWords) : '(none)',
              opponentName: opponent ? deepBrandLabel(opponent.provider) : '',
              opponentModel: opponent?.model ?? '',
              opponentOpening: opponentOpening ? openingSummary(opponentOpening, sideWords) : '(none)',
            })
      let current = draft[index]!
      while (current.attempts < REPORT_MAX_ATTEMPTS) {
        const timeoutMs = Math.min(REPORT_TIMEOUTS_MS.debater, hop.remaining() - 10_000)
        if (timeoutMs < 30_000) break
        const attempt = current.attempts + 1
        const checked = await callAndValidate(
          hop,
          {
            stage: round,
            provider: current.provider,
            model: current.model,
            systemPrompt: DEBATER_SYSTEM_PROMPT,
            userPrompt: withRetry(prompt, attempt > 1 ? current.error ?? null : null),
            maxTokens: REPORT_TOKENS.debater,
            timeoutMs,
            attempt,
          },
          (called): Validation<DebaterOpening | TargetedRebuttal> =>
            round === 'opening'
              ? validateOpening(called.text, called.finishReason)
              : validateTargetedRebuttal(called.text, called.finishReason, {
                  opening: opponentOpening ?? { headline: null, points: [] },
                  acceptedTargets: opponent ? acceptedNames(opponent) : [],
                }),
        )
        if (checked.ok) {
          const v = checked.value
          current =
            'quotedClaim' in v
              ? {
                  ...current,
                  ok: true,
                  attempts: attempt,
                  error: null,
                  headline: null,
                  points: [],
                  rebuttal: [{ text: v.rebuttal, ref: v.evidenceRefs[0] ?? null }],
                  rebuttalText: v.rebuttal,
                  targetModel: v.targetModel,
                  quotedClaim: v.quotedClaim,
                  evidenceRefs: v.evidenceRefs,
                  finalSide: null,
                  finalProbability: null,
                  whyChanged: null,
                }
              : {
                  ...current,
                  ok: true,
                  attempts: attempt,
                  error: null,
                  headline: v.headline,
                  points: v.points,
                  rebuttal: [],
                  finalSide: v.finalSide,
                  finalProbability: v.finalProbability,
                  whyChanged: null,
                }
        } else {
          current = { ...current, attempts: attempt, error: checked.reason }
        }
        draft[index] = current
        saveDraft(draft)
        if (current.ok) break
      }
    }),
  )

  const complete = draft.every((turn) => turn.ok || turn.attempts >= REPORT_MAX_ATTEMPTS || !eligible(turn))
  if (!complete) {
    saveDraft(draft)
    return false
  }
  hop.progress(round === 'opening' ? { openings: draft, openingDraft: undefined } : { rebuttals: draft, rebuttalDraft: undefined })
  if (round === 'rebuttal') {
    const ok = draft.filter((turn) => turn.ok).length
    console.log(`[league-deep] report run=${hop.runId} rebuttal done ok=${ok} calls=${draft.reduce((sum, turn) => sum + turn.attempts, 0)}`)
  }
  return true
}

async function stepCounterRound(hop: Hop): Promise<boolean> {
  const state = hop.state()
  const sideWords = state.sideWords ?? reportSideWords({ category: state.category, instrument: state.instrument }, state.outputLanguage)
  const evidence = evidenceBlockForPrompt(state.research?.findings ?? [])
  const openings = state.openings ?? []
  const rebuttals = state.rebuttals ?? []
  const pairs = pairSeats(state.roundId, openings)
  const draft: ReportTurn[] = [...(state.counterDraft ?? assignDebateSides(state.roundId).map(emptyTurn))]
  const incomingFor = (turn: ReportTurn) =>
    rebuttals.find((row) => row.ok && row.quotedClaim && opponentOf(pairs, turn.provider)?.provider === row.provider)
  const saveDraft = (turns: ReportTurn[]) => hop.progress({ counterDraft: [...turns] })

  await Promise.all(
    draft.map(async (turn, index) => {
      const incoming = incomingFor(turn)
      if (turn.ok || turn.attempts >= REPORT_MAX_ATTEMPTS || !incoming) return
      const opponent = opponentOf(pairs, turn.provider)
      if (!opponent) return
      const prompt = counterUserPrompt({
        locale: state.outputLanguage,
        proposition: state.proposition,
        packet: state.context,
        evidence,
        side: turn.side,
        sideWords,
        opponentName: deepBrandLabel(opponent.provider),
        opponentModel: opponent.model,
        quotedClaim: incoming.quotedClaim ?? '',
        rebuttal: incoming.rebuttalText ?? incoming.rebuttal[0]?.text ?? '',
      })
      let current = draft[index]!
      while (current.attempts < REPORT_MAX_ATTEMPTS) {
        const timeoutMs = Math.min(REPORT_TIMEOUTS_MS.debater, hop.remaining() - 10_000)
        if (timeoutMs < 30_000) break
        const attempt = current.attempts + 1
        const checked = await callAndValidate(
          hop,
          {
            stage: 'counter',
            provider: current.provider,
            model: current.model,
            systemPrompt: DEBATER_SYSTEM_PROMPT,
            userPrompt: withRetry(prompt, attempt > 1 ? current.error ?? null : null),
            maxTokens: REPORT_TOKENS.debater,
            timeoutMs,
            attempt,
          },
          (called): Validation<CounterReply> =>
            validateCounterReply(called.text, called.finishReason, { acceptedTargets: acceptedNames(opponent) }),
        )
        if (checked.ok) {
          const v = checked.value
          current = {
            ...current,
            ok: true,
            attempts: attempt,
            error: null,
            repliesToModel: v.repliesToModel,
            stance: v.stance,
            reply: v.reply,
            evidenceRefs: v.evidenceRefs,
            finalSide: v.finalSide,
            finalProbability: v.finalProbability,
            whyChanged: v.whyChanged,
          }
        } else {
          current = { ...current, attempts: attempt, error: checked.reason }
        }
        draft[index] = current
        saveDraft(draft)
        if (current.ok) break
      }
    }),
  )

  const complete = draft.every((turn) => turn.ok || turn.attempts >= REPORT_MAX_ATTEMPTS || !incomingFor(turn))
  if (!complete) {
    saveDraft(draft)
    return false
  }
  hop.progress({ counters: draft, counterDraft: undefined })
  const ok = draft.filter((turn) => turn.ok).length
  console.log(`[league-deep] report run=${hop.runId} counter done ok=${ok} calls=${draft.reduce((sum, turn) => sum + turn.attempts, 0)}`)
  return true
}

// ── Chair ─────────────────────────────────────────────────────────────────────

/** Same official-seat log-odds aggregate the card headline shows. */
export async function loadFortySeatSummary(roundId: string): Promise<FortySeatSummary | null> {
  const [roundQuery, rowsQuery] = await Promise.all([
    supabaseAdmin.from('prediction_rounds').select('proposition_kind, instrument, category, subject_label').eq('id', roundId).maybeSingle(),
    supabaseAdmin.from('model_predictions').select('model_id, league_tier, predicted_direction, predicted_value').eq('round_id', roundId),
  ])
  if (rowsQuery.error || !rowsQuery.data) return null
  const round = (roundQuery.data ?? {}) as SideRoundContext
  if (isBrandTableInstrument(round.instrument)) return null
  return fortySeatFromRows(round, rowsQuery.data as FortySeatRow[])
}

type FortySeatRow = {
  model_id: string | null
  league_tier: string | null
  predicted_direction: string | null
  predicted_value: number | null
}

export function fortySeatFromRows(round: SideRoundContext, rows: readonly FortySeatRow[]): FortySeatSummary {
  const pair = sidePairOf(round)
  const official = officialRowsForConsensus(rows)
  const snap = computeConsensusSnapshot({
    rows: official.map((row) => ({
      model_id: row.model_id,
      league_tier: row.league_tier,
      direction: row.predicted_direction,
      probability: row.predicted_value,
    })),
    sides: pair,
    mode: 'binary',
  })
  const sideOf = (token: string | null): DebateSide | null => (token === pair[0] ? 'yes' : token === pair[1] ? 'no' : null)
  const yes = official.filter((row) => row.predicted_direction === pair[0]).length
  const no = official.filter((row) => row.predicted_direction === pair[1]).length
  return {
    side: sideOf(snap.aggregateDirection),
    confidence: snap.aggregateProbability == null ? null : Math.round(snap.aggregateProbability),
    yes,
    no,
    noAnswer: official.length - yes - no,
    total: official.length,
  }
}

function fortySeatLine(summary: FortySeatSummary | null, sideWords: SideWords): string {
  if (!summary || !summary.side || summary.confidence == null) return '40-seat aggregate unavailable.'
  const word = summary.side === 'yes' ? sideWords.yes : sideWords.no
  return [
    `40-AI result: ${summary.side.toUpperCase()} ("${word}") at ${summary.confidence}% weighted confidence.`,
    `Seats: yes ${summary.yes}, no ${summary.no}, no answer ${summary.noAnswer} (of ${summary.total}).`,
  ].join(' ')
}

function finalCallLine(open: ReportTurn, counters: readonly ReportTurn[], rebuttals: readonly ReportTurn[]): string {
  const counter = counters.find((row) => row.provider === open.provider && row.ok && row.finalSide)
  const reb = rebuttals.find((row) => row.provider === open.provider)
  const finalTurn = counter ?? (reb?.ok && reb.finalSide ? reb : open.ok ? open : null)
  if (!finalTurn?.finalSide || finalTurn.finalProbability == null) return 'no final call'
  return `${finalTurn.finalSide.toUpperCase()} ${finalTurn.finalProbability}%${finalTurn.finalSide !== open.side ? ' (changed side)' : ''}`
}

function debateBlock(state: ReportPipelineState, sideWords: SideWords): string {
  const openings = state.openings ?? []
  const rebuttals = state.rebuttals ?? []
  const counters = state.counters ?? []
  const threaded = rebuttals.some((row) => row.ok && row.quotedClaim)
  if (!threaded) {
    return openings
      .map((open) => {
        const reb = rebuttals.find((row) => row.provider === open.provider)
        const brand = deepBrandLabel(open.provider)
        const word = open.side === 'yes' ? sideWords.yes : sideWords.no
        return [
          `## ${brand} — assigned ${open.side.toUpperCase()} ("${word}") — final ${finalCallLine(open, counters, rebuttals)}`,
          open.ok ? `Opening: ${open.headline}\n${pointLines(open.points)}` : 'Opening: (no reply)',
          reb?.ok ? `Rebuttal: ${reb.headline ?? ''}\n${pointLines(reb.rebuttal)}${reb.whyChanged ? `\nWhy changed: ${reb.whyChanged}` : ''}` : 'Rebuttal: (no reply)',
        ].join('\n')
      })
      .join('\n\n')
  }
  return pairSeats(state.roundId, openings)
    .map((pair) => {
      const lines = [pair.yes, pair.no].map((seat) => {
        const open = openings.find((row) => row.provider === seat.provider)
        const foe = seat.provider === pair.yes.provider ? pair.no : pair.yes
        const reb = rebuttals.find((row) => row.provider === foe.provider && row.ok)
        const reply = counters.find((row) => row.provider === seat.provider && row.ok)
        const brand = deepBrandLabel(seat.provider)
        const foeBrand = deepBrandLabel(foe.provider)
        return [
          `## ${brand} — final ${open ? finalCallLine(open, counters, rebuttals) : 'no final call'}`,
          open?.ok ? `Opening: ${open.headline}\n${pointLines(open.points)}` : 'Opening: (no reply)',
          reb?.quotedClaim ? `${foeBrand} quoted ${brand}: "${reb.quotedClaim}"` : '',
          reb?.rebuttalText ? `${foeBrand} rebuttal: ${reb.rebuttalText}` : '',
          reply?.reply ? `${brand} reply (${reply.stance ?? 'defend'}): ${reply.reply}` : '',
        ]
          .filter(Boolean)
          .join('\n')
      })
      return lines.join('\n\n')
    })
    .join('\n\n')
}

function chairExchanges(state: ReportPipelineState): { left: string; right: string }[] {
  const rebuttals = state.rebuttals ?? []
  if (!rebuttals.some((row) => row.ok && row.quotedClaim)) return []
  return pairSeats(state.roundId, state.openings ?? []).map((pair) => ({
    left: deepBrandLabel(pair.yes.provider),
    right: deepBrandLabel(pair.no.provider),
  }))
}

async function stepChair(hop: Hop): Promise<'done' | 'pending' | 'failed'> {
  const state = hop.state()
  const sideWords = state.sideWords ?? reportSideWords({ category: state.category, instrument: state.instrument }, state.outputLanguage)
  const fortySeat = state.fortySeat !== undefined ? state.fortySeat : await loadFortySeatSummary(state.roundId)
  hop.progress({ fortySeat })
  const prompt = chairUserPrompt({
    locale: state.outputLanguage,
    proposition: state.proposition,
    packet: state.context,
    evidence: evidenceBlockForPrompt(state.research?.findings ?? []),
    debate: debateBlock(state, sideWords),
    fortySeatAggregate: fortySeatLine(fortySeat, sideWords),
    categoryNote: categoryDeepGuards(state.category).join('\n'),
    sideWords,
  })
  let attempts = state.chairAttempts ?? 0
  let reason = state.chairError ?? null
  while (attempts < REPORT_MAX_ATTEMPTS) {
    const timeoutMs = Math.min(REPORT_TIMEOUTS_MS.chair, hop.remaining() - 10_000)
    if (timeoutMs < 90_000) break
    attempts += 1
    const checked = await callAndValidate(
      hop,
      {
        stage: 'chair',
        provider: DEEP_REPORT_CHAIR.provider,
        model: DEEP_REPORT_CHAIR.model,
        systemPrompt: CHAIR_SYSTEM_PROMPT,
        userPrompt: withRetry(prompt, attempts > 1 ? reason : null),
        maxTokens: REPORT_TOKENS.chair,
        timeoutMs,
        attempt: attempts,
      },
      (called) => validateChair(called.text, called.finishReason, { exchanges: chairExchanges(hop.state()) }),
    )
    if (checked.ok) {
      const v = checked.value
      const relation = relationTo40({ side: v.verdictSide, probability: v.verdictProbability }, fortySeat)
      const chair: ReportChair = {
        ...v,
        vs40Why: relation && v.vs40RelationClaimed === relation ? v.vs40Why : null,
        relation,
        ai40: fortySeat,
      }
      hop.progress({ chair, chairAttempts: attempts, chairError: null })
      return 'done'
    }
    reason = checked.reason
    hop.progress({ chairAttempts: attempts, chairError: reason })
  }
  return attempts >= REPORT_MAX_ATTEMPTS ? 'failed' : 'pending'
}

function reportSummaryLine(chair: ReportChair, sideWords: SideWords): string {
  const word = chair.verdictSide === 'yes' ? sideWords.yes : sideWords.no
  return `${word} · ${chair.verdictProbability}% — ${chair.oneLine}`
}

// ── Advance ───────────────────────────────────────────────────────────────────

export type ReportAdvance =
  | { done: false; stage: string; state: ReportPipelineState }
  | { done: true; result: { ok: boolean; report: string | null; error?: string }; state: ReportPipelineState }

export async function advanceReportState(state: ReportPipelineState, hooks: ReportHooks = {}): Promise<ReportAdvance> {
  if (state.result?.ok) return { done: true, result: state.result, state }
  const nowMs = hooks.now ?? (() => Date.now())
  const hop = openHop(state, hooks)
  const finish = async (out: ReportAdvance): Promise<ReportAdvance> => {
    await hop.flush()
    return out
  }

  if (!hop.state().research) {
    const done = await stepResearch(hop, hop.state(), nowMs)
    return finish({ done: false, stage: done ? 'opening' : 'research', state: hop.state() })
  }
  if (!hop.state().openings) {
    const done = await stepDebateRound(hop, 'opening')
    const next = hop.state()
    if (done && !(next.openings ?? []).some((row) => row.ok)) {
      const result = { ok: false, report: null, error: 'all openings failed' }
      return finish({ done: true, result, state: { ...next, result } })
    }
    return finish({ done: false, stage: done ? 'rebuttal' : 'opening', state: next })
  }
  if (!hop.state().rebuttals) {
    const done = await stepDebateRound(hop, 'rebuttal')
    const next = hop.state()
    const stage = !done ? 'rebuttal' : rebuttalsAwaitCounter(next.rebuttals) ? 'counter' : 'chair'
    return finish({ done: false, stage, state: next })
  }
  if (!hop.state().counters && rebuttalsAwaitCounter(hop.state().rebuttals)) {
    const done = await stepCounterRound(hop)
    return finish({ done: false, stage: done ? 'chair' : 'counter', state: hop.state() })
  }
  const chairOutcome = await stepChair(hop)
  const next = hop.state()
  if (chairOutcome === 'pending') return finish({ done: false, stage: 'chair', state: next })
  if (chairOutcome === 'failed' || !next.chair) {
    const result = { ok: false, report: null, error: `chair failed: ${next.chairError ?? 'invalid reply'}` }
    return finish({ done: true, result, state: { ...next, result } })
  }
  const sideWords = next.sideWords ?? reportSideWords({ category: next.category, instrument: next.instrument }, next.outputLanguage)
  const result = { ok: true, report: reportSummaryLine(next.chair, sideWords) }
  return finish({ done: true, result, state: { ...next, result } })
}
