import { supabaseAdmin } from '@/lib/supabase/server'
import { resolveRouteAuth } from '@/lib/supabase/route-auth'
import { creditsForLeagueOpen } from '@/lib/credits'
import { deductCreditsBalance } from '@/lib/credits-server'
import { checkRateLimit } from '@/lib/rate-limit'
import { LEAGUE_DEEP_RATE_RULE } from '@/lib/league/access-policy'
import { gatherJejuSnapshot, buildBriefingContext, type JejuSnapshot } from '@/lib/motie/brief'
import { summarizeAvailableData, type JejuExecutedSearch } from '@/lib/motie/deep'
import { generateJejuPreReport } from '@/lib/motie/pre-report'
import {
  planJejuOpenMeeting,
  runJejuOpenAnalyses,
  synthesizeJejuOpenBrief,
  OPEN_BRIEF_ANALYSTS,
  type JejuOpenMeetingPlan,
  type JejuOpenAnalysis,
  type JejuOpenBriefSynthesis,
} from '@/lib/motie/open-brief'
import { sanitizeMotieSupplements, type MotieSupplement } from '@/lib/motie/supplements'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * Paid open-analysis run. Auth is required on every POST. Credits
 * (`creditsForLeagueOpen` / module `league_open`) are deducted ONCE, on
 * `action === 'start'`, via the existing `deductCreditsBalance` +
 * `credit_logs` path — later stages of the same session are not recharged.
 * Insufficient balance returns 402 and does not start the engine.
 */

// ─────────────────────────────────────────────────────────────────────────────
// JEJU open-ended (라이트) briefing route — SEPARATE from deliberate/deep debate.
//
// Pipeline: start → orchestrate → pre-report → analyses → synthesize
//   start       : gatherJejuSnapshot + buildBriefingContext + summarizeAvailableData
//   orchestrate : planJejuOpenMeeting (Opus, neutral lenses, 1 doubled angle)
//   pre-report  : generateJejuPreReport({ mode:'briefing' })
//   analyses    : runJejuOpenAnalyses (6 parallel, no debate/vote/consensus)
//   synthesize  : synthesizeJejuOpenBrief (Opus, 추천안 + B·C 대안)
//
// Isolation: NO import from app/api/synod/* or lib/jeju/synod-debate.ts.
// State in motie_deep_sessions.state JSONB — no migration.
// ─────────────────────────────────────────────────────────────────────────────

const TABLE = 'motie_deep_sessions'

type BriefState = {
  question: string
  /** AX COUNCIL mode — plumbed through; engine branching lands next step. */
  councilMode?: 'trade' | 'warroom'
  snapshot?: JejuSnapshot
  context?: string
  availableDataSummary?: string
  plan?: JejuOpenMeetingPlan
  report?: string | null
  leadAnalysis?: string | null
  reportSearches?: JejuExecutedSearch[]
  droppedSearchCount?: number
  analyses?: JejuOpenAnalysis[]
  synthesis?: JejuOpenBriefSynthesis
  /** User-submitted paste-text supplements — optional, text-only this step. */
  supplements?: MotieSupplement[]
}

type Stage = 'start' | 'orchestrate' | 'pre-report' | 'analyses' | 'synthesize' | 'done'

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

function fail(stage: string, error: string, status = 500): Response {
  return json({ ok: false, stage, error }, status)
}

async function loadSession(
  sessionId: string
): Promise<{ state: BriefState; stage: Stage } | null> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('state, stage')
    .eq('id', sessionId)
    .maybeSingle()
  if (error || !data) return null
  return { state: (data.state ?? {}) as BriefState, stage: (data.stage ?? 'start') as Stage }
}

async function saveSession(
  sessionId: string,
  state: BriefState,
  stage: Stage,
  status: 'running' | 'done' | 'error'
): Promise<void> {
  await supabaseAdmin
    .from(TABLE)
    .update({ state, stage, status, updated_at: new Date().toISOString() })
    .eq('id', sessionId)
}

export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    // empty body tolerated
  }

  const action = typeof body.action === 'string' ? body.action : ''

  const { user, error: authErr } = await resolveRouteAuth(req, body)
  if (authErr || !user) {
    return json({ ok: false, stage: action || 'unknown', error: 'Invalid session' }, 401)
  }

  // ── ACTION: start — snapshot + context ───────────────────────────────────────
  if (action === 'start') {
    try {
      const question =
        typeof body.question === 'string' && body.question.trim() ? body.question.trim() : ''
      if (!question) return fail('start', '질문이 비어 있습니다.', 400)

      // Burst guard on the only charged action, checked BEFORE the deduction so
      // a throttled caller is never billed. Per-process and per-user — see
      // `lib/rate-limit.ts` for what this does and does not protect against.
      const limit = checkRateLimit(`league_open:${user.id}`, LEAGUE_DEEP_RATE_RULE)
      if (!limit.ok) {
        return json(
          {
            ok: false,
            stage: 'start',
            error: 'Too many requests. Please wait a moment.',
            retryAfterSec: Math.max(1, Math.ceil(limit.retryAfterMs / 1000)),
          },
          429
        )
      }

      const cost = creditsForLeagueOpen()
      const deduct = await deductCreditsBalance(supabaseAdmin, user.id, cost, 'league_open')
      if (!deduct.ok) {
        const insufficient = deduct.reason === 'insufficient'
        return json(
          {
            ok: false,
            stage: 'start',
            error: insufficient ? 'Insufficient credits' : 'Could not update credits',
            balance: deduct.balance,
            required: cost,
          },
          insufficient ? 402 : 500
        )
      }

      const councilMode: 'trade' | 'warroom' =
        body.councilMode === 'warroom' ? 'warroom' : 'trade'

      const snapshot = await gatherJejuSnapshot(councilMode)
      const context = buildBriefingContext(snapshot, councilMode)
      const availableDataSummary = await summarizeAvailableData(councilMode)
      const supplements = sanitizeMotieSupplements(body.supplements)

      const state: BriefState = {
        question,
        councilMode,
        snapshot,
        context,
        availableDataSummary,
        ...(supplements ? { supplements } : {}),
      }

      const ins = await supabaseAdmin
        .from(TABLE)
        .insert([{ question, status: 'running', stage: 'start', state }])
        .select('id')
        .single()
      if (ins.error || !ins.data?.id) {
        return fail('start', ins.error?.message ?? 'could not create session')
      }

      return json({
        ok: true,
        stage: 'start',
        sessionId: String(ins.data.id),
        nextAction: 'orchestrate',
        analystCount: OPEN_BRIEF_ANALYSTS.length,
      })
    } catch (e: unknown) {
      return fail('start', e instanceof Error ? e.message : 'unknown error')
    }
  }

  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
  if (!sessionId) return fail(action || 'unknown', 'sessionId가 필요합니다.', 400)

  const loaded = await loadSession(sessionId)
  if (!loaded) return fail(action, '세션을 찾을 수 없습니다.', 404)
  const state = loaded.state

  // ── ACTION: orchestrate — open-mode role assignment ──────────────────────────
  if (action === 'orchestrate') {
    try {
      if (!state.context) return fail('orchestrate', '데이터 컨텍스트가 없습니다. start부터 다시 실행하세요.', 400)

      const plan = await planJejuOpenMeeting({
        question: state.question,
        availableDataSummary: state.availableDataSummary ?? state.context,
        councilMode: state.councilMode,
      })

      const next: BriefState = { ...state, plan }
      await saveSession(sessionId, next, 'orchestrate', plan.ok ? 'running' : 'error')

      if (!plan.ok) {
        return json({
          ok: false,
          stage: 'orchestrate',
          sessionId,
          done: true,
          error: plan.error ?? '오케스트레이터 배치 실패',
          plan,
        })
      }

      return json({
        ok: true,
        stage: 'orchestrate',
        sessionId,
        nextAction: 'pre-report',
        plan,
        roles: plan.roles,
        rationale: plan.rationale,
        primaryAngleId: plan.primaryAngleId,
        analystCount: plan.roles.length,
      })
    } catch (e: unknown) {
      return fail('orchestrate', e instanceof Error ? e.message : 'unknown error')
    }
  }

  // ── ACTION: pre-report — shared briefing (mode:'briefing') ───────────────────
  if (action === 'pre-report') {
    try {
      if (!state.snapshot || !state.context) {
        return fail('pre-report', '스냅샷/컨텍스트가 없습니다.', 400)
      }

      const preReport = await generateJejuPreReport({
        question: state.question,
        snapshot: state.snapshot,
        context: state.context,
        mode: 'briefing',
        councilMode: state.councilMode,
      })

      const next: BriefState = {
        ...state,
        report: preReport.report,
        leadAnalysis: preReport.leadAnalysis,
        reportSearches: preReport.searches,
        droppedSearchCount: preReport.droppedSearchCount,
      }
      await saveSession(sessionId, next, 'pre-report', preReport.ok ? 'running' : 'error')

      return json({
        ok: preReport.ok,
        stage: 'pre-report',
        sessionId,
        nextAction: preReport.ok ? 'analyses' : undefined,
        done: !preReport.ok,
        report: preReport.report,
        leadAnalysis: preReport.leadAnalysis,
        searches: preReport.searches,
        droppedSearchCount: preReport.droppedSearchCount,
        reportError: preReport.error,
      })
    } catch (e: unknown) {
      return fail('pre-report', e instanceof Error ? e.message : 'unknown error')
    }
  }

  // ── ACTION: analyses — 6 parallel single-pass analyses ─────────────────────
  if (action === 'analyses') {
    try {
      if (!state.plan?.ok) return fail('analyses', '오케스트레이터 계획이 없습니다.', 400)
      if (!state.report?.trim()) return fail('analyses', '사전 브리핑이 없습니다.', 400)
      if (!state.context) return fail('analyses', '데이터 컨텍스트가 없습니다.', 400)

      const analyses = await runJejuOpenAnalyses({
        question: state.question,
        plan: state.plan,
        briefing: state.report,
        context: state.context,
        councilMode: state.councilMode,
        searches: state.reportSearches,
        supplements: state.supplements,
      })

      const next: BriefState = { ...state, analyses }
      const anyOk = analyses.some((a) => a.ok)
      await saveSession(sessionId, next, 'analyses', anyOk ? 'running' : 'error')

      return json({
        ok: anyOk,
        stage: 'analyses',
        sessionId,
        nextAction: anyOk ? 'synthesize' : undefined,
        done: !anyOk,
        analyses,
        completedCount: analyses.filter((a) => a.ok).length,
        error: anyOk ? undefined : '모든 분석이 실패했습니다.',
      })
    } catch (e: unknown) {
      return fail('analyses', e instanceof Error ? e.message : 'unknown error')
    }
  }

  // ── ACTION: synthesize — Opus integrated briefing ────────────────────────────
  if (action === 'synthesize') {
    try {
      if (!state.report?.trim()) return fail('synthesize', '사전 브리핑이 없습니다.', 400)
      if (!state.analyses || state.analyses.length === 0) {
        return fail('synthesize', '병렬 분석 결과가 없습니다.', 400)
      }

      const synthesis = await synthesizeJejuOpenBrief({
        question: state.question,
        briefing: state.report,
        analyses: state.analyses,
        searches: state.reportSearches,
        councilMode: state.councilMode,
        supplements: state.supplements,
      })

      const next: BriefState = { ...state, synthesis }
      await saveSession(sessionId, next, 'synthesize', synthesis.ok ? 'done' : 'error')

      return json({
        ok: synthesis.ok,
        stage: 'synthesize',
        sessionId,
        done: synthesis.ok,
        synthesis: synthesis.synthesis,
        synthesisError: synthesis.error,
        provider: synthesis.provider,
      })
    } catch (e: unknown) {
      return fail('synthesize', e instanceof Error ? e.message : 'unknown error')
    }
  }

  return fail(action || 'unknown', `알 수 없는 action: ${action}`, 400)
}
