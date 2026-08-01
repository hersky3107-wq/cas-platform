import { supabaseAdmin } from '@/lib/supabase/server'
import { gatherJejuSnapshot, buildBriefingContext, type JejuSnapshot } from '@/lib/jeju/brief'
import { summarizeAvailableData, type JejuExecutedSearch } from '@/lib/jeju/deep'
import { generateJejuPreReport } from '@/lib/jeju/pre-report'
import {
  planJejuOpenMeeting,
  runJejuOpenAnalyses,
  synthesizeJejuOpenBrief,
  OPEN_BRIEF_ANALYSTS,
  type JejuOpenMeetingPlan,
  type JejuOpenAnalysis,
  type JejuOpenBriefSynthesis,
} from '@/lib/jeju/open-brief'
import { sanitizeJejuSupplements, type JejuSupplement } from '@/lib/jeju/supplements'
import { runJejuCrossCheck, type DataTrustBlock } from '@/lib/jeju/cross-check'

export const runtime = 'nodejs'
export const maxDuration = 300

// TODO: credit/auth gating before public launch (governance demo — open for now).

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
// State in jeju_deep_sessions.state JSONB — no migration.
// ─────────────────────────────────────────────────────────────────────────────

const TABLE = 'jeju_deep_sessions'

type BriefState = {
  question: string
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
  /** User-submitted paste-text supplements — optional, sanitized on start. */
  supplements?: JejuSupplement[]
  /** Data cross-validation findings, computed once from the beat-1 snapshot. */
  dataTrust?: DataTrustBlock
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

  // ── ACTION: start — snapshot + context ───────────────────────────────────────
  if (action === 'start') {
    try {
      const question =
        typeof body.question === 'string' && body.question.trim() ? body.question.trim() : ''
      if (!question) return fail('start', '질문이 비어 있습니다.', 400)

      const snapshot = await gatherJejuSnapshot()
      const context = buildBriefingContext(snapshot)
      // Data cross-validation runs BEFORE the orchestrator, on the same
      // snapshot it's about to read. Never throws (see runJejuCrossCheck).
      const dataTrust = await runJejuCrossCheck({ snapshot })
      const availableDataSummary = await summarizeAvailableData()
      const supplements = sanitizeJejuSupplements(body.supplements)

      const state: BriefState = {
        question,
        snapshot,
        context,
        availableDataSummary,
        ...(supplements ? { supplements } : {}),
        ...(dataTrust.hasIssues ? { dataTrust } : {}),
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
        supplements: state.supplements,
        dataTrust: state.dataTrust,
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
        supplements: state.supplements,
        dataTrust: state.dataTrust,
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
