import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'
import {
  executeJejuSearches,
  KOREAN_ONLY_DIRECTIVE,
  type JejuExecutedSearch,
} from '@/lib/jeju/deep'
export type { DiagnosticCategory } from '@/lib/jeju/diagnostic-categories'
export { DIAGNOSTIC_CATEGORIES, getDiagnosticCategory } from '@/lib/jeju/diagnostic-categories'

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
  const seed = params.searchSeed?.trim() || params.question.trim()
  if (!seed) return []
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

function buildStatusSystemPrompt(): string {
  return [
    '당신은 제주특별자치도정을 보좌하는 데이터 분석가입니다.',
    '주어진 [수집 데이터]와 [외부 검색 결과]를 읽고, 이 분야의 "오늘의 현황"을 객관적으로 정리하세요.',
    '',
    '작성 규칙:',
    '- 수치·사실 중심. 데이터가 실제로 무엇을 보여주는지 담담하게 서술하세요.',
    '- 모든 수치·사실에는 출처와 시점을 괄호로 병기하세요. 예: "(출처: KPX, 2026-06-27 기준)".',
    '- 데이터에 없는 값은 지어내지 말고, 없으면 없다고 밝히세요.',
    '- 판단·권고·우선순위는 쓰지 마세요(그건 다음 단계 담당). 오직 현황만.',
    '- 길이: 한국어 500~900자, 문장 중간에 끊지 말고 완결하세요.',
    '',
    KOREAN_ONLY_DIRECTIVE,
  ].join('\n')
}

export async function runDiagnosticStatus(params: {
  question: string
  context: string
  searches: JejuExecutedSearch[]
}): Promise<DiagnosticPart> {
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

  try {
    const r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: STATUS_PROVIDER,
      prompt: userPrompt,
      systemPrompt: buildStatusSystemPrompt(),
      maxCompletionTokens: STATUS_MAX_TOKENS,
      modelOverride: STATUS_MODEL,
    })
    if (r.error || !r.text?.trim()) {
      return { ...base, error: r.error ?? '현황 분석이 빈 응답을 반환했습니다.' }
    }
    return { ...base, ok: true, text: sanitizeDiagnosticText(r.text) }
  } catch (e: unknown) {
    return { ...base, error: `현황 분석 호출 실패: ${e instanceof Error ? e.message : 'unknown error'}` }
  }
}

// ── Step 3: AI② 현안 진단가 (Opus) — 가장 시급·중요 사안 ───────────────────────

function buildIssuesSystemPrompt(): string {
  return [
    '당신은 제주특별자치도정을 보좌하는 현안 진단가입니다.',
    '주어진 [수집 데이터], [외부 검색 결과], 그리고 [오늘의 현황](데이터 분석가가 정리한 객관적 현황)을 읽고,',
    '이 분야에서 "지금 가장 시급하고 중요한 사안"을 진단하세요.',
    '',
    '작성 규칙:',
    '- 무엇이 가장 시급한지, 왜 중요한지, 무엇을 주시해야 하는지 — 짧고 결단력 있게.',
    '- 근거가 되는 수치·사실은 출처와 함께 인용하세요.',
    '- 우선순위가 여러 개면 가장 중요한 것부터 1, 2, 3로 제시하세요(최대 3개).',
    '- 찬반 표결·합의도·A/B/C 대안 같은 형식은 쓰지 마세요. 이것은 진단 브리핑입니다.',
    '- 길이: 한국어 400~800자, 문장 중간에 끊지 말고 완결하세요.',
    '',
    KOREAN_ONLY_DIRECTIVE,
  ].join('\n')
}

export async function runDiagnosticIssues(params: {
  question: string
  context: string
  searches: JejuExecutedSearch[]
  status: string | null
}): Promise<DiagnosticPart> {
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

  try {
    const r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: ISSUES_PROVIDER,
      prompt: userPrompt,
      systemPrompt: buildIssuesSystemPrompt(),
      maxCompletionTokens: ISSUES_MAX_TOKENS,
      modelOverride: ISSUES_MODEL,
    })
    if (r.error || !r.text?.trim()) {
      return { ...base, error: r.error ?? '현안 진단이 빈 응답을 반환했습니다.' }
    }
    return { ...base, ok: true, text: sanitizeDiagnosticText(r.text) }
  } catch (e: unknown) {
    return { ...base, error: `현안 진단 호출 실패: ${e instanceof Error ? e.message : 'unknown error'}` }
  }
}
