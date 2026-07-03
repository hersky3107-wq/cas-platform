import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'
import type { JejuSnapshot, JejuCouncilMode } from '@/lib/motie/brief'
import {
  mergeSearchRequests,
  executeJejuSearches,
  KOREAN_ONLY_DIRECTIVE,
  type JejuRoleAnalysis,
  type JejuSearchRequest,
  type JejuExecutedSearch,
} from '@/lib/motie/deep'
import {
  leadAnalystPersonaLine,
  reportWriterPersonaLines,
  userQuestionLabel,
  TRADE_ANALYST_DIRECTIVE,
  TRADE_REDUNDANCY_RULE,
  WARROOM_ANALYST_DIRECTIVE,
  WARROOM_REDUNDANCY_RULE,
} from '@/lib/motie/persona'

/**
 * JEJU pre-debate analysis report — the SHARED, mode-agnostic front-end piece.
 *
 * "고급 AI가 API 데이터를 쫙 보고 분석한 리포트": a strong reasoning model reads
 * the question + the already-gathered Korean briefing context, declares what it
 * still needs looked up, delegates ONLY that to Perplexity (via the existing
 * deep.ts search path), then writes one long, structured, PROVENANCE-CITED
 * Korean governance report.
 *
 * Reused by BOTH:
 *   - Mode B (deliberation): this report SEEDS the SYNOD debate (the debaters
 *     read it before arguing).
 *   - Mode A (briefing): this report IS the primary output (synthesized into
 *     conclusions/proposals).
 *
 * DESIGN:
 *   - Data IN, report OUT. The CALLER (future route) runs gatherJejuSnapshot() +
 *     buildBriefingContext() and passes { snapshot, context } in. This function
 *     does NOT re-fetch the data layer — keeps it testable and avoids double
 *     fetches when a route already has the snapshot.
 *   - REUSES (never reimplements): mergeSearchRequests + executeJejuSearches
 *     (Perplexity-backed, MAX_SEARCHES cap) from deep.ts, and runSingleAiProvider.
 *   - Korean-only output via KOREAN_ONLY_DIRECTIVE.
 *   - Hard requirement: every figure in the report cites its SOURCE
 *     (KPX/KAMIS/KMA/감귤통계 등) WITH a timestamp — the data-provenance display
 *     the product explicitly wants surfaced ("자랑할 데이터를 자랑하는").
 *   - No debate, no vote, no chair here. Those are separate steps.
 *
 * 'server-only', never throws — failures return ok:false with partial data.
 */

/** Which downstream consumer the report shape is tailored for. */
export type JejuPreReportMode = 'briefing' | 'deliberation'

/** Structured result of the pre-debate report stage. */
export type JejuPreReport = {
  ok: boolean
  question: string
  mode: JejuPreReportMode
  /** The lead analyst's first-pass analysis (kept for transparency/UI). */
  leadAnalysis: string | null
  /** Perplexity search results used to enrich the report (kept for UI + onward). */
  searches: JejuExecutedSearch[]
  /** Distinct search topics dropped beyond the MAX_SEARCHES cap. */
  droppedSearchCount: number
  /** The final long, structured, provenance-cited Korean report. */
  report: string | null
  /** Provider that wrote the report (for transparency). */
  provider: string
  error?: string
}

/** Strong reasoning model used for both the first pass and the final report. */
const LEAD_PROVIDER: ExtendedAiProviderName = 'anthropic'

/** First-pass analysis: a Korean analysis + a small search-requests JSON. */
const LEAD_ANALYSIS_MAX_TOKENS = 1800

/**
 * Final report: one long page (sections 1–4 + tables) in token-dense Korean.
 * Completeness is the priority — never truncate mid-sentence — so this is set
 * very generously. Shared by both 개방형(brief) and 찬반형(deliberation) modes.
 */
const REPORT_MAX_TOKENS = 8000

/**
 * Throwaway Supabase client to satisfy runSingleAiProvider's required param.
 * With sessionId:null + userId:null the router does NO DB inserts and NO BYOK
 * reads, so this client is never dereferenced for I/O. Mirrors the local pattern
 * in brief.ts / deep.ts (their helpers aren't exported) to keep lib/jeju portable.
 */
function noDbSupabase(): SupabaseClient {
  return createClient('http://localhost', 'pre-report-no-db') as unknown as SupabaseClient
}

/** Strips ``` / ```json fences and returns the inner JSON-ish text. */
function stripFences(raw: string): string {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i)
  if (fence && fence[1]) text = fence[1].trim()
  if (!text.startsWith('{')) {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end > start) text = text.slice(start, end + 1)
  }
  return text
}

/** Validates + caps the lead analyst's search requests; drops malformed entries. */
function normalizeSearchRequests(raw: unknown): JejuSearchRequest[] {
  if (!Array.isArray(raw)) return []
  const out: JejuSearchRequest[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const query = typeof o.query === 'string' ? o.query.trim() : ''
    const reason = typeof o.reason === 'string' ? o.reason.trim() : ''
    if (!query || !reason) continue
    out.push({ query, reason })
  }
  return out
}

/**
 * Parses the lead analyst's first-pass output into { analysis, searchRequests }.
 * On clean JSON: pulls both. On parse failure but non-empty text: treats the raw
 * text as the analysis with no search requests (a JSON hiccup never loses it).
 */
function parseLeadOutput(raw: string): { analysis: string; searchRequests: JejuSearchRequest[] } {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripFences(raw))
  } catch {
    return { analysis: raw.trim(), searchRequests: [] }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { analysis: raw.trim(), searchRequests: [] }
  }
  const o = parsed as Record<string, unknown>
  const analysis = typeof o.analysis === 'string' && o.analysis.trim() ? o.analysis.trim() : raw.trim()
  return { analysis, searchRequests: normalizeSearchRequests(o.searchRequests) }
}

/** First-pass lead-analyst system prompt: read the data, flag what to search. */
function buildLeadAnalysisSystemPrompt(councilMode: JejuCouncilMode): string {
  const isTrade = councilMode === 'trade'
  const gapLine = isTrade
    ? '- 내부 데이터만으로 부족한 부분, 즉 최신 외부 정보(현지 시장·수요 동향, 관세·인증·라벨링 규제, 무역구제(반덤핑 등) 동향, 경쟁·바이어·유통, 환율 흐름 등)가 필요한 지점을 명확히 짚고, 추측으로 메우지 말고 "검색 요청"으로 선언하세요.'
    : '- 내부 데이터만으로 부족한 부분, 즉 최신 외부 정보(국제 유가·가스 가격, 지정학·수급 정세, 정부 에너지 정책, 국제기구 전망 등)가 필요한 지점을 명확히 짚고, 추측으로 메우지 말고 "검색 요청"으로 선언하세요.'
  return [
    leadAnalystPersonaLine(councilMode),
    '제공된 [수집 데이터]를 정밀하게 읽고, 이 질문에 답하기 위한 1차 분석을 수행하세요.',
    '해야 할 일:',
    '- 이 질문이 쪼개지는 핵심 하위 질문들을 식별하세요.',
    '- 확보된 데이터가 실제로 무엇을 말하는지 정리하세요(수치는 데이터에 있는 값만 사용, 지어내지 말 것).',
    gapLine,
    '검색 요청은 의사결정에 정말 중요한 것 위주로, 무엇을 왜 찾아야 하는지 구체적으로.',
    ...(isTrade ? ['', TRADE_ANALYST_DIRECTIVE] : ['', WARROOM_ANALYST_DIRECTIVE]),
    '',
    KOREAN_ONLY_DIRECTIVE,
    '',
    '출력 형식 (매우 중요): 오직 하나의 JSON 객체만 출력하세요. 마크다운 코드펜스(```)도, 설명 문장도 쓰지 마세요. 순수 JSON만.',
    '스키마:',
    '{ "analysis": "1차 분석 (핵심 하위질문 + 데이터가 말하는 것 + 공백, 400~700자)", "searchRequests": [ { "query": "검색어", "reason": "왜 필요한지" } ] }',
    'searchRequests는 정말 더 알아봐야 할 게 있을 때만. 없으면 빈 배열 [].',
  ].join('\n')
}

/** Korean section list for the final report, branched by mode + councilMode. */
function reportSectionList(mode: JejuPreReportMode, councilMode: JejuCouncilMode): string {
  const isTrade = councilMode === 'trade'
  const section2 = isTrade
    ? '2. 데이터가 말하는 것: 확보된 정량·정성 데이터의 해석. 각 수치·사실마다 반드시 출처(KOTRA 국가정보, KOTRA 상품DB, 한국수출입은행 환율, 관세·통계 등)와 데이터 시점(언제 기준인지)을 괄호로 함께 명시하세요. 예: "관세율 OO% (출처: KOTRA 국가정보)". 출처·시점을 밝힐 수 없는 수치는 쓰지 말고, 근거 없는 추론·전망에는 [AI 추정]/[확인 필요]를 붙이세요. 각 데이터 포인트는 1~2줄로 간결하게, 중복 없이.'
    : '2. 데이터가 말하는 것: 확보된 정량·정성 데이터의 해석. 각 수치·사실마다 반드시 출처(오피넷 유가, 가스공사 LNG 수입, 검색 등)와 데이터 시점(언제 기준인지)을 괄호로 함께 명시하세요. 예: "휘발유 전국 평균 OO원/L (출처: 오피넷, 오늘 기준)". 오피넷 유가는 현재 현황으로, 가스공사 LNG 수입은 과거 구조 배경으로만 다루고 과거 데이터를 현재처럼 쓰지 마세요. 출처·시점을 밝힐 수 없는 수치는 쓰지 말고, 근거 없는 추론·전망에는 [AI 추정]/[확인 필요]를 붙이세요. 각 데이터 포인트는 1~2줄로 간결하게, 중복 없이.'
  const shared = [
    '1. 핵심 현안: 가장 중요한 메시지 3~5줄로 요약.',
    section2,
    '3. 외부 조사로 보완한 것: 검색(Perplexity)으로 확인한 최신 정보와 그 출처. 검색이 없었으면 "외부 조사 없음"이라고 적으세요.',
    '4. 쟁점과 불확실성: 데이터 공백, 상충, 검증이 필요한 지점, 신뢰도 한계.',
  ]
  let tail: string
  if (mode === 'deliberation') {
    tail = isTrade
      ? '5. 진입 판단을 위한 핵심 쟁점: 이 수출 안건을 진입/보류로 가르는 핵심 질문과, 진입(찬성) 측·보류(반대) 측 논거가 각각 출발할 지점을 정리하세요(결론을 내리지는 말 것 — 토론의 출발점만 제시).'
      : '5. 찬반 판단을 위한 핵심 쟁점: 이 안건을 찬성/반대로 가르는 핵심 질문과, 찬성 측·반대 측 논거가 각각 출발할 지점을 정리하세요(결론을 내리지는 말 것 — 토론의 출발점만 제시).'
  } else {
    tail = isTrade
      ? '5. 가능한 실행 방향들: 개방형 질문에 대해 데이터가 시사하는, 실행 가능한 수출 방향을 진입 / 보류 / 조건부 추진의 선택지로 제시하세요(단정이 아니라 선택지로).'
      : '5. 가능한 방향들: 개방형 질문에 대해 데이터가 시사하는, 실행 가능한 정책 방향·제언을 제시하세요(단정이 아니라 선택지로).'
  }
  return [...shared, tail].join('\n')
}

/** Final report-writer system prompt: long structured Korean report with provenance. */
function buildReportWriterSystemPrompt(mode: JejuPreReportMode, sourceHint: string, councilMode: JejuCouncilMode): string {
  const isTrade = councilMode === 'trade'
  return [
    ...reportWriterPersonaLines(councilMode),
    '이 리포트는 이후 여러 AI 전문가가 읽고 토론·판단하는 기초 자료가 됩니다. 따라서 정확하고, 근거가 분명하며, 출처가 투명해야 합니다.',
    ...(isTrade
      ? ['', TRADE_ANALYST_DIRECTIVE, '', TRADE_REDUNDANCY_RULE]
      : ['', WARROOM_ANALYST_DIRECTIVE, '', WARROOM_REDUNDANCY_RULE]),
    '',
    '반드시 다음 섹션 구조를 따르세요(각 섹션 제목을 그대로 쓰세요):',
    reportSectionList(mode, councilMode),
    '',
    '데이터 출처 표기(매우 중요, 반드시 준수): 이 리포트의 가치는 "어떤 데이터를 근거로 했는가"를 투명하게 보여주는 데 있습니다. 모든 수치와 사실에는 출처 기관/데이터명과 시점을 반드시 병기하세요. 출처를 숨기거나 뭉뚱그리지 마세요.',
    sourceHint ? `참고로, 이번에 확보된 내부 데이터 출처는 다음과 같습니다(가능하면 이 명칭으로 인용): ${sourceHint}` : '',
    '데이터에 없는 수치는 절대 지어내지 마세요. 데이터가 없거나 누락된 부분은 그 사실을 솔직히 밝히세요.',
    '',
    KOREAN_ONLY_DIRECTIVE,
    '',
    '출력: 위 섹션 구조를 따르는 리포트 본문만 작성하세요(마크다운 섹션 제목 사용 가능). JSON으로 감싸지 마세요.',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

/** Builds a short, comma-joined list of the OK source labels for provenance hinting. */
function okSourceLabels(snapshot: JejuSnapshot): string {
  return snapshot.sources
    .filter((s) => s.ok)
    .map((s) => s.label)
    .join(', ')
}

/** Renders the executed searches into a Korean block for the report writer. */
function formatSearchesForWriter(searches: JejuExecutedSearch[]): string {
  const ok = searches.filter((s) => s.ok && s.result && s.result.trim() !== '')
  if (ok.length === 0) return '(외부 조사 결과 없음)'
  return ok
    .map((s, i) => `${i + 1}. 검색어: ${s.query}\n결과: ${s.result!.trim()}`)
    .join('\n\n')
}

/**
 * Generates the pre-debate analysis report.
 *
 * Pipeline (all reused pieces are imported, not reimplemented):
 *   1) caller-supplied { question, snapshot, context } (NO re-fetch here)
 *   2) lead analyst first pass (anthropic) → analysis + searchRequests
 *   3) mergeSearchRequests([leadAnalysis]) → executeJejuSearches (Perplexity, capped)
 *   4) report writer (anthropic) → long structured Korean report w/ provenance
 *   5) return { ok, report, searches, leadAnalysis, droppedSearchCount, ... }
 *
 * `mode` branches ONLY the final-report section list; everything else is shared
 * so Mode A ('briefing') and Mode B ('deliberation') call this identically.
 * Never throws.
 */
export async function generateJejuPreReport(params: {
  question: string
  snapshot: JejuSnapshot
  context: string
  mode?: JejuPreReportMode
  councilMode?: JejuCouncilMode
}): Promise<JejuPreReport> {
  const question = params.question?.trim() ?? ''
  const mode: JejuPreReportMode = params.mode === 'deliberation' ? 'deliberation' : 'briefing'
  const councilMode: JejuCouncilMode = params.councilMode === 'warroom' ? 'warroom' : 'trade'
  const context = params.context ?? ''
  const questionLabel = `[${userQuestionLabel(councilMode)}]`

  const base: JejuPreReport = {
    ok: false,
    question,
    mode,
    leadAnalysis: null,
    searches: [],
    droppedSearchCount: 0,
    report: null,
    provider: LEAD_PROVIDER,
  }

  if (!question) return { ...base, error: '질문이 비어 있습니다.' }
  if (!context.trim()) return { ...base, error: '분석할 데이터 컨텍스트가 없습니다.' }

  // ── 2) Lead analyst first pass ──────────────────────────────────────────────
  let leadAnalysis: string | null = null
  let searchRequests: JejuSearchRequest[] = []
  try {
    const r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: LEAD_PROVIDER,
      prompt: [questionLabel, question, '', '[수집 데이터]', context, '', '위 데이터를 분석하고 필요한 검색을 선언하세요. 스키마에 맞는 순수 JSON만 출력하세요.'].join('\n'),
      systemPrompt: buildLeadAnalysisSystemPrompt(councilMode),
      maxCompletionTokens: LEAD_ANALYSIS_MAX_TOKENS,
    })
    if (!r.error && r.text) {
      const parsed = parseLeadOutput(r.text)
      leadAnalysis = parsed.analysis
      searchRequests = parsed.searchRequests
    }
  } catch {
    // Lead analysis is enrichment for the writer; proceed even if it failed.
  }

  // ── 3) Search delegation (REUSE deep.ts merge + Perplexity execution) ────────
  // Package the lead analyst as a single synthetic JejuRoleAnalysis so the
  // existing mergeSearchRequests path can group/cap its requests unchanged.
  let searches: JejuExecutedSearch[] = []
  let droppedSearchCount = 0
  if (searchRequests.length > 0) {
    const leadAsRole: JejuRoleAnalysis = {
      roleId: 'lead-analyst',
      roleLabel: '수석 데이터 분석가',
      provider: LEAD_PROVIDER,
      isRedTeam: false,
      ok: true,
      analysis: leadAnalysis,
      searchRequests,
    }
    try {
      const { merged, droppedCount } = await mergeSearchRequests({ analyses: [leadAsRole] })
      droppedSearchCount = droppedCount
      if (merged.length > 0) {
        searches = await executeJejuSearches({ merged })
      }
    } catch {
      // Search is enrichment; the report can still be written from internal data.
    }
  }

  // ── 4) Final report writer ───────────────────────────────────────────────────
  const writerPrompt = [
    questionLabel,
    question,
    '',
    '[수집 데이터]',
    context,
    '',
    '[외부 조사 결과]',
    formatSearchesForWriter(searches),
    '',
    leadAnalysis ? `[1차 분석 메모]\n${leadAnalysis}` : '',
    '',
    councilMode === 'trade'
      ? '위 자료를 근거로, 지정된 섹션 구조의 한국어 수출 분석 리포트를 작성하세요. 모든 수치에 출처와 시점을 병기하세요.'
      : '위 자료를 근거로, 지정된 섹션 구조의 한국어 자원·에너지 안보 분석 리포트를 작성하세요. 모든 수치에 출처와 시점을 병기하세요.',
  ]
    .filter((line) => line !== '')
    .join('\n')

  try {
    const r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: LEAD_PROVIDER,
      prompt: writerPrompt,
      systemPrompt: buildReportWriterSystemPrompt(mode, okSourceLabels(params.snapshot), councilMode),
      maxCompletionTokens: REPORT_MAX_TOKENS,
    })
    if (r.error || !r.text) {
      return { ...base, leadAnalysis, searches, droppedSearchCount, error: r.error ?? '리포트 생성이 빈 응답을 반환했습니다.' }
    }
    return {
      ok: true,
      question,
      mode,
      leadAnalysis,
      searches,
      droppedSearchCount,
      report: r.text.trim(),
      provider: LEAD_PROVIDER,
    }
  } catch (e: unknown) {
    return {
      ...base,
      leadAnalysis,
      searches,
      droppedSearchCount,
      error: `리포트 생성 호출 실패: ${e instanceof Error ? e.message : 'unknown error'}`,
    }
  }
}
