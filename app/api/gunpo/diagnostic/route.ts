import { supabaseAdmin } from '@/lib/supabase/server'
import { gatherJejuSnapshot, buildBriefingContext, FIXED_GUNPO_COUNCIL_MODE, type JejuSnapshot } from '@/lib/gunpo/brief'
import { type JejuExecutedSearch } from '@/lib/gunpo/deep'
import {
  runDiagnosticSearch,
  runDiagnosticStatus,
  runDiagnosticIssues,
  getDiagnosticCategory,
  type DiagnosticPart,
} from '@/lib/gunpo/diagnostic'

export const runtime = 'nodejs'
export const maxDuration = 300

// TODO: credit/auth gating before public launch (governance demo — open for now).

// ─────────────────────────────────────────────────────────────────────────────
// JEJU diagnostic (진단형) route — SEPARATE from deliberate & brief.
//
// Pipeline: start → search → status → issues
//   start  : gatherJejuSnapshot + buildBriefingContext
//   search : runDiagnosticSearch (one Perplexity status search)
//   status : runDiagnosticStatus (AI① Sonnet — 오늘의 현황)
//   issues : runDiagnosticIssues (AI② Opus — 가장 시급한 사안)
//
// Isolation: NO import from synod-debate, the deliberate route, or open-brief.
// State in motie_deep_sessions.state JSONB — no migration. No vote/consensus/ABC.
// ─────────────────────────────────────────────────────────────────────────────

const TABLE = 'motie_deep_sessions'

type DiagnosticState = {
  question: string
  /** AX COUNCIL mode — plumbed through; engine branching lands next step. */
  councilMode?: 'trade' | 'warroom'
  categoryId?: string
  searchSeed?: string
  snapshot?: JejuSnapshot
  context?: string
  searches?: JejuExecutedSearch[]
  status?: DiagnosticPart
  issues?: DiagnosticPart
}

type Stage = 'start' | 'search' | 'status' | 'issues' | 'done'

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

function fail(stage: string, error: string, status = 500): Response {
  return json({ ok: false, stage, error }, status)
}

async function loadSession(
  sessionId: string
): Promise<{ state: DiagnosticState; stage: Stage } | null> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('state, stage')
    .eq('id', sessionId)
    .maybeSingle()
  if (error || !data) return null
  return { state: (data.state ?? {}) as DiagnosticState, stage: (data.stage ?? 'start') as Stage }
}

async function saveSession(
  sessionId: string,
  state: DiagnosticState,
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
      // STEP12: mode toggle removed — always use the fixed single mode.
      const councilMode: 'trade' | 'warroom' = FIXED_GUNPO_COUNCIL_MODE
      void body.councilMode

      const categoryId = typeof body.categoryId === 'string' ? body.categoryId.trim() : ''
      const category = categoryId ? getDiagnosticCategory(categoryId, councilMode) : undefined

      // Question: explicit free-text wins; else the category preset.
      const rawQuestion = typeof body.question === 'string' ? body.question.trim() : ''
      const question = rawQuestion || category?.presetQuestion || ''
      if (!question) return fail('start', '질문 또는 카테고리가 필요합니다.', 400)

      const searchSeed = category?.searchSeed ?? question

      const snapshot = await gatherJejuSnapshot(councilMode)
      const context = buildBriefingContext(snapshot, councilMode)

      const state: DiagnosticState = {
        question,
        councilMode,
        categoryId: category?.id,
        searchSeed,
        snapshot,
        context,
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
        nextAction: 'search',
        question,
        categoryId: category?.id ?? null,
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

  // ── ACTION: search — one Perplexity status search ────────────────────────────
  if (action === 'search') {
    try {
      const searches = await runDiagnosticSearch({
        question: state.question,
        searchSeed: state.searchSeed,
      })
      const next: DiagnosticState = { ...state, searches }
      await saveSession(sessionId, next, 'search', 'running')
      return json({
        ok: true,
        stage: 'search',
        sessionId,
        nextAction: 'status',
        searches,
      })
    } catch (e: unknown) {
      return fail('search', e instanceof Error ? e.message : 'unknown error')
    }
  }

  // ── ACTION: status — AI① Sonnet 오늘의 현황 ──────────────────────────────────
  if (action === 'status') {
    try {
      if (!state.context) return fail('status', '데이터 컨텍스트가 없습니다.', 400)
      const status = await runDiagnosticStatus({
        question: state.question,
        context: state.context,
        searches: state.searches ?? [],
        councilMode: state.councilMode,
      })
      const next: DiagnosticState = { ...state, status }
      await saveSession(sessionId, next, 'status', status.ok ? 'running' : 'error')
      return json({
        ok: status.ok,
        stage: 'status',
        sessionId,
        nextAction: status.ok ? 'issues' : undefined,
        done: !status.ok,
        status,
        error: status.ok ? undefined : status.error,
      })
    } catch (e: unknown) {
      return fail('status', e instanceof Error ? e.message : 'unknown error')
    }
  }

  // ── ACTION: issues — AI② Opus 가장 시급한 사안 ───────────────────────────────
  if (action === 'issues') {
    try {
      if (!state.context) return fail('issues', '데이터 컨텍스트가 없습니다.', 400)
      const issues = await runDiagnosticIssues({
        question: state.question,
        context: state.context,
        searches: state.searches ?? [],
        status: state.status?.text ?? null,
        councilMode: state.councilMode,
      })
      const next: DiagnosticState = { ...state, issues }
      await saveSession(sessionId, next, 'issues', issues.ok ? 'done' : 'error')
      return json({
        ok: issues.ok,
        stage: 'issues',
        sessionId,
        done: issues.ok,
        issues,
        error: issues.ok ? undefined : issues.error,
      })
    } catch (e: unknown) {
      return fail('issues', e instanceof Error ? e.message : 'unknown error')
    }
  }

  return fail(action || 'unknown', `알 수 없는 action: ${action}`, 400)
}
