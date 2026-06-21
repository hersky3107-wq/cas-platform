import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { gatherJejuSnapshot } from '@/lib/jeju/brief'
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
