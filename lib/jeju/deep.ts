import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { gatherJejuSnapshot, buildBriefingContext, type JejuSnapshot } from '@/lib/jeju/brief'
import {
  runSingleAiProvider,
  MODEL_BY_PROVIDER,
  type ExtendedAiProviderName,
} from '@/lib/ai/router'

/**
 * Jeju governance DEEP engine — piece 1: the dynamic meeting orchestrator.
 *
 * DESIGN CONSTRAINTS (same as all of lib/jeju):
 *   - May import lib/jeju/brief.ts, lib/jeju/connectors.ts, lib/ai/router.ts.
 *   - MUST NOT touch or depend on app/api/synod/* — self-contained orchestrator.
 *   - AIMANI must NOT import lib/jeju. The folder stays liftable to a standalone
 *     /jeju site. 'server-only'. Never throws.
 *
 * CONCEPT (the AX vision):
 *   A real government meeting convenes DIFFERENT experts depending on the agenda.
 *   We do NOT hardcode roles. Instead an orchestrator AI reads the question + the
 *   data we actually have, then dynamically decides which expert roles to convene
 *   and which AI brand best fits each role.
 *
 * SCOPE of this piece: ONLY the convening decision (planJejuMeeting). Running the
 * analyses, the debate, and the final synthesis are LATER pieces that sit on top
 * of the returned JejuMeetingPlan.
 */

/**
 * What each AI brand is good at — used both in the orchestrator's prompt (so it
 * can assign roles sensibly) and as our own reference. Keys are valid
 * ExtendedAiProviderName values; every entry must be a key of MODEL_BY_PROVIDER.
 */
export const AI_BRAND_STRENGTHS: Record<ExtendedAiProviderName, string> = {
  perplexity: '실시간 검색·최신 정보·외부 사실 확인',
  anthropic: '종합·신중한 분석·리스크/윤리 검토 (의장 적합)',
  openai: '균형잡힌 정책 추론·범용',
  google: '정보 정합성·대용량 데이터 처리',
  xai: '도발적 반박·통념 비판 (레드팀 적합)',
  deepseek: '수치·정량 분석·타임라인',
  mistral: '간결·창의적 관점·보조 분석',
  meta: '빠른 보조 분석',
}

/** One convened expert seat at the deliberation table. */
export type JejuExpertRole = {
  /** Stable-ish id for this seat (slug or short token). */
  roleId: string
  /** Korean display label, e.g. '에너지 수급 분석가'. */
  roleLabel: string
  /** Korean: what this expert examines and why they're needed for THIS question. */
  mandate: string
  /** The AI brand assigned to play this role. */
  provider: ExtendedAiProviderName
  /** True when this seat is the red-team / skeptic. */
  isRedTeam?: boolean
}

/** The orchestrator's convening decision for one question. */
export type JejuMeetingPlan = {
  ok: boolean
  question: string
  roles: JejuExpertRole[]
  /** Korean: why this particular lineup fits the question. */
  rationale: string
  /** True when the question needs current external info beyond our internal data. */
  searchNeeded: boolean
  /** Raw model output, kept for debugging/transparency. */
  raw?: string
  error?: string
}

/**
 * Korean uses ~2-3x more tokens than English. A 5-role plan with Korean labels +
 * mandates + rationale can exceed a tight cap and truncate the JSON mid-string
 * (→ parse failure → fallback). 2000 gives the orchestrator headroom to finish.
 */
const PLAN_MAX_TOKENS = 2000

/** Default orchestrator brand — strong at structured reasoning. */
const DEFAULT_ORCHESTRATOR: ExtendedAiProviderName = 'anthropic'

/** Set of valid provider keys, derived from MODEL_BY_PROVIDER (single source). */
const VALID_PROVIDERS = new Set(Object.keys(MODEL_BY_PROVIDER))

/**
 * Throwaway Supabase client to satisfy runSingleAiProvider's required param.
 * Mirrors brief.ts's noDbSupabase pattern (not exported there, so replicated
 * locally): with sessionId:null + userId:null the router does NO DB inserts and
 * NO BYOK reads, so this client is never dereferenced for I/O. Keeping it local
 * preserves lib/jeju's portability.
 */
function noDbSupabase(): SupabaseClient {
  return createClient('http://localhost', 'deep-mode-no-db') as unknown as SupabaseClient
}

/** Resolves a provider string to a valid router provider, defaulting to anthropic. */
function resolveProvider(p: string | undefined, fallback: ExtendedAiProviderName): ExtendedAiProviderName {
  if (p && VALID_PROVIDERS.has(p)) return p as ExtendedAiProviderName
  return fallback
}

/**
 * Short Korean summary of which governance sources are live (labels + ok status
 * + a one-liner of what each provides). Deliberately does NOT include the full
 * data — the orchestrator only needs to know what's realistically available so
 * it can convene fitting roles and decide searchNeeded, without context bloat.
 */
export async function summarizeAvailableData(): Promise<string> {
  // One-line capability blurb per known source id (independent of live success).
  const CAPABILITY_BY_ID: Record<string, string> = {
    'kpx-jeju-power': '5분단위 태양광·풍력 발전 및 전력 수요',
    'kamis-jeju-products': '제주 농수산물 도·소매 가격 (양배추·갈치 등)',
    'kma-jeju-weather': '제주시 초단기 기상 실황 (기온·강수·바람)',
    'kma-jeju-midterm': '중기예보 11일 전망 (일별 최저/최고기온·강수확률)',
  }

  let snapshot
  try {
    snapshot = await gatherJejuSnapshot()
  } catch (e: unknown) {
    return `(데이터 가용성 확인 실패: ${e instanceof Error ? e.message : 'unknown error'})`
  }

  const lines = snapshot.sources.map((s) => {
    const status = s.ok ? '사용가능' : `사용불가 (${s.error ?? '오류'})`
    const cap = CAPABILITY_BY_ID[s.id] ?? s.label
    return `- ${s.label}: ${status} — ${cap}`
  })
  return lines.length ? lines.join('\n') : '(등록된 데이터 소스 없음)'
}

/** The orchestrator (회의 소집 책임자) system prompt. */
function buildOrchestratorSystemPrompt(): string {
  const brandList = (Object.keys(AI_BRAND_STRENGTHS) as ExtendedAiProviderName[])
    .map((k) => `  - ${k}: ${AI_BRAND_STRENGTHS[k]}`)
    .join('\n')

  return [
    '당신은 제주특별자치도 거버넌스 심의의 "회의 소집 책임자(meeting convener)"입니다.',
    '실제 정부 회의가 안건에 따라 서로 다른 전문가를 부르듯, 당신은 주어진 정책 질문과',
    '현재 확보된 실시간 데이터 현황을 읽고, 이 질문에 가장 적합한 전문가 역할을 동적으로 구성해야 합니다.',
    '역할을 미리 정해두지 마세요 — 질문에 맞춰 매번 새로 설계하세요.',
    '',
    '결정해야 할 것:',
    '(a) 소집할 전문가 역할 3~5개. 각 역할은 이 질문에 구체적으로 들어맞아야 합니다.',
    '    예: 에너지 질문 → 에너지수급/계통/재정 전문가; 관광 질문 → 관광/교통/안전 전문가.',
    '    각 역할에는 한국어 라벨(roleLabel)과, 왜 바로 그 전문가가 이 질문에 필요한지 설명하는',
    '    한국어 직무(mandate)를 부여하세요.',
    '(b) 각 역할에 가장 적합한 AI 브랜드를 아래 강점표에서 골라 배정하세요(provider).',
    '    최소 1개 역할은 통념을 비판하는 레드팀/회의론자(isRedTeam:true)여야 하며,',
    '    가급적 xai 또는 anthropic에 배정하세요.',
    '(c) searchNeeded: 이 질문이 우리 내부 데이터를 넘어서는 최신 외부 정보를 필요로 하면 true.',
    '    true인 경우 perplexity를 맡는 실시간 검색 역할을 반드시 포함하세요.',
    '',
    'AI 브랜드 강점표:',
    brandList,
    '',
    '출력 형식 (매우 중요):',
    '오직 하나의 JSON 객체만 출력하세요. 마크다운 코드펜스(```)도, 설명 문장도 쓰지 마세요. 순수 JSON만.',
    '스키마:',
    '{',
    '  "roles": [',
    '    { "roleId": "string(영문 슬러그)", "roleLabel": "string(한국어)", "mandate": "string(한국어)", "provider": "위 강점표의 키 중 하나", "isRedTeam": false },',
    '    ...',
    '  ],',
    '  "rationale": "string(한국어 — 이 라인업이 왜 이 질문에 적합한지)",',
    '  "searchNeeded": true 또는 false',
    '}',
    'provider 값은 반드시 강점표의 키(openai, anthropic, google, xai, deepseek, mistral, perplexity, meta) 중 하나여야 합니다.',
  ].join('\n')
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

/** A sane default lineup so the engine is never left dead (parse/empty failure). */
function fallbackPlan(question: string, raw: string | undefined, note: string): JejuMeetingPlan {
  return {
    ok: true,
    question,
    roles: [
      {
        roleId: 'general-analyst',
        roleLabel: '종합분석가',
        mandate: '질문 전반을 종합적으로 검토하고 핵심 쟁점을 정리합니다.',
        provider: 'anthropic',
      },
      {
        roleId: 'data-analyst',
        roleLabel: '데이터분석가',
        mandate: '확보된 정량 데이터를 분석하고 수치 근거를 제시합니다.',
        provider: 'deepseek',
      },
      {
        roleId: 'red-team',
        roleLabel: '비판검토자(레드팀)',
        mandate: '형성되는 합의의 약점과 통념의 허점을 적극적으로 반박합니다.',
        provider: 'xai',
        isRedTeam: true,
      },
    ],
    rationale: `(기본 라인업) ${note}`,
    searchNeeded: false,
    raw,
  }
}

/**
 * Validates + normalizes one raw role object from the model. Returns null when
 * the role lacks the minimum fields (roleLabel/mandate/provider). Invalid
 * providers are coerced to 'openai' and noted via the returned `coerced` flag.
 */
function normalizeRole(
  raw: unknown,
  index: number
): { role: JejuExpertRole; coerced: boolean } | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>

  const roleLabel = typeof o.roleLabel === 'string' ? o.roleLabel.trim() : ''
  const mandate = typeof o.mandate === 'string' ? o.mandate.trim() : ''
  const providerRaw = typeof o.provider === 'string' ? o.provider.trim() : ''
  if (!roleLabel || !mandate || !providerRaw) return null

  const coerced = !VALID_PROVIDERS.has(providerRaw)
  const provider: ExtendedAiProviderName = coerced
    ? 'openai'
    : (providerRaw as ExtendedAiProviderName)

  const roleId =
    typeof o.roleId === 'string' && o.roleId.trim()
      ? o.roleId.trim()
      : `role-${index + 1}`
  const isRedTeam = o.isRedTeam === true

  return { role: { roleId, roleLabel, mandate, provider, ...(isRedTeam ? { isRedTeam } : {}) }, coerced }
}

/**
 * PIECE 1 — dynamic meeting orchestration.
 *
 * Asks an orchestrator AI (default 'anthropic') to convene 3–5 expert roles that
 * fit THIS question + the data we actually have, assign each a fitting AI brand,
 * include ≥1 red-team seat, and decide whether real-time search is needed.
 *
 * Robust by design: strips fences, parses defensively, validates/normalizes
 * roles, coerces invalid providers to 'openai', and falls back to a sane default
 * lineup if parsing fails or yields no roles. ok:false ONLY when the AI call
 * itself errored. Never throws.
 */
export async function planJejuMeeting(params: {
  question: string
  availableDataSummary: string
  provider?: string
}): Promise<JejuMeetingPlan> {
  const question = params.question?.trim() ?? ''
  const orchestrator = resolveProvider(params.provider, DEFAULT_ORCHESTRATOR)

  if (!question) {
    return {
      ok: false,
      question,
      roles: [],
      rationale: '',
      searchNeeded: false,
      error: '질문이 비어 있습니다.',
    }
  }

  const userPrompt = [
    '[정책 질문]',
    question,
    '',
    '[현재 확보된 실시간 데이터 현황]',
    params.availableDataSummary || '(가용 데이터 정보 없음)',
    '',
    '위 질문과 데이터 현황에 맞춰 회의를 소집하세요. 스키마에 맞는 순수 JSON만 출력하세요.',
  ].join('\n')

  let r
  try {
    r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: orchestrator,
      prompt: userPrompt,
      systemPrompt: buildOrchestratorSystemPrompt(),
      maxCompletionTokens: PLAN_MAX_TOKENS,
    })
  } catch (e: unknown) {
    return {
      ok: false,
      question,
      roles: [],
      rationale: '',
      searchNeeded: false,
      error: `오케스트레이터 호출 실패: ${e instanceof Error ? e.message : 'unknown error'}`,
    }
  }

  if (r.error || !r.text) {
    return {
      ok: false,
      question,
      roles: [],
      rationale: '',
      searchNeeded: false,
      error: r.error ?? '오케스트레이터가 빈 응답을 반환했습니다.',
    }
  }

  const raw = r.text

  let parsed: unknown
  try {
    parsed = JSON.parse(stripFences(raw))
  } catch {
    return fallbackPlan(question, raw, 'AI 응답 JSON 파싱 실패로 기본 라인업을 사용합니다.')
  }

  if (!parsed || typeof parsed !== 'object') {
    return fallbackPlan(question, raw, 'AI 응답 형식이 올바르지 않아 기본 라인업을 사용합니다.')
  }
  const obj = parsed as Record<string, unknown>

  const rawRoles = Array.isArray(obj.roles) ? obj.roles : []
  const normalized: JejuExpertRole[] = []
  let anyCoerced = false
  rawRoles.forEach((rr, i) => {
    const res = normalizeRole(rr, i)
    if (res) {
      normalized.push(res.role)
      if (res.coerced) anyCoerced = true
    }
  })

  if (normalized.length === 0) {
    return fallbackPlan(question, raw, 'AI가 유효한 역할을 제시하지 않아 기본 라인업을 사용합니다.')
  }

  const rationaleBase = typeof obj.rationale === 'string' ? obj.rationale.trim() : ''
  const coercedNote = anyCoerced
    ? ' (참고: 일부 역할의 AI 브랜드가 유효하지 않아 openai로 대체되었습니다.)'
    : ''
  const rationale = (rationaleBase || '(라인업 설명 없음)') + coercedNote

  const searchNeeded = obj.searchNeeded === true

  return {
    ok: true,
    question,
    roles: normalized,
    rationale,
    searchNeeded,
    raw,
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PIECE 2 — convened experts run their first-pass analysis + flag what they
// still need looked up (beat 2, agentic search-request capture).
//
// Each role from piece 1's plan runs IN PARALLEL: it produces (a) a data-grounded
// first-pass analysis in its own lane AND (b) optional search requests (what
// external info it still needs + why). We only CAPTURE the requests here — a
// LATER piece executes them via Perplexity and feeds results back for a 2nd pass.
// ════════════════════════════════════════════════════════════════════════════

/** One thing an expert still needs looked up externally. */
export type JejuSearchRequest = {
  /** The actual search query (Korean or mixed). */
  query: string
  /** Korean: why this expert needs it. */
  reason: string
}

/** One expert's first-pass analysis result + their search requests. */
export type JejuRoleAnalysis = {
  roleId: string
  roleLabel: string
  provider: ExtendedAiProviderName
  isRedTeam: boolean
  ok: boolean
  /** First-pass analysis text (null only when the AI call failed). */
  analysis: string | null
  /** What the expert still needs looked up (may be empty). */
  searchRequests: JejuSearchRequest[]
  error?: string
}

/** Room for a Korean first-pass analysis + a small search-requests JSON. */
const ANALYSIS_MAX_TOKENS = 1500

/** Hard cap on search requests captured per expert (prompt also instructs ≤2). */
const MAX_SEARCH_REQUESTS = 2

/** Builds one convened expert's system prompt: stay in lane, be data-grounded, may request lookups. */
function buildAnalystSystemPrompt(role: JejuExpertRole, question: string): string {
  const lines = [
    `당신은 제주도정 거버넌스 심의에 소집된 전문가입니다. 당신의 역할: ${role.roleLabel}.`,
    `당신의 직무(mandate): ${role.mandate}`,
    '',
    `핵심 규칙: 오직 당신의 전문 영역(${role.roleLabel}) 관점에서만 분석하세요. 다른 전문가 영역을 침범하거나 일반적 종합 의견을 내지 마세요. 당신만의 고유한 시각·우려·발견을 제시하는 것이 임무입니다.`,
    '반드시 제공된 [수집 데이터]에 근거하세요. 데이터에 없는 수치는 지어내지 마세요.',
    '진짜 전문가처럼 일하세요. 주어진 데이터만으로 판단이 부족하거나, 더 확인해야 할 외부 정보(최신 통계, 타지역 사례, 정부 정책, 법령, 시장 동향 등)가 있으면, 추측으로 메우지 말고 "검색 요청"으로 명시하세요. 무엇을, 왜 찾아야 하는지 구체적으로.',
  ]

  if (role.isRedTeam) {
    lines.push(
      '당신은 레드팀입니다. 통념적·관행적 접근의 허점, 숨은 비용, 실패 가능성을 적극 지적하세요. 동의가 아니라 비판이 임무입니다.'
    )
  }

  lines.push(
    '당신은 보좌역이며 최종 결정자가 아닙니다.',
    '',
    '출력 형식 (매우 중요): 오직 하나의 JSON 객체만 출력하세요. 마크다운 코드펜스(```)도, 설명 문장도 쓰지 마세요. 순수 JSON만.',
    '스키마:',
    '{ "analysis": "당신의 1차 분석 (250~400자, 데이터 근거)", "searchRequests": [ { "query": "검색어", "reason": "왜 필요한지" } ] }',
    'searchRequests는 정말 더 알아봐야 할 게 있을 때만. 없으면 빈 배열 []. 최대 2개까지만.'
  )

  // `question` is included so the lane rule is anchored to the actual agenda.
  lines.push('', `[심의 안건] ${question}`)

  return lines.join('\n')
}

/** Validates + caps a raw searchRequests array; drops entries missing query/reason. */
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
    if (out.length >= MAX_SEARCH_REQUESTS) break
  }
  return out
}

/**
 * Parses one expert's model output into { analysis, searchRequests }.
 *
 * On clean JSON: pulls analysis (string) + validated searchRequests. On parse
 * FAILURE but non-empty text: treats the whole raw text as the analysis with no
 * search requests — so a JSON hiccup never loses a usable analysis.
 */
function parseExpertOutput(raw: string): { analysis: string; searchRequests: JejuSearchRequest[] } {
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

/** Runs ONE convened expert's first-pass analysis. Never throws. */
async function runOneExpert(
  role: JejuExpertRole,
  question: string,
  context: string
): Promise<JejuRoleAnalysis> {
  const isRedTeam = role.isRedTeam === true
  const base = {
    roleId: role.roleId,
    roleLabel: role.roleLabel,
    provider: role.provider,
    isRedTeam,
  }

  const userPrompt = [
    '[거버넌스 질문]',
    question,
    '',
    '[수집 데이터]',
    context,
    '',
    '[당신의 역할]',
    `${role.roleLabel}로서 위 데이터를 분석하고, 더 필요한 정보가 있으면 검색 요청하세요. 스키마에 맞는 순수 JSON만 출력하세요.`,
  ].join('\n')

  let r
  try {
    r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: role.provider,
      prompt: userPrompt,
      systemPrompt: buildAnalystSystemPrompt(role, question),
      maxCompletionTokens: ANALYSIS_MAX_TOKENS,
    })
  } catch (e: unknown) {
    return {
      ...base,
      ok: false,
      analysis: null,
      searchRequests: [],
      error: `전문가 호출 실패: ${e instanceof Error ? e.message : 'unknown error'}`,
    }
  }

  if (r.error || !r.text) {
    return {
      ...base,
      ok: false,
      analysis: null,
      searchRequests: [],
      error: r.error ?? '전문가가 빈 응답을 반환했습니다.',
    }
  }

  const { analysis, searchRequests } = parseExpertOutput(r.text)
  return { ...base, ok: true, analysis, searchRequests }
}

/**
 * PIECE 2 — runs ALL convened experts' first-pass analyses IN PARALLEL.
 *
 * Each expert gets the FULL data context (buildBriefingContext output) so its
 * analysis is data-grounded, stays in its lane, and may flag search requests for
 * what's genuinely missing. Search requests are CAPTURED only (not executed).
 * Never throws — a rejected expert becomes an ok:false analysis entry.
 */
export async function runExpertAnalyses(params: {
  question: string
  roles: JejuExpertRole[]
  context: string
}): Promise<JejuRoleAnalysis[]> {
  const { question, roles, context } = params

  const settled = await Promise.allSettled(
    roles.map((role) => runOneExpert(role, question, context))
  )

  return settled.map((res, i) => {
    if (res.status === 'fulfilled') return res.value
    const role = roles[i]!
    return {
      roleId: role.roleId,
      roleLabel: role.roleLabel,
      provider: role.provider,
      isRedTeam: role.isRedTeam === true,
      ok: false,
      analysis: null,
      searchRequests: [],
      error: res.reason instanceof Error ? res.reason.message : 'analysis rejected',
    }
  })
}

/** Full DEEP result through the first-pass analysis stage (beats 1 + 2). */
export type JejuDeepThroughAnalysis = {
  ok: boolean
  question: string
  snapshot: JejuSnapshot
  context: string
  plan: JejuMeetingPlan
  analyses: JejuRoleAnalysis[]
  error?: string
}

/** Default question for the daily/general DEEP run (senior-official path). */
const DEFAULT_DEEP_QUESTION = '오늘의 제주 거버넌스 종합 분석'

/**
 * Orchestrates beats 1 + 2 end-to-end:
 *   gatherJejuSnapshot → buildBriefingContext → summarizeAvailableData →
 *   planJejuMeeting → runExpertAnalyses (when the plan is ok).
 *
 * ok = plan.ok && at least one analysis ok. Never throws; on any thrown error
 * returns ok:false with whatever partial data was gathered.
 */
export async function runJejuDeepThroughAnalysis(params?: {
  question?: string
  orchestratorProvider?: string
}): Promise<JejuDeepThroughAnalysis> {
  const question = params?.question?.trim() || DEFAULT_DEEP_QUESTION

  // Empty defaults so a partial failure can still return meaningful structure.
  let snapshot: JejuSnapshot = { ok: false, sources: [] }
  let context = ''
  let plan: JejuMeetingPlan = {
    ok: false,
    question,
    roles: [],
    rationale: '',
    searchNeeded: false,
  }

  try {
    snapshot = await gatherJejuSnapshot()
    context = buildBriefingContext(snapshot)
    const availableDataSummary = await summarizeAvailableData()
    plan = await planJejuMeeting({
      question,
      availableDataSummary,
      provider: params?.orchestratorProvider,
    })

    if (!plan.ok) {
      return {
        ok: false,
        question,
        snapshot,
        context,
        plan,
        analyses: [],
        error: plan.error ?? '회의 소집(orchestration)에 실패했습니다.',
      }
    }

    const analyses = await runExpertAnalyses({ question, roles: plan.roles, context })
    const ok = plan.ok && analyses.some((a) => a.ok)
    return {
      ok,
      question,
      snapshot,
      context,
      plan,
      analyses,
      ...(ok ? {} : { error: '유효한 전문가 분석이 하나도 없습니다.' }),
    }
  } catch (e: unknown) {
    return {
      ok: false,
      question,
      snapshot,
      context,
      plan,
      analyses: [],
      error: `DEEP 분석 실패: ${e instanceof Error ? e.message : 'unknown error'}`,
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PIECE 2.5 — actually EXECUTE the experts' search requests via Perplexity.
//
// Piece 2 only CAPTURED what each expert still needed. Here we (1) collect every
// request, (2) MERGE near-duplicates so we never pay for the same search twice,
// (3) execute up to a HARD CAP of MAX_SEARCHES real-time searches via Perplexity,
// (4) return the results for a later piece to feed back into a 2nd-pass analysis.
//
// ⚠️ COST CONTROL: Perplexity search billing comes out of our platform credit.
// The dedup/merge step and the MAX_SEARCHES cap are MANDATORY — do not exceed.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Hard cap on Perplexity calls per DEEP run. Each call costs real money from our
 * platform credit, so this ceiling is a non-negotiable cost control. The merge
 * step targets ≤ this many queries; executeJejuSearches enforces it again
 * defensively.
 */
const MAX_SEARCHES = 5

/** Token budgets for the (cheap) merge call and each Perplexity search summary. */
const MERGE_MAX_TOKENS = 800
const SEARCH_MAX_TOKENS = 700

/** One executed (post-merge) search and its Perplexity result. */
export type JejuExecutedSearch = {
  /** The (possibly merged) query actually run. */
  query: string
  /** roleLabels that wanted this query (post-merge). */
  requestedBy: string[]
  ok: boolean
  /** Perplexity's answer text (null when the call failed). */
  result: string | null
  error?: string
}

/** A merged search topic: one query + the roles that asked for it. */
type MergedSearch = { query: string; requestedBy: string[] }

/** Flattened raw request (one per expert ask), tagged with the asking role. */
type TaggedRequest = { roleLabel: string; query: string; reason: string }

/** Collects every search request from ok analyses, tagged with its roleLabel. */
function collectRequests(analyses: JejuRoleAnalysis[]): TaggedRequest[] {
  const out: TaggedRequest[] = []
  for (const a of analyses) {
    if (!a.ok) continue
    for (const sr of a.searchRequests) {
      out.push({ roleLabel: a.roleLabel, query: sr.query, reason: sr.reason })
    }
  }
  return out
}

/**
 * Fallback merge (no AI / AI returned junk): dedupe raw requests by exact query
 * string (case-insensitive trim), union the requesting roles, then truncate to
 * MAX_SEARCHES. droppedCount = distinct topics beyond the cap.
 */
function fallbackMerge(requests: TaggedRequest[]): {
  merged: MergedSearch[]
  droppedCount: number
} {
  const byQuery = new Map<string, MergedSearch>()
  for (const r of requests) {
    const key = r.query.trim().toLowerCase()
    if (!key) continue
    const existing = byQuery.get(key)
    if (existing) {
      if (!existing.requestedBy.includes(r.roleLabel)) existing.requestedBy.push(r.roleLabel)
    } else {
      byQuery.set(key, { query: r.query.trim(), requestedBy: [r.roleLabel] })
    }
  }
  const all = [...byQuery.values()]
  const merged = all.slice(0, MAX_SEARCHES)
  return { merged, droppedCount: Math.max(0, all.length - merged.length) }
}

/** Validates one merged entry from the merge AI; returns null if unusable. */
function normalizeMerged(raw: unknown): MergedSearch | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const query = typeof o.query === 'string' ? o.query.trim() : ''
  if (!query) return null
  const requestedBy = Array.isArray(o.requestedBy)
    ? o.requestedBy.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim())
    : []
  return { query, requestedBy }
}

/** Merge-AI system prompt: group similar requests, ≤MAX_SEARCHES, raw JSON only. */
function buildMergeSystemPrompt(): string {
  return [
    '당신은 제주도정 거버넌스 심의의 검색 요청을 정리하는 조정자입니다.',
    '여러 전문가가 외부 정보 검색을 요청했습니다. 당신의 임무:',
    '- 의미가 비슷한 요청들을 하나의 통합 검색어로 묶으세요(중복 검색 비용 방지).',
    '- 검색어는 간결하고 검색에 적합하게 다듬으세요.',
    '- 각 통합 검색어에 대해 그것을 요청한 전문가 역할(roleLabel)들을 보존하세요.',
    `- 통합 결과는 최대 ${MAX_SEARCHES}개까지만. 서로 다른 주제가 ${MAX_SEARCHES}개를 넘으면,`,
    '  의사결정에 가장 중요한 것 위주로 남기고 나머지는 버리세요.',
    '',
    '출력 형식 (매우 중요): 오직 하나의 JSON 객체만 출력하세요. 마크다운 코드펜스(```)도, 설명 문장도 쓰지 마세요. 순수 JSON만.',
    '스키마:',
    '{ "merged": [ { "query": "통합 검색어", "requestedBy": ["역할A","역할B"] } ] }',
  ].join('\n')
}

/**
 * Collects all experts' search requests and merges near-duplicates into at most
 * MAX_SEARCHES queries (cost control). Uses a cheap anthropic call to group
 * semantically; falls back to exact-query dedup + truncation if that call fails
 * or returns junk. Returns the merged list + how many distinct topics were
 * dropped beyond the cap (for later UI transparency). Never throws.
 */
export async function mergeSearchRequests(params: {
  analyses: JejuRoleAnalysis[]
}): Promise<{ merged: MergedSearch[]; droppedCount: number }> {
  const requests = collectRequests(params.analyses)
  if (requests.length === 0) return { merged: [], droppedCount: 0 }

  const userPrompt = [
    '[검색 요청 목록]',
    ...requests.map(
      (r, i) => `${i + 1}. (요청자: ${r.roleLabel}) 검색어: ${r.query} / 이유: ${r.reason}`
    ),
    '',
    `위 요청들을 의미별로 통합하여 최대 ${MAX_SEARCHES}개의 검색어로 정리하세요. 스키마에 맞는 순수 JSON만 출력하세요.`,
  ].join('\n')

  let r
  try {
    r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: 'anthropic',
      prompt: userPrompt,
      systemPrompt: buildMergeSystemPrompt(),
      maxCompletionTokens: MERGE_MAX_TOKENS,
    })
  } catch {
    return fallbackMerge(requests)
  }

  if (r.error || !r.text) return fallbackMerge(requests)

  let parsed: unknown
  try {
    parsed = JSON.parse(stripFences(r.text))
  } catch {
    return fallbackMerge(requests)
  }
  if (!parsed || typeof parsed !== 'object') return fallbackMerge(requests)

  const rawMerged = (parsed as Record<string, unknown>).merged
  if (!Array.isArray(rawMerged) || rawMerged.length === 0) return fallbackMerge(requests)

  const normalized: MergedSearch[] = []
  for (const m of rawMerged) {
    const nm = normalizeMerged(m)
    if (nm) normalized.push(nm)
  }
  if (normalized.length === 0) return fallbackMerge(requests)

  // Enforce the cap even if the AI ignored it; count distinct topics dropped.
  const capped = normalized.slice(0, MAX_SEARCHES)
  const droppedCount = Math.max(0, normalized.length - capped.length)
  return { merged: capped, droppedCount }
}

/** Perplexity search-specialist system prompt (concise Korean summary + sources). */
function buildSearchSystemPrompt(): string {
  return '당신은 제주도정 거버넌스 심의를 지원하는 검색 전문가입니다. 주어진 질의에 대해 최신·신뢰할 수 있는 외부 정보를 찾아 핵심만 간결하게(200~350자) 한국어로 요약하세요. 출처가 있으면 함께 제시하세요. 추측하지 말고, 찾은 정보가 없으면 없다고 하세요.'
}

/** Runs ONE Perplexity search. Never throws. */
async function runOneSearch(item: MergedSearch): Promise<JejuExecutedSearch> {
  const base = { query: item.query, requestedBy: item.requestedBy }
  let r
  try {
    r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: 'perplexity',
      prompt: item.query,
      systemPrompt: buildSearchSystemPrompt(),
      maxCompletionTokens: SEARCH_MAX_TOKENS,
    })
  } catch (e: unknown) {
    return {
      ...base,
      ok: false,
      result: null,
      error: `검색 호출 실패: ${e instanceof Error ? e.message : 'unknown error'}`,
    }
  }

  if (r.error || !r.text) {
    return { ...base, ok: false, result: null, error: r.error ?? '검색 결과가 비어 있습니다.' }
  }
  return { ...base, ok: true, result: r.text }
}

/**
 * Executes the merged searches via Perplexity IN PARALLEL.
 *
 * ⚠️ COST CONTROL: only the first MAX_SEARCHES entries are run (defensive — merge
 * already caps). Each is a real Perplexity call billed to platform credit.
 * Never throws; a rejected/empty search becomes an ok:false entry.
 */
export async function executeJejuSearches(params: {
  merged: MergedSearch[]
}): Promise<JejuExecutedSearch[]> {
  const toRun = params.merged.slice(0, MAX_SEARCHES)
  if (toRun.length === 0) return []

  const settled = await Promise.allSettled(toRun.map((item) => runOneSearch(item)))

  return settled.map((res, i) => {
    if (res.status === 'fulfilled') return res.value
    const item = toRun[i]!
    return {
      query: item.query,
      requestedBy: item.requestedBy,
      ok: false,
      result: null,
      error: res.reason instanceof Error ? res.reason.message : 'search rejected',
    }
  })
}

/** Full DEEP result through the search-execution stage (beats 1 + 2 + 2.5). */
export type JejuDeepThroughSearch = {
  ok: boolean
  question: string
  snapshot: JejuSnapshot
  context: string
  plan: JejuMeetingPlan
  analyses: JejuRoleAnalysis[]
  searches: JejuExecutedSearch[]
  /** Distinct search topics dropped beyond MAX_SEARCHES (transparency). */
  droppedSearchCount: number
  error?: string
}

/**
 * Orchestrates beats 1 + 2 + 2.5 end-to-end:
 *   runJejuDeepThroughAnalysis → mergeSearchRequests → executeJejuSearches.
 *
 * Searches are ENRICHMENT: a failed/empty search stage does NOT fail the run.
 * ok mirrors the analysis stage (≥1 ok analysis). Never throws; on a thrown
 * error returns ok:false with whatever partial data exists.
 */
export async function runJejuDeepThroughSearch(params?: {
  question?: string
  orchestratorProvider?: string
}): Promise<JejuDeepThroughSearch> {
  const analysisStage = await runJejuDeepThroughAnalysis(params)

  const baseline: JejuDeepThroughSearch = {
    ok: analysisStage.ok,
    question: analysisStage.question,
    snapshot: analysisStage.snapshot,
    context: analysisStage.context,
    plan: analysisStage.plan,
    analyses: analysisStage.analyses,
    searches: [],
    droppedSearchCount: 0,
    ...(analysisStage.error ? { error: analysisStage.error } : {}),
  }

  // If the analysis stage produced nothing usable, there's nothing to search for.
  if (!analysisStage.ok) return baseline

  try {
    const { merged, droppedCount } = await mergeSearchRequests({ analyses: analysisStage.analyses })
    if (merged.length === 0) {
      return { ...baseline, searches: [], droppedSearchCount: droppedCount }
    }
    const searches = await executeJejuSearches({ merged })
    return { ...baseline, searches, droppedSearchCount: droppedCount }
  } catch (e: unknown) {
    // Search is enrichment — keep the (ok) analysis result, note the search error.
    return {
      ...baseline,
      searches: [],
      droppedSearchCount: 0,
      error: `검색 실행 실패(분석 결과는 유효): ${e instanceof Error ? e.message : 'unknown error'}`,
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PIECE 2.7 — experts REVISE their analysis after seeing the search results.
//
// This closes beat 2's loop: piece 2 = first-pass + "what I still need", piece
// 2.5 = went and looked it up, piece 2.7 = everyone reads the findings and
// updates their view. The search results are SHARED meeting material — documents
// placed on the table that EVERY expert reads, not just the one who asked. This
// is what makes them working experts rather than one-shot reasoners.
// ════════════════════════════════════════════════════════════════════════════

/** Token budget for a revised analysis (slightly more than first-pass headroom). */
const REVISION_MAX_TOKENS = 1200

/** One expert's analysis before and after seeing the shared search results. */
export type JejuRevisedAnalysis = {
  roleId: string
  roleLabel: string
  provider: ExtendedAiProviderName
  isRedTeam: boolean
  ok: boolean
  /** Carried over from piece 2 analysis. */
  firstPass: string | null
  /** Updated analysis after reading the search results. */
  revised: string | null
  /** Did the expert actually update their view in light of the new info? */
  changed: boolean
  error?: string
}

/**
 * Builds the shared "documents on the table" block from successful searches.
 * Only ok searches with non-empty result are included. Returns '' when there is
 * nothing to share (so the caller can skip the revision round entirely).
 */
export function formatSearchResultsForExperts(searches: JejuExecutedSearch[]): string {
  const usable = searches.filter((s) => s.ok && s.result && s.result.trim() !== '')
  if (usable.length === 0) return ''

  const blocks = usable.map((s, i) => `[검색${i + 1}] ${s.query}\n${s.result!.trim()}`)
  return `## 회의 공용 조사 자료 (검색 결과)\n\n${blocks.join('\n\n')}`
}

/** Builds one expert's revision system prompt: re-read shared findings, update or hold. */
function buildRevisionSystemPrompt(role: JejuExpertRole, question: string): string {
  const lines = [
    `당신은 제주도정 거버넌스 심의에 소집된 전문가입니다. 당신의 역할: ${role.roleLabel}.`,
    `당신의 직무(mandate): ${role.mandate}`,
    '',
    '당신은 1차 분석을 이미 제출했습니다. 이제 회의 공용 조사 자료(검색 결과)가 추가되었습니다.',
    `이 새 정보를 검토하여, 당신의 전문 영역(${role.roleLabel}) 관점에서 분석을 갱신하세요. 새 정보가 당신의 판단을 바꾸면 솔직히 반영하고(수치·근거 인용), 바꾸지 않으면 기존 입장을 유지하되 그 이유를 밝히세요.`,
    `여전히 당신의 영역(${role.roleLabel})에만 집중하고, 데이터·조사자료에 근거하세요. 추측 금지.`,
  ]

  if (role.isRedTeam) {
    lines.push(
      '당신은 레드팀입니다. 새 정보로 무장하여 통념·합의의 허점과 숨은 비용, 실패 가능성을 계속 적극적으로 공격하세요. 조사 자료가 약점을 드러내면 더 날카롭게 지적하세요.'
    )
  }

  lines.push(
    '당신은 보좌역이며 최종 결정자가 아닙니다.',
    '',
    '출력 형식 (매우 중요): 오직 하나의 JSON 객체만 출력하세요. 마크다운 코드펜스(```)도, 설명 문장도 쓰지 마세요. 순수 JSON만.',
    '스키마:',
    '{ "revised": "갱신된 분석 (250~400자)", "changed": true 또는 false }',
    'changed는 새 정보가 당신의 판단을 실질적으로 바꿨을 때만 true. 입장 유지 시 false.'
  )

  lines.push('', `[심의 안건] ${question}`)

  return lines.join('\n')
}

/** Parses one expert's revision output into { revised, changed }. Robust to non-JSON. */
function parseRevisionOutput(raw: string): { revised: string; changed: boolean } {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripFences(raw))
  } catch {
    // Non-JSON but non-empty text → assume they said something new.
    return { revised: raw.trim(), changed: true }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { revised: raw.trim(), changed: true }
  }
  const o = parsed as Record<string, unknown>
  const revised = typeof o.revised === 'string' && o.revised.trim() ? o.revised.trim() : raw.trim()
  const changed = o.changed === true
  return { revised, changed }
}

/** Runs ONE expert's revision pass against the shared search block. Never throws. */
async function runOneRevision(
  analysis: JejuRoleAnalysis,
  role: JejuExpertRole,
  question: string,
  sharedSearchBlock: string
): Promise<JejuRevisedAnalysis> {
  const base = {
    roleId: analysis.roleId,
    roleLabel: analysis.roleLabel,
    provider: analysis.provider,
    isRedTeam: analysis.isRedTeam,
    firstPass: analysis.analysis,
  }

  const userPrompt = [
    '[거버넌스 질문]',
    question,
    '',
    '[당신의 1차 분석]',
    analysis.analysis ?? '(1차 분석 없음)',
    '',
    sharedSearchBlock,
    '',
    '위 조사 자료를 반영해 당신의 분석을 갱신하세요. 스키마에 맞는 순수 JSON만 출력하세요.',
  ].join('\n')

  let r
  try {
    r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: role.provider,
      prompt: userPrompt,
      systemPrompt: buildRevisionSystemPrompt(role, question),
      maxCompletionTokens: REVISION_MAX_TOKENS,
    })
  } catch (e: unknown) {
    // Carry the first-pass through so we never lose a usable analysis.
    return {
      ...base,
      ok: false,
      revised: null,
      changed: false,
      error: `갱신 호출 실패: ${e instanceof Error ? e.message : 'unknown error'}`,
    }
  }

  if (r.error || !r.text) {
    return {
      ...base,
      ok: false,
      revised: null,
      changed: false,
      error: r.error ?? '전문가가 빈 갱신 응답을 반환했습니다.',
    }
  }

  const { revised, changed } = parseRevisionOutput(r.text)
  return { ...base, ok: true, revised, changed }
}

/**
 * PIECE 2.7 — every expert revises after reading ALL search results.
 *
 * The shared search block is built ONCE and handed to every convened expert
 * (shared meeting material). If no search succeeded (empty block), the AI round
 * is SKIPPED entirely — each expert's first-pass carries through as the revised
 * (changed:false) to avoid pointless cost. Otherwise experts whose first-pass
 * was ok run their revision IN PARALLEL; a failed first-pass carries through as
 * ok:false with no revision attempted. Never throws.
 */
export async function reviseExpertAnalyses(params: {
  question: string
  roles: JejuExpertRole[]
  analyses: JejuRoleAnalysis[]
  searches: JejuExecutedSearch[]
}): Promise<JejuRevisedAnalysis[]> {
  const { question, roles, analyses, searches } = params
  const rolesById = new Map(roles.map((role) => [role.roleId, role]))
  const sharedSearchBlock = formatSearchResultsForExperts(searches)

  // No new info → don't pay for a revision round; first-pass IS the revised view.
  if (sharedSearchBlock === '') {
    return analyses.map((a) => ({
      roleId: a.roleId,
      roleLabel: a.roleLabel,
      provider: a.provider,
      isRedTeam: a.isRedTeam,
      ok: a.ok,
      firstPass: a.analysis,
      revised: a.analysis,
      changed: false,
      ...(a.ok ? {} : { error: a.error ?? '1차 분석이 유효하지 않습니다.' }),
    }))
  }

  const settled = await Promise.allSettled(
    analyses.map((a) => {
      // A failed first-pass can't be meaningfully revised — carry it through.
      if (!a.ok) {
        const carried: JejuRevisedAnalysis = {
          roleId: a.roleId,
          roleLabel: a.roleLabel,
          provider: a.provider,
          isRedTeam: a.isRedTeam,
          ok: false,
          firstPass: a.analysis,
          revised: null,
          changed: false,
          error: a.error ?? '1차 분석 실패로 갱신을 건너뜁니다.',
        }
        return Promise.resolve(carried)
      }
      // Match role by roleId; fall back to the analysis's own provider/label.
      const role =
        rolesById.get(a.roleId) ??
        ({
          roleId: a.roleId,
          roleLabel: a.roleLabel,
          mandate: a.roleLabel,
          provider: a.provider,
          ...(a.isRedTeam ? { isRedTeam: true } : {}),
        } as JejuExpertRole)
      return runOneRevision(a, role, question, sharedSearchBlock)
    })
  )

  return settled.map((res, i) => {
    if (res.status === 'fulfilled') return res.value
    const a = analyses[i]!
    return {
      roleId: a.roleId,
      roleLabel: a.roleLabel,
      provider: a.provider,
      isRedTeam: a.isRedTeam,
      ok: false,
      firstPass: a.analysis,
      revised: null,
      changed: false,
      error: res.reason instanceof Error ? res.reason.message : 'revision rejected',
    }
  })
}

/** Full DEEP result through the revision stage (beats 1 + 2 + 2.5 + 2.7). */
export type JejuDeepFull = {
  ok: boolean
  question: string
  snapshot: JejuSnapshot
  context: string
  plan: JejuMeetingPlan
  /** First-pass analyses. */
  analyses: JejuRoleAnalysis[]
  searches: JejuExecutedSearch[]
  droppedSearchCount: number
  /** Revised analyses after reading the shared search results. */
  revised: JejuRevisedAnalysis[]
  error?: string
}

/**
 * Orchestrates the full DEEP pipeline through revision:
 *   runJejuDeepThroughSearch → reviseExpertAnalyses.
 *
 * Revision is ENRICHMENT: its failure does NOT fail the run; ok mirrors the
 * analysis stage. Never throws; on a thrown error returns ok:false with whatever
 * partial data exists.
 */
export async function runJejuDeepFull(params?: {
  question?: string
  orchestratorProvider?: string
}): Promise<JejuDeepFull> {
  const searchStage = await runJejuDeepThroughSearch(params)

  const baseline: JejuDeepFull = {
    ok: searchStage.ok,
    question: searchStage.question,
    snapshot: searchStage.snapshot,
    context: searchStage.context,
    plan: searchStage.plan,
    analyses: searchStage.analyses,
    searches: searchStage.searches,
    droppedSearchCount: searchStage.droppedSearchCount,
    revised: [],
    ...(searchStage.error ? { error: searchStage.error } : {}),
  }

  // Nothing usable upstream → nothing to revise.
  if (!searchStage.ok) return baseline

  try {
    const revised = await reviseExpertAnalyses({
      question: searchStage.question,
      roles: searchStage.plan.roles,
      analyses: searchStage.analyses,
      searches: searchStage.searches,
    })
    return { ...baseline, revised }
  } catch (e: unknown) {
    // Revision is enrichment — keep the (ok) earlier stages, note the error.
    return {
      ...baseline,
      revised: [],
      error: `갱신 단계 실패(이전 결과는 유효): ${e instanceof Error ? e.message : 'unknown error'}`,
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PIECE 3 — the DEBATE round (beat 3: visible debate).
//
// Each expert has a search-informed revised analysis but has never confronted
// the others. Now every expert reads the OTHERS' analyses and must push back —
// surfacing REAL disagreement, not a politeness chorus. This is ONE rebuttal
// round; re-rebuttal and "summon a missing expert" are LATER pieces.
//
// ⚠️ ANTI-SYCOPHANCY: AI debaters default to "좋은 지적입니다, 동의합니다", which
// kills the debate. The prompt FORCES each expert to find a genuine point of
// disagreement (even partial) and argue it from their own domain. Mere agreement
// is a failure of their job.
// ════════════════════════════════════════════════════════════════════════════

/** Token budget for one rebuttal (matches revision headroom). */
const DEBATE_MAX_TOKENS = 1200

/** One expert's rebuttal against the other experts' revised analyses. */
export type JejuRebuttal = {
  roleId: string
  roleLabel: string
  provider: ExtendedAiProviderName
  isRedTeam: boolean
  ok: boolean
  /** Whom they pushed back against (role labels). */
  targetRoleLabels: string[]
  /** Their challenge (null only when the AI call failed). */
  rebuttal: string | null
  error?: string
}

/**
 * Builds the "other experts' analyses" block for one debater. Excludes self by
 * roleId and only includes ok peers with non-empty revised text. Returns '' when
 * the debater has no usable peers (caller skips that expert).
 */
export function formatPeerAnalysesForDebate(
  self: JejuRevisedAnalysis,
  all: JejuRevisedAnalysis[]
): string {
  const peers = all.filter(
    (p) => p.roleId !== self.roleId && p.ok && p.revised && p.revised.trim() !== ''
  )
  if (peers.length === 0) return ''

  const blocks = peers.map((p) => `[${p.roleLabel}]\n${p.revised!.trim()}`)
  return `## 다른 전문가들의 분석\n\n${blocks.join('\n\n')}`
}

/** Builds one expert's debate system prompt: find REAL disagreement, no chorus. */
function buildDebateSystemPrompt(role: JejuExpertRole, question: string): string {
  const lines = [
    `당신은 제주도정 거버넌스 심의에 소집된 전문가입니다. 당신의 역할: ${role.roleLabel}.`,
    `당신의 직무(mandate): ${role.mandate}`,
    '',
    `회의의 다른 전문가들이 각자 분석을 내놨습니다. 당신의 임무는 그들의 분석에서 당신의 전문 영역(${role.roleLabel}) 관점에서 동의할 수 없거나, 빠졌거나, 위험한 지점을 찾아 반박하는 것입니다.`,
    '핵심 규칙: 단순히 동의하지 마세요. "좋은 지적이다"로 끝나는 것은 당신의 임무 실패입니다. 진짜 회의처럼, 당신의 전문성으로 볼 때 다른 전문가가 놓쳤거나 틀렸거나 과소평가한 지점을 반드시 하나 이상 짚어 반박하세요. 부분적 이견이라도 명확히 논쟁하세요.',
    '당신의 영역에 근거해 반박하세요. 인신공격이 아니라 논리·데이터·전문성으로. 누구의 어떤 주장에 반박하는지 명시하세요.',
  ]

  if (role.isRedTeam) {
    lines.push(
      '당신은 레드팀입니다. 형성되는 합의 전체를 향해 가장 날카로운 반론을 제기하세요. 모두가 동의하는 지점일수록 더 의심하세요.'
    )
  }

  lines.push(
    '당신은 보좌역이며 최종 결정자가 아닙니다.',
    '',
    '출력 형식 (매우 중요): 오직 하나의 JSON 객체만 출력하세요. 마크다운 코드펜스(```)도, 설명 문장도 쓰지 마세요. 순수 JSON만.',
    '스키마:',
    '{ "targetRoleLabels": ["반박 대상 역할 라벨", ...], "rebuttal": "당신의 반박 (250~400자, 무엇에 왜 반대하는지 구체적으로)" }'
  )

  lines.push('', `[심의 안건] ${question}`)

  return lines.join('\n')
}

/** Parses one rebuttal output into { targetRoleLabels, rebuttal }. Robust to non-JSON. */
function parseRebuttalOutput(raw: string): { targetRoleLabels: string[]; rebuttal: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripFences(raw))
  } catch {
    return { targetRoleLabels: [], rebuttal: raw.trim() }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { targetRoleLabels: [], rebuttal: raw.trim() }
  }
  const o = parsed as Record<string, unknown>
  const targetRoleLabels = Array.isArray(o.targetRoleLabels)
    ? o.targetRoleLabels
        .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
        .map((x) => x.trim())
    : []
  const rebuttal =
    typeof o.rebuttal === 'string' && o.rebuttal.trim() ? o.rebuttal.trim() : raw.trim()
  return { targetRoleLabels, rebuttal }
}

/** Runs ONE expert's rebuttal against the peer-analyses block. Never throws. */
async function runOneRebuttal(
  self: JejuRevisedAnalysis,
  role: JejuExpertRole,
  question: string,
  peerBlock: string
): Promise<JejuRebuttal> {
  const base = {
    roleId: self.roleId,
    roleLabel: self.roleLabel,
    provider: self.provider,
    isRedTeam: self.isRedTeam,
  }

  const userPrompt = [
    '[거버넌스 질문]',
    question,
    '',
    '[당신의 분석]',
    self.revised ?? '(분석 없음)',
    '',
    peerBlock,
    '',
    '위 다른 전문가들의 분석을 검토하고, 당신의 영역에서 동의할 수 없는 지점을 반박하세요. 스키마에 맞는 순수 JSON만 출력하세요.',
  ].join('\n')

  let r
  try {
    r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: role.provider,
      prompt: userPrompt,
      systemPrompt: buildDebateSystemPrompt(role, question),
      maxCompletionTokens: DEBATE_MAX_TOKENS,
    })
  } catch (e: unknown) {
    return {
      ...base,
      ok: false,
      targetRoleLabels: [],
      rebuttal: null,
      error: `토론 호출 실패: ${e instanceof Error ? e.message : 'unknown error'}`,
    }
  }

  if (r.error || !r.text) {
    return {
      ...base,
      ok: false,
      targetRoleLabels: [],
      rebuttal: null,
      error: r.error ?? '전문가가 빈 반박 응답을 반환했습니다.',
    }
  }

  const { targetRoleLabels, rebuttal } = parseRebuttalOutput(r.text)
  return { ...base, ok: true, targetRoleLabels, rebuttal }
}

/**
 * PIECE 3 — every expert challenges the others' revised analyses IN PARALLEL.
 *
 * Each debater gets the OTHER experts' analyses (self excluded) and is pushed to
 * surface a real point of disagreement (anti-sycophancy prompt). An expert with
 * no usable peers is skipped (ok:false + note). A failed revision can't debate.
 * Never throws — a rejected rebuttal becomes an ok:false entry.
 */
export async function runDebateRound(params: {
  question: string
  roles: JejuExpertRole[]
  revised: JejuRevisedAnalysis[]
}): Promise<JejuRebuttal[]> {
  const { question, roles, revised } = params
  const rolesById = new Map(roles.map((role) => [role.roleId, role]))

  const settled = await Promise.allSettled(
    revised.map((self) => {
      // A failed revision has no analysis to defend or debate from.
      if (!self.ok || !self.revised || self.revised.trim() === '') {
        const carried: JejuRebuttal = {
          roleId: self.roleId,
          roleLabel: self.roleLabel,
          provider: self.provider,
          isRedTeam: self.isRedTeam,
          ok: false,
          targetRoleLabels: [],
          rebuttal: null,
          error: self.error ?? '유효한 분석이 없어 토론에 참여할 수 없습니다.',
        }
        return Promise.resolve(carried)
      }

      const peerBlock = formatPeerAnalysesForDebate(self, revised)
      if (peerBlock === '') {
        const carried: JejuRebuttal = {
          roleId: self.roleId,
          roleLabel: self.roleLabel,
          provider: self.provider,
          isRedTeam: self.isRedTeam,
          ok: false,
          targetRoleLabels: [],
          rebuttal: null,
          error: '반박할 다른 전문가 분석이 없습니다(단독 분석).',
        }
        return Promise.resolve(carried)
      }

      const role =
        rolesById.get(self.roleId) ??
        ({
          roleId: self.roleId,
          roleLabel: self.roleLabel,
          mandate: self.roleLabel,
          provider: self.provider,
          ...(self.isRedTeam ? { isRedTeam: true } : {}),
        } as JejuExpertRole)
      return runOneRebuttal(self, role, question, peerBlock)
    })
  )

  return settled.map((res, i) => {
    if (res.status === 'fulfilled') return res.value
    const self = revised[i]!
    return {
      roleId: self.roleId,
      roleLabel: self.roleLabel,
      provider: self.provider,
      isRedTeam: self.isRedTeam,
      ok: false,
      targetRoleLabels: [],
      rebuttal: null,
      error: res.reason instanceof Error ? res.reason.message : 'rebuttal rejected',
    }
  })
}

/** Full DEEP result through the debate round (beats 1 + 2 + 2.5 + 2.7 + 3). */
export type JejuDeepWithDebate = JejuDeepFull & {
  /** One rebuttal round: each expert challenges the others. */
  debate: JejuRebuttal[]
}

/**
 * Orchestrates the full DEEP pipeline through the debate round:
 *   runJejuDeepFull → runDebateRound.
 *
 * The debate is ENRICHMENT: its failure does NOT fail the run; ok mirrors the
 * analysis stage. Never throws; on a thrown error returns ok:false with whatever
 * partial data exists.
 */
export async function runJejuDeepWithDebate(params?: {
  question?: string
  orchestratorProvider?: string
}): Promise<JejuDeepWithDebate> {
  const fullStage = await runJejuDeepFull(params)

  const baseline: JejuDeepWithDebate = { ...fullStage, debate: [] }

  // Nothing usable upstream → no debate.
  if (!fullStage.ok) return baseline

  try {
    const debate = await runDebateRound({
      question: fullStage.question,
      roles: fullStage.plan.roles,
      revised: fullStage.revised,
    })
    return { ...baseline, debate }
  } catch (e: unknown) {
    // Debate is enrichment — keep the (ok) earlier stages, note the error.
    return {
      ...baseline,
      debate: [],
      error: `토론 단계 실패(이전 결과는 유효): ${e instanceof Error ? e.message : 'unknown error'}`,
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PIECE 3.5 — ONE deliberation round (rebuttal AND convergence at once).
//
// The democratic intellectual-consensus mechanism. NOT instant agreement
// ("everyone's right, peace!"), NOT endless division ("everyone's wrong, only I
// am right") — but a round where each expert pushes back on what they STILL
// disagree with WHILE conceding what they now accept, so consensus climbs
// gradually (e.g. 30→60→85) across rounds. This piece is ONE round, designed to
// be looped N times later: it takes the prior round's state and returns this
// round's state, plus a measured consensus score.
//
// ⚠️ BALANCE: a round must avoid BOTH failure modes — premature "peace!" and
// stubborn "everyone's wrong". The prompt forces each expert to do (a) hold
// genuine disagreement where their domain/data warrants and (b) honestly concede
// earned points, simultaneously.
// ════════════════════════════════════════════════════════════════════════════

/** Token budgets for a deliberation turn and the consensus-measuring call. */
const DELIBERATION_MAX_TOKENS = 1200
// Korean summary + two point-lists need headroom; too small truncates the JSON
// mid-string and forces the -1 sentinel. 2000 leaves comfortable room.
const CONSENSUS_MAX_TOKENS = 2000

/** Sentinel consensus score used when the measuring call fails (never fabricate). */
const CONSENSUS_SCORE_UNAVAILABLE = -1

/** One expert's turn in a deliberation round: updated position + concede/hold split. */
export type JejuDeliberationTurn = {
  roleId: string
  roleLabel: string
  provider: ExtendedAiProviderName
  isRedTeam: boolean
  ok: boolean
  /** Their updated position THIS round. */
  position: string | null
  /** What they now accept from others (may be empty string). */
  concedes: string | null
  /** What they still contest, and why. */
  holds: string | null
  error?: string
}

/** The outcome of one deliberation round, including a measured consensus score. */
export type JejuRoundResult = {
  roundNumber: number
  turns: JejuDeliberationTurn[]
  /** 0-100 measured AFTER this round; CONSENSUS_SCORE_UNAVAILABLE (-1) if unmeasurable. */
  consensusScore: number
  agreedPoints: string[]
  contestedPoints: string[]
  /** Korean: where the meeting stands after this round. */
  summary: string
  ok: boolean
  error?: string
}

/** Builds a Korean block of the prior round's turns (position/concedes/holds). */
export function formatPriorRound(turns: JejuDeliberationTurn[]): string {
  const usable = turns.filter((t) => t.ok && t.position && t.position.trim() !== '')
  if (usable.length === 0) return ''

  const blocks = usable.map((t) => {
    const tag = t.isRedTeam ? ' [레드팀]' : ''
    const lines = [`[${t.roleLabel}]${tag}`, `입장: ${t.position!.trim()}`]
    if (t.concedes && t.concedes.trim() !== '') lines.push(`수용: ${t.concedes.trim()}`)
    if (t.holds && t.holds.trim() !== '') lines.push(`견지: ${t.holds.trim()}`)
    return lines.join('\n')
  })
  return blocks.join('\n\n')
}

/** Builds the round-1 seed block from each expert's revised (search-informed) analysis. */
function formatSeedAnalyses(seed: JejuRevisedAnalysis[]): string {
  const usable = seed.filter((s) => s.ok && s.revised && s.revised.trim() !== '')
  if (usable.length === 0) return ''

  const blocks = usable.map((s) => {
    const tag = s.isRedTeam ? ' [레드팀]' : ''
    return `[${s.roleLabel}]${tag}\n입장: ${s.revised!.trim()}`
  })
  return blocks.join('\n\n')
}

/** Builds one expert's deliberation system prompt: hold AND concede, gradual convergence. */
function buildDeliberationSystemPrompt(
  role: JejuExpertRole,
  question: string,
  roundNumber: number
): string {
  const lines = [
    `당신은 제주도정 거버넌스 심의에 소집된 전문가입니다. 당신의 역할: ${role.roleLabel}.`,
    `당신의 직무(mandate): ${role.mandate}`,
    '',
    `이것은 ${roundNumber}번째 토론 라운드입니다. 직전 라운드에서 전문가들이 낸 입장을 검토하고, 당신의 입장을 갱신하세요.`,
    '두 가지를 동시에 하세요. (1) 당신의 전문 영역·데이터로 볼 때 여전히 동의할 수 없는 지점은 분명히 반박하며 지키세요 — 성급하게 "모두 옳다"고 양보하지 마세요. (2) 동시에, 토론을 통해 타당하다고 인정하게 된 지점은 정직하게 받아들이세요 — "모두 틀렸고 나만 맞다"는 고집도 금물입니다. 진짜 합의는 라운드를 거치며 조금씩 쌓이는 것입니다.',
    `반드시 당신의 전문 영역(${role.roleLabel})과 제공된 데이터·조사자료에 근거하세요. 추측 금지.`,
  ]

  if (role.isRedTeam) {
    lines.push(
      '당신은 레드팀입니다. 근거 약한 다수 합의는 계속 견제하되, 라운드를 거치며 정말 타당해진 합의는 인정할 수 있습니다.'
    )
  }

  lines.push(
    '당신은 보좌역이며 최종 결정자가 아닙니다.',
    '',
    '출력 형식 (매우 중요): 오직 하나의 JSON 객체만 출력하세요. 마크다운 코드펜스(```)도, 설명 문장도 쓰지 마세요. 순수 JSON만.',
    '스키마:',
    '{ "position": "이번 라운드 당신의 갱신된 입장 (150~300자)", "concedes": "이번에 받아들이는 점 (없으면 빈 문자열)", "holds": "여전히 지키며 반박하는 점과 이유" }'
  )

  lines.push('', `[심의 안건] ${question}`)

  return lines.join('\n')
}

/** Parses one deliberation turn output into { position, concedes, holds }. Robust to non-JSON. */
function parseDeliberationOutput(raw: string): {
  position: string
  concedes: string
  holds: string
} {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripFences(raw))
  } catch {
    // Non-JSON but non-empty text → treat the whole thing as the position.
    return { position: raw.trim(), concedes: '', holds: '' }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { position: raw.trim(), concedes: '', holds: '' }
  }
  const o = parsed as Record<string, unknown>
  const position =
    typeof o.position === 'string' && o.position.trim() ? o.position.trim() : raw.trim()
  const concedes = typeof o.concedes === 'string' ? o.concedes.trim() : ''
  const holds = typeof o.holds === 'string' ? o.holds.trim() : ''
  return { position, concedes, holds }
}

/** Runs ONE expert's deliberation turn against the prior-round context. Never throws. */
async function runOneDeliberationTurn(
  role: JejuExpertRole,
  question: string,
  roundNumber: number,
  ownPrior: string,
  peerContext: string
): Promise<JejuDeliberationTurn> {
  const base = {
    roleId: role.roleId,
    roleLabel: role.roleLabel,
    provider: role.provider,
    isRedTeam: role.isRedTeam === true,
  }

  const userPrompt = [
    '[거버넌스 질문]',
    question,
    '',
    '[당신의 직전 입장]',
    ownPrior || '(직전 입장 없음)',
    '',
    roundNumber <= 1
      ? '## 직전 라운드 전문가 입장 (1차 수렴 라운드 — 각자의 조사 반영 분석에서 출발)'
      : '## 직전 라운드 전문가 입장',
    peerContext,
    '',
    '위 입장들을 검토하고, 받아들일 점은 받아들이고 지킬 점은 반박하며 당신의 입장을 갱신하세요. 스키마에 맞는 순수 JSON만 출력하세요.',
  ].join('\n')

  let r
  try {
    r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: role.provider,
      prompt: userPrompt,
      systemPrompt: buildDeliberationSystemPrompt(role, question, roundNumber),
      maxCompletionTokens: DELIBERATION_MAX_TOKENS,
    })
  } catch (e: unknown) {
    return {
      ...base,
      ok: false,
      position: null,
      concedes: null,
      holds: null,
      error: `토론 호출 실패: ${e instanceof Error ? e.message : 'unknown error'}`,
    }
  }

  if (r.error || !r.text) {
    return {
      ...base,
      ok: false,
      position: null,
      concedes: null,
      holds: null,
      error: r.error ?? '전문가가 빈 토론 응답을 반환했습니다.',
    }
  }

  const { position, concedes, holds } = parseDeliberationOutput(r.text)
  return { ...base, ok: true, position, concedes, holds }
}

/** Builds the consensus-measuring system prompt (one anthropic call per round). */
function buildConsensusSystemPrompt(): string {
  return [
    '당신은 제주도정 거버넌스 심의의 합의 수준을 측정하는 중립 분석가입니다.',
    '여러 전문가가 이번 토론 라운드에서 낸 입장(position)·수용(concedes)·견지(holds)를 받습니다.',
    '이들이 이번 라운드에서 얼마나 수렴했는지 0~100점으로 평가하세요.',
    '- 서로 겹치는 수용(concedes)이 많고, 강하게 충돌하는 견지(holds)가 적을수록 높은 점수.',
    '- 모두 한목소리(완전 합의)면 100에 가깝게, 모두 평행선(전면 대립)이면 0에 가깝게.',
    '- 부분 수렴(일부 합의 + 일부 쟁점 잔존)은 중간대(예: 40~75).',
    '추측으로 점수를 부풀리지 말고, 실제 입장 텍스트에 근거해 측정하세요.',
    'agreedPoints·contestedPoints는 각각 핵심만 3~5개의 짧은 항목으로, summary는 3~4문장으로 간결하게 작성해 JSON이 잘리지 않게 하세요.',
    '',
    '출력 형식 (매우 중요): 오직 하나의 JSON 객체만 출력하세요. 코드펜스나 설명 없이 순수 JSON만.',
    '스키마:',
    '{ "score": 0~100 정수, "agreedPoints": ["합의된 핵심 지점", ...], "contestedPoints": ["여전히 쟁점인 지점", ...], "summary": "이번 라운드 후 회의 상태 한 문단(한국어)" }',
  ].join('\n')
}

/** Clamps a raw number into the inclusive 0-100 integer range. */
function clampScore(n: number): number {
  if (!Number.isFinite(n)) return CONSENSUS_SCORE_UNAVAILABLE
  return Math.max(0, Math.min(100, Math.round(n)))
}

/** Measures consensus across this round's turns via one anthropic call. Never throws. */
async function measureConsensus(turns: JejuDeliberationTurn[]): Promise<{
  consensusScore: number
  agreedPoints: string[]
  contestedPoints: string[]
  summary: string
  ok: boolean
  error?: string
}> {
  const usable = turns.filter((t) => t.ok && t.position && t.position.trim() !== '')
  if (usable.length === 0) {
    return {
      consensusScore: CONSENSUS_SCORE_UNAVAILABLE,
      agreedPoints: [],
      contestedPoints: [],
      summary: '',
      ok: false,
      error: '측정할 유효한 입장이 없습니다.',
    }
  }

  const userPrompt = [
    '[이번 라운드 전문가 입장]',
    ...usable.map((t) => {
      const tag = t.isRedTeam ? ' [레드팀]' : ''
      const parts = [`[${t.roleLabel}]${tag}`, `입장: ${t.position!.trim()}`]
      if (t.concedes && t.concedes.trim() !== '') parts.push(`수용: ${t.concedes.trim()}`)
      if (t.holds && t.holds.trim() !== '') parts.push(`견지: ${t.holds.trim()}`)
      return parts.join('\n')
    }),
    '',
    '위 입장들의 수렴 정도를 측정하여 스키마에 맞는 순수 JSON만 출력하세요.',
  ].join('\n')

  let r
  try {
    r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: 'anthropic',
      prompt: userPrompt,
      systemPrompt: buildConsensusSystemPrompt(),
      maxCompletionTokens: CONSENSUS_MAX_TOKENS,
    })
  } catch (e: unknown) {
    return {
      consensusScore: CONSENSUS_SCORE_UNAVAILABLE,
      agreedPoints: [],
      contestedPoints: [],
      summary: '',
      ok: false,
      error: `합의 측정 호출 실패: ${e instanceof Error ? e.message : 'unknown error'}`,
    }
  }

  if (r.error || !r.text) {
    return {
      consensusScore: CONSENSUS_SCORE_UNAVAILABLE,
      agreedPoints: [],
      contestedPoints: [],
      summary: '',
      ok: false,
      error: r.error ?? '합의 측정이 빈 응답을 반환했습니다.',
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(stripFences(r.text))
  } catch {
    return {
      consensusScore: CONSENSUS_SCORE_UNAVAILABLE,
      agreedPoints: [],
      contestedPoints: [],
      summary: '',
      ok: false,
      error: '합의 측정 JSON 파싱 실패.',
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    return {
      consensusScore: CONSENSUS_SCORE_UNAVAILABLE,
      agreedPoints: [],
      contestedPoints: [],
      summary: '',
      ok: false,
      error: '합의 측정 출력이 객체가 아닙니다.',
    }
  }

  const o = parsed as Record<string, unknown>
  const consensusScore = typeof o.score === 'number' ? clampScore(o.score) : CONSENSUS_SCORE_UNAVAILABLE
  const agreedPoints = Array.isArray(o.agreedPoints)
    ? o.agreedPoints.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim())
    : []
  const contestedPoints = Array.isArray(o.contestedPoints)
    ? o.contestedPoints.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim())
    : []
  const summary = typeof o.summary === 'string' ? o.summary.trim() : ''

  return {
    consensusScore,
    agreedPoints,
    contestedPoints,
    summary,
    ok: consensusScore !== CONSENSUS_SCORE_UNAVAILABLE,
    ...(consensusScore === CONSENSUS_SCORE_UNAVAILABLE ? { error: '합의 점수를 측정하지 못했습니다.' } : {}),
  }
}

/**
 * PIECE 3.5 — runs ONE deliberation round (rebuttal + convergence) and measures
 * the resulting consensus. Designed to be LOOPED: pass priorTurns from the last
 * round, or [] + seedAnalyses for the first convergence round.
 *
 * Each expert runs IN PARALLEL with the balance prompt (hold AND concede). After
 * collecting turns, ONE anthropic call measures convergence. Never throws; if the
 * measuring call fails, turns are still returned with consensusScore = -1
 * (sentinel — we never fabricate a score).
 */
export async function runDeliberationRound(params: {
  question: string
  roles: JejuExpertRole[]
  roundNumber: number
  priorTurns: JejuDeliberationTurn[]
  seedAnalyses?: JejuRevisedAnalysis[]
}): Promise<JejuRoundResult> {
  const { question, roles, roundNumber, priorTurns, seedAnalyses } = params

  // The shared peer context: prior round's turns, or (round 1) the seed analyses.
  const peerContext =
    priorTurns.length > 0
      ? formatPriorRound(priorTurns)
      : formatSeedAnalyses(seedAnalyses ?? [])

  if (peerContext.trim() === '') {
    return {
      roundNumber,
      turns: [],
      consensusScore: CONSENSUS_SCORE_UNAVAILABLE,
      agreedPoints: [],
      contestedPoints: [],
      summary: '',
      ok: false,
      error: '토론을 시작할 직전 입장(또는 시드 분석)이 없습니다.',
    }
  }

  // Per-role lookup of their own prior position, to anchor "your last position".
  const priorByRoleId = new Map(priorTurns.map((t) => [t.roleId, t]))
  const seedByRoleId = new Map((seedAnalyses ?? []).map((s) => [s.roleId, s]))

  const settled = await Promise.allSettled(
    roles.map((role) => {
      const prior = priorByRoleId.get(role.roleId)
      const seed = seedByRoleId.get(role.roleId)
      const ownPrior =
        prior && prior.ok && prior.position
          ? prior.position
          : seed && seed.ok && seed.revised
            ? seed.revised
            : ''
      return runOneDeliberationTurn(role, question, roundNumber, ownPrior, peerContext)
    })
  )

  const turns: JejuDeliberationTurn[] = settled.map((res, i) => {
    if (res.status === 'fulfilled') return res.value
    const role = roles[i]!
    return {
      roleId: role.roleId,
      roleLabel: role.roleLabel,
      provider: role.provider,
      isRedTeam: role.isRedTeam === true,
      ok: false,
      position: null,
      concedes: null,
      holds: null,
      error: res.reason instanceof Error ? res.reason.message : 'deliberation rejected',
    }
  })

  const consensus = await measureConsensus(turns)
  const anyTurnOk = turns.some((t) => t.ok)

  return {
    roundNumber,
    turns,
    consensusScore: consensus.consensusScore,
    agreedPoints: consensus.agreedPoints,
    contestedPoints: consensus.contestedPoints,
    summary: consensus.summary,
    ok: anyTurnOk,
    ...(anyTurnOk ? {} : { error: '유효한 토론 발언이 하나도 없습니다.' }),
  }
}

/** Full DEEP result through ONE convergence round (beats 1 + 2 + 2.5 + 2.7 + 3 + 3.5). */
export type JejuDeepOneConvergenceRound = JejuDeepWithDebate & {
  /** The first convergence round's result. */
  round1: JejuRoundResult
}

/**
 * Orchestrates the full DEEP pipeline through ONE convergence round:
 *   runJejuDeepWithDebate → runDeliberationRound(round 1, seeded from revised).
 *
 * This proves a SINGLE round works before a later piece loops it. The debate
 * (piece 3) informs experts implicitly via their revised analyses; round 1 is
 * where they begin trading concessions. ok mirrors the analysis stage; the round
 * is enrichment. Never throws; partial data on error.
 */
export async function runJejuDeepOneConvergenceRound(params?: {
  question?: string
  orchestratorProvider?: string
}): Promise<JejuDeepOneConvergenceRound> {
  const debateStage = await runJejuDeepWithDebate(params)

  const emptyRound: JejuRoundResult = {
    roundNumber: 1,
    turns: [],
    consensusScore: CONSENSUS_SCORE_UNAVAILABLE,
    agreedPoints: [],
    contestedPoints: [],
    summary: '',
    ok: false,
    error: '상위 단계가 유효하지 않아 수렴 라운드를 건너뜁니다.',
  }

  const baseline: JejuDeepOneConvergenceRound = { ...debateStage, round1: emptyRound }

  // Nothing usable upstream → no convergence round.
  if (!debateStage.ok) return baseline

  try {
    const round1 = await runDeliberationRound({
      question: debateStage.question,
      roles: debateStage.plan.roles,
      roundNumber: 1,
      priorTurns: [],
      seedAnalyses: debateStage.revised,
    })
    return { ...baseline, round1 }
  } catch (e: unknown) {
    // Convergence round is enrichment — keep the earlier stages, note the error.
    return {
      ...baseline,
      round1: {
        ...emptyRound,
        error: `수렴 라운드 실패(이전 결과는 유효): ${e instanceof Error ? e.message : 'unknown error'}`,
      },
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PIECE 3.6 — LOOP the convergence round so consensus climbs gradually.
//
// One round landed at ~62 (facts converged, policy still split). A real
// intellectual-consensus body needs several exchanges to climb (e.g. 45→62→78→
// 85). But we must control cost/time and avoid pointless rounds, so we loop with
// SMART STOPPING: enough rounds to genuinely converge, stop early when consensus
// is high (target) OR when it stalls (no meaningful gain).
// ════════════════════════════════════════════════════════════════════════════

/** A real deliberation needs at least a few exchanges — never stop before this (no premature peace). */
const MIN_CONVERGENCE_ROUNDS = 3
/** Hard cap on rounds (cost/time control). */
const MAX_CONVERGENCE_ROUNDS = 5
/** Stop early once consensus reaches this score. */
const CONSENSUS_TARGET = 85
/** After the minimum, if a round's gain drops below this, stop — nothing more to squeeze. */
const STALL_DELTA = 4

/** Why the deliberation loop stopped. */
export type JejuDeliberationStopReason = 'target_reached' | 'stalled' | 'max_rounds' | 'error'

/** A full multi-round deliberation: every round + the final converged state. */
export type JejuDeliberation = {
  /** Every round in order. */
  rounds: JejuRoundResult[]
  /** Consensus after the last round run. */
  finalScore: number
  roundsRun: number
  stoppedReason: JejuDeliberationStopReason
  /** From the final round. */
  agreedPoints: string[]
  /** From the final round (→ minority-report seeds). */
  contestedPoints: string[]
  /** Final round's summary. */
  summary: string
  ok: boolean
  error?: string
}

/** Builds the final JejuDeliberation from the rounds run so far + a stop reason. */
function buildDeliberationResult(
  rounds: JejuRoundResult[],
  stoppedReason: JejuDeliberationStopReason,
  error?: string
): JejuDeliberation {
  const last = rounds.length > 0 ? rounds[rounds.length - 1]! : undefined
  const ok = rounds.some((r) => r.ok && r.consensusScore !== CONSENSUS_SCORE_UNAVAILABLE)
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

/**
 * PIECE 3.6 — loops runDeliberationRound until consensus converges, stalls, or
 * hits the round cap. Round 1 is seeded from the revised analyses; each later
 * round feeds on the previous round's turns.
 *
 * Stopping (evaluated only AFTER a completed round):
 *   - round failed OR score unmeasurable (-1) → stop 'error' (keep prior rounds)
 *   - at/after MIN_CONVERGENCE_ROUNDS:
 *       score >= CONSENSUS_TARGET            → stop 'target_reached'
 *       gain since prev round < STALL_DELTA  → stop 'stalled'
 *   - roundNumber >= maxRounds               → stop 'max_rounds'
 * The MINIMUM is enforced: never stop before MIN_CONVERGENCE_ROUNDS even if an
 * early round scores high (prevents premature "peace!"). Never throws.
 */
export async function runDeliberation(params: {
  question: string
  roles: JejuExpertRole[]
  seedAnalyses: JejuRevisedAnalysis[]
  maxRounds?: number
}): Promise<JejuDeliberation> {
  const { question, roles, seedAnalyses } = params
  const maxRounds = Math.max(
    MIN_CONVERGENCE_ROUNDS,
    Math.min(MAX_CONVERGENCE_ROUNDS, params.maxRounds ?? MAX_CONVERGENCE_ROUNDS)
  )

  const rounds: JejuRoundResult[] = []

  try {
    for (let roundNumber = 1; roundNumber <= maxRounds; roundNumber++) {
      const priorTurns = roundNumber > 1 ? rounds[rounds.length - 1]!.turns : []
      const round = await runDeliberationRound({
        question,
        roles,
        roundNumber,
        priorTurns,
        ...(roundNumber === 1 ? { seedAnalyses } : {}),
      })
      rounds.push(round)

      // A broken round (no valid turns or unmeasurable score) ends the loop.
      if (!round.ok || round.consensusScore === CONSENSUS_SCORE_UNAVAILABLE) {
        return buildDeliberationResult(rounds, 'error', round.error ?? '라운드 측정 실패로 토론을 중단합니다.')
      }

      // Enforce the minimum — no early stop before a real deliberation has happened.
      if (roundNumber >= MIN_CONVERGENCE_ROUNDS) {
        if (round.consensusScore >= CONSENSUS_TARGET) {
          return buildDeliberationResult(rounds, 'target_reached')
        }
        const prevScore = rounds[rounds.length - 2]?.consensusScore ?? round.consensusScore
        if (round.consensusScore - prevScore < STALL_DELTA) {
          return buildDeliberationResult(rounds, 'stalled')
        }
      }

      if (roundNumber >= maxRounds) {
        return buildDeliberationResult(rounds, 'max_rounds')
      }
    }

    // Loop exhausted the cap without an earlier explicit stop.
    return buildDeliberationResult(rounds, 'max_rounds')
  } catch (e: unknown) {
    return buildDeliberationResult(
      rounds,
      'error',
      `토론 루프 실패: ${e instanceof Error ? e.message : 'unknown error'}`
    )
  }
}

/** Full DEEP result through the multi-round deliberation (beats 1–3.6). */
export type JejuDeepThroughDeliberation = JejuDeepWithDebate & {
  /** The looped multi-round deliberation result. */
  deliberation: JejuDeliberation
}

/**
 * Orchestrates the full DEEP pipeline through the looped deliberation:
 *   runJejuDeepWithDebate → runDeliberation(seeded from revised).
 *
 * The deliberation is the core, but its failure shouldn't crash the pipeline;
 * ok mirrors the analysis stage. Never throws; partial data on error.
 */
export async function runJejuDeepThroughDeliberation(params?: {
  question?: string
  orchestratorProvider?: string
  maxRounds?: number
}): Promise<JejuDeepThroughDeliberation> {
  const debateStage = await runJejuDeepWithDebate(params)

  const emptyDeliberation: JejuDeliberation = {
    rounds: [],
    finalScore: CONSENSUS_SCORE_UNAVAILABLE,
    roundsRun: 0,
    stoppedReason: 'error',
    agreedPoints: [],
    contestedPoints: [],
    summary: '',
    ok: false,
    error: '상위 단계가 유효하지 않아 토론을 건너뜁니다.',
  }

  const baseline: JejuDeepThroughDeliberation = { ...debateStage, deliberation: emptyDeliberation }

  // Nothing usable upstream → no deliberation.
  if (!debateStage.ok) return baseline

  try {
    const deliberation = await runDeliberation({
      question: debateStage.question,
      roles: debateStage.plan.roles,
      seedAnalyses: debateStage.revised,
      ...(params?.maxRounds !== undefined ? { maxRounds: params.maxRounds } : {}),
    })
    return { ...baseline, deliberation }
  } catch (e: unknown) {
    return {
      ...baseline,
      deliberation: {
        ...emptyDeliberation,
        error: `토론 단계 실패(이전 결과는 유효): ${e instanceof Error ? e.message : 'unknown error'}`,
      },
    }
  }
}
