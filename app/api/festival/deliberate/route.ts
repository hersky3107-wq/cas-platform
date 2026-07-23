import { supabaseAdmin } from '@/lib/supabase/server'
import {
  buildStubFestivalPlan,
  buildFestivalBriefing,
  runFestivalScoring,
  runFestivalBenchmark,
  runFestivalOpen,
  runFestivalRound,
  runFestivalFacilitate,
  runFestivalRescoring,
  festivalLoopControl,
  convergeFestival,
  renderFestivalVerdict,
  FESTIVAL_TUNING,
  type FestivalInvestigatorScore,
  type FestivalRescore,
  type FestivalBenchmark,
  type FestivalConverge,
  type FestivalVerdict,
  type FestivalStopReason,
} from '@/lib/festival/pipeline'
import type { FestivalTurn, FestivalFacilitatorSummary } from '@/lib/festival/debate'
import {
  FESTIVAL_INVESTIGATORS,
  FESTIVAL_DEBATE_SEATS,
} from '@/lib/festival/roster'
import {
  validateFestivalPlan,
  FESTIVAL_INVESTIGATOR_MODEL_LABEL,
  type FestivalPlan,
  type FestivalSupplement,
} from '@/lib/festival/plan-schema'

export const runtime = 'nodejs'
export const maxDuration = 300

// ─────────────────────────────────────────────────────────────────────────────
// FESTIVAL success-forecast — chunked/polling deliberation route.
//
// PUBLIC DEMO (competition): no login required, no credit check/deduction.
// Anyone with the URL can run a full deliberation; session rows are created
// via supabaseAdmin (service role), not tied to a user account.
//
// ISOLATION INVARIANT (non-negotiable):
//   - State lives in its OWN table `festival_sessions` — NEVER motie_deep_sessions
//     or jeju_deep_sessions. Festival never reads/writes MOTIE/Jeju session rows.
//   - Engine logic is imported ONLY from lib/festival/* (which itself depends only
//     on shared infra: lib/ai/router). No lib/motie/* or lib/jeju/* import here.
//   - Deleting lib/festival/* + app/api/festival/* + dropping festival_sessions
//     leaves MOTIE + AX Jeju byte-for-byte identical.
//
// Chunked-action discipline (mirror of app/api/motie/deliberate): one POST
// advances ONE stage so no single call exceeds ~250s. The investigate stage is
// SPLIT into 'scoring' (7 LLMs) + 'benchmark' (Perplexity). The per-round 'turn'
// action runs the 6 debate seats of ONE round only, never all rounds.
//
// Stages: start → scoring → benchmark → open → turn → facilitate →
//         rescoring → converge → verdict → done
// ─────────────────────────────────────────────────────────────────────────────

const TABLE = 'festival_sessions'

type FestivalSessionState = {
  question: string
  plan: FestivalPlan
  /** Manual supplements (paste/URL/file extracts) — organizer-provided, unverified. */
  supplements?: FestivalSupplement[]
  // investigate (STAGE-1)
  scores?: FestivalInvestigatorScore[]
  benchmark?: FestivalBenchmark
  briefing?: string
  // debate
  turns?: FestivalTurn[]
  summaries?: FestivalFacilitatorSummary[]
  debateDone?: boolean
  stoppedReason?: FestivalStopReason
  // STAGE-2 rescoring (after last facilitate)
  rescores?: FestivalRescore[]
  // converge + verdict
  converge?: FestivalConverge
  verdict?: FestivalVerdict
}

type Stage =
  | 'start'
  | 'scoring'
  | 'benchmark'
  | 'open'
  | 'turn'
  | 'facilitate'
  | 'rescoring'
  | 'converge'
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
): Promise<{ state: FestivalSessionState; stage: Stage } | null> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('state, stage')
    .eq('id', sessionId)
    .maybeSingle()
  if (error || !data) return null
  return {
    state: (data.state ?? {}) as FestivalSessionState,
    stage: (data.stage ?? 'start') as Stage,
  }
}

async function saveSession(
  sessionId: string,
  state: FestivalSessionState,
  stage: Stage,
  status: 'running' | 'done' | 'error'
): Promise<void> {
  await supabaseAdmin
    .from(TABLE)
    .update({ state, stage, status, updated_at: new Date().toISOString() })
    .eq('id', sessionId)
}

/** Builds the deliberation question from the plan name (role-neutral). */
function questionForPlan(plan: FestivalPlan): string {
  return `"${plan.block1.name}"을(를) 제출된 기획안대로 개최할 경우, 이 축제의 흥행·성공 가능성은 어떠한가? (개최/조건부 추진/보류 관점에서 전망하라)`
}

/**
 * Structured client-facing shape for STAGE-1 scores. Additive — does NOT
 * replace the existing `scoring` stage response shape (roleLabelKo/score),
 * which other code may already depend on; this is a normalized view used by
 * the final (verdict/done) response so the client can render 1차/2차 cards
 * without depending on chair prose.
 */
function mapStage1ForClient(scores: FestivalInvestigatorScore[]) {
  return scores.map((s) => ({
    id: s.id,
    roleName: s.roleLabelKo,
    model: FESTIVAL_INVESTIGATOR_MODEL_LABEL[s.id] ?? s.provider,
    score1: s.score,
    ok: s.ok,
    ...(s.error ? { error: s.error } : {}),
  }))
}

/** Structured client-facing shape for STAGE-2 rescores. Additive (see above). */
function mapRescoresForClient(rescores: FestivalRescore[]) {
  return rescores.map((r) => ({
    id: r.id,
    roleName: r.roleLabelKo,
    model: FESTIVAL_INVESTIGATOR_MODEL_LABEL[r.id] ?? r.provider,
    score1: r.stage1Score,
    score2: r.stage2Score,
    delta: r.delta,
    changeReason: r.changeReason,
    ok: r.ok,
    ...(r.error ? { error: r.error } : {}),
  }))
}

/**
 * Logs the 1차/2차 pair table to the server console so it's easy to verify the
 * rescore isn't just copying stage-1 (some seats should move up, some down,
 * some stay flat — never all identical unless the debate genuinely changed
 * nothing for every seat, which would itself be suspicious).
 */
function logRescorePairs(sessionId: string, rescores: FestivalRescore[]): void {
  const rows = rescores.map((r) => {
    const arrow = r.delta > 0 ? '↑' : r.delta < 0 ? '↓' : '='
    return `  ${r.roleLabelKo.padEnd(10, ' ')} 1차=${r.stage1Score}\t2차=${r.stage2Score}\t${arrow}${r.delta !== 0 ? Math.abs(r.delta) : ''}\t${r.changeReason}`
  })
  const anyChanged = rescores.some((r) => r.delta !== 0)
  console.log(
    [
      `[festival:rescoring] session=${sessionId} 1차→2차 비교 (변동 여부: ${anyChanged ? 'YES — 일부 변동 있음' : 'NO — 전원 동일, 재채점 의심'})`,
      ...rows,
    ].join('\n')
  )
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

  // ── ACTION: start — accept the typed FestivalPlan + supplements, create row. ─
  if (action === 'start') {
    try {
      // Two entry paths:
      //   - { plan: FestivalPlan }              → real form submission (validated)
      //   - { useExample: true } or no plan      → "예시로 채우기" stub (testing)
      const wantsExample = body.useExample === true
      const planRaw = body.plan
      let plan: FestivalPlan
      let supplements: FestivalSupplement[] | undefined

      if (wantsExample || !planRaw || typeof planRaw !== 'object') {
        plan = buildStubFestivalPlan()
      } else {
        // Trust the client shape minimally; validate required blocks below.
        plan = planRaw as FestivalPlan
        const errors = validateFestivalPlan(plan)
        if (errors.length > 0) {
          return fail('start', `기획안 필수 항목 누락: ${errors.join(' ')}`, 400)
        }
        // Optional supplements array (from /api/festival/extract + paste).
        if (Array.isArray(body.supplements)) {
          supplements = (body.supplements as unknown[]).filter(
            (s): s is FestivalSupplement =>
              !!s &&
              typeof s === 'object' &&
              typeof (s as FestivalSupplement).label === 'string' &&
              typeof (s as FestivalSupplement).text === 'string' &&
              typeof (s as FestivalSupplement).source === 'string' &&
              typeof (s as FestivalSupplement).ok === 'boolean'
          )
          if (supplements.length === 0) supplements = undefined
        }
      }

      const question = questionForPlan(plan)
      const state: FestivalSessionState = { question, plan, ...(supplements ? { supplements } : {}) }

      const ins = await supabaseAdmin
        .from(TABLE)
        .insert([{ question, status: 'running', stage: 'start', state }])
        .select('id')
        .single()
      if (ins.error || !ins.data?.id) {
        return fail('start', ins.error?.message ?? 'could not create session')
      }
      const sessionId = String(ins.data.id)

      return json({
        ok: true,
        stage: 'start',
        sessionId,
        nextAction: 'scoring',
        question,
        plan,
        ...(state.supplements ? { supplements: state.supplements } : {}),
        // The 8 on-screen investigators (7 scoring + 1 search) and the 6 debate seats.
        investigators: FESTIVAL_INVESTIGATORS.map((p) => ({
          id: p.id,
          roleLabelKo: p.roleLabelKo,
          kind: p.kind,
          provider: p.provider,
        })),
        debateSeats: FESTIVAL_DEBATE_SEATS.map((s) => ({
          id: s.id,
          labelKo: s.labelKo,
          investigatorIds: s.investigatorIds,
        })),
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

  // ── ACTION: scoring — investigate part 1 (7 scoring LLMs). ───────────────────
  if (action === 'scoring') {
    try {
      const scores = await runFestivalScoring(state.plan, state.supplements)
      state.scores = scores
      await saveSession(sessionId, state, 'scoring', 'running')
      return json({
        ok: scores.some((s) => s.ok),
        stage: 'scoring',
        sessionId,
        nextAction: 'benchmark',
        scores: scores.map((s) => ({
          id: s.id,
          roleLabelKo: s.roleLabelKo,
          provider: s.provider,
          score: s.score,
          reasoning: s.reasoning,
          ok: s.ok,
          ...(s.error ? { error: s.error } : {}),
        })),
      })
    } catch (e: unknown) {
      return fail('scoring', e instanceof Error ? e.message : 'unknown error')
    }
  }

  // ── ACTION: benchmark — investigate part 2 (Perplexity, no score). ───────────
  if (action === 'benchmark') {
    try {
      const benchmark = await runFestivalBenchmark(state.plan, state.supplements)
      state.benchmark = benchmark
      state.briefing = buildFestivalBriefing(state.scores ?? [], benchmark)
      await saveSession(sessionId, state, 'benchmark', 'running')
      return json({
        ok: benchmark.ok,
        stage: 'benchmark',
        sessionId,
        nextAction: 'open',
        benchmark,
      })
    } catch (e: unknown) {
      return fail('benchmark', e instanceof Error ? e.message : 'unknown error')
    }
  }

  // ── ACTION: open — debate round 1 (6 seats, independent opinions). ───────────
  if (action === 'open') {
    try {
      const briefing = state.briefing ?? buildFestivalBriefing(state.scores ?? [], state.benchmark)
      const turns = await runFestivalOpen({ question: state.question, briefing })
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

  // ── ACTION: turn — ONE debate round (6 seats serial, red-team rotation). ─────
  if (action === 'turn') {
    try {
      const summaries = state.summaries ?? []
      const priorTurns = state.turns ?? []
      const roundNumber = summaries.length + 1
      if (roundNumber < 2) {
        return fail('turn', '먼저 개회 라운드(open)와 정리(facilitate)가 필요합니다.', 409)
      }
      const briefing = state.briefing ?? buildFestivalBriefing(state.scores ?? [], state.benchmark)
      const currentRoundTurns = await runFestivalRound({
        question: state.question,
        briefing,
        roundNumber,
        priorSummaries: summaries,
      })
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

  // ── ACTION: facilitate — ONE facilitator call + loop control. ────────────────
  if (action === 'facilitate') {
    try {
      const summaries = state.summaries ?? []
      const allTurns = state.turns ?? []
      const roundNumber = summaries.length + 1
      const allTurnsThisRound = allTurns.filter((t) => t.roundNumber === roundNumber)
      if (allTurnsThisRound.length === 0) {
        return fail('facilitate', `라운드 ${roundNumber}의 토론 발언이 없어 정리할 수 없습니다.`, 409)
      }

      const summary = await runFestivalFacilitate({
        question: state.question,
        roundNumber,
        allTurnsThisRound,
        priorSummaries: summaries,
      })

      if (!summary || summary.roundConsensusScore === FESTIVAL_TUNING.SCORE_UNAVAILABLE) {
        await saveSession(sessionId, state, 'facilitate', 'error')
        return json({
          ok: false,
          stage: 'facilitate',
          sessionId,
          roundNumber,
          error: `라운드 ${roundNumber} 수렴 정리(facilitator) 응답을 해석하지 못했습니다.`,
        })
      }

      summaries.push(summary)
      state.summaries = summaries

      const { done, stoppedReason } = festivalLoopControl(summaries)
      if (done) {
        state.debateDone = true
        state.stoppedReason = stoppedReason
      }
      await saveSession(sessionId, state, 'facilitate', 'running')

      return json({
        ok: true,
        stage: 'facilitate',
        sessionId,
        roundNumber,
        consensusScore: summary.roundConsensusScore,
        summary,
        done,
        ...(done ? { stoppedReason, nextAction: 'rescoring' } : { nextAction: 'turn' }),
      })
    } catch (e: unknown) {
      return fail('facilitate', e instanceof Error ? e.message : 'unknown error')
    }
  }

  // ── ACTION: rescoring — STAGE-2 (lens + debate whole-picture), before converge. ─
  if (action === 'rescoring') {
    try {
      const scores = state.scores ?? []
      if (scores.length === 0) {
        return fail('rescoring', '1차 조사관 점수가 없어 재채점할 수 없습니다.', 409)
      }
      if (!state.debateDone) {
        return fail('rescoring', '토론이 끝나기 전에는 2차 재채점을 할 수 없습니다.', 409)
      }
      const rescores = await runFestivalRescoring({
        plan: state.plan,
        ...(state.supplements ? { supplements: state.supplements } : {}),
        stage1Scores: scores,
        turns: state.turns ?? [],
        summaries: state.summaries ?? [],
        benchmark: state.benchmark,
      })
      state.rescores = rescores
      await saveSession(sessionId, state, 'rescoring', 'running')
      logRescorePairs(sessionId, rescores)
      return json({
        ok: rescores.some((r) => r.ok),
        stage: 'rescoring',
        sessionId,
        nextAction: 'converge',
        rescores: rescores.map((r) => ({
          id: r.id,
          roleLabelKo: r.roleLabelKo,
          provider: r.provider,
          stage1Score: r.stage1Score,
          stage2Score: r.stage2Score,
          delta: r.delta,
          changeReason: r.changeReason,
          reasoning: r.reasoning,
          ok: r.ok,
          ...(r.error ? { error: r.error } : {}),
        })),
      })
    } catch (e: unknown) {
      return fail('rescoring', e instanceof Error ? e.message : 'unknown error')
    }
  }

  // ── ACTION: converge — trimmed mean of the 7 STAGE-2 scores. NO vote. ─────────
  if (action === 'converge') {
    try {
      const rescores = state.rescores ?? []
      if (rescores.length === 0) {
        return fail('converge', '2차 재채점 결과가 없어 종합할 수 없습니다.', 409)
      }
      const converge = convergeFestival(rescores)
      state.converge = converge
      await saveSession(sessionId, state, 'converge', 'running')
      return json({
        ok: converge.ok,
        stage: 'converge',
        sessionId,
        nextAction: 'verdict',
        converge,
      })
    } catch (e: unknown) {
      return fail('converge', e instanceof Error ? e.message : 'unknown error')
    }
  }

  // ── ACTION: verdict — chair (Claude Opus) renders the festival forecast. ─────
  if (action === 'verdict') {
    try {
      const converge = state.converge
      if (!converge) {
        return fail('verdict', '종합(converge) 결과가 없어 판결할 수 없습니다.', 409)
      }

      // Idempotent: one verdict per session.
      if (state.verdict) {
        return json({
          ok: state.verdict.ok,
          stage: 'done',
          sessionId,
          done: true,
          overallScore: state.verdict.overallScore,
          converge,
          verdict: state.verdict,
          scores: mapStage1ForClient(state.scores ?? []),
          rescores: mapRescoresForClient(state.rescores ?? []),
        })
      }

      const verdict = await renderFestivalVerdict({
        plan: state.plan,
        ...(state.supplements ? { supplements: state.supplements } : {}),
        scores: state.scores ?? [],
        rescores: state.rescores,
        benchmark: state.benchmark,
        turns: state.turns ?? [],
        summaries: state.summaries ?? [],
        converge,
      })
      state.verdict = verdict
      await saveSession(sessionId, state, 'done', verdict.ok ? 'done' : 'error')

      return json({
        ok: verdict.ok,
        stage: 'done',
        sessionId,
        done: true,
        overallScore: verdict.overallScore,
        converge,
        verdict,
        scores: mapStage1ForClient(state.scores ?? []),
        rescores: mapRescoresForClient(state.rescores ?? []),
      })
    } catch (e: unknown) {
      return fail('verdict', e instanceof Error ? e.message : 'unknown error')
    }
  }

  return fail(action || 'unknown', `unknown action: ${action || '(none)'}`, 400)
}
