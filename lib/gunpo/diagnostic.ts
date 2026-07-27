import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'
import type { JejuCouncilMode } from '@/lib/gunpo/brief'
import {
  executeJejuSearches,
  KOREAN_ONLY_DIRECTIVE,
  type JejuExecutedSearch,
} from '@/lib/gunpo/deep'
import {
  diagnosticStatusPersonaLine,
  diagnosticIssuesPersonaLine,
  TRADE_ANALYST_DIRECTIVE,
  WARROOM_ANALYST_DIRECTIVE,
} from '@/lib/gunpo/persona'
export type { DiagnosticCategory } from '@/lib/gunpo/diagnostic-categories'
export { getDiagnosticCategories, getDiagnosticCategory } from '@/lib/gunpo/diagnostic-categories'

// ── Models + caps ─────────────────────────────────────────────────────────────

const STATUS_PROVIDER: ExtendedAiProviderName = 'anthropic'
const STATUS_MODEL = 'claude-sonnet-4-6'
const ISSUES_PROVIDER: ExtendedAiProviderName = 'anthropic'
const ISSUES_MODEL = 'claude-opus-4-8'

/** Generous caps — completeness over brevity, but still a one-pager. */
const STATUS_MAX_TOKENS = 2500
const ISSUES_MAX_TOKENS = 2500

function noDbSupabase(): SupabaseClient {
  return createClient('http://localhost', 'diagnostic-no-db') as unknown as SupabaseClient
}

// ── Transient-failure retry wrapper ───────────────────────────────────────────
// A single transient upstream hiccup (503 / connection reset / timeout /
// overloaded / 429) or an empty response can wipe a stage's result mid-demo.
// We retry up to 3 attempts with a short linear backoff. Non-transient errors
// (400/401/invalid request, etc.) return immediately — no point retrying those.

const RETRY_MAX_ATTEMPTS = 3
const RETRY_BACKOFF_MS = 1200

function retryDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isTransientAiError(msg: string | null | undefined): boolean {
  if (!msg) return false
  const m = msg.toLowerCase()
  return (
    m.includes('503') ||
    m.includes('service unavailable') ||
    m.includes('upstream connect') ||
    m.includes('connection termination') ||
    m.includes('reset') ||
    m.includes('timeout') ||
    m.includes('econnreset') ||
    m.includes('overloaded') ||
    m.includes('429')
  )
}

type RetryOutcome = {
  /** Non-empty text on success; null otherwise. */
  text: string | null
  /** true when the response was OK (no error + non-blank text). */
  ok: boolean
  /** How the call failed (when !ok). 'threw' = exception was raised. */
  errorKind: 'none' | 'error' | 'empty' | 'threw'
  /** r.error string, or the thrown message. null for empty-response failures. */
  errorMessage: string | null
  /** true when at least one retry was attempted before the final outcome. */
  retried: boolean
}

/**
 * Wraps runSingleAiProvider with transient-failure retries. Preserves the
 * caller's ability to build the exact same DiagnosticPart error messages —
 * it only reports WHAT happened, never formats the user-facing string.
 */
async function runAiWithRetry(
  params: Parameters<typeof runSingleAiProvider>[0]
): Promise<RetryOutcome> {
  let retried = false
  let lastKind: 'error' | 'empty' | 'threw' = 'empty'
  let lastMessage: string | null = null

  for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
    let transient = false
    try {
      const r = await runSingleAiProvider(params)
      if (!r.error && r.text?.trim()) {
        return { text: r.text, ok: true, errorKind: 'none', errorMessage: null, retried }
      }
      if (r.error) {
        lastKind = 'error'
        lastMessage = r.error
        transient = isTransientAiError(r.error)
      } else {
        // Empty/blank text with no explicit error — treat as transient.
        lastKind = 'empty'
        lastMessage = null
        transient = true
      }
      if (!transient) {
        return { text: null, ok: false, errorKind: lastKind, errorMessage: lastMessage, retried }
      }
    } catch (e: unknown) {
      // A thrown network error is always treated as transient.
      lastKind = 'threw'
      lastMessage = e instanceof Error ? e.message : 'unknown error'
      transient = true
    }

    if (attempt < RETRY_MAX_ATTEMPTS) {
      retried = true
      await retryDelay(RETRY_BACKOFF_MS * attempt)
    }
  }

  return { text: null, ok: false, errorKind: lastKind, errorMessage: lastMessage, retried: true }
}

/**
 * Strips CJK ideographs + leaked markdown/citation markup, leaving clean Korean
 * prose. Combines the CJK-strip (cf. brief page sanitizeCjk) and the
 * markdown/citation strip (cf. deep.ts sanitizeVoteReason) into one server-side
 * pass so the diagnostic page renders clean text without its own sanitizer.
 */
export function sanitizeDiagnosticText(text: string | null | undefined): string | null {
  if (!text || !text.trim()) return null
  const cleaned = text
    // CJK Unified Ideographs + extensions A/B + Compatibility Ideographs
    .replace(/[\u4E00-\u9FFF\u3400-\u4DBF\u{20000}-\u{2A6DF}\uF900-\uFAFF]/gu, '')
    // CJK Radicals, Kangxi, bopomofo
    .replace(/[\u2E80-\u2FFF\u3100-\u312F]/g, '')
    // footnote/citation markers [n], [n][m]
    .replace(/\[\d+\](?:\[\d+\])*/g, '')
    // underscore emphasis / stray underscores
    .replace(/_+/g, '')
    // markdown bold/italic asterisks
    .replace(/\*+/g, '')
    // collapse runs of spaces left by removals
    .replace(/[ \t]{2,}/g, ' ')
    // tidy space left before punctuation
    .replace(/ +([,.\])])/g, '$1')
    .trim()
  return cleaned || null
}

// ── KST date helper (computed per-call, never at module load) ─────────────────

function kstYmd(): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date())
}

// ── Step 1: Perplexity status search (reuse executeJejuSearches) ──────────────

/**
 * Runs ONE Perplexity search for the category's current status. Builds the
 * `merged` array directly (no mergeSearchRequests needed — diagnostic asks a
 * single status question). Search results are sanitized for display.
 */
export async function runDiagnosticSearch(params: {
  question: string
  searchSeed?: string
}): Promise<JejuExecutedSearch[]> {
  const rawSeed = params.searchSeed?.trim() || params.question.trim()
  if (!rawSeed) return []
  const todayKST = kstYmd()
  const seed = `[오늘: ${todayKST} 기준] ${rawSeed} 최신 현황 (가능한 한 최근 1~2주 이내 자료 우선, 오래된 자료는 시점을 명시)`
  const merged = [{ query: seed, requestedBy: ['진단 분석가'] }]
  const results = await executeJejuSearches({ merged })
  return results.map((r) => ({
    ...r,
    result: r.ok ? sanitizeDiagnosticText(r.result) : r.result,
  }))
}

// ── Shared material block ─────────────────────────────────────────────────────

function searchBlock(searches: JejuExecutedSearch[]): string {
  if (!searches || searches.length === 0) return '(외부 검색 없음)'
  return searches
    .map((s) => {
      const body = s.ok && s.result ? s.result : `(검색 실패: ${s.error ?? 'unknown'})`
      return `· ${s.query}: ${body}`
    })
    .join('\n')
}

// ── Step 2: AI① 데이터 분석가 (Sonnet) — 오늘의 현황 ───────────────────────────

export type DiagnosticPart = {
  ok: boolean
  text: string | null
  provider: string
  model: string
  error?: string
}

function buildStatusSystemPrompt(councilMode: JejuCouncilMode): string {
  const isTrade = councilMode === 'trade'
  const todayKST = kstYmd()
  const sourceExample = isTrade
    ? '- 모든 수치·사실에는 출처와 시점을 괄호로 병기하세요. 예: "(출처: KOTRA 국가정보)".'
    : '- 모든 수치·사실에는 출처와 시점을 괄호로 병기하세요. 예: "(출처: 오피넷, 오늘 기준)". 오피넷 유가는 현재 현황, 가스공사 LNG 수입은 과거 구조 배경으로 구분하세요.'
  return [
    diagnosticStatusPersonaLine(councilMode),
    `오늘 날짜: ${todayKST}. 이 시점을 기준으로 "현재/최근"을 판단하라.`,
    '주어진 [수집 데이터]와 [외부 검색 결과]를 읽고, 이 분야의 "오늘의 현황"을 객관적으로 정리하세요.',
    ...(isTrade ? ['', TRADE_ANALYST_DIRECTIVE] : ['', WARROOM_ANALYST_DIRECTIVE]),
    '',
    '작성 규칙:',
    '- 수치·사실 중심. 데이터가 실제로 무엇을 보여주는지 담담하게 서술하세요.',
    sourceExample,
    '- 데이터에 없는 값은 지어내지 말고, 없으면 없다고 밝히세요.',
    '- 판단·권고·우선순위는 쓰지 마세요(그건 다음 단계 담당). 오직 현황만.',
    '- 길이: 한국어 500~900자, 문장 중간에 끊지 말고 완결하세요.',
    '- 검색 결과에 시점이 불명확하거나 과거(예: 몇 달 전, 지난해) 자료로 보이면, 그 사실을 "[시점 불명]" 또는 "[과거 자료]"로 표기하고 현재 상황으로 단정하지 마라.',
    '- 검색 결과나 데이터에 없는 수치·사건을 지어내지 마라. 확인되지 않으면 "[확인 필요]"로 표기하라.',
    '',
    KOREAN_ONLY_DIRECTIVE,
  ].join('\n')
}

export async function runDiagnosticStatus(params: {
  question: string
  context: string
  searches: JejuExecutedSearch[]
  councilMode?: JejuCouncilMode
}): Promise<DiagnosticPart> {
  const councilMode: JejuCouncilMode = params.councilMode === 'warroom' ? 'warroom' : 'trade'
  const base: DiagnosticPart = {
    ok: false,
    text: null,
    provider: STATUS_PROVIDER,
    model: STATUS_MODEL,
  }
  const userPrompt = [
    '[질문]',
    params.question,
    '',
    '[수집 데이터]',
    params.context.trim() || '(내부 데이터 없음)',
    '',
    '[외부 검색 결과]',
    searchBlock(params.searches),
    '',
    '위 자료로 이 분야의 "오늘의 현황"을 정리하세요.',
  ].join('\n')

  const r = await runAiWithRetry({
    supabase: noDbSupabase(),
    sessionId: null,
    userId: null,
    provider: STATUS_PROVIDER,
    prompt: userPrompt,
    systemPrompt: buildStatusSystemPrompt(councilMode),
    maxCompletionTokens: STATUS_MAX_TOKENS,
    modelOverride: STATUS_MODEL,
  })
  if (r.ok) {
    return { ...base, ok: true, text: sanitizeDiagnosticText(r.text) }
  }
  const err =
    r.errorKind === 'threw'
      ? `현황 분석 호출 실패: ${r.errorMessage ?? 'unknown error'}`
      : (r.errorMessage ?? '현황 분석이 빈 응답을 반환했습니다.')
  return { ...base, error: r.retried ? `${err} (재시도 후 실패)` : err }
}

// ── Step 3: AI② 현안 진단가 (Opus) — 가장 시급·중요 사안 ───────────────────────

function buildIssuesSystemPrompt(councilMode: JejuCouncilMode): string {
  const isTrade = councilMode === 'trade'
  const todayKST = kstYmd()
  return [
    diagnosticIssuesPersonaLine(councilMode),
    `오늘 날짜: ${todayKST}. 이 시점을 기준으로 "현재/최근"을 판단하라.`,
    '주어진 [수집 데이터], [외부 검색 결과], 그리고 [오늘의 현황](데이터 분석가가 정리한 객관적 현황)을 읽고,',
    '이 분야에서 "지금 가장 시급하고 중요한 사안"을 진단하세요.',
    ...(isTrade ? ['', TRADE_ANALYST_DIRECTIVE] : ['', WARROOM_ANALYST_DIRECTIVE]),
    '',
    '작성 규칙:',
    '- 무엇이 가장 시급한지, 왜 중요한지, 무엇을 주시해야 하는지 — 짧고 결단력 있게.',
    '- 근거가 되는 수치·사실은 출처와 함께 인용하세요.',
    '- 우선순위가 여러 개면 가장 중요한 것부터 1, 2, 3로 제시하세요(최대 3개).',
    '- 찬반 표결·합의도·A/B/C 대안 같은 형식은 쓰지 마세요. 이것은 진단 브리핑입니다.',
    '- 길이: 한국어 400~800자, 문장 중간에 끊지 말고 완결하세요.',
    '- 검색 결과에 시점이 불명확하거나 과거(예: 몇 달 전, 지난해) 자료로 보이면, 그 사실을 "[시점 불명]" 또는 "[과거 자료]"로 표기하고 현재 상황으로 단정하지 마라.',
    '- 검색 결과나 데이터에 없는 수치·사건을 지어내지 마라. 확인되지 않으면 "[확인 필요]"로 표기하라.',
    '',
    KOREAN_ONLY_DIRECTIVE,
  ].join('\n')
}

export async function runDiagnosticIssues(params: {
  question: string
  context: string
  searches: JejuExecutedSearch[]
  status: string | null
  councilMode?: JejuCouncilMode
}): Promise<DiagnosticPart> {
  const councilMode: JejuCouncilMode = params.councilMode === 'warroom' ? 'warroom' : 'trade'
  const base: DiagnosticPart = {
    ok: false,
    text: null,
    provider: ISSUES_PROVIDER,
    model: ISSUES_MODEL,
  }
  const userPrompt = [
    '[질문]',
    params.question,
    '',
    '[수집 데이터]',
    params.context.trim() || '(내부 데이터 없음)',
    '',
    '[외부 검색 결과]',
    searchBlock(params.searches),
    '',
    '[오늘의 현황 — 데이터 분석가 정리]',
    params.status?.trim() || '(현황 분석 없음)',
    '',
    '위 자료로 "가장 시급하고 중요한 사안"을 진단하세요.',
  ].join('\n')

  const r = await runAiWithRetry({
    supabase: noDbSupabase(),
    sessionId: null,
    userId: null,
    provider: ISSUES_PROVIDER,
    prompt: userPrompt,
    systemPrompt: buildIssuesSystemPrompt(councilMode),
    maxCompletionTokens: ISSUES_MAX_TOKENS,
    modelOverride: ISSUES_MODEL,
  })
  if (r.ok) {
    return { ...base, ok: true, text: sanitizeDiagnosticText(r.text) }
  }
  const err =
    r.errorKind === 'threw'
      ? `현안 진단 호출 실패: ${r.errorMessage ?? 'unknown error'}`
      : (r.errorMessage ?? '현안 진단이 빈 응답을 반환했습니다.')
  return { ...base, error: r.retried ? `${err} (재시도 후 실패)` : err }
}
