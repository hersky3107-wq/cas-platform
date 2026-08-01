import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { type ExtendedAiProviderName } from '@/lib/ai/router'
import {
  callJejuAi,
  type JejuProvider,
} from '@/lib/jeju/local-providers'
import {
  buildJejuSupplementBlock,
  type JejuSupplement,
} from '@/lib/jeju/supplements'
import {
  buildDataTrustBlock,
  type DataTrustBlock,
} from '@/lib/jeju/cross-check'
import {
  KOREAN_ONLY_DIRECTIVE,
  TRUTH_SEEKING_DIRECTIVE,
  type JejuExecutedSearch,
} from '@/lib/jeju/deep'

/**
 * JEJU open-ended (라이트) governance briefing — Mode A engine.
 *
 * Pipeline: snapshot → orchestrate (neutral lenses, 1 doubled angle) → shared
 * pre-report (briefing mode, caller-supplied) → 8 parallel single-pass analyses
 * (NO debate/vote/consensus) → Opus synthesis (추천안 + B·C 대안).
 *
 * Fully isolated from lib/jeju/synod-debate.ts and the deliberate route.
 * Meta stays disabled via the local analyst roster below.
 */

// ── Local reasoning roster (mirrors SYNOD_DEBATERS minus meta; NOT imported) ───

/** How many analytical angles get a second AI (importance-weighted doubling). */
export const OPEN_BRIEF_DOUBLED_ANGLE_COUNT = 1

/**
 * Eight reasoning brands for open-mode parallel analysis: the 6 shared-router
 * brands plus JEJU-LOCAL solar/exaone (mid-order, matching SYNOD_DEBATERS).
 * Meta intentionally excluded.
 */
export const OPEN_BRIEF_ANALYSTS: JejuProvider[] = [
  'openai',
  'anthropic',
  'google',
  'solar',
  'exaone',
  'xai',
  'deepseek',
  'mistral',
]

const VALID_ANALYSTS = new Set<string>(OPEN_BRIEF_ANALYSTS)

const ORCHESTRATOR_PROVIDER: ExtendedAiProviderName = 'anthropic'
const ORCHESTRATOR_MODEL = 'claude-opus-4-8'
const SYNTHESIS_MODEL = 'claude-opus-4-8'

const PLAN_MAX_TOKENS = 3000
/**
 * Per-analyst token cap. Target output is a fuller ~900–1300 Korean characters
 * (two sections). Completeness beats brevity — a full 1300자 is better than a
 * cut-off 700자 — so 3000 gives generous headroom and analyses never truncate.
 */
const ANALYSIS_MAX_TOKENS = 3000
const SYNTHESIS_MAX_TOKENS = 5000

/** Brand display names for orchestrator prompts (product names, not company-only). */
const BRAND_LABEL: Record<string, string> = {
  openai: 'ChatGPT',
  anthropic: 'Claude',
  google: 'Gemini',
  solar: 'Solar',
  exaone: 'EXAONE',
  xai: 'Grok',
  deepseek: 'DeepSeek',
  mistral: 'Mistral',
}

function noDbSupabase(): SupabaseClient {
  return createClient('http://localhost', 'open-brief-no-db') as unknown as SupabaseClient
}

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

// ── Types ─────────────────────────────────────────────────────────────────────

/** One neutral domain-analysis seat assigned by the open-mode orchestrator. */
export type JejuOpenAnalysisRole = {
  roleId: string
  roleLabel: string
  mandate: string
  /** The specific sub-question this AI examines within its angle. */
  subQuestion: string
  provider: JejuProvider
  /** True when this seat covers the importance-doubled primary angle. */
  isDoubledAngle: boolean
  /** Shared id linking the two AIs on the doubled angle (if any). */
  doubledGroupId?: string
}

export type JejuOpenMeetingPlan = {
  ok: boolean
  question: string
  roles: JejuOpenAnalysisRole[]
  rationale: string
  /** The analytical angle that received two AIs. */
  primaryAngleId: string
  searchNeeded: boolean
  raw?: string
  error?: string
}

/** One parallel analyst's single-pass output (no debate tags). */
export type JejuOpenAnalysis = {
  roleId: string
  roleLabel: string
  provider: JejuProvider
  subQuestion: string
  isDoubledAngle: boolean
  ok: boolean
  analysis: string | null
  error?: string
}

export type JejuOpenBriefSynthesis = {
  ok: boolean
  question: string
  synthesis: string | null
  provider: string
  error?: string
}

// ── Orchestrator (STEP 1) ─────────────────────────────────────────────────────

function buildOpenOrchestratorSystemPrompt(): string {
  const brands = OPEN_BRIEF_ANALYSTS.map((p) => `- ${p} (${BRAND_LABEL[p] ?? p})`).join('\n')
  return [
    '당신은 제주특별자치도정 개방형(라이트) 거버넌스 브리핑의 오케스트레이터입니다.',
    '이 모드는 찬반 토론이 아닙니다. 공무원·실무자가 "지금 가장 시급한 현안은?" 같은 개방형 질문에 답하기 위해,',
    '8개 추론 AI를 각기 다른 중립적 분석 렌즈에 배치합니다.',
    '',
    TRUTH_SEEKING_DIRECTIVE,
    '',
    '핵심 규칙:',
    '- 역할은 반드시 중립적 "분야·관점 분석"입니다. 찬성/반대/옹호/레드팀/비판자 같은 입장 배정 금지.',
    '- 각 AI는 자신의 전문 렌즈로 데이터를 읽고, 솔직하게 분석합니다. 8:0 찬성도 8:0 반대도 강요하지 않습니다.',
    '- Perplexity는 검색 전용이며 분석 좌석에 배정하지 마세요.',
    `- 사용 가능한 8개 추론 AI(각각 정확히 1회만 배정):\n${brands}`,
    '',
    `중요도 가중 배치(고정 규칙): 이번 주제에서 가장 중요한 분석 각도 1개(primaryAngleId)를 고르고,`,
    `그 각도에 서로 다른 subQuestion을 가진 AI 2개를 배정하세요(약간 다른 하위 질문으로 깊이를 확보).`,
    `나머지 6개 각도에는 AI 1개씩 배정합니다. 총 배정 수 = 8.`,
    '',
    '- 각 배정마다 roleLabel은 공무원이 즉시 이해하는 행정 한국어(예: "에너지·계통 수급", "관광·경제 영향").',
    '- mandate: 이 좌석이 무엇을, 왜 봐야 하는지 1~2문장.',
    '- subQuestion: 이 AI만의 구체적 분석 과제(다른 AI와 겹치지 않게).',
    '- doubledGroupId: 같은 primary 각도에 배정된 두 AI는 동일 id(예: "energy-supply").',
    '',
    KOREAN_ONLY_DIRECTIVE,
    '',
    '출력: 오직 하나의 JSON 객체만. 마크다운 코드펜스(```) 금지.',
    '스키마:',
    '{',
    '  "rationale": "이 배치가 이 질문·데이터에 맞는 이유 (한국어 2~4문장)",',
    '  "searchNeeded": true 또는 false,',
    '  "primaryAngleId": "가장 중요하게 본 각도 id",',
    '  "assignments": [',
    '    {',
    '      "roleId": "짧은-id",',
    '      "roleLabel": "행정 한국어 역할명",',
    '      "mandate": "직무 설명",',
    '      "subQuestion": "이 AI의 구체적 분석 과제",',
    '      "provider": "openai|anthropic|google|solar|exaone|xai|deepseek|mistral 중 하나",',
    '      "isDoubledAngle": true/false,',
    '      "doubledGroupId": "primary 각도 id 또는 null"',
    '    }',
    '  ]',
    '}',
    'assignments는 정확히 8개. provider는 8개 브랜드 각 1회만.',
  ].join('\n')
}

function fallbackOpenPlan(question: string): JejuOpenMeetingPlan {
  const defaults: Omit<JejuOpenAnalysisRole, 'provider'>[] = [
    {
      roleId: 'primary-a',
      roleLabel: '핵심 현안·우선순위',
      mandate: '질문의 핵심 현안과 긴급도를 데이터 근거로 정리합니다.',
      subQuestion: '지금 가장 시급한 현안과 그 근거는 무엇인가?',
      isDoubledAngle: true,
      doubledGroupId: 'primary',
    },
    {
      roleId: 'primary-b',
      roleLabel: '핵심 현안·파급효과',
      mandate: '동일 주제의 2차·파급 영향과 리스크를 분석합니다.',
      subQuestion: '핵심 현안이 다른 분야·도민·산업에 미치는 영향은?',
      isDoubledAngle: true,
      doubledGroupId: 'primary',
    },
    {
      roleId: 'fiscal-regulatory',
      roleLabel: '재정·규제',
      mandate: '재정 부담과 규제·제도 여건을 평가합니다.',
      subQuestion: '재정·규제 관점에서 주의할 점은?',
      isDoubledAngle: false,
    },
    {
      roleId: 'admin-institutional',
      roleLabel: '행정·제도 현실성',
      mandate: '도정·유관 기관의 실제 집행 절차와 제도적 제약을 점검합니다.',
      subQuestion: '행정·제도 관점에서 실제로 집행 가능한가?',
      isDoubledAngle: false,
    },
    {
      roleId: 'industry-field',
      roleLabel: '현장·산업 실행 가능성',
      mandate: '현장 운영·산업 여건에 비추어 실행 가능성을 점검합니다.',
      subQuestion: '현장·산업 관점에서 실제로 실행 가능한가?',
      isDoubledAngle: false,
    },
    {
      roleId: 'infra-ops',
      roleLabel: '인프라·운영',
      mandate: '실행 가능한 인프라·운영 여건을 점검합니다.',
      subQuestion: '현재 인프라·운영 역량으로 대응 가능한가?',
      isDoubledAngle: false,
    },
    {
      roleId: 'community-impact',
      roleLabel: '지역사회·민생',
      mandate: '도민·지역사회·민생 영향을 분석합니다.',
      subQuestion: '도민·민생에 미치는 직접적 영향은?',
      isDoubledAngle: false,
    },
    {
      roleId: 'external-trends',
      roleLabel: '외부·시장 동향',
      mandate: '외부 환경·시장·정책 동향과의 정합성을 봅니다.',
      subQuestion: '외부 동향·타지역 사례가 시사하는 바는?',
      isDoubledAngle: false,
    },
  ]
  const roles: JejuOpenAnalysisRole[] = defaults.map((d, i) => ({
    ...d,
    provider: OPEN_BRIEF_ANALYSTS[i]!,
  }))
  return {
    ok: true,
    question,
    roles,
    rationale: '오케스트레이터 JSON 파싱 실패 — 기본 6좌석(핵심 각도 2명 + 4분야 1명)으로 대체했습니다.',
    primaryAngleId: 'primary',
    searchNeeded: true,
  }
}

function parseOpenPlan(raw: string, question: string): JejuOpenMeetingPlan {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripFences(raw))
  } catch {
    return { ...fallbackOpenPlan(question), raw, error: '오케스트레이터 JSON 파싱 실패' }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ...fallbackOpenPlan(question), raw, error: '오케스트레이터 JSON 파싱 실패' }
  }

  const o = parsed as Record<string, unknown>
  const rationale = typeof o.rationale === 'string' ? o.rationale.trim() : ''
  const searchNeeded = o.searchNeeded === true
  const primaryAngleId =
    typeof o.primaryAngleId === 'string' && o.primaryAngleId.trim()
      ? o.primaryAngleId.trim()
      : 'primary'

  const rawAssignments = Array.isArray(o.assignments) ? o.assignments : []
  const roles: JejuOpenAnalysisRole[] = []
  const usedProviders = new Set<string>()

  for (const item of rawAssignments) {
    if (!item || typeof item !== 'object') continue
    const a = item as Record<string, unknown>
    const provider = typeof a.provider === 'string' ? a.provider.trim() : ''
    if (!VALID_ANALYSTS.has(provider) || usedProviders.has(provider)) continue

    const roleId = typeof a.roleId === 'string' && a.roleId.trim() ? a.roleId.trim() : `role-${roles.length + 1}`
    const roleLabel = typeof a.roleLabel === 'string' ? a.roleLabel.trim() : ''
    const mandate = typeof a.mandate === 'string' ? a.mandate.trim() : ''
    const subQuestion = typeof a.subQuestion === 'string' ? a.subQuestion.trim() : ''
    if (!roleLabel || !mandate || !subQuestion) continue

    usedProviders.add(provider)
    roles.push({
      roleId,
      roleLabel,
      mandate,
      subQuestion,
      provider: provider as JejuProvider,
      isDoubledAngle: a.isDoubledAngle === true,
      doubledGroupId:
        typeof a.doubledGroupId === 'string' && a.doubledGroupId.trim()
          ? a.doubledGroupId.trim()
          : undefined,
    })
  }

  if (roles.length !== OPEN_BRIEF_ANALYSTS.length) {
    const fb = fallbackOpenPlan(question)
    return {
      ...fb,
      raw,
      rationale: rationale || fb.rationale,
      searchNeeded: searchNeeded || fb.searchNeeded,
      error: `오케스트레이터가 ${roles.length}개 좌석만 배정 — 8개 필요, 기본 배치로 대체`,
    }
  }

  const doubledCount = roles.filter((r) => r.isDoubledAngle).length
  if (doubledCount !== OPEN_BRIEF_DOUBLED_ANGLE_COUNT * 2) {
    // Non-fatal: proceed but note if doubling is off-spec
  }

  return {
    ok: true,
    question,
    roles,
    rationale: rationale || '(오케스트레이터 소집 근거 없음)',
    primaryAngleId,
    searchNeeded,
    raw,
  }
}

/**
 * Open-mode orchestrator: assigns 6 reasoning AIs to neutral analytical lenses.
 * Exactly one angle is importance-doubled (2 AIs, different subQuestions).
 * Does NOT modify planJejuMeeting in deep.ts.
 */
export async function planJejuOpenMeeting(params: {
  question: string
  availableDataSummary: string
}): Promise<JejuOpenMeetingPlan> {
  const question = params.question?.trim() ?? ''
  if (!question) {
    return {
      ok: false,
      question,
      roles: [],
      rationale: '',
      primaryAngleId: '',
      searchNeeded: false,
      error: '질문이 비어 있습니다.',
    }
  }

  const userPrompt = [
    '[개방형 질문]',
    question,
    '',
    '[현재 확보된 실시간 데이터 현황]',
    params.availableDataSummary || '(가용 데이터 정보 없음)',
    '',
    '위 질문과 데이터에 맞춰 8개 AI 분석 좌석을 배정하세요. 스키마에 맞는 순수 JSON만 출력하세요.',
  ].join('\n')

  let r
  try {
    r = await callJejuAi({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: ORCHESTRATOR_PROVIDER,
      prompt: userPrompt,
      systemPrompt: buildOpenOrchestratorSystemPrompt(),
      maxCompletionTokens: PLAN_MAX_TOKENS,
      modelOverride: ORCHESTRATOR_MODEL,
    })
  } catch (e: unknown) {
    return {
      ok: false,
      question,
      roles: [],
      rationale: '',
      primaryAngleId: '',
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
      primaryAngleId: '',
      searchNeeded: false,
      error: r.error ?? '오케스트레이터 응답이 비어 있습니다.',
    }
  }

  const plan = parseOpenPlan(r.text, question)
  return plan.ok ? plan : { ...plan, error: plan.error ?? '오케스트레이터 배치 실패' }
}

// ── Parallel analysis (STEP 3) ────────────────────────────────────────────────

function buildAnalystSystemPrompt(role: JejuOpenAnalysisRole): string {
  return [
    `당신은 제주도정 개방형 거버넌스 브리핑에 참여하는 전문 분석가입니다.`,
    `당신의 AI 브랜드: ${BRAND_LABEL[role.provider] ?? role.provider}.`,
    `당신의 역할: ${role.roleLabel}.`,
    `당신의 직무: ${role.mandate}`,
    '',
    TRUTH_SEEKING_DIRECTIVE,
    '',
    '분석 규칙:',
    '- 이것은 토론이 아닙니다. 다른 AI를 반박하거나 이름을 부르며 논쟁하지 마세요.',
    '- CLAIM/ACTION 같은 토론 태그를 쓰지 마세요.',
    '- 제공된 [상황 브리핑]과 [수집 데이터]에 근거하세요. 없는 수치는 지어내지 마세요.',
    '',
    '출력 형식 (총 900~1300자, 두 섹션만):',
    '## 핵심 발견',
    '4~6문장. 당신의 렌즈에서 가장 중요한 발견을 충실히 서술하세요. 치명적 리스크가 있으면 이 안에 포함하세요.',
    '## 데이터 근거',
    '4~6문장. 수치·사실을 출처·시점과 함께 인용하세요. 예: "(출처: KPX, 2026-06-27 기준)".',
    '',
    '두 섹션 외 추가 제목(리스크, 불확실성 등)을 별도로 만들지 마세요. 충실하고 완결된 분석이 목표이며, 절대 문장 중간에 끊지 말고 끝까지 작성하세요.',
    '',
    '언어 규칙(절대 준수): 결과를 반드시 순수 한국어로 작성하라. 한자(漢字)·중국어·일본어 문자를 절대 사용하지 말 것. 단 영어 약어(MW, SMP, ESS, HVDC, V2G, kWh, % 등), 숫자, 단위는 허용.',
    KOREAN_ONLY_DIRECTIVE,
  ].join('\n')
}

function buildAnalystUserPrompt(params: {
  question: string
  role: JejuOpenAnalysisRole
  briefing: string
  context: string
  /** User-submitted paste-text supplements — untrusted reference data only. */
  supplements?: JejuSupplement[]
  /** Data cross-validation findings — untrusted-data context only. */
  dataTrust?: DataTrustBlock
}): string {
  return [
    '[거버넌스 질문]',
    params.question,
    '',
    '[당신의 분석 과제]',
    params.role.subQuestion,
    '',
    '[상황 브리핑 — 모든 분석가가 공유하는 사실 기반]',
    params.briefing.trim(),
    '',
    '[수집 데이터 원문]',
    params.context.trim(),
    ...(params.supplements && params.supplements.length > 0
      ? [buildJejuSupplementBlock(params.supplements)]
      : []),
    ...(params.dataTrust?.hasIssues ? [buildDataTrustBlock(params.dataTrust)] : []),
    '',
    '위 브리핑과 데이터를 바탕으로, 당신의 렌즈에서 한 번만 분석하세요.',
  ].join('\n')
}

async function runOneOpenAnalysis(params: {
  question: string
  role: JejuOpenAnalysisRole
  briefing: string
  context: string
  supplements?: JejuSupplement[]
  dataTrust?: DataTrustBlock
}): Promise<JejuOpenAnalysis> {
  const { role } = params
  const base: JejuOpenAnalysis = {
    roleId: role.roleId,
    roleLabel: role.roleLabel,
    provider: role.provider,
    subQuestion: role.subQuestion,
    isDoubledAngle: role.isDoubledAngle,
    ok: false,
    analysis: null,
  }

  try {
    const r = await callJejuAi({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: role.provider,
      prompt: buildAnalystUserPrompt(params),
      systemPrompt: buildAnalystSystemPrompt(role),
      maxCompletionTokens: ANALYSIS_MAX_TOKENS,
    })
    if (r.error || !r.text?.trim()) {
      return { ...base, error: r.error ?? '분석 응답이 비어 있습니다.' }
    }
    return { ...base, ok: true, analysis: r.text.trim() }
  } catch (e: unknown) {
    return {
      ...base,
      error: `분석 호출 실패: ${e instanceof Error ? e.message : 'unknown error'}`,
    }
  }
}

/**
 * Runs all 8 open-mode analysts IN PARALLEL — one single-pass analysis each.
 * No debate rounds, no rebuttal, no vote.
 */
export async function runJejuOpenAnalyses(params: {
  question: string
  plan: JejuOpenMeetingPlan
  briefing: string
  context: string
  /** User-submitted paste-text supplements — untrusted reference data only. */
  supplements?: JejuSupplement[]
  /** Data cross-validation findings — untrusted-data context only. */
  dataTrust?: DataTrustBlock
}): Promise<JejuOpenAnalysis[]> {
  const roles = params.plan.roles.length > 0 ? params.plan.roles : fallbackOpenPlan(params.question).roles
  const settled = await Promise.allSettled(
    roles.map((role) =>
      runOneOpenAnalysis({
        question: params.question,
        role,
        briefing: params.briefing,
        context: params.context,
        supplements: params.supplements,
        dataTrust: params.dataTrust,
      })
    )
  )
  return settled.map((s, i) => {
    if (s.status === 'fulfilled') return s.value
    const role = roles[i]!
    return {
      roleId: role.roleId,
      roleLabel: role.roleLabel,
      provider: role.provider,
      subQuestion: role.subQuestion,
      isDoubledAngle: role.isDoubledAngle,
      ok: false,
      analysis: null,
      error: s.reason instanceof Error ? s.reason.message : '분석 rejected',
    }
  })
}

// ── Opus synthesis (STEP 4) ─────────────────────────────────────────────────────

function formatAnalysesBlock(analyses: JejuOpenAnalysis[]): string {
  return analyses
    .map((a, i) => {
      const brand = BRAND_LABEL[a.provider] ?? a.provider
      const body = a.ok && a.analysis ? a.analysis : `(분석 실패: ${a.error ?? 'unknown'})`
      return [
        `── 분석 ${i + 1}: ${brand} (${a.roleLabel}) ──`,
        `과제: ${a.subQuestion}`,
        body,
      ].join('\n')
    })
    .join('\n\n')
}

function buildSynthesisSystemPrompt(): string {
  return [
    '당신은 제주특별자치도정 개방형 거버넌스 브리핑의 최종 통합 작성자(수석 보좌관)입니다.',
    '8개 AI의 병렬 분석과 사전 브리핑을 읽고, 공무원·실무자가 바로 의사결정에 쓸 수 있는',
    '하나의 통합 브리핑을 작성하세요.',
    '',
    TRUTH_SEEKING_DIRECTIVE,
    '',
    '반드시 아래 5개 섹션 제목을 그대로 사용하고, 각 섹션을 충실히 채우세요:',
    '',
    '1) 핵심 요약',
    '   - 3~5줄. 지금 무엇이 가장 중요한지, 한눈에.',
    '',
    '2) 분야별 현황',
    '   - 8개 분석을 통합·정리. 데이터 출처·시점을 인라인으로 유지.',
    '',
    '3) 가장 시급한 쟁점 (우선순위)',
    '   - 무엇을 먼저 다뤄야 하는지, 근거와 함께 우선순위.',
    '',
    '4) ★권고',
    '   - 의장 추천안 1개: "★ 추천안(A안)" — 무엇을 우선하는지, 트레이드오프 명시.',
    '   - 대안 B안 1개: "B안" — 다른 우선순위·트레이드오프.',
    '   - 대안 C안 1개: "C안" — 또 다른 선택지·트레이드오프.',
    '   - 공무원이 A/B/C 중 선택할 수 있게 각 안의 장단·우선 가치를 분명히.',
    '',
    '5) 데이터 공백·유의사항',
    '   - 확인되지 않은 것, 추가 조사 필요, 리스크.',
    '   - 마지막 줄에 면책: "본 문서는 AI 보좌 의견이며, 최종 결정은 담당 공무원에게 있습니다."',
    '',
    '금지: 찬반 표결, 합의도 점수, 토론 요약, "전원 찬성" 같은 표현.',
    KOREAN_ONLY_DIRECTIVE,
  ].join('\n')
}

function buildSynthesisUserPrompt(params: {
  question: string
  briefing: string
  analyses: JejuOpenAnalysis[]
  searches?: JejuExecutedSearch[]
  /** User-submitted paste-text supplements — untrusted reference data only. */
  supplements?: JejuSupplement[]
  /** Data cross-validation findings — untrusted-data context only. */
  dataTrust?: DataTrustBlock
}): string {
  const searchBlock =
    params.searches && params.searches.length > 0
      ? params.searches
          .map((s) => {
            const body = s.ok && s.result ? s.result : `(검색 실패: ${s.error ?? 'unknown'})`
            return `· ${s.query}: ${body}`
          })
          .join('\n')
      : '(외부 검색 없음)'

  return [
    '[거버넌스 질문]',
    params.question,
    '',
    '[사전 상황 브리핑]',
    params.briefing.trim(),
    '',
    '[Perplexity 검색 결과]',
    searchBlock,
    '',
    '[8개 AI 병렬 분석]',
    formatAnalysesBlock(params.analyses),
    ...(params.supplements && params.supplements.length > 0
      ? [buildJejuSupplementBlock(params.supplements)]
      : []),
    ...(params.dataTrust?.hasIssues ? [buildDataTrustBlock(params.dataTrust)] : []),
    '',
    '위 자료를 통합하여 5개 섹션 구조의 최종 브리핑을 작성하세요.',
  ].join('\n')
}

/**
 * Opus synthesis: integrated briefing with ★추천안 + B·C 대안. No vote/consensus.
 */
export async function synthesizeJejuOpenBrief(params: {
  question: string
  briefing: string
  analyses: JejuOpenAnalysis[]
  searches?: JejuExecutedSearch[]
  /** User-submitted paste-text supplements — reaches synthesis the same as analysts. */
  supplements?: JejuSupplement[]
  /** Data cross-validation findings — reaches synthesis the same as analysts. */
  dataTrust?: DataTrustBlock
}): Promise<JejuOpenBriefSynthesis> {
  const question = params.question?.trim() ?? ''
  const base: JejuOpenBriefSynthesis = {
    ok: false,
    question,
    synthesis: null,
    provider: ORCHESTRATOR_PROVIDER,
  }

  if (!question) return { ...base, error: '질문이 비어 있습니다.' }
  if (!params.briefing?.trim()) return { ...base, error: '브리핑이 없습니다.' }

  try {
    const r = await callJejuAi({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: ORCHESTRATOR_PROVIDER,
      prompt: buildSynthesisUserPrompt(params),
      systemPrompt: buildSynthesisSystemPrompt(),
      maxCompletionTokens: SYNTHESIS_MAX_TOKENS,
      modelOverride: SYNTHESIS_MODEL,
    })
    if (r.error || !r.text?.trim()) {
      return { ...base, error: r.error ?? '통합 브리핑 응답이 비어 있습니다.' }
    }
    return { ...base, ok: true, synthesis: r.text.trim() }
  } catch (e: unknown) {
    return {
      ...base,
      error: `통합 브리핑 호출 실패: ${e instanceof Error ? e.message : 'unknown error'}`,
    }
  }
}
