import { supabaseAdmin } from '@/lib/supabase/server'
import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'
import { gatherJejuSnapshot, buildBriefingContext, type JejuSnapshot } from '@/lib/motie/brief'
import {
  planJejuMeeting,
  summarizeAvailableData,
  renderChairVerdict,
  runJejuMotionVote,
  JEJU_DEEP_DELIBERATION_TUNING,
  type JejuMeetingPlan,
  type JejuExecutedSearch,
  type JejuRevisedAnalysis,
  type JejuDeliberationTurn,
  type JejuRoundResult,
  type JejuDeliberation,
  type JejuDeliberationStopReason,
  type JejuVerdict,
  type JejuVoteResult,
} from '@/lib/motie/deep'
import { generateJejuPreReport } from '@/lib/motie/pre-report'
import {
  SYNOD_DEBATERS,
  PROVIDER_TO_BRAND,
  openingSystemPrompt,
  turnSystemPrompt,
  facilitatorSystemPrompt,
  buildDeliberationContext,
  buildFacilitatorInput,
  parseClaim,
  parseActionTag,
  safeParseJson,
  type SynodTurn,
  type FacilitatorSummary,
  type DebaterRole,
} from '@/lib/motie/synod-debate'

export const runtime = 'nodejs'
export const maxDuration = 300

// TODO: credit/auth gating before public launch (governance demo — open for now).

// ─────────────────────────────────────────────────────────────────────────────
// JEJU Mode B — yes/no DELIBERATION route (SEPARATE from app/api/jeju/deep).
//
// Assembly (all pieces REUSED/COPIED, nothing reimplemented here):
//   JEJU front  : gatherJejuSnapshot + buildBriefingContext + planJejuMeeting  (brief.ts / deep.ts)
//   report      : generateJejuPreReport(mode:'deliberation')                   (pre-report.ts)
//   debate loop : SYNOD opening/turn/facilitator prompts + memory builders     (synod-debate.ts)
//   vote        : runJejuMotionVote (8-AI JEJU_VOTE_PANEL)                      (deep.ts)
//   chair       : renderChairVerdict (6-section Korean governance verdict)      (deep.ts)
//
// Isolation: NO import from app/api/synod/* (the SYNOD core was copied into
// lib/jeju/synod-debate.ts in step 1). State lives in the EXISTING
// motie_deep_sessions.state JSONB — no new columns/migration needed.
//
// Chunked-action discipline (mirror of app/api/jeju/deep/route.ts): one POST
// advances ONE stage so no single call exceeds ~250s. The per-round 'turn'
// action runs the 6 debaters of ONE round only (serial flow), never all rounds.
// ─────────────────────────────────────────────────────────────────────────────

const {
  MIN_CONVERGENCE_ROUNDS,
  MAX_CONVERGENCE_ROUNDS,
  CONSENSUS_TARGET,
  STALL_DELTA,
  CONSENSUS_SCORE_UNAVAILABLE,
  CONSENSUS_VOTE_THRESHOLD,
} = JEJU_DEEP_DELIBERATION_TUNING

const TABLE = 'motie_deep_sessions'

/** Completion caps — Korean needs headroom; turns are 8–10 sentences. */
const OPENING_MAX_TOKENS = 1100
const TURN_MAX_TOKENS = 1100
/**
 * The facilitator emits a structured JSON summary of ALL 6 debaters' turns
 * (consensusPoints + per-issue positions + nextDirective), in Korean. Korean +
 * JSON is token-heavy: at 1600 the JSON was truncated mid-output → unparseable →
 * the round scored as "unmeasurable" and the whole run died after round 1. A
 * 6-turn round needs ~3.7k chars complete; 4096 gives safe headroom.
 */
const FACILITATOR_MAX_TOKENS = 4096

/** The facilitator is neutral (not a debater); a strong reasoning brand runs it. */
const FACILITATOR_PROVIDER: ExtendedAiProviderName = 'anthropic'

/** Reverse of PROVIDER_TO_BRAND, so a stored brand label maps back to a provider. */
const BRAND_TO_PROVIDER: Record<string, ExtendedAiProviderName> = Object.fromEntries(
  (Object.entries(PROVIDER_TO_BRAND) as [ExtendedAiProviderName, string][]).map(([p, b]) => [b, p])
) as Record<string, ExtendedAiProviderName>

// ── Persisted Mode B state (opaque JSONB blob in motie_deep_sessions.state) ────
type DeliberateState = {
  question: string
  /** AX COUNCIL mode — plumbed through; engine branching lands next step. */
  councilMode?: 'trade' | 'warroom'
  // beat 1 (start)
  snapshot?: JejuSnapshot
  context?: string
  plan?: JejuMeetingPlan
  questionType?: 'binary' | 'openEnded'
  // beat 2 (report)
  report?: string | null
  reportSearches?: JejuExecutedSearch[]
  leadAnalysis?: string | null
  // beats 3+4 (open + turn) — every debate turn, tagged with its 1-indexed round.
  turns?: SynodTurn[]
  // beat 5 (facilitate) — one summary per round, index 0 == round 1.
  summaries?: FacilitatorSummary[]
  deliberationDone?: boolean
  stoppedReason?: JejuDeliberationStopReason
  // beats 6+7 (vote + verdict)
  vote?: JejuVoteResult
  verdict?: JejuVerdict
}

type Stage =
  | 'start'
  | 'report'
  | 'open'
  | 'turn'
  | 'facilitate'
  | 'vote'
  | 'verdict'
  | 'done'

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

function fail(stage: string, error: string, status = 500): Response {
  return json({ ok: false, stage, error }, status)
}

async function loadSession(
  sessionId: string
): Promise<{ state: DeliberateState; stage: Stage } | null> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('state, stage')
    .eq('id', sessionId)
    .maybeSingle()
  if (error || !data) return null
  return { state: (data.state ?? {}) as DeliberateState, stage: (data.stage ?? 'start') as Stage }
}

async function saveSession(
  sessionId: string,
  state: DeliberateState,
  stage: Stage,
  status: 'running' | 'done' | 'error'
): Promise<void> {
  await supabaseAdmin
    .from(TABLE)
    .update({ state, stage, status, updated_at: new Date().toISOString() })
    .eq('id', sessionId)
}

// ── AI call wrapper — sessionId/userId null ⇒ router does NO DB writes. ────────
async function callProvider(params: {
  provider: ExtendedAiProviderName
  systemPrompt: string
  prompt: string
  maxCompletionTokens: number
}): Promise<{ text: string | null; error?: string | null }> {
  const r = await runSingleAiProvider({
    supabase: supabaseAdmin,
    sessionId: null,
    userId: null,
    provider: params.provider,
    prompt: params.prompt,
    systemPrompt: params.systemPrompt,
    maxCompletionTokens: params.maxCompletionTokens,
  })
  return { text: r.text, error: r.error }
}

/**
 * The governance expert role assigned (1:1) to a debate brand by planJejuMeeting,
 * shaped for the SYNOD opening/turn prompt builders. Returns undefined if the
 * plan somehow lacks a role for that brand (the builders then fall back safely).
 */
function roleForProvider(
  plan: JejuMeetingPlan | undefined,
  provider: string
): DebaterRole | undefined {
  const r = plan?.roles?.find((x) => x.provider === provider)
  return r ? { roleLabel: r.roleLabel, mandate: r.mandate } : undefined
}

/** Prepends the step-2 pre-debate report to a debater's USER prompt (seeding). */
function reportPreamble(report: string | null | undefined): string {
  if (!report || !report.trim()) return ''
  return ['[사전 분석 리포트 — 토론 전 반드시 숙지할 기초 자료]', report.trim(), '', '---', ''].join('\n')
}

/** Clamp a model-supplied consensus score to 0–100, else mark unmeasurable. */
function clampScore(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return CONSENSUS_SCORE_UNAVAILABLE
  return Math.max(0, Math.min(100, Math.round(n)))
}

/** Parses the facilitator's strict-JSON output into a FacilitatorSummary. */
function parseFacilitatorSummary(raw: string, roundNumber: number): FacilitatorSummary | null {
  const parsed = safeParseJson(raw)
  if (!parsed) return null

  const consensusPoints: FacilitatorSummary['consensusPoints'] = Array.isArray(parsed.consensusPoints)
    ? parsed.consensusPoints
        .map((cp): FacilitatorSummary['consensusPoints'][number] | null => {
          if (!cp || typeof cp !== 'object') return null
          const o = cp as Record<string, unknown>
          const point = typeof o.point === 'string' ? o.point.trim() : ''
          if (!point) return null
          const agreedBy = Array.isArray(o.agreedBy)
            ? o.agreedBy.filter((x): x is string => typeof x === 'string')
            : []
          return { point, agreedBy }
        })
        .filter((x): x is FacilitatorSummary['consensusPoints'][number] => x !== null)
    : []

  const openIssues: FacilitatorSummary['openIssues'] = Array.isArray(parsed.openIssues)
    ? parsed.openIssues
        .map((oi): FacilitatorSummary['openIssues'][number] | null => {
          if (!oi || typeof oi !== 'object') return null
          const o = oi as Record<string, unknown>
          const issue = typeof o.issue === 'string' ? o.issue.trim() : ''
          if (!issue) return null
          const positions = Array.isArray(o.positions)
            ? o.positions
                .map((p): { ai: string; stance: string } | null => {
                  if (!p || typeof p !== 'object') return null
                  const po = p as Record<string, unknown>
                  const ai = typeof po.ai === 'string' ? po.ai.trim() : ''
                  const stance = typeof po.stance === 'string' ? po.stance.trim() : ''
                  if (!ai || !stance) return null
                  return { ai, stance }
                })
                .filter((x): x is { ai: string; stance: string } => x !== null)
            : []
          return { issue, positions }
        })
        .filter((x): x is FacilitatorSummary['openIssues'][number] => x !== null)
    : []

  const nextDirective = typeof parsed.nextDirective === 'string' ? parsed.nextDirective.trim() : ''

  return {
    roundNumber,
    consensusPoints,
    openIssues,
    roundConsensusScore: clampScore(parsed.roundConsensusScore),
    nextDirective,
  }
}

// ── SYNOD debate state → JEJU chair input adapters (glue, not engine logic) ────

/** Maps the SYNOD turns + facilitator summaries into a JEJU JejuDeliberation. */
function buildModeBDeliberation(
  turns: SynodTurn[],
  summaries: FacilitatorSummary[],
  stoppedReason: JejuDeliberationStopReason
): JejuDeliberation {
  const rounds: JejuRoundResult[] = summaries.map((s) => {
    const roundTurns: JejuDeliberationTurn[] = turns
      .filter((t) => t.roundNumber === s.roundNumber && t.content.trim() !== '')
      .map((t) => ({
        roleId: BRAND_TO_PROVIDER[t.aiName] ?? t.aiName,
        roleLabel: t.aiName,
        provider: BRAND_TO_PROVIDER[t.aiName] ?? 'anthropic',
        isRedTeam: t.isRedTeam === true,
        ok: true,
        position: t.content.trim(),
        concedes: null,
        holds: null,
      }))
    return {
      roundNumber: s.roundNumber,
      turns: roundTurns,
      consensusScore: s.roundConsensusScore,
      agreedPoints: s.consensusPoints.map((cp) => cp.point),
      contestedPoints: s.openIssues.map((oi) => oi.issue),
      summary: s.nextDirective,
      ok: s.roundConsensusScore !== CONSENSUS_SCORE_UNAVAILABLE,
    }
  })

  const last = summaries.length > 0 ? summaries[summaries.length - 1]! : undefined
  const ok = rounds.some((r) => r.ok)
  return {
    rounds,
    finalScore: last ? last.roundConsensusScore : CONSENSUS_SCORE_UNAVAILABLE,
    roundsRun: rounds.length,
    stoppedReason,
    agreedPoints: last ? last.consensusPoints.map((cp) => cp.point) : [],
    contestedPoints: last ? last.openIssues.map((oi) => oi.issue) : [],
    summary: last ? last.nextDirective : '',
    ok,
  }
}

/** Packs the step-2 report as ONE synthetic analysis so the chair reads it. */
function preReportAsAnalysis(report: string | null | undefined): JejuRevisedAnalysis[] {
  if (!report || !report.trim()) return []
  return [
    {
      roleId: 'pre-report',
      roleLabel: '사전 분석 리포트',
      provider: 'anthropic',
      isRedTeam: false,
      ok: true,
      firstPass: null,
      revised: report.trim(),
      changed: false,
    },
  ]
}

/** No-ballot result (shape-faithful to deep.ts's emptyVoteResult). */
function emptyVote(summary: string): JejuVoteResult {
  return {
    votes: [],
    approveCount: 0,
    opposeCount: 0,
    abstainCount: 0,
    approveProviders: [],
    opposeProviders: [],
    abstainProviders: [],
    outcome: 'divided',
    ok: false,
    summary,
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────
export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    // empty body tolerated; `action` validated below
  }

  const action = typeof body.action === 'string' ? body.action : ''

  // ── ACTION: start — beat 1 (snapshot → context → plan). ──────────────────────
  if (action === 'start') {
    try {
      const question =
        typeof body.question === 'string' && body.question.trim() ? body.question.trim() : ''
      if (!question) return fail('start', '질문이 비어 있습니다.', 400)

      const orchestratorProvider =
        typeof body.orchestratorProvider === 'string' ? body.orchestratorProvider : undefined
      const councilMode: 'trade' | 'warroom' =
        body.councilMode === 'warroom' ? 'warroom' : 'trade'

      const snapshot = await gatherJejuSnapshot(councilMode)
      const context = buildBriefingContext(snapshot, councilMode)
      const availableDataSummary = await summarizeAvailableData(councilMode)
      const plan = await planJejuMeeting({
        question,
        availableDataSummary,
        // Mode B: pin a 1:1 governance role to each of the 6 SYNOD debate brands,
        // so every debater argues AS a professional expert.
        debateBrands: [...SYNOD_DEBATERS],
        ...(orchestratorProvider ? { provider: orchestratorProvider } : {}),
      })

      const state: DeliberateState = {
        question,
        councilMode,
        snapshot,
        context,
        plan,
        questionType: plan.questionType,
      }

      const ins = await supabaseAdmin
        .from(TABLE)
        .insert([{ question, status: plan.ok ? 'running' : 'error', stage: 'start', state }])
        .select('id')
        .single()
      if (ins.error || !ins.data?.id) {
        return fail('start', ins.error?.message ?? 'could not create session')
      }
      const sessionId = String(ins.data.id)

      if (!plan.ok) {
        return json({
          ok: false,
          stage: 'start',
          sessionId,
          done: true,
          error: plan.error ?? '회의 소집(분석 계획) 단계에 실패했습니다.',
          plan,
        })
      }

      return json({
        ok: true,
        stage: 'start',
        sessionId,
        nextAction: 'report',
        questionType: plan.questionType,
        // The orchestrator's roster (for transparency); Mode B debate itself runs
        // the 6 SYNOD reasoning brands below, not these analytic seats.
        roles: plan.roles.map((r) => ({
          roleId: r.roleId,
          roleLabel: r.roleLabel,
          mandate: r.mandate,
          provider: r.provider,
          isRedTeam: r.isRedTeam === true,
        })),
        rationale: plan.rationale,
        debaters: SYNOD_DEBATERS.map((p) => ({ provider: p, brand: PROVIDER_TO_BRAND[p] })),
      })
    } catch (e: unknown) {
      return fail('start', e instanceof Error ? e.message : 'unknown error')
    }
  }

  // All remaining actions require an existing session.
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
  if (!sessionId) return fail(action || 'unknown', 'sessionId is required', 400)

  const loaded = await loadSession(sessionId)
  if (!loaded) return fail(action || 'unknown', 'session not found', 404)
  const { state } = loaded

  // ── ACTION: report — beat 2 (pre-debate analysis report, REUSE step 2). ──────
  if (action === 'report') {
    try {
      if (!state.context) return fail('report', '데이터 컨텍스트가 없어 리포트를 만들 수 없습니다.', 409)
      const pre = await generateJejuPreReport({
        question: state.question,
        snapshot: state.snapshot ?? { ok: false, sources: [] },
        context: state.context,
        mode: 'deliberation',
        councilMode: state.councilMode,
      })
      state.report = pre.report
      state.reportSearches = pre.searches
      state.leadAnalysis = pre.leadAnalysis
      await saveSession(sessionId, state, 'report', 'running')
      return json({
        ok: pre.ok,
        stage: 'report',
        sessionId,
        nextAction: 'open',
        report: pre.report,
        leadAnalysis: pre.leadAnalysis,
        searches: pre.searches,
        droppedSearchCount: pre.droppedSearchCount,
        ...(pre.error ? { reportError: pre.error } : {}),
      })
    } catch (e: unknown) {
      return fail('report', e instanceof Error ? e.message : 'unknown error')
    }
  }

  // ── ACTION: open — beat 3 (round 1: 6 debaters give independent opinions). ───
  if (action === 'open') {
    try {
      const preamble = reportPreamble(state.report)
      const results = await Promise.all(
        SYNOD_DEBATERS.map(async (provider) => {
          const userPrompt = [
            preamble,
            '[심의 안건]',
            state.question,
            '',
            '위 안건에 대해, 사전 분석 리포트를 근거로 당신의 독립적이고 명확한 의견을 제시하세요.',
          ].join('\n')
          const { text } = await callProvider({
            provider,
            systemPrompt: openingSystemPrompt(provider, roleForProvider(state.plan, provider)),
            prompt: userPrompt,
            maxCompletionTokens: OPENING_MAX_TOKENS,
          })
          return { provider, text }
        })
      )

      const turns: SynodTurn[] = []
      for (const { provider, text } of results) {
        if (!text || !text.trim()) continue
        const a = parseActionTag(text)
        const c = parseClaim(a.content)
        turns.push({
          roundNumber: 1,
          aiName: PROVIDER_TO_BRAND[provider],
          ...(a.tag ? { actionTag: a.tag } : {}),
          ...(c.claim ? { claim: c.claim } : {}),
          content: c.content,
          isRedTeam: false,
        })
      }

      state.turns = turns
      await saveSession(sessionId, state, 'open', 'running')
      return json({
        ok: turns.length > 0,
        stage: 'open',
        sessionId,
        roundNumber: 1,
        nextAction: 'facilitate',
        turns,
      })
    } catch (e: unknown) {
      return fail('open', e instanceof Error ? e.message : 'unknown error')
    }
  }

  // ── ACTION: turn — beat 4 (ONE debate round, 6 debaters SERIAL so each reacts).
  if (action === 'turn') {
    try {
      const summaries = state.summaries ?? []
      const priorTurns = state.turns ?? []
      // Round N is the first round not yet summarized: summaries cover 1..len.
      const roundNumber = summaries.length + 1
      if (roundNumber < 2) {
        return fail('turn', '먼저 개회 라운드(open)와 정리(facilitate)가 필요합니다.', 409)
      }

      // Rotate the stress-tester seat each round so the forming consensus is
      // pressure-tested from a different brand every time — EXCEPT the final
      // round, where it is turned OFF so the panel can genuinely converge
      // (SYNOD-faithful: red team is active through the penultimate round and
      // off in the last, preventing an artificial late drop in consensus).
      const isFinalRound = roundNumber >= MAX_CONVERGENCE_ROUNDS
      const redTeamProvider = isFinalRound
        ? null
        : SYNOD_DEBATERS[roundNumber % SYNOD_DEBATERS.length]!

      const currentRoundTurns: SynodTurn[] = []
      for (const provider of SYNOD_DEBATERS) {
        const isRedTeam = redTeamProvider !== null && provider === redTeamProvider
        // anonymize:false — debaters see and address each other by REAL brand name
        // (so they engage directly and never rebut themselves). Faithful to SYNOD,
        // where only the verdict chair gets an anonymized input.
        const ctx = buildDeliberationContext({
          question: state.question,
          priorSummaries: summaries,
          currentRoundTurns,
          anonymize: false,
        })
        const userPrompt = [reportPreamble(state.report), ctx.text].filter((s) => s !== '').join('\n')
        const { text } = await callProvider({
          provider,
          systemPrompt: turnSystemPrompt(provider, isRedTeam, roundNumber, roleForProvider(state.plan, provider)),
          prompt: userPrompt,
          maxCompletionTokens: TURN_MAX_TOKENS,
        })
        if (!text || !text.trim()) continue
        const a = parseActionTag(text)
        const c = parseClaim(a.content)
        currentRoundTurns.push({
          roundNumber,
          aiName: PROVIDER_TO_BRAND[provider],
          ...(a.tag ? { actionTag: a.tag } : {}),
          ...(c.claim ? { claim: c.claim } : {}),
          content: c.content,
          isRedTeam,
        })
      }

      state.turns = [...priorTurns, ...currentRoundTurns]
      await saveSession(sessionId, state, 'turn', 'running')
      return json({
        ok: currentRoundTurns.length > 0,
        stage: 'turn',
        sessionId,
        roundNumber,
        nextAction: 'facilitate',
        turns: currentRoundTurns,
      })
    } catch (e: unknown) {
      return fail('turn', e instanceof Error ? e.message : 'unknown error')
    }
  }

  // ── ACTION: facilitate — beat 5 (ONE facilitator call + loop control). ───────
  if (action === 'facilitate') {
    try {
      const summaries = state.summaries ?? []
      const allTurns = state.turns ?? []
      // Summarize the latest round that has turns but no summary yet.
      const roundNumber = summaries.length + 1
      const allTurnsThisRound = allTurns.filter((t) => t.roundNumber === roundNumber)
      if (allTurnsThisRound.length === 0) {
        return fail('facilitate', `라운드 ${roundNumber}의 토론 발언이 없어 정리할 수 없습니다.`, 409)
      }

      const input = buildFacilitatorInput({
        question: state.question,
        roundNumber,
        allTurnsThisRound,
        priorSummaries: summaries,
      })
      const { text } = await callProvider({
        provider: FACILITATOR_PROVIDER,
        systemPrompt: facilitatorSystemPrompt(),
        prompt: input,
        maxCompletionTokens: FACILITATOR_MAX_TOKENS,
      })

      const parsedSummary = text ? parseFacilitatorSummary(text, roundNumber) : null

      // EXPLICIT FAILURE (do not hide it): the facilitator returned nothing
      // parseable, or a score we can't read (UNAVAILABLE only ever means a
      // parse/format failure, never a legitimate 0). Previously this fell back to
      // a -1 summary and was silently treated as `done` → the run slid to verdict
      // with a green progress strip over a dead debate. Surface it instead so the
      // client stops on the failing stage. (Past cause: the JSON was truncated at
      // a too-low token cap — now raised; this guards any residual hiccup.)
      if (!parsedSummary || parsedSummary.roundConsensusScore === CONSENSUS_SCORE_UNAVAILABLE) {
        await saveSession(sessionId, state, 'facilitate', 'error')
        return json({
          ok: false,
          stage: 'facilitate',
          sessionId,
          roundNumber,
          error: `라운드 ${roundNumber} 합의도 정리(facilitator) 응답을 해석하지 못했습니다.`,
        })
      }

      const summary = parsedSummary
      summaries.push(summary)
      state.summaries = summaries

      // Loop control — SYNOD's monotonic facilitator-scored loop (faithful to the
      // deep route's deliberate stop logic, but driven by the facilitator score).
      // `score` is guaranteed measurable here (UNAVAILABLE handled above).
      const roundsRun = summaries.length
      const score = summary.roundConsensusScore
      let done = false
      let stoppedReason: JejuDeliberationStopReason | undefined

      if (roundsRun >= MIN_CONVERGENCE_ROUNDS) {
        if (score >= CONSENSUS_TARGET) {
          done = true
          stoppedReason = 'target_reached'
        } else {
          const prevScore = summaries[summaries.length - 2]?.roundConsensusScore ?? score
          if (score - prevScore < STALL_DELTA) {
            done = true
            stoppedReason = 'stalled'
          }
        }
      }
      if (!done && roundsRun >= MAX_CONVERGENCE_ROUNDS) {
        done = true
        stoppedReason = 'max_rounds'
      }

      if (done) {
        state.deliberationDone = true
        state.stoppedReason = stoppedReason
      }
      await saveSession(sessionId, state, 'facilitate', 'running')

      return json({
        ok: true,
        stage: 'facilitate',
        sessionId,
        roundNumber,
        consensusScore: score,
        summary,
        done,
        ...(done ? { stoppedReason, nextAction: 'vote' } : { nextAction: 'turn' }),
      })
    } catch (e: unknown) {
      return fail('facilitate', e instanceof Error ? e.message : 'unknown error')
    }
  }

  // ── ACTION: vote — beat 6 (motion ballot ONLY if consensus < threshold). ─────
  if (action === 'vote') {
    try {
      const summaries = state.summaries ?? []
      if (summaries.length === 0) {
        return fail('vote', '토론 정리 결과가 없어 표결할 수 없습니다.', 409)
      }

      const stoppedReason: JejuDeliberationStopReason = state.stoppedReason ?? 'max_rounds'
      const deliberation = buildModeBDeliberation(state.turns ?? [], summaries, stoppedReason)
      const finalScore = deliberation.finalScore
      const questionType = state.questionType ?? 'openEnded'

      // The 2x2 gate (same as the deep route): vote ONLY for a binary question
      // whose measured consensus is below the threshold.
      const measurable = finalScore >= 0
      const highConsensus = measurable && finalScore >= CONSENSUS_VOTE_THRESHOLD
      const doVote =
        questionType === 'binary' && measurable && finalScore < CONSENSUS_VOTE_THRESHOLD

      const noVoteSummary =
        questionType !== 'binary'
          ? '개방형 질문으로 표결 생략'
          : !measurable
            ? '합의도 측정 불가로 표결 생략(안전 경로)'
            : highConsensus
              ? `${CONSENSUS_VOTE_THRESHOLD}점 이상 합의로 표결 생략`
              : '표결 생략'

      let vote: JejuVoteResult = emptyVote(noVoteSummary)
      if (doVote) {
        vote = await runJejuMotionVote({ question: state.question, deliberation })
      }
      state.vote = vote
      await saveSession(sessionId, state, 'vote', 'running')

      return json({
        ok: true,
        stage: 'vote',
        sessionId,
        nextAction: 'verdict',
        voted: doVote,
        vote,
        consensusScore: finalScore,
      })
    } catch (e: unknown) {
      return fail('vote', e instanceof Error ? e.message : 'unknown error')
    }
  }

  // ── ACTION: verdict — beat 7 (JEJU chair renders the final ruling). ──────────
  if (action === 'verdict') {
    try {
      const summaries = state.summaries ?? []
      if (summaries.length === 0) {
        return fail('verdict', '토론 결과가 없어 판결을 내릴 수 없습니다.', 409)
      }

      // Idempotent: one verdict per session.
      if (state.verdict) {
        return json({
          ok: state.verdict.ok,
          stage: 'done',
          sessionId,
          done: true,
          questionType: state.questionType ?? 'openEnded',
          consensusScore: state.verdict.consensusScore,
          verdict: state.verdict,
          vote: state.vote ?? emptyVote('표결 없음'),
        })
      }

      const stoppedReason: JejuDeliberationStopReason = state.stoppedReason ?? 'max_rounds'
      const deliberation = buildModeBDeliberation(state.turns ?? [], summaries, stoppedReason)
      const finalScore = deliberation.finalScore
      const questionType = state.questionType ?? 'openEnded'
      const brief = finalScore >= 0 && finalScore >= CONSENSUS_VOTE_THRESHOLD
      const vote = state.vote ?? emptyVote('표결 없음')

      const verdict = await renderChairVerdict({
        question: state.question,
        snapshot: state.snapshot ?? { ok: false, sources: [] },
        // No JEJU analytic seats in Mode B — the pre-report is fed as the analysis.
        analyses: [],
        searches: state.reportSearches ?? [],
        revised: preReportAsAnalysis(state.report),
        // The SYNOD debate is carried in `deliberation.rounds`, not as separate
        // rebuttals, so nothing to feed here (avoids double-counting the debate).
        rebuttals: [],
        deliberation,
        brief,
        vote,
        councilMode: state.councilMode,
      })

      state.verdict = verdict
      await saveSession(sessionId, state, 'done', verdict.ok ? 'done' : 'error')

      return json({
        ok: verdict.ok,
        stage: 'done',
        sessionId,
        done: true,
        questionType,
        consensusScore: verdict.consensusScore,
        verdict: {
          judgment: verdict.judgment,
          beat1Summary: verdict.beat1Summary,
          beat2Summary: verdict.beat2Summary,
          beat3Summary: verdict.beat3Summary,
          minorityReport: verdict.minorityReport,
          mediaRisk: verdict.mediaRisk,
          disclaimer: verdict.disclaimer,
          provider: verdict.provider,
          ...(verdict.error ? { error: verdict.error } : {}),
        },
        vote,
        deliberation: {
          finalScore: deliberation.finalScore,
          roundsRun: deliberation.roundsRun,
          stoppedReason: deliberation.stoppedReason,
          agreedPoints: deliberation.agreedPoints,
          contestedPoints: deliberation.contestedPoints,
          summary: deliberation.summary,
        },
      })
    } catch (e: unknown) {
      return fail('verdict', e instanceof Error ? e.message : 'unknown error')
    }
  }

  return fail(action || 'unknown', `unknown action: ${action || '(none)'}`, 400)
}
