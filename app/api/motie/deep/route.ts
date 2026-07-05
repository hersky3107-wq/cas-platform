import { supabaseAdmin } from '@/lib/supabase/server'
import {
  runJejuDeepThroughAnalysis,
  mergeSearchRequests,
  executeJejuSearches,
  reviseExpertAnalyses,
  runDebateRound,
  runDeliberationRound,
  renderChairVerdict,
  runJejuMotionVote,
  JEJU_DEEP_DELIBERATION_TUNING,
  type JejuMeetingPlan,
  type JejuRoleAnalysis,
  type JejuExecutedSearch,
  type JejuRevisedAnalysis,
  type JejuRebuttal,
  type JejuRoundResult,
  type JejuDeliberation,
  type JejuDeliberationStopReason,
  type JejuVerdict,
  type JejuVoteResult,
} from '@/lib/motie/deep'
import type { JejuSnapshot } from '@/lib/motie/brief'

export const runtime = 'nodejs'
export const maxDuration = 300

// TODO: credit/auth gating before public launch (governance demo — open for now).

const {
  MIN_CONVERGENCE_ROUNDS,
  MAX_CONVERGENCE_ROUNDS,
  CONSENSUS_TARGET,
  STALL_DELTA,
  CONSENSUS_SCORE_UNAVAILABLE,
  CONSENSUS_VOTE_THRESHOLD,
} = JEJU_DEEP_DELIBERATION_TUNING

const TABLE = 'motie_deep_sessions'

// ── Persisted pipeline state (opaque JSONB blob) ──────────────────────────────
type DeepState = {
  question: string
  /** AX COUNCIL mode — plumbed through; engine branching lands next step. */
  councilMode?: 'trade' | 'warroom'
  orchestratorProvider?: string
  maxRounds?: number
  // beats 1+2 (start)
  snapshot?: JejuSnapshot
  context?: string
  plan?: JejuMeetingPlan
  analyses?: JejuRoleAnalysis[]
  // beat 2.5 (search)
  searches?: JejuExecutedSearch[]
  droppedSearchCount?: number
  // beat 2.7 (revise)
  revised?: JejuRevisedAnalysis[]
  // beat 3 (debate)
  debate?: JejuRebuttal[]
  // beat 3.6 (deliberate — one round per action)
  rounds?: JejuRoundResult[]
  deliberationDone?: boolean
  stoppedReason?: JejuDeliberationStopReason
  // beat 4 (verdict)
  verdict?: JejuVerdict
  vote?: JejuVoteResult
}

type Stage =
  | 'start'
  | 'search'
  | 'revise'
  | 'debate'
  | 'deliberate'
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
): Promise<{ state: DeepState; stage: Stage } | null> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('state, stage')
    .eq('id', sessionId)
    .maybeSingle()
  if (error || !data) return null
  return { state: (data.state ?? {}) as DeepState, stage: (data.stage ?? 'start') as Stage }
}

async function saveSession(
  sessionId: string,
  state: DeepState,
  stage: Stage,
  status: 'running' | 'done' | 'error'
): Promise<void> {
  await supabaseAdmin
    .from(TABLE)
    .update({ state, stage, status, updated_at: new Date().toISOString() })
    .eq('id', sessionId)
}

/** Replica of deep.ts's private buildDeliberationResult (kept faithful). */
function buildDeliberation(
  rounds: JejuRoundResult[],
  stoppedReason: JejuDeliberationStopReason,
  error?: string
): JejuDeliberation {
  const last = rounds.length > 0 ? rounds[rounds.length - 1]! : undefined
  const ok = rounds.some(
    (r) => r.ok && r.consensusScore !== CONSENSUS_SCORE_UNAVAILABLE
  )
  return {
    rounds,
    finalScore: last ? last.consensusScore : CONSENSUS_SCORE_UNAVAILABLE,
    roundsRun: rounds.length,
    stoppedReason,
    agreedPoints: last ? last.agreedPoints : [],
    contestedPoints: last ? last.contestedPoints : [],
    summary: last ? last.summary : '',
    ok,
    ...(error ? { error } : {}),
  }
}

/** No-ballot result (shape-faithful to deep.ts's emptyVoteResult). */
function emptyVote(summary: string): JejuVoteResult {
  return {
    votes: [],
    approveCount: 0,
    conditionalCount: 0,
    opposeCount: 0,
    abstainCount: 0,
    approveProviders: [],
    conditionalProviders: [],
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
    // empty body tolerated; `action` defaults handled below
  }

  const action = typeof body.action === 'string' ? body.action : ''

  // ── ACTION: start — beats 1+2 (snapshot → context → plan → analyses). ────────
  if (action === 'start') {
    try {
      const question =
        typeof body.question === 'string' && body.question.trim()
          ? body.question.trim()
          : undefined
      const orchestratorProvider =
        typeof body.orchestratorProvider === 'string'
          ? body.orchestratorProvider
          : undefined
      const maxRounds =
        typeof body.maxRounds === 'number' ? body.maxRounds : undefined
      const councilMode: 'trade' | 'warroom' =
        body.councilMode === 'warroom' ? 'warroom' : 'trade'

      const analysis = await runJejuDeepThroughAnalysis({
        question,
        orchestratorProvider,
        councilMode,
      })

      const state: DeepState = {
        question: analysis.question,
        councilMode,
        ...(orchestratorProvider ? { orchestratorProvider } : {}),
        ...(maxRounds !== undefined ? { maxRounds } : {}),
        snapshot: analysis.snapshot,
        context: analysis.context,
        plan: analysis.plan,
        analyses: analysis.analyses,
      }

      const ins = await supabaseAdmin
        .from(TABLE)
        .insert([{ question: analysis.question, status: analysis.ok ? 'running' : 'error', stage: 'start', state }])
        .select('id')
        .single()
      if (ins.error || !ins.data?.id) {
        return fail('start', ins.error?.message ?? 'could not create session')
      }
      const sessionId = String(ins.data.id)

      // Plan failed / no usable analysis → terminal, no further actions.
      if (!analysis.ok) {
        return json({
          ok: false,
          stage: 'start',
          sessionId,
          done: true,
          error: analysis.error ?? '분석 단계에 실패했습니다.',
          plan: analysis.plan,
        })
      }

      return json({
        ok: true,
        stage: 'start',
        sessionId,
        nextAction: 'search',
        plan: analysis.plan,
        questionType: analysis.plan.questionType,
        // Convened experts (full) so the UI can show the roster + who is red team
        // + whether the 언론 분석가 (press analyst) was convened.
        roles: analysis.plan.roles.map((r) => ({
          roleId: r.roleId,
          roleLabel: r.roleLabel,
          mandate: r.mandate,
          provider: r.provider,
          isRedTeam: r.isRedTeam === true,
        })),
        // Each expert's first-pass draft (full text) for the live process view.
        analyses: analysis.analyses,
        analysisCount: analysis.analyses.filter((a) => a.ok).length,
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

  // ── ACTION: search — beat 2.5 (merge + execute Perplexity, ≤MAX_SEARCHES). ───
  if (action === 'search') {
    try {
      if (!state.analyses || !state.plan?.ok) {
        return fail('search', '분석 결과가 없어 검색을 건너뜁니다.', 409)
      }
      const { merged, droppedCount } = await mergeSearchRequests({
        analyses: state.analyses,
        councilMode: state.councilMode,
      })
      const searches =
        merged.length > 0
          ? await executeJejuSearches({ merged, councilMode: state.councilMode })
          : []
      state.searches = searches
      state.droppedSearchCount = droppedCount
      await saveSession(sessionId, state, 'search', 'running')
      return json({
        ok: true,
        stage: 'search',
        sessionId,
        nextAction: 'revise',
        // Full search findings for the live process view.
        searches,
        searchCount: searches.filter((s) => s.ok).length,
        droppedSearchCount: droppedCount,
      })
    } catch (e: unknown) {
      return fail('search', e instanceof Error ? e.message : 'unknown error')
    }
  }

  // ── ACTION: revise — beat 2.7 (experts revise after reading search results). ─
  if (action === 'revise') {
    try {
      if (!state.analyses || !state.plan?.ok) {
        return fail('revise', '분석 결과가 없어 갱신을 건너뜁니다.', 409)
      }
      const revised = await reviseExpertAnalyses({
        question: state.question,
        roles: state.plan.roles,
        analyses: state.analyses,
        searches: state.searches ?? [],
        councilMode: state.councilMode,
      })
      state.revised = revised
      await saveSession(sessionId, state, 'revise', 'running')
      return json({
        ok: true,
        stage: 'revise',
        sessionId,
        nextAction: 'debate',
        // Full revised analyses (firstPass + revised + changed flag) for the UI.
        revised,
        revisedCount: revised.filter((r) => r.ok).length,
      })
    } catch (e: unknown) {
      return fail('revise', e instanceof Error ? e.message : 'unknown error')
    }
  }

  // ── ACTION: debate — beat 3 (one rebuttal round). ────────────────────────────
  if (action === 'debate') {
    try {
      if (!state.revised || !state.plan?.ok) {
        return fail('debate', '갱신된 분석이 없어 토론을 건너뜁니다.', 409)
      }
      const debate = await runDebateRound({
        question: state.question,
        roles: state.plan.roles,
        revised: state.revised,
        councilMode: state.councilMode,
      })
      state.debate = debate
      await saveSession(sessionId, state, 'debate', 'running')
      return json({
        ok: true,
        stage: 'debate',
        sessionId,
        nextAction: 'deliberate',
        // Full rebuttals (who challenged whom + the challenge text) for the UI.
        debate,
        rebuttalCount: debate.filter((d) => d.ok).length,
      })
    } catch (e: unknown) {
      return fail('debate', e instanceof Error ? e.message : 'unknown error')
    }
  }

  // ── ACTION: deliberate — beat 3.6, ONE round per call. Client repeats until
  //    `done`. Replicates runDeliberation's stop logic faithfully. ─────────────
  if (action === 'deliberate') {
    try {
      if (!state.revised || !state.plan?.ok) {
        return fail('deliberate', '시드 분석이 없어 토론을 시작할 수 없습니다.', 409)
      }
      const rounds = state.rounds ?? []
      const maxRounds = Math.max(
        MIN_CONVERGENCE_ROUNDS,
        Math.min(MAX_CONVERGENCE_ROUNDS, state.maxRounds ?? MAX_CONVERGENCE_ROUNDS)
      )
      const roundNumber = rounds.length + 1
      const priorTurns = rounds.length > 0 ? rounds[rounds.length - 1]!.turns : []

      const round = await runDeliberationRound({
        question: state.question,
        roles: state.plan.roles,
        roundNumber,
        priorTurns,
        councilMode: state.councilMode,
        ...(roundNumber === 1 ? { seedAnalyses: state.revised } : {}),
      })
      rounds.push(round)
      state.rounds = rounds

      // Decide stop (mirror of runDeliberation).
      let done = false
      let stoppedReason: JejuDeliberationStopReason | undefined

      if (!round.ok || round.consensusScore === CONSENSUS_SCORE_UNAVAILABLE) {
        done = true
        stoppedReason = 'error'
      } else if (roundNumber >= MIN_CONVERGENCE_ROUNDS) {
        if (round.consensusScore >= CONSENSUS_TARGET) {
          done = true
          stoppedReason = 'target_reached'
        } else {
          const prevScore = rounds[rounds.length - 2]?.consensusScore ?? round.consensusScore
          if (round.consensusScore - prevScore < STALL_DELTA) {
            done = true
            stoppedReason = 'stalled'
          }
        }
      }
      if (!done && roundNumber >= maxRounds) {
        done = true
        stoppedReason = 'max_rounds'
      }

      if (done) {
        state.deliberationDone = true
        state.stoppedReason = stoppedReason
      }
      await saveSession(sessionId, state, 'deliberate', 'running')

      return json({
        ok: true,
        stage: 'deliberate',
        sessionId,
        roundNumber,
        consensusScore: round.consensusScore,
        roundOk: round.ok,
        // Full round detail (per-expert turns + agreed/contested + summary) so the
        // UI can show the debate AND the consensus progression as it happens.
        round,
        done,
        ...(done ? { stoppedReason, nextAction: 'verdict' } : { nextAction: 'deliberate' }),
      })
    } catch (e: unknown) {
      return fail('deliberate', e instanceof Error ? e.message : 'unknown error')
    }
  }

  // ── ACTION: verdict — beat 4. Applies the 2x2 rule, optional motion vote,
  //    then the chair's final ruling. Returns the full deliverable. ────────────
  if (action === 'verdict') {
    try {
      if (!state.rounds || state.rounds.length === 0 || !state.plan?.ok) {
        return fail('verdict', '토론 결과가 없어 판결을 내릴 수 없습니다.', 409)
      }

      const stoppedReason: JejuDeliberationStopReason = state.stoppedReason ?? 'max_rounds'
      const deliberation = buildDeliberation(state.rounds, stoppedReason)
      const finalScore = deliberation.finalScore
      const questionType = state.plan.questionType

      // The 2x2 decision rule (faithful to runJejuDeepCompleteWithVote).
      const measurable = finalScore >= 0
      const highConsensus = measurable && finalScore >= CONSENSUS_VOTE_THRESHOLD
      const doVote =
        questionType === 'binary' && measurable && finalScore < CONSENSUS_VOTE_THRESHOLD
      const brief = highConsensus

      const noVoteSummary =
        questionType !== 'binary'
          ? '개방형 질문으로 표결 생략'
          : !measurable
            ? '합의도 측정 불가로 표결 생략(안전 경로)'
            : highConsensus
              ? `${CONSENSUS_VOTE_THRESHOLD}점 이상 합의로 표결 생략`
              : '표결 생략'

      // Motion vote runs BEFORE the chair (so the chair sees it as advisory).
      let vote: JejuVoteResult = emptyVote(noVoteSummary)
      if (doVote) {
        vote = await runJejuMotionVote({
          question: state.question,
          deliberation,
          councilMode: state.councilMode,
        })
      }

      const verdict = await renderChairVerdict({
        question: state.question,
        snapshot: state.snapshot ?? { ok: false, sources: [] },
        analyses: state.analyses ?? [],
        searches: state.searches ?? [],
        revised: state.revised ?? [],
        rebuttals: state.debate ?? [],
        deliberation,
        brief,
        vote,
        councilMode: state.councilMode,
      })

      state.verdict = verdict
      state.vote = vote
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
