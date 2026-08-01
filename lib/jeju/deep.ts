import 'server-only'

import { gatherJejuSnapshot, buildBriefingContext, JEJU_STANDING_ECONOMY_CONTEXT, type JejuSnapshot } from '@/lib/jeju/brief'
import {
  CROSS_DOMAIN_DIRECTIVE,
  CASE_CITATION_DISCIPLINE,
  BANDWAGON_RESISTANCE,
  DATA_GAP_DISCIPLINE,
  RECENCY_GUARD_DIRECTIVE,
} from '@/lib/jeju/prompt-directives'
import {
  MODEL_BY_PROVIDER,
  type ExtendedAiProviderName,
} from '@/lib/ai/router'
import {
  callJejuAi,
  isJejuLocalProvider,
  type JejuProvider,
} from '@/lib/jeju/local-providers'
import {
  buildJejuSupplementBlock,
  type JejuSupplement,
} from '@/lib/jeju/supplements'

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
 * can assign roles sensibly) and as our own reference. Keys are JejuProvider
 * values: shared-router providers plus JEJU-LOCAL solar/exaone.
 */
export const AI_BRAND_STRENGTHS: Record<JejuProvider, string> = {
  perplexity: '실시간 검색·최신 정보·외부 사실 확인',
  anthropic: '종합·신중한 분석·리스크/윤리 검토 (의장 적합)',
  openai: '균형잡힌 정책 추론·범용',
  google: '정보 정합성·대용량 데이터 처리',
  xai: '도발적 반박·통념 비판 (레드팀 적합)',
  deepseek: '수치·정량 분석·타임라인',
  mistral: '간결·창의적 관점·보조 분석',
  solar: '제주 행정·제도 맥락 이해·도정 정책 현실성 검토 (국산 모델)',
  exaone: '제주 현장·산업 현실성·실행 가능성 검토 (국산 모델)',
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
  /** The AI brand assigned to play this role (may be a JEJU-LOCAL provider). */
  provider: JejuProvider
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
  /**
   * Whether the question is a yes/no proposition the official wants approved or
   * rejected ('binary' / 찬반형) or an exploratory how/what question with no
   * single yes/no answer ('openEnded' / 개방형). Defaults to 'openEnded' when
   * ambiguous or unparseable. Classified by the orchestrator in its existing
   * call (adds NO extra AI call). Consumed by a later voting-branch step.
   */
  questionType: 'binary' | 'openEnded'
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
 * Hard Korean-only output lock, injected into every governance expert/debate/
 * deliberation/revision system prompt. Governance questions are always Korean,
 * so we hardcode a strong directive (no language detection needed) to stop the
 * observed contamination ("電気료", "商业용", "šte한", "스티엄", "경관계통" etc.).
 */
export const KOREAN_ONLY_DIRECTIVE =
  '언어 규칙(매우 중요, 반드시 준수): 출력은 100% 깨끗한 표준 한국어여야 합니다. 중국어·일본어 한자나 다른 언어 글자, 혼종·오염 표기를 절대 섞지 마십시오(금지 예: "電気료", "商业용", "šte한", "스티엄", "경관계통"). 브랜드명 등 불가피한 고유명사를 제외하고는 한자·외국어 글자를 쓰지 말고, 모든 문장을 자연스러운 한국어로만 작성하십시오.'

/**
 * Shared truth-seeking directive injected near the TOP of every debater AND
 * voter system prompt (Mode B). It governs the DEBATE attitude — seek the best
 * answer, adjust on better evidence — and is deliberately NOT a mandate to
 * converge: the vote's stance-persistence rule (honest 반대/기권) still stands.
 */
export const TRUTH_SEEKING_DIRECTIVE =
  '이 심의의 목적은 당신의 입장을 관철하는 것이 아니라, 패널 전체가 함께 가장 객관적이고 현명하며 정답에 가장 가까운 결론에 도달하는 것입니다. 당신의 전문 영역 관점은 그 결론을 찾기 위한 재료이지, 반드시 이겨야 할 주장이 아닙니다. 자기 의견을 무리하게 강조하거나 방어하지 말고, 다른 전문가의 더 나은 근거가 있으면 정직하게 인정하고 입장을 조정하십시오. 동시에, 단지 합의를 위해 약한 근거에 동조하지도 마십시오 — 목표는 "가짜 합의"가 아니라 "진짜 최적해"입니다. 근거의 질로만 판단하십시오.'

/**
 * Shared tag-discipline directive, injected alongside KOREAN_ONLY_DIRECTIVE
 * into every governance analysis / debate / diagnostic system prompt. Stops
 * the AI from dressing output up with bracket-tag salad, emoji, or decorative
 * markers so responses read as professional analysis. Mirrors motie's 태그 절제
 * rule, generalised to the bracket-tags jeju actually uses
 * ([AI 추정]/[확인 필요]/[시점 불명]/[과거 자료]) and stripped of council-mode framing.
 */
export const TAG_DISCIPLINE_DIRECTIVE =
  '태그 절제(중요): [AI 추정]·[확인 필요]·[시점 불명]·[과거 자료] 같은 꺾쇠 태그는 신뢰도·시점 표기를 위한 장치이지 장식이 아닙니다. 남발하지 마십시오. (1) 같은 불확실성을 문단마다 반복 표기하지 말고, 중요한 판단·수치에 처음 등장할 때 1회만 태그하십시오. (2) 반복되는 확인 필요·시점 불명 사항은 개별 문장마다 달지 말고 마지막에 한데 모아 정리하십시오. (3) 출처가 명시된 확실한 공식 데이터에는 태그를 붙이지 마십시오. 한 문단에 꺾쇠 태그가 3회 이상이면 과도하니 통합·정리하십시오. 이모지·장식 기호도 전문 분석 톤에 어울리지 않으니 쓰지 마십시오.'

/**
 * Shared cross-domain analysis directive (with spurious-correlation guard).
 * Injected alongside KOREAN_ONLY_DIRECTIVE / TAG_DISCIPLINE_DIRECTIVE into LITE
 * briefing, diagnostic status/issues, and deliberate analyst/revision/debate/
 * deliberation/chair system prompts so all governance modes stay consistent.
 * Defined in prompt-directives.ts (leaf module) to avoid brief↔deep cycles;
 * re-exported here so callers that already import from deep keep one surface.
 */
export { CROSS_DOMAIN_DIRECTIVE }

/**
 * Shared case-citation discipline directive — stops fabricated court case
 * numbers while keeping legal reasoning at the principle/statute/doctrine
 * level. Injected alongside TAG_DISCIPLINE_DIRECTIVE / CROSS_DOMAIN_DIRECTIVE
 * into the same deliberate analyst/revision/debate/deliberation/chair and
 * diagnostic status/issues system prompts. Defined in prompt-directives.ts;
 * re-exported here for the same reason as CROSS_DOMAIN_DIRECTIVE above.
 */
export { CASE_CITATION_DISCIPLINE }

/**
 * Shared bandwagon-resistance directive — commits each panelist to an
 * independent judgment and a stated counter-argument before conforming, so
 * consensus is reached by evidence rather than conformity pressure. Injected
 * alongside CASE_CITATION_DISCIPLINE / CROSS_DOMAIN_DIRECTIVE into the same
 * deliberate analyst/revision/debate/deliberation/chair and diagnostic
 * status/issues system prompts. Defined in prompt-directives.ts; re-exported
 * here for the same reason as CROSS_DOMAIN_DIRECTIVE above.
 */
export { BANDWAGON_RESISTANCE }

/**
 * Shared data-gap narration discipline — keeps the briefing judgment-first
 * instead of repeating "데이터 부재/미검증" every paragraph, collecting real
 * limitations once at the end. Injected alongside CASE_CITATION_DISCIPLINE /
 * BANDWAGON_RESISTANCE into the same deliberate analyst/revision/debate/
 * deliberation/chair and diagnostic status/issues system prompts. Defined in
 * prompt-directives.ts; re-exported here for the same reason as
 * CROSS_DOMAIN_DIRECTIVE above.
 */
export { DATA_GAP_DISCIPLINE }

/**
 * Shared search-recency guard — forces the Perplexity search specialist (and
 * every downstream prompt that reads its raw output) to date-stamp findings and
 * tag anything ~3+ months old as "[과거 자료]" instead of silently presenting it
 * as today's status. Defined in prompt-directives.ts; re-exported here for the
 * same reason as CROSS_DOMAIN_DIRECTIVE above.
 */
export { RECENCY_GUARD_DIRECTIVE }

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
    'kpx-jeju-smp': '제주 시간별 계통한계가격(SMP, 원/kWh) 및 수요예측',
    'kma-jeju-warning': '제주 발효 중 기상특보 (호우·강풍·태풍 등; 없으면 "없음")',
    'keco-jeju-evcharger': '제주 전기차 충전기 분포·용량·방식 (인프라 현황)',
    'jeju-citrus-production': '제주 품종별 감귤 생산량·추세 (확정통계, 최신 2023년산)',
    'jeju-cargo-throughput': '제주 항만별 화물 물동량 (입출항 품목·물류 추세)',
    'jeju-foreign-tourists': '제주 외국인 관광객 국적별 현황 (관광 수요·국가별 의존도)',
    'jeju-domestic-tourists': '제주 내국인 관광객 형태·목적별 현황',
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
  const dataLines = lines.length ? lines.join('\n') : '(등록된 데이터 소스 없음)'
  return `${JEJU_STANDING_ECONOMY_CONTEXT}\n\n${dataLines}`
}

/**
 * The orchestrator (회의 소집 책임자) system prompt.
 *
 * When `debateBrands` is provided (JEJU Mode B — 찬반 심의), the convener is
 * pinned to a 1:1 "deliberation seating" mode: exactly one governance role per
 * supplied brand, so every SYNOD debater speaks AS a professional expert. The
 * default (no `debateBrands`) is the original 3–5 analytic-role convening used
 * by the DEEP pipeline — unchanged.
 */
function buildOrchestratorSystemPrompt(debateBrands?: JejuProvider[]): string {
  const brandList = (Object.keys(AI_BRAND_STRENGTHS) as JejuProvider[])
    .map((k) => `  - ${k}: ${AI_BRAND_STRENGTHS[k]}`)
    .join('\n')

  // ── Mode B: 1:1 brand→role deliberation seating ─────────────────────────────
  if (debateBrands && debateBrands.length > 0) {
    const n = debateBrands.length
    const seatList = debateBrands.map((b) => `  - ${b}`).join('\n')
    return [
      '당신은 제주특별자치도 거버넌스 "찬반 심의(deliberation)"의 회의 소집 책임자입니다.',
      `이 심의는 아래 ${n}개의 AI 브랜드가 각각 한 명의 전문가가 되어 직접 토론·반박·수렴합니다.`,
      `따라서 아래 ${n}개 브랜드 각각에 1:1로 정확히 하나의 전문가 역할을 배정하세요(브랜드 수 = 역할 수, 중복·누락 금지).`,
      '역할을 미리 정해두지 말고, 주어진 질문과 데이터 현황에 맞춰 매번 새로 설계하세요.',
      '',
      '배정 대상 브랜드(각각 정확히 1개 역할):',
      seatList,
      '',
      '역할 구성 규칙:',
      '(a) 중립 도메인 전문가만 배정(매우 중요): 찬성/반대 같은 입장을 좌석에 미리 박지 마세요. 각 좌석은 질문과 관련된 "분야 전문가"이며, 데이터를 자기 분야의 눈으로 정직하게 읽고 스스로 찬성/반대/유보를 판단합니다. 결론을 미리 정해 추인하도록 설계하지 마세요.',
      '    - 질문에 맞는 도메인에서 고르세요(예시): 재정·규제 / 교통·안전 / 환경·에너지 / 관광·경제 / 인프라 / 법률·제도 / 지역사회 영향 분석. 질문과 무관한 도메인은 넣지 말고, 브랜드 수만큼 이 질문에 가장 핵심적인 도메인을 배정하세요.',
      '    - 모든 좌석의 isRedTeam은 false로 두세요. 라운드별 상호 검증(서로의 논리 허점 점검)은 토론 단계에서 자동으로 처리되므로, 소집 단계에서 "반대 전담"이나 "옹호 전담" 좌석을 만들지 마세요.',
      '    - 정직한 만장일치(예: 8:0)도 정당한 결과입니다. 인위적으로 찬반을 갈라놓지 마세요. 목표는 균형처럼 보이는 구도가 아니라, 각 분야의 가장 정확한 판단이 충돌·수렴해 "참된 최적해"가 살아남는 것입니다.',
      '(b) 양면 검토 의무(각 mandate에 반드시 포함): 모든 전문가는 결론을 내리기 전에 자기 도메인 안에서 이 안건의 가장 강력한 찬성 근거와 가장 강력한 반대 근거를 모두 검토해야 합니다 — 한쪽으로 성급히 기울지 말고, 강한 반론을 무시하지 마세요.',
      '(c) roleLabel 표기(공무원이 즉시 이해하는 행정 한국어): "스틸맨" 같은 은어·외래어·영어 표기 금지. 입장이 아니라 "분야"로만 표기하세요. 예) "재정·규제 분석", "교통·안전 분석", "환경·에너지 분석", "관광·경제 분석".',
      '(d) mandate(한국어 직무): 그 전문가가 이 질문에서 자기 분야 관점으로 무엇을 분석·논증하는지 구체적으로 적되, 위 (b)의 양면 검토 의무를 반드시 담으세요.',
      '(e) provider: 위 브랜드 목록의 값을 정확히 하나씩만 사용하세요(각 브랜드 1회). 목록에 없는 브랜드(특히 perplexity)는 절대 쓰지 마세요 — perplexity는 검색·언론 전용이라 이 토론 좌석에 들어오지 않습니다.',
      '(f) questionType 분류: "binary"(공무원이 찬성/반대로 답하는 명확한 정책 명제) 또는 "openEnded"(단일 찬반으로 답할 수 없는 탐색형). 애매하면 반드시 "openEnded".',
      '',
      '참고용 AI 브랜드 강점표(역할-브랜드 적합도 판단에만 사용):',
      brandList,
      '',
      '출력 형식 (매우 중요):',
      '오직 하나의 JSON 객체만 출력하세요. 마크다운 코드펜스(```)도, 설명 문장도 쓰지 마세요. 순수 JSON만.',
      '스키마:',
      '{',
      `  "roles": [ 정확히 ${n}개, 위 브랜드 각각에 1개씩 ],`,
      '    각 원소: { "roleId": "string(영문 슬러그)", "roleLabel": "string(한국어)", "mandate": "string(한국어)", "provider": "위 목록의 브랜드 키", "isRedTeam": false },',
      '  "rationale": "string(한국어 — 이 라인업이 왜 이 질문에 적합한지)",',
      '  "searchNeeded": false,',
      '  "questionType": "binary" 또는 "openEnded"',
      '}',
      `provider 값은 반드시 위 ${n}개 브랜드 목록의 키 중 하나여야 하며, 모든 브랜드가 정확히 한 번씩 등장해야 합니다.`,
    ].join('\n')
  }

  // ── Default: original 3–5 analytic-role convening (DEEP pipeline) ────────────
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
    '    대립 구도(매우 중요): 이 심의의 목적은 미리 정해진 결론을 추인하는 것이 아니라, 안건에 대한 가장 강력한 찬성 논거와 가장 강력한 반대 논거가 정면으로 충돌하게 하여 의장이 진실에 가장 가까운 최적의 답을 찾도록 돕는 것입니다. 어느 한쪽으로 기울어진 라인업을 짜지 마세요.',
    '    - 최소 1개 역할은 "가장 강력한 반대 논거"를 제시하는 좌석입니다(isRedTeam:true). 임무: 숨은 비용·실패 시나리오·통념의 허점을 근거와 전문성으로 가장 날카롭게 공격한다(트집이 아니라 최강의 반론). 가급적 xai 또는 anthropic에 배정하세요.',
    '    - 최소 1개 역할은 "가장 강력한 찬성 논거"를 제시하는 좌석입니다(isRedTeam:false). 임무: 형식적 찬성이 아니라, 데이터·전문성으로 무장하여 이 제안이 옳을 수 있는 가장 엄밀하고 설득력 있는 근거를 끝까지 밀어붙인다. roleLabel과 mandate에 이 "찬성 측 최강 논거" 임무를 분명히 적으세요. 강한 추론에 능한 브랜드(anthropic, openai 등)에 배정하세요.',
    '    - 두 좌석은 서로 다른 좌석이며 합치지 마세요. 둘 다 응원·비방이 아니라 근거·전문성으로만 논증합니다.',
    '    - 나머지 기능·분석 역할(계통·재정·관광 등)은 진정으로 중립을 유지하세요. 이들은 사실과 영향을 평가할 뿐, 미리 찬/반 어느 한쪽을 골라서는 안 됩니다. 분석가 좌석을 회의론 쪽으로 기울이지 마세요.',
    '    - roleLabel 표기 규칙(공무원이 즉시 이해하는 행정 한국어, 매우 중요): "스틸맨" 같은 업계 은어·외래어·영어 표기를 절대 쓰지 마세요. 입장(stance)과 영역(domain)을 분리하고, 영역은 괄호로 붙이세요. 예) 반대 좌석 → "리스크·반대 논거 검토 (에너지·환경 관점)", 찬성 좌석 → "정책 추진 옹호 (찬성 측 최강 논거, 재정 관점)". 두 의무 좌석의 라벨은 각각 "가장 강력한 찬성"과 "가장 강력한 반대"로 읽혀야 합니다.',
    '    - Perplexity 좌석 제한(매우 중요): perplexity는 검색·언론/여론 모니터링 전용입니다. 토론·수렴 라운드에 참여하는 좌석(분석가·반대 논거·찬성 논거 등 추론·논쟁 좌석)에는 perplexity를 절대 배정하지 마세요 — perplexity는 검색·검색엔진형 모델이라 토론에서 논거를 진전시키지 못하고 같은 말을 되풀이하는 경향이 있습니다. 토론에 참여하는 좌석은 오직 추론 브랜드(anthropic, openai, google, xai, deepseek, mistral, solar, exaone) 중에서만 배정하세요. perplexity는 (c)의 실시간 검색 역할과 (e)의 언론 분석가 역할에만 쓰십시오.',
    '    - 브랜드 다양성(가능한 한): 토론에 참여하는 좌석에는 가급적 서로 다른 브랜드를 배정하고, 8개 추론 브랜드(anthropic, openai, google, xai, deepseek, mistral, solar, exaone)를 고루 활용해 토론에 여러 AI가 눈에 띄게 참여하도록 하세요(매번 같은 5개만 반복 금지). 단, 브랜드를 더 넣으려고 불필요한 역할을 지어내지 마세요 — 역할 수는 질문이 요구하는 3~5개로만 정하고, 다양성은 어디까지나 브랜드 배정의 동점 처리 기준일 뿐 패널을 늘리는 이유가 될 수 없습니다.',
    '(c) searchNeeded: 이 질문이 우리 내부 데이터를 넘어서는 최신 외부 정보를 필요로 하면 true.',
    '    true인 경우 perplexity를 맡는 실시간 검색 역할을 반드시 포함하세요.',
    '(d) questionType: 이 질문의 유형을 분류하세요.',
    '    - "binary": 공무원이 찬성/반대로 답할 수 있는 명확한 정책 명제 (예: "X를 도입해야 하는가?").',
    '    - "openEnded": 단일 찬반으로 답할 수 없는 탐색적·개방형 질문 (예: "잉여 전기를 어떻게 활용해야 하는가?").',
    '    애매하면 반드시 "openEnded"로 분류하세요.',
    '(e) 언론 분석가(press analyst) 역할: 공공정책·여론 민감 사안이면 언론 분석가를 기본적으로 소집한다. 단순 사실조회는 제외.',
    '    - 기본 소집 대상: 예산·산업·에너지·관광 정책, 규제·입법, 사회적 파급·여론 민감성이 있는 안건, 산업 다각화·구조 전환 등 도민·시민에게 영향을 주는 공공 정책 질문. questionType이 "binary"이거나 openEnded라도 정책·쟁점화 성격이면 3~5개 역할 중 하나로 "언론 분석가"를 반드시 포함하세요.',
    '    - 제외 대상: 시세·날씨·단순 수치 조회 등 좁은 기술·데이터 질문, 사실 확인만 필요한 단순 lookup. 이런 경우에는 언론 분석가를 소집하지 마세요(과잉 소집 방지).',
    '    - 직무(mandate)에는 다음을 담으세요: 이 사안에 대한 언론 보도 논조와 반복 제기된 쟁점·우려를 분석한다. 정량 수치는 지어내지 말고 정성적으로만(논조·쟁점·우려) 다룬다. 가능하면 제주 지역 언론(제주일보·한라일보·제이누리 등)과 전국 언론을 함께 본다.',
    '    - 정직성(매우 중요): 이 역할은 언론 보도 논조를 분석할 뿐, 여론조사 수치가 아닙니다. 지지율 %, 찬성 N%, SNS 감성 점수 등 정량적 수치를 절대 지어내지 마십시오. 언론 보도는 오직 정성적으로(언론이 유사 사안을 어떻게 프레이밍했는지: 긍정/부정/중립 논조, 반복된 우려, 쟁점화 양상)만 추론합니다.',
    '    - provider는 실시간 언론 검색이 가능한 브랜드, 특히 perplexity를 강력히 권장합니다(실제 보도를 확인하는 것이 이 역할의 핵심). 이미 다른 검색 역할이 perplexity를 맡고 있어도, 이 역할에도 perplexity를 배정할 수 있습니다(하류의 검색 통합·중복 제거와 검색 횟수 상한이 알아서 정리합니다). 검색 횟수 상한을 늘리려 하지 마십시오.',
    '    - 이 역할은 레드팀 좌석과 별개입니다. 레드팀(isRedTeam:true)과 공존할 수 있으며, 둘을 하나로 합치지 마십시오. 언론 분석가는 isRedTeam:false 입니다.',
    '    - perplexity를 맡은 언론 분석가가 토론·수렴 라운드에 참여할 경우, 그 기여는 "언론 논조·쟁점·리스크 보고"에 한정하고 상대를 정조준해 논거로 이기려는 반박은 하지 않게 mandate에 명시하세요. 만약 이 좌석이 본격적으로 논쟁(반박·수렴)에 참여하길 기대한다면 perplexity 대신 추론 브랜드를 배정하십시오.',
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
    '  "searchNeeded": true 또는 false,',
    '  "questionType": "binary" 또는 "openEnded"',
    '}',
    'provider 값은 반드시 강점표의 키(openai, anthropic, google, xai, deepseek, mistral, solar, exaone, perplexity, meta) 중 하나여야 합니다.',
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
    questionType: 'openEnded',
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

  // JEJU-LOCAL providers ('solar'/'exaone') are legitimate seat brands here even
  // though they are absent from the shared MODEL_BY_PROVIDER-derived set.
  const coerced = !VALID_PROVIDERS.has(providerRaw) && !isJejuLocalProvider(providerRaw)
  const provider: JejuProvider = coerced ? 'openai' : (providerRaw as JejuProvider)

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
/**
 * Forces a 1:1 brand→role mapping for the debate seating (Mode B). The model is
 * asked for exactly one role per brand, but defends against drift: it returns
 * EXACTLY one role per brand in `brands` order — reusing the model's roles where
 * a brand matches, reassigning a leftover role's provider when a brand is
 * missing, and synthesizing a neutral analytic role only as a last resort. This
 * guarantees every SYNOD debater has a professional role.
 */
function reconcileDebateRoles(
  roles: JejuExpertRole[],
  brands: JejuProvider[]
): JejuExpertRole[] {
  const pool = [...roles]
  const out: JejuExpertRole[] = []
  for (const brand of brands) {
    let idx = pool.findIndex((r) => r.provider === brand)
    if (idx === -1) idx = pool.length > 0 ? 0 : -1
    if (idx >= 0) {
      const picked = pool.splice(idx, 1)[0]!
      out.push({ ...picked, provider: brand })
    } else {
      out.push({
        roleId: `analyst-${brand}`,
        roleLabel: '정책 분석',
        mandate:
          '안건의 사실관계와 영향을 중립적으로 평가하고 핵심 쟁점을 짚습니다. 결론을 내리기 전에 가장 강력한 찬성 근거와 가장 강력한 반대 근거를 모두 검토합니다.',
        provider: brand,
      })
    }
  }
  return out
}

/** Applies the 1:1 brand→role reconciliation to a plan when in debate mode. */
function reconcilePlan(
  plan: JejuMeetingPlan,
  debateBrands?: JejuProvider[]
): JejuMeetingPlan {
  if (!debateBrands || debateBrands.length === 0) return plan
  return { ...plan, roles: reconcileDebateRoles(plan.roles, debateBrands) }
}

/** Korean 6-role plans need more headroom than the default 3–5 lineup. */
const DEBATE_PLAN_MAX_TOKENS = 3000

export async function planJejuMeeting(params: {
  question: string
  availableDataSummary: string
  provider?: string
  /**
   * Mode B (찬반 심의): pin the convening to a 1:1 brand→role mapping, one
   * governance role per supplied debate brand. Omit for the default DEEP convening.
   */
  debateBrands?: JejuProvider[]
}): Promise<JejuMeetingPlan> {
  const question = params.question?.trim() ?? ''
  const orchestrator = resolveProvider(params.provider, DEFAULT_ORCHESTRATOR)
  const debateBrands =
    params.debateBrands && params.debateBrands.length > 0 ? params.debateBrands : undefined

  if (!question) {
    return {
      ok: false,
      question,
      roles: [],
      rationale: '',
      questionType: 'openEnded',
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
    r = await callJejuAi({
      provider: orchestrator,
      prompt: userPrompt,
      systemPrompt: buildOrchestratorSystemPrompt(debateBrands),
      maxCompletionTokens: debateBrands ? DEBATE_PLAN_MAX_TOKENS : PLAN_MAX_TOKENS,
    })
  } catch (e: unknown) {
    return {
      ok: false,
      question,
      roles: [],
      rationale: '',
      questionType: 'openEnded',
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
      questionType: 'openEnded',
      searchNeeded: false,
      error: r.error ?? '오케스트레이터가 빈 응답을 반환했습니다.',
    }
  }

  const raw = r.text

  let parsed: unknown
  try {
    parsed = JSON.parse(stripFences(raw))
  } catch {
    return reconcilePlan(fallbackPlan(question, raw, 'AI 응답 JSON 파싱 실패로 기본 라인업을 사용합니다.'), debateBrands)
  }

  if (!parsed || typeof parsed !== 'object') {
    return reconcilePlan(fallbackPlan(question, raw, 'AI 응답 형식이 올바르지 않아 기본 라인업을 사용합니다.'), debateBrands)
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
    return reconcilePlan(fallbackPlan(question, raw, 'AI가 유효한 역할을 제시하지 않아 기본 라인업을 사용합니다.'), debateBrands)
  }

  const rationaleBase = typeof obj.rationale === 'string' ? obj.rationale.trim() : ''
  const coercedNote = anyCoerced
    ? ' (참고: 일부 역할의 AI 브랜드가 유효하지 않아 openai로 대체되었습니다.)'
    : ''
  const rationale = (rationaleBase || '(라인업 설명 없음)') + coercedNote

  const searchNeeded = obj.searchNeeded === true

  // Accept ONLY the exact strings; anything else defaults to the safe 'openEnded'.
  const questionType: 'binary' | 'openEnded' =
    obj.questionType === 'binary' ? 'binary' : 'openEnded'

  return reconcilePlan(
    {
      ok: true,
      question,
      roles: normalized,
      rationale,
      questionType,
      searchNeeded,
      raw,
    },
    debateBrands
  )
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
  provider: JejuProvider
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
    KOREAN_ONLY_DIRECTIVE,
    TAG_DISCIPLINE_DIRECTIVE,
    CROSS_DOMAIN_DIRECTIVE,
    CASE_CITATION_DISCIPLINE,
    BANDWAGON_RESISTANCE,
    DATA_GAP_DISCIPLINE,
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
    r = await callJejuAi({
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
    questionType: 'openEnded',
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
    r = await callJejuAi({
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

/**
 * Today's date in KST as YYYY-MM-DD, for the search-recency anchor line.
 * Computed per-call, never at module load. Mirrors the equivalent private
 * helper already used in diagnostic.ts / mediawatch.ts.
 */
function todayKSTForSearch(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

/**
 * Perplexity search-specialist system prompt (concise Korean summary + sources).
 * Anchored to today's KST date + RECENCY_GUARD_DIRECTIVE so the search itself
 * dates/tags stale findings (e.g. off-season citrus prices from months ago)
 * instead of leaving that entirely to downstream consumers.
 */
function buildSearchSystemPrompt(): string {
  return [
    '당신은 제주도정 거버넌스 심의를 지원하는 검색 전문가입니다.',
    `오늘은 ${todayKSTForSearch()}(한국 표준시)입니다.`,
    '주어진 질의에 대해 최신·신뢰할 수 있는 외부 정보를 찾아 핵심만 간결하게(200~350자) 한국어로 요약하세요.',
    '출처가 있으면 함께 제시하세요. 추측하지 말고, 찾은 정보가 없으면 없다고 하세요.',
    '',
    RECENCY_GUARD_DIRECTIVE,
    '',
    '언어 규칙(절대 준수): 결과를 반드시 순수 한국어로 정리하라. 한자(漢字)·중국어·일본어 문자를 절대 사용하지 말 것. 단 영어 약어(MW, SMP, ESS, HVDC, V2G, kWh, % 등), 숫자, 단위는 허용.',
  ].join('\n')
}

/** Runs ONE Perplexity search. Never throws. */
async function runOneSearch(item: MergedSearch): Promise<JejuExecutedSearch> {
  const base = { query: item.query, requestedBy: item.requestedBy }
  let r
  try {
    r = await callJejuAi({
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
  provider: JejuProvider
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
    KOREAN_ONLY_DIRECTIVE,
    TAG_DISCIPLINE_DIRECTIVE,
    CROSS_DOMAIN_DIRECTIVE,
    CASE_CITATION_DISCIPLINE,
    BANDWAGON_RESISTANCE,
    DATA_GAP_DISCIPLINE,
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
    r = await callJejuAi({
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
  provider: JejuProvider
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
    KOREAN_ONLY_DIRECTIVE,
    TAG_DISCIPLINE_DIRECTIVE,
    CROSS_DOMAIN_DIRECTIVE,
    CASE_CITATION_DISCIPLINE,
    BANDWAGON_RESISTANCE,
    DATA_GAP_DISCIPLINE,
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
    r = await callJejuAi({
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
  provider: JejuProvider
  isRedTeam: boolean
  ok: boolean
  /** Their updated position THIS round. */
  position: string | null
  /** What they now accept from others (may be empty string). */
  concedes: string | null
  /** What they still contest, and why. */
  holds: string | null
  /** Mode B (찬반형) only — SYNOD ACTION tag carried through for vote transcripts. */
  actionTag?: 'AGREE' | 'CHALLENGE' | 'SUPPLEMENT' | 'REFRAME'
  /** Mode B (찬반형) only — SYNOD CLAIM line carried through for vote transcripts. */
  claim?: string
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
    '핵심 — 지목 반박(매우 중요): 이번 라운드에서 가장 중요하다고 보는 "단 한 명"의 다른 전문가를 고르세요. 그 사람의 이름(역할 라벨)을 명시하고, 그가 견지(hold)한 "구체적 문장 한 대목을 직접 인용"한 뒤, 바로 그 지점을 정면으로 반박하세요. 여러 명을 한꺼번에 상대하지 마십시오 — 한 라운드에 한 명만 정조준합니다. (예: "[관광경제 분석가]의 \'관광 수요가 가격에 둔감하다\'는 견지에 반대합니다 …")',
    '진전 의무(반복 금지): 직전 라운드에서 쓴 견지(hold) 문단을 그대로 되풀이하지 마십시오. 매 라운드는 반드시 움직여야 합니다 — 무언가를 양보하거나, 논거를 더 날카롭게 다듬거나, 새로운 구체적 반론을 제시하세요. 입장이 변하지 않았다면, 최소한 논증을 한 단계 더 진전시키거나 "어떤 새로운 근거가 제시되면 내 입장이 바뀌는지"를 분명히 밝히세요.',
    '논쟁은 구체적이고 직접적이어야 합니다(상대 전문가의 실제 주장에 밀착). 다만 인신공격은 금지하고, 행정 심의에 어울리는 정중하고 전문적인 어조를 유지하세요. 일반론적 재진술이 아니라, 근거로 획득한 구체적 이견이어야 합니다.',
    KOREAN_ONLY_DIRECTIVE,
    TAG_DISCIPLINE_DIRECTIVE,
    CROSS_DOMAIN_DIRECTIVE,
    CASE_CITATION_DISCIPLINE,
    BANDWAGON_RESISTANCE,
    DATA_GAP_DISCIPLINE,
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
    '{ "position": "이번 라운드 당신의 갱신된 입장 (150~300자)", "concedes": "이번에 받아들이는 점 (없으면 빈 문자열)", "holds": "지목 반박: 정조준한 단 한 명의 역할 라벨 + 그가 견지한 구체적 인용 한 대목 + 그에 대한 당신의 직접적 반박과 이유" }'
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
    r = await callJejuAi({
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
    r = await callJejuAi({
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

/**
 * Consensus at/above this score is treated as "high enough that there is little
 * left to adjudicate": the chair writes a SHORT verdict and NO vote is held.
 * Below it (on a binary question) the body votes. Numerically equal to
 * CONSENSUS_TARGET today, but a SEPARATE concern (voting/brief-mode gate, not the
 * deliberation stop target) — kept independent on purpose so the two can diverge.
 */
const CONSENSUS_VOTE_THRESHOLD = 85

/**
 * ADDITIVE (no behavior change): surfaces the module-private deliberation/vote
 * tuning constants so an EXTERNAL chunked orchestrator (e.g. a per-round polling
 * API route) can replicate runDeliberation's stop logic and the 2x2 vote rule
 * faithfully without duplicating magic numbers. Nothing here alters how the
 * engine runs in-process; it only re-exports the existing values.
 */
export const JEJU_DEEP_DELIBERATION_TUNING = {
  MIN_CONVERGENCE_ROUNDS,
  MAX_CONVERGENCE_ROUNDS,
  CONSENSUS_TARGET,
  STALL_DELTA,
  CONSENSUS_SCORE_UNAVAILABLE,
  CONSENSUS_VOTE_THRESHOLD,
} as const

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

// ════════════════════════════════════════════════════════════════════════════
// PIECE 4 — the CHAIR's final judgment (beat 4: the one-page verdict).
//
// The most important piece. The chair is a JUDGE, not a summarizer. It reads the
// WHOLE case file (collection → analyses → search → revisions → debate →
// convergence) and renders a responsible final ruling that officials will act on.
//
// ⚠️ The chair carries real responsibility:
//   • Strongest available model — provider 'anthropic' (Claude Opus 4.8, current
//     top model). Documented here so the choice is intentional, not incidental.
//   • It reads the FULL deliberation, not a digest.
//   • CONSENSUS-WEIGHTED: high consensus → confirm & sharpen; low consensus
//     (esp. < 70) → the chair must TAKE RESPONSIBILITY and rule like a court,
//     not hide behind "the experts disagreed". Lower consensus = heavier duty.
//   • It stays an ADVISOR — the disclaimer makes the human official the decider.
// ════════════════════════════════════════════════════════════════════════════

// A full one-pager verdict has SIX sections; the judgment alone can run long, so
// give generous headroom — too small truncates before the 마이너리티 리포트 (the
// dissent) is ever written, which is exactly the section officials must not lose.
// (Even so, a verbose judge can overflow, so renderChairVerdict ALSO reconstructs
// the 마이너리티 리포트 from the deliberation's contestedPoints as a fallback.)
const VERDICT_MAX_TOKENS = 6000

/** The default disclaimer appended when the chair omits its own 참고 사항 section. */
const DEFAULT_DISCLAIMER =
  '본 판단은 AI 다중 분석·토론에 기반한 보좌 의견입니다. 전적으로 신뢰하지 마시고 참고 자료로 활용하시되, 최종 정책 결정과 책임은 담당 공무원에게 있습니다.'

/**
 * The 마이너리티 리포트 instruction — demands the dissent be steelmanned, not
 * merely noted. Shared verbatim by the brief and full chair prompts so the bar
 * never drops when the short-circuit fires.
 */
const MINORITY_REPORT_INSTRUCTION =
  '이 절은 형식적으로 채우지 말고 실질적으로 쓰십시오. 반드시 (1) 어느 전문가(좌석)가 왜 이견을 냈는지 명시하고, (2) 그 반대 측이 제시한 가장 강력한 논거를 스틸맨(steelman)하여 공정하게 서술하며(무시·폄하 금지), (3) 어떤 근거·조건이 확인되면 다수 판단이 바뀔 수 있는지 적으십시오. 최소 3~4문장 이상으로 쓰십시오. 합의도가 높거나 표결이 거의 일치했더라도 "이견 없음"으로 비우지 마십시오 — 토론 중 조금이라도 갈린 지점이 있었다면 위 (1)~(3)에 따라 반드시 서술하십시오. 진정으로 아무 이견도 없었을 때만 그렇다고 짧게 밝히되, 이를 작업을 피하기 위한 손쉬운 도피처로 쓰지 마십시오. 제목은 그대로 두고 내용은 한국어로 쓰십시오.'

/** The chair's final, structured verdict — the deliverable officials read. */
export type JejuVerdict = {
  ok: boolean
  /** 3-line summary of the KEY CONTESTED AXES, shown ABOVE the verdict so a reader grasps the debate at a glance. */
  keyIssues: string | null
  /** The chair's final ruling + reasoning (the heart). */
  judgment: string | null
  /** Brief: what data was collected (beat 1). */
  beat1Summary: string | null
  /** Brief: what the experts analyzed + searched (beat 2). */
  beat2Summary: string | null
  /** Proper summary: how the debate/convergence went (beat 3). */
  beat3Summary: string | null
  /** The honestly-preserved dissent (English label, Korean content). */
  minorityReport: string | null
  /** Qualitative press/media reception risk — set ONLY when the case file contains media analysis; otherwise null. */
  mediaRisk: string | null
  /** Carried from the deliberation. */
  consensusScore: number
  /** The "참고용, 최종판단은 사람" note. */
  disclaimer: string
  provider: string
  error?: string
}

/**
 * Builds the chair (judge) system prompt; instruction weight scales with (low)
 * consensus. When `brief` is true (high-consensus short-circuit) the chair writes
 * a concise result — a short 최종 판단, a short 토론·합의 과정 note, the
 * 마이너리티 리포트 (still REQUIRED), and 참고 사항 — skipping the long
 * beat1/beat2 data/analysis summaries.
 *
 * When `hasVote` is true, a ballot is being shown to the chair as ADVISORY
 * context; an extra instruction tells the chair it is not bound by the vote and
 * must justify any departure from it. The chair stays the decider — influence is
 * via the prompt only.
 */
function buildChairSystemPrompt(consensusScore: number, brief = false, hasVote = false): string {
  const lines = [
    '당신은 제주도정 거버넌스 심의의 최종 의장(chair)이자 판결자입니다.',
    '당신은 단순 요약가가 아니라, 법원의 재판관에 가까운 역할입니다. 수집된 데이터, 전문가들의 분석과 조사, 그리고 여러 라운드의 토론·합의 과정을 모두 읽고, 가장 최적이며 확실한 최종 판단을 책임지고 내려야 합니다. 당신의 판단에 따라 공무원이 실제로 정책을 집행합니다.',
  ]

  // Consensus-weighted responsibility: the lower the score, the heavier the duty.
  if (consensusScore >= CONSENSUS_TARGET) {
    lines.push(
      `전문가들의 합의도는 ${consensusScore}점으로 높습니다. 전문가들이 대체로 합의했으므로, 그 합의를 확정하고 날카롭게 다듬으십시오.`
    )
  } else if (consensusScore < 70 && consensusScore >= 0) {
    lines.push(
      `전문가들이 완전히 합의하지 못했습니다(합의도 ${consensusScore}점, 70점 미만). 바로 이럴 때 당신의 판단이 가장 중요합니다. "전문가들이 갈렸다"로 회피하는 것은 직무 유기입니다. 흩어진 근거들을 저울질하여, 당신이 방어할 수 있는 가장 타당하고 확실한 단일 결론을 책임지고 판결하십시오. 모호한 양비론이 아니라, 공무원이 곧바로 집행할 수 있는 분명한 방향을 제시해야 합니다.`
    )
  } else {
    lines.push(
      `전문가들이 완전히 합의하지 못했습니다(합의도 ${consensusScore === CONSENSUS_SCORE_UNAVAILABLE ? '측정 불가' : consensusScore + '점'}). 바로 이럴 때 당신의 판단이 가장 중요합니다. "전문가들이 갈렸다"로 회피하지 말고, 근거를 들어 가장 타당한 결론을 책임지고 판결하십시오.`
    )
  }

  // Advisory vote: shown only when a ballot accompanies this verdict. The chair is
  // told the vote is non-binding and must justify any departure from it.
  if (hasVote) {
    lines.push(
      '',
      '이 안건에는 심의체 전원의 표결 결과가 참고 자료로 함께 제공됩니다. 다음을 명심하십시오.',
      '표결 결과는 참고 자료일 뿐, 절대적 구속력이 없습니다.',
      '당신은 재판관입니다. 다수결을 맹종하지 마십시오. 표결과 다른 판단을 내릴 수 있으며, 그럴 경우 반드시 그 이유를 "## 최종 판단"에 분명히 밝히십시오.',
      '표결이 찬성 다수라 해서 무비판적으로 추인하지 마십시오. 반대·기권에 담긴 근거(특히 마이너리티 리포트와 합의도)를 함께 저울질하여 판단하십시오.'
    )
  }

  if (brief) {
    // High-consensus short-circuit: concise output, but the minority report is
    // STILL required and must never be dropped.
    lines.push(
      '',
      '전문가 합의도가 높아 길게 판결할 필요가 없습니다. 아래 구조를 정확히 따르되 간결하게 작성하십시오. 각 절은 반드시 "## " 머리말로 시작하세요. 수집 데이터 요약과 전문가 분석·조사 요약 절은 생략합니다.',
      '중요: 분량을 줄이더라도 "## 마이너리티 리포트"는 절대 생략하지 마십시오. 합의도가 높아도 끝까지 남은 소수·반대 의견은 반드시 보존해야 합니다.',
      '',
      '## 핵심 쟁점 (3줄 요약)',
      '출력을 반드시 이 절로 시작하십시오. 서론·머리말 없이, 이 심의에서 전문가들의 의견이 갈린 핵심 축을 정확히 3줄(각 줄 "- "로 시작하는 한 문장)로 요약하십시오. 일반적 요약이 아니라 실제로 대립한 쟁점만 쓰십시오. 예: 총량 억제 vs 미시규제, 시행 속도 vs 리스크 신중론, 단기 효과 vs 장기 부담. 3줄을 넘기지 마십시오.',
      '',
      '## 최종 판단',
      '당신의 결론(판결)과 핵심 이유를 간결하게. 합의를 확정하고 날카롭게 다듬되, 공무원이 집행할 수 있는 분명한 방향으로 쓰십시오.',
      '',
      '## 토론·합의 과정',
      '토론이 어떻게 수렴했는지 짧게(합의 점수와 안착 지점 위주).',
      '',
      '## 마이너리티 리포트',
      MINORITY_REPORT_INSTRUCTION,
      '',
      '## 참고 사항',
      DEFAULT_DISCLAIMER,
      '',
      CROSS_DOMAIN_DIRECTIVE,
      '',
      CASE_CITATION_DISCIPLINE,
      '',
      BANDWAGON_RESISTANCE,
      '',
      DATA_GAP_DISCIPLINE,
      '',
      '데이터 정직성: 반드시 제공된 심의 자료에 근거하십시오. 자료에 없는 새로운 사실을 지어내지 마십시오. 당신은 보좌역이며 최종 결정자가 아닙니다.'
    )
    return lines.join('\n')
  }

  lines.push(
    '',
    '아래 구조를 정확히 따르되, 각 절은 한국어 산문으로 작성하십시오. 각 절은 반드시 "## " 머리말로 시작하세요.',
    '분량 배분(중요): "## 최종 판단"에 가장 큰 비중을 두되, 요약 절(수집 데이터/전문가 분석·조사/토론·합의 과정)은 각각 핵심만 간결하게 쓰고, 반드시 마지막 "## 마이너리티 리포트"와 "## 참고 사항"까지 빠짐없이 작성하십시오. 중간에서 분량이 소진되어 소수의견이 누락되는 일이 없도록 하십시오.',
    '',
    '## 핵심 쟁점 (3줄 요약)',
    '출력을 반드시 이 절로 시작하십시오. 서론·머리말 없이, 이 심의에서 전문가들의 의견이 갈린 핵심 축을 정확히 3줄(각 줄 "- "로 시작하는 한 문장)로 요약하십시오. 일반적 요약이 아니라 실제로 대립한 쟁점만 쓰십시오. 예: 총량 억제 vs 미시규제, 시행 속도 vs 리스크 신중론, 단기 효과 vs 장기 부담. 3줄을 넘기지 마십시오.',
    '',
    '## 최종 판단',
    '당신의 결론(판결)과 그 이유. 이 심의의 가장 중요한 부분입니다. 결단력 있고 방어 가능하게, 공무원이 집행할 수 있는 분명한 방향으로 쓰십시오.',
    '',
    '## 수집 데이터 요약',
    '이 판단의 근거가 된 데이터를 간결하게(beat 1).',
    '',
    '## 전문가 분석·조사 요약',
    '전문가들이 무엇을 검토했고 외부 조사가 무엇을 더했는지 간결하게(beat 2).',
    '',
    '## 토론·합의 과정',
    '토론이 어떻게 수렴했는지에 대한 제대로 된 요약(beat 3). 합의 점수, 어디에 안착했고 왜 그랬는지 설명하십시오.',
    '',
    '## 언론 리스크',
    '심의 자료에 언론 분석이 포함된 경우에만 이 절을 작성하라. 이 정책을 발표·집행할 때 예상되는 언론 보도 논조와 반복될 가능성이 있는 쟁점·우려, 그리고 그로 인한 평판·소통 리스크를 정성적으로 서술하라. 정량 수치(지지율 등)를 지어내지 말 것. 심의 자료에 언론 분석이 전혀 없으면 이 절 자체를 생략하라(없는 반응을 지어내지 말 것).',
    '',
    '## 마이너리티 리포트',
    MINORITY_REPORT_INSTRUCTION,
    '',
    '## 참고 사항',
    DEFAULT_DISCLAIMER,
    '',
    CROSS_DOMAIN_DIRECTIVE,
    '',
    CASE_CITATION_DISCIPLINE,
    '',
    BANDWAGON_RESISTANCE,
    '',
    DATA_GAP_DISCIPLINE,
    '',
    '데이터 정직성: 반드시 제공된 심의 자료에 근거하십시오. 자료에 없는 새로운 사실을 지어내지 마십시오. 데이터 부재로 해소되지 못한 쟁점은 그렇다고 솔직히 밝히십시오. 당신은 보좌역이며 최종 결정자가 아닙니다.'
  )

  return lines.join('\n')
}

/** Renders the per-round deliberation transcript into a Korean block for the chair. */
function formatDeliberationForChair(deliberation: JejuDeliberation): string {
  const blocks: string[] = []
  for (const round of deliberation.rounds) {
    const scoreLabel =
      round.consensusScore === CONSENSUS_SCORE_UNAVAILABLE ? '측정 불가' : `${round.consensusScore}점`
    const turnLines = round.turns
      .filter((t) => t.ok && t.position && t.position.trim() !== '')
      .map((t) => {
        const tag = t.isRedTeam ? ' [레드팀]' : ''
        const parts = [`- [${t.roleLabel}]${tag} 입장: ${t.position!.trim()}`]
        if (t.concedes && t.concedes.trim() !== '') parts.push(`  수용: ${t.concedes.trim()}`)
        if (t.holds && t.holds.trim() !== '') parts.push(`  견지: ${t.holds.trim()}`)
        return parts.join('\n')
      })
    blocks.push(
      [`### 라운드 ${round.roundNumber} (합의도 ${scoreLabel})`, ...turnLines].join('\n')
    )
  }

  const tail = [
    '### 최종 수렴 상태',
    `합의 점수: ${deliberation.finalScore === CONSENSUS_SCORE_UNAVAILABLE ? '측정 불가' : deliberation.finalScore + '점'} (${deliberation.roundsRun}개 라운드, 종료사유: ${deliberation.stoppedReason})`,
    deliberation.agreedPoints.length > 0
      ? `합의된 지점:\n${deliberation.agreedPoints.map((p) => `  • ${p}`).join('\n')}`
      : '합의된 지점: (없음)',
    deliberation.contestedPoints.length > 0
      ? `잔존 쟁점:\n${deliberation.contestedPoints.map((p) => `  • ${p}`).join('\n')}`
      : '잔존 쟁점: (없음)',
    deliberation.summary ? `최종 요약: ${deliberation.summary}` : '',
  ]
    .filter((s) => s !== '')
    .join('\n')

  return [...blocks, tail].join('\n\n')
}

/** Korean label for a ballot choice, used when showing the vote to the chair. */
function voteChoiceLabel(choice: JejuVoteChoice): string {
  return choice === 'approve'
    ? '찬성'
    : choice === 'conditional'
      ? '조건부 찬성'
      : choice === 'oppose'
        ? '반대'
        : '기권'
}

/**
 * Renders the motion ballot into a Korean block for the chair (advisory context):
 * the tally line plus each cast ballot's brand label, choice, and short reason.
 * Only ok, choice-bearing votes are listed.
 */
function formatVoteForChair(vote: JejuVoteResult): string {
  const lines = [vote.summary]
  for (const v of vote.votes) {
    if (!v.ok || v.choice == null) continue
    const label = JEJU_VOTE_BRAND_LABEL[v.provider]
    const reason = v.reason && v.reason.trim() !== '' ? ` — ${v.reason.trim()}` : ''
    lines.push(`- ${label}: ${voteChoiceLabel(v.choice)}${reason}`)
  }
  return lines.join('\n')
}

/** Renders revised analyses + their first-pass into a Korean block for the chair. */
function formatAnalysesForChair(revised: JejuRevisedAnalysis[]): string {
  const usable = revised.filter((r) => r.ok && r.revised && r.revised.trim() !== '')
  if (usable.length === 0) return '(유효한 전문가 분석 없음)'
  return usable
    .map((r) => {
      const tag = r.isRedTeam ? ' [레드팀]' : ''
      return `[${r.roleLabel}]${tag} (${r.provider})\n${r.revised!.trim()}`
    })
    .join('\n\n')
}

/** Renders executed searches into a Korean block for the chair. */
function formatSearchesForChair(searches: JejuExecutedSearch[]): string {
  const usable = searches.filter((s) => s.ok && s.result && s.result.trim() !== '')
  if (usable.length === 0) return '(외부 조사 결과 없음)'
  return usable.map((s, i) => `[조사${i + 1}] ${s.query}\n${s.result!.trim()}`).join('\n\n')
}

/** Renders the debate rebuttals into a Korean block for the chair. */
function formatRebuttalsForChair(rebuttals: JejuRebuttal[]): string {
  const usable = rebuttals.filter((d) => d.ok && d.rebuttal && d.rebuttal.trim() !== '')
  if (usable.length === 0) return '(반박 없음)'
  return usable
    .map((d) => {
      const tag = d.isRedTeam ? ' [레드팀]' : ''
      const targets = d.targetRoleLabels.length > 0 ? d.targetRoleLabels.join(', ') : '(대상 미지정)'
      return `[${d.roleLabel}]${tag} → ${targets}\n${d.rebuttal!.trim()}`
    })
    .join('\n\n')
}

/** Maps a section heading to its JejuVerdict field. Returns null for unknown headings. */
function chairSectionField(
  heading: string
):
  | 'keyIssues'
  | 'judgment'
  | 'beat1Summary'
  | 'beat2Summary'
  | 'beat3Summary'
  | 'mediaRisk'
  | 'minorityReport'
  | 'disclaimer'
  | null {
  const h = heading.trim().toLowerCase()
  if (h.includes('핵심 쟁점') || h.includes('핵심쟁점')) return 'keyIssues'
  if (h.includes('최종 판단') || h.includes('최종판단')) return 'judgment'
  if (h.includes('수집 데이터') || h.includes('수집데이터')) return 'beat1Summary'
  if (h.includes('전문가 분석') || h.includes('분석·조사') || h.includes('분석/조사')) return 'beat2Summary'
  // Check 언론 리스크 BEFORE the 토론/합의 matcher so it never gets swallowed.
  if (h.includes('언론 리스크') || h.includes('언론리스크')) return 'mediaRisk'
  if (h.includes('토론') || h.includes('합의 과정') || h.includes('합의과정')) return 'beat3Summary'
  if (h.includes('minority') || h.includes('마이너리티')) return 'minorityReport'
  if (h.includes('참고')) return 'disclaimer'
  return null
}

/**
 * Splits the chair's "## "-delimited prose into the labeled sections. Robust: an
 * unrecognized heading is ignored; if NOTHING maps, the caller falls back to
 * putting the whole text in `judgment` (output is never lost).
 */
function parseChairOutput(text: string): {
  keyIssues: string | null
  judgment: string | null
  beat1Summary: string | null
  beat2Summary: string | null
  beat3Summary: string | null
  mediaRisk: string | null
  minorityReport: string | null
  disclaimer: string | null
  matchedAny: boolean
} {
  const result = {
    keyIssues: null as string | null,
    judgment: null as string | null,
    beat1Summary: null as string | null,
    beat2Summary: null as string | null,
    beat3Summary: null as string | null,
    mediaRisk: null as string | null,
    minorityReport: null as string | null,
    disclaimer: null as string | null,
    matchedAny: false,
  }

  // Split on lines beginning with "## " (section headings).
  const parts = text.split(/^\s*##\s+/m)
  for (const part of parts) {
    if (part.trim() === '') continue
    const nl = part.indexOf('\n')
    if (nl === -1) continue // heading with no body
    const heading = part.slice(0, nl)
    const body = part.slice(nl + 1).trim()
    const field = chairSectionField(heading)
    if (!field || body === '') continue
    result[field] = body
    result.matchedAny = true
  }

  return result
}

/**
 * Reconstructs a 마이너리티 리포트 from the deliberation's surviving contestedPoints.
 * Used when the chair omits or truncates the section — the unresolved dissent must
 * never be lost. Returns null only when there is genuinely no residual dissent.
 */
function fallbackMinorityReport(deliberation: JejuDeliberation): string | null {
  if (deliberation.contestedPoints.length === 0) return null
  return [
    '(토론 기록에서 자동 보존된 잔존 쟁점 — 의장 판결문에 명시되지 않아 합의 미도달 항목을 복원함)',
    '',
    '다음 쟁점들은 다수 라운드의 토론 종료 시점까지 합의에 이르지 못한 채 남았습니다:',
    ...deliberation.contestedPoints.map((p) => `• ${p}`),
  ].join('\n')
}

/**
 * PIECE 4 — the chair reads the WHOLE case file and renders the final verdict.
 *
 * Feeds the strongest model (anthropic / Claude Opus) the question, the collected
 * data (via buildBriefingContext), the revised role analyses, the searched-in
 * facts, the debate rebuttals, and the full per-round deliberation transcript +
 * final convergence state. The system prompt scales the chair's responsibility to
 * the (in)completeness of consensus. The prose output is split into labeled
 * sections; if splitting finds nothing, the whole text is kept as `judgment`
 * (output is never lost). Never throws.
 */
export async function renderChairVerdict(params: {
  question: string
  snapshot: JejuSnapshot
  analyses: JejuRoleAnalysis[]
  searches: JejuExecutedSearch[]
  revised: JejuRevisedAnalysis[]
  rebuttals: JejuRebuttal[]
  deliberation: JejuDeliberation
  /** High-consensus short-circuit: render a concise verdict (minority report still kept). */
  brief?: boolean
  /** A motion ballot to show the chair as ADVISORY context (non-binding). */
  vote?: JejuVoteResult
  /**
   * User-submitted reference material (첨부·추가 자료). Rendered into the case
   * file with its provenance fence so the chair weighs the same material the
   * debaters saw. Omitted ⇒ case file unchanged (orphan deep route stays a no-op).
   */
  supplements?: JejuSupplement[]
}): Promise<JejuVerdict> {
  const { question, snapshot, searches, revised, rebuttals, deliberation, vote } = params
  const brief = params.brief === true
  const consensusScore = deliberation.finalScore

  // Single source of truth: the chair is shown the ballot AND told it's advisory
  // only when there's a real, parseable vote with at least one cast ballot. This
  // keeps the context block and the system-prompt instruction in lockstep.
  const hasVote =
    vote != null &&
    vote.ok &&
    vote.approveCount + vote.conditionalCount + vote.opposeCount + vote.abstainCount > 0

  const base = {
    consensusScore,
    disclaimer: DEFAULT_DISCLAIMER,
    provider: 'anthropic',
  }

  const contextParts = [
    '# 심의 안건',
    question,
    '',
    '# 1. 수집 데이터 (beat 1)',
    buildBriefingContext(snapshot),
    '',
    '# 2. 전문가 분석 (조사 반영 후 갱신본, beat 2)',
    formatAnalysesForChair(revised),
    '',
    '# 2.5 외부 조사 결과 (beat 2.5)',
    formatSearchesForChair(searches),
    '',
    '# 3. 토론 — 반박 (beat 3)',
    formatRebuttalsForChair(rebuttals),
    '',
    '# 3.5 토론 — 다중 라운드 수렴 (beat 3.5/3.6)',
    formatDeliberationForChair(deliberation),
  ]

  // Advisory ballot block — placed AFTER the deliberation, BEFORE the task. Only
  // when a real vote happened (see hasVote); otherwise nothing is appended.
  if (hasVote) {
    contextParts.push('', '# 표결 결과 (참고용)', formatVoteForChair(vote!))
  }

  // User-submitted material, provenance-fenced identically to the debaters' copy.
  // Nothing is appended when the caller passed no supplements.
  const supplementBlock = buildJejuSupplementBlock(params.supplements).trim()
  if (supplementBlock) {
    contextParts.push('', supplementBlock)
  }

  contextParts.push(
    '',
    '# 당신의 임무',
    '위 전체 심의 자료(case file)를 모두 읽고, 의장으로서 최종 판단을 구조에 맞춰 작성하십시오.'
  )

  const contextBlock = contextParts.join('\n')

  let r
  try {
    r = await callJejuAi({
      provider: 'anthropic',
      prompt: contextBlock,
      systemPrompt: buildChairSystemPrompt(consensusScore, brief, hasVote),
      maxCompletionTokens: VERDICT_MAX_TOKENS,
      modelOverride: 'claude-opus-4-8',
    })
  } catch (e: unknown) {
    return {
      ...base,
      ok: false,
      keyIssues: null,
      judgment: null,
      beat1Summary: null,
      beat2Summary: null,
      beat3Summary: null,
      mediaRisk: null,
      minorityReport: null,
      error: `의장 판결 호출 실패: ${e instanceof Error ? e.message : 'unknown error'}`,
    }
  }

  if (r.error || !r.text) {
    return {
      ...base,
      ok: false,
      keyIssues: null,
      judgment: null,
      beat1Summary: null,
      beat2Summary: null,
      beat3Summary: null,
      mediaRisk: null,
      minorityReport: null,
      error: r.error ?? '의장이 빈 판결을 반환했습니다.',
    }
  }

  const parsed = parseChairOutput(r.text)

  // If section-splitting found nothing, never lose the output — keep it whole.
  // Still reconstruct the 마이너리티 리포트 from the deliberation so dissent survives.
  if (!parsed.matchedAny) {
    return {
      ...base,
      ok: true,
      keyIssues: null,
      judgment: r.text.trim(),
      beat1Summary: null,
      beat2Summary: null,
      beat3Summary: null,
      mediaRisk: null,
      minorityReport: fallbackMinorityReport(deliberation),
    }
  }

  // The chair sometimes truncates before (or skips) the 마이너리티 리포트; if so,
  // rebuild it from the surviving contestedPoints so officials never lose dissent.
  const minorityReport =
    parsed.minorityReport && parsed.minorityReport.trim() !== ''
      ? parsed.minorityReport
      : fallbackMinorityReport(deliberation)

  return {
    ...base,
    ok: true,
    // Optional: null when absent (brief mode, or chair omitted it). No reconstruction.
    keyIssues: parsed.keyIssues,
    judgment: parsed.judgment,
    beat1Summary: parsed.beat1Summary,
    beat2Summary: parsed.beat2Summary,
    beat3Summary: parsed.beat3Summary,
    mediaRisk: parsed.mediaRisk,
    minorityReport,
    // Prefer the chair's own 참고 사항 if present; otherwise the default.
    disclaimer: parsed.disclaimer ?? DEFAULT_DISCLAIMER,
  }
}

/** The complete 4-beat DEEP result: deliberation + the chair's final verdict. */
export type JejuDeepComplete = JejuDeepThroughDeliberation & {
  /** The chair's final one-page verdict — the deliverable. */
  verdict: JejuVerdict
}

/**
 * Beats 1–4 COMPLETE — the full DEEP pipeline end to end:
 *   runJejuDeepThroughDeliberation → renderChairVerdict.
 *
 * The verdict is the deliverable, so ok mirrors the verdict's ok. The chair still
 * renders even on partial upstream data (it judges what exists). Never throws;
 * partial data on error.
 */
export async function runJejuDeepComplete(params?: {
  question?: string
  orchestratorProvider?: string
  maxRounds?: number
}): Promise<JejuDeepComplete> {
  const deliberationStage = await runJejuDeepThroughDeliberation(params)

  const emptyVerdict: JejuVerdict = {
    ok: false,
    keyIssues: null,
    judgment: null,
    beat1Summary: null,
    beat2Summary: null,
    beat3Summary: null,
    mediaRisk: null,
    minorityReport: null,
    consensusScore: deliberationStage.deliberation.finalScore,
    disclaimer: DEFAULT_DISCLAIMER,
    provider: 'anthropic',
    error: '상위 단계가 유효하지 않아 의장 판결을 건너뜁니다.',
  }

  // Nothing usable upstream → no verdict (officials get the honest failure).
  if (!deliberationStage.ok) {
    return { ...deliberationStage, ok: false, verdict: emptyVerdict }
  }

  try {
    const verdict = await renderChairVerdict({
      question: deliberationStage.question,
      snapshot: deliberationStage.snapshot,
      analyses: deliberationStage.analyses,
      searches: deliberationStage.searches,
      revised: deliberationStage.revised,
      rebuttals: deliberationStage.debate,
      deliberation: deliberationStage.deliberation,
    })
    return { ...deliberationStage, ok: verdict.ok, verdict }
  } catch (e: unknown) {
    return {
      ...deliberationStage,
      ok: false,
      verdict: {
        ...emptyVerdict,
        error: `의장 판결 실패(이전 결과는 유효): ${e instanceof Error ? e.message : 'unknown error'}`,
      },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PIECE 5 — the democratic final ballot.
//
// After the chair renders its verdict (piece 4), the WHOLE deliberation body
// votes on whether to endorse that ruling for the province to act on. This is a
// POLICY vote on a concrete proposition (the chair's 최종 판단), not an
// "which AI did best" evaluation — and it can only happen once a ruling exists.
//
// Differences from the existing (binary) Panel Vote module, by design:
//   - JEJU-specific and isolated (does NOT import or reuse lib/verdict-vote).
//   - Options are 찬성 / 반대 / 기권 (approve / oppose / ABSTAIN). Abstain is
//     essential for governance honesty: a provider whose domain is distant, or
//     who finds the evidence insufficient, abstains rather than guessing.
//   - ALL 8 providers vote — the full panel, regardless of who was convened for
//     the debate. The debate used the dynamically-convened roles; the closing
//     ballot is the whole body's.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The full panel that casts the closing ballot — every provider, not just the
 * convened debate roles. This is the whole body's final vote.
 */
/**
 * RECOVERABLE FLAG — mirrors ENABLE_META in lib/jeju/synod-debate.ts. Llama
 * (meta) is disabled (persistent non-Korean leakage). Flip to `true` to re-add
 * it as a voter; the 'meta' entry below + its brand label are kept for that.
 * Keep this in sync with synod-debate.ts's ENABLE_META.
 */
const ENABLE_META = false

const JEJU_VOTE_PANEL: JejuProvider[] = [
  'anthropic',
  'openai',
  'google',
  'xai',
  'deepseek',
  'mistral',
  'solar',
  'exaone',
  'perplexity',
  ...(ENABLE_META ? (['meta'] as JejuProvider[]) : []),
]

/**
 * Brand labels for the vote panel. Kept local (small map) so lib/jeju stays
 * self-contained and portable — we do NOT reach into SYNOD or other modules.
 */
const JEJU_VOTE_BRAND_LABEL: Record<JejuProvider, string> = {
  anthropic: 'Claude',
  openai: 'ChatGPT',
  google: 'Gemini',
  xai: 'Grok',
  deepseek: 'DeepSeek',
  mistral: 'Mistral',
  solar: 'Upstage (솔라)',
  exaone: 'LG (엑사원)',
  perplexity: 'Perplexity',
  meta: 'Llama',
}

/** A single provider's ballot choice on the chair's ruling. */
export type JejuVoteChoice = 'approve' | 'conditional' | 'oppose' | 'abstain'

/** One provider's vote on the chair's verdict. */
export type JejuVote = {
  provider: JejuProvider
  ok: boolean
  choice: JejuVoteChoice | null
  /** 1–2 sentence Korean reason. */
  reason: string | null
  error?: string
}

/** The tallied result of the closing ballot. */
export type JejuVoteResult = {
  votes: JejuVote[]
  approveCount: number
  /** 조건부 찬성 — directional agreement WITH conditions. Counted separately, never merged into approve/abstain. */
  conditionalCount: number
  opposeCount: number
  abstainCount: number
  /** Brand labels, e.g. ['Claude', 'ChatGPT']. */
  approveProviders: string[]
  conditionalProviders: string[]
  opposeProviders: string[]
  abstainProviders: string[]
  /**
   * approved if (approve+conditional)>oppose; rejected if oppose>(approve+conditional);
   * divided if equal. 조건부 찬성 counts on the yes side; abstains never tip it.
   */
  outcome: 'approved' | 'rejected' | 'divided'
  /**
   * Korean display label parallel to `outcome` (does not overload the enum):
   * 가결 / 조건부 가결 / 부결 / 의견 분분.
   */
  outcomeLabel: string
  ok: boolean
  /** Korean one-liner, e.g. '찬성 4 · 조건부 찬성 2 · 기권 1 · 반대 1 — 조건부 가결'. */
  summary: string
}

/** Tokens for a vote call — short: one choice line + a 1–2 sentence reason. */
const VOTE_MAX_TOKENS = 400

/** What the ballot is cast on: a chair ruling ('verdict') or the motion itself ('motion'). */
type JejuVoteMode = 'verdict' | 'motion'

/**
 * Builds the Korean system prompt for a voting member of the deliberation body.
 *   - 'verdict': vote on whether to endorse the chair's 최종 판단.
 *   - 'motion':  vote on the official's original proposition (the motion) itself,
 *                cast BEFORE any chair ruling exists.
 */
function buildVoteSystemPrompt(mode: JejuVoteMode = 'verdict'): string {
  // Shared preamble — the stance-first rule is the same regardless of mode.
  const stancePrimary = [
    '핵심 원칙 — 당신 자신의 토론 기록대로 표결하십시오(가장 중요):',
    '  이 표결은 새로운 추상적 판단이 아니라, 당신이 심의 토론에서 실제로 취한 입장의 충실한 요약입니다.',
    '  1) 표결 전에 반드시 먼저 자문하십시오: "나는 토론 전반에 걸쳐 이 안건에 대해 어떤 입장을 취했는가?"',
    '  2) 토론 내내 안건의 핵심 방향·수단을 지지했다면(사소한 유보가 있더라도) → 찬성.',
    '  3) 큰 방향·핵심 수단에는 동의하나, 그 전제가 충족되지 않으면 정책이 실패하거나 심각한 부작용이 날 "중대하고 차단적인(blocking)" 조건이 있다면 → 조건부 찬성. 단순한 실행 디테일·통상적 보완사항 수준이면 조건부 찬성이 아니라 찬성입니다.',
    '  4) 토론 내내 안건의 핵심 방향·수단을 거부하거나, 다른 수단을 주장했다면 → 반대.',
    '  5) 토론에서 진정으로 혼재되었거나 해소되지 않은 상태라면 → 기권이 정직한 선택입니다.',
    '',
    '침묵 속 전환 금지 — 양방향 강제 규칙:',
    '  [찬성→반대 전환 금지] 토론에서 안건의 핵심 방향·수단을 지지했다면, 표결 시점에 부차적인 우려(사회적 비용, 전환 지원 부담, 일부 리스크)를 이유로 조용히 반대로 바꿀 수 없습니다.',
    '  부차적(사소한) 우려만으로는 반대로 바꿀 수 없으며, 그 우려가 정책 성패를 가르는 중대 조건이면 조건부 찬성, 통상적 수준이면 찬성입니다.',
    '  [반대→찬성 전환 금지] 토론에서 안건의 핵심 수단을 거부하거나 다른 수단을 주장했다면, 표결 시점에 더 막연한 가치("방향은 맞다")로 후퇴해 조용히 찬성으로 바꿀 수 없습니다. 반대를 유지하거나 기권하십시오.',
    '  유효한 전환(양방향 공통): 토론 중에 당신이 입장을 바꾸는 발언을 실제로 했을 때만 예외입니다.',
    '  예) "처음엔 반대였지만, X 때문에 입장을 바꾼다" — 토론 안에서 명시적으로 이루어진 전환만 인정합니다.',
    '  무효한 전환: 토론이 끝나고 나서 사후에 방향을 바꾸는 것은 양방향 모두 허용되지 않습니다.',
    '',
    '평가 대상 — 추상화 금지:',
    '  안건에 명시된 구체적 정책 수단·방향을 그대로 평가하십시오.',
    '  안건을 더 추상적·더 반대하기 어려운 상위 가치로 바꿔 읽고 찬성하지 마십시오.',
    '  예) 안건이 "관광 총량 억제로 전환"이면, "환경 보전이 옳은가?"가 아니라 "총량 억제라는 수단으로 전환"이 옳은지를 표결합니다.',
    '  전문가 합의도 숫자를 이유로 삼지 마십시오 — 찬성/반대 결정은 오직 안건의 내용과 당신의 토론 기록에 기반해야 합니다.',
    '',
    '찬성·조건부 찬성·기권·반대의 정의:',
    '  찬성: 안건이 제시한 그 수단·방향이 옳다. 사소한 유보나 통상적 보완 의견이 있어도 핵심 수단에 동의하면 찬성입니다.',
    '  조건부 찬성: 큰 방향·핵심 수단에는 동의하나, 그 조건이 충족되지 않으면 정책이 실패하거나 심각한 부작용이 나는 "중대하고 차단적인(blocking)" 전제일 때만 선택하십시오. 단순한 실행 디테일·통상적 보완사항·있으면 좋은 수준의 우려는 조건부 찬성이 아니라 찬성입니다. 조건부 찬성을 선택하면 그 조건을 이유에 반드시 명시하십시오.',
    '  반대: 그 수단·방향 자체가 틀렸거나, 다른 수단을 택해야 한다.',
    '  기권: 전문 영역 밖이거나 근거가 부족해 진정으로 판단할 수 없다.',
    '',
    '찬성 vs 조건부 찬성 판별 기준(핵심):',
    '  → 조건부 찬성은 "이 조건이 없으면 지지를 철회할 정도"의 전제에만 쓰십시오.',
    '  → 사소하거나 통상적인 실행 조건(일반적 모니터링, 점진적 시행, 관례적 보완장치 등)을 이유로 조건부 찬성을 남발하지 마십시오 — 그 수준이면 찬성입니다.',
    '  → 조건부 찬성과 방향성 반대의 구분: 핵심 수단·기제 자체를 받아들이되 차단적 전제만 있으면 → 조건부 찬성. 핵심 수단·기제 자체를 거부하거나 다른 수단을 주장하면 → 반대.',
    '  예) "총량 억제 대신 미시규제" = 반대. "총량 억제는 최후의 수단" = 이 수단 채택 거부이므로 반대.',
    '  예) "총량 억제 불가피하나, 법적 위임 근거 없이는 집행이 불가능하므로 입법 선행이 전제" = 차단적 조건 → 조건부 찬성.',
    '',
    '이유 형식 요건(반드시 포함):',
    '  당신이 Perplexity(검색·언론 동향 담당)라면: 토론에 참여하지 않았으므로 "토론에서 주장했다"는 표현을 쓰지 마십시오. 대신 수집·검색한 자료와 언론 동향에서 발견한 근거를 이유로 쓰십시오. 예) "수집·검색 자료 기준으로 X 근거로 보면 이 방향이 타당하다/타당하지 않다." 각주·인용 표기([1], [2] 등), 밑줄(_…_)·별표(*) 같은 마크다운, 영어 단어를 쓰지 말고 깨끗한 한국어 산문으로만 쓰십시오.',
    '  그 외 모든 표결 위원: 이유 줄에는 (1) 토론에서 취한 입장 한 구절, (2) 그 입장과 표결이 일치함(또는 왜 전환했는지)을 함께 쓰십시오.',
    '  예) "토론 내내 총량 억제 대신 미시규제를 주장했고, 그 입장이 유지되어 반대한다."',
    '  예) "총량 억제 불가피성을 지지했으나 입법 없이는 집행 불가라는 차단적 전제를 일관되게 강조했으므로 조건부 찬성한다."',
    '  예) "핵심 수단에 전적으로 동의하며, 일부 보완장치를 언급했으나 그 수준은 통상적 실행 조건이므로 찬성한다."',
    '  예) "처음엔 유보였지만 ESS 경제성 검증 요건 논의로 찬성 방향으로 수렴하여 찬성한다."',
  ].join('\n')

  if (mode === 'motion') {
    return [
      '당신은 제주도정 거버넌스 심의체의 표결 위원입니다. 전문가 심의를 거친 정책 안건(동의안)이 표결에 부쳐졌습니다.',
      '안건의 문구는 공무원이 제출한 원안 그대로입니다. 어느 AI가 잘했는지 평가하는 것이 아닙니다.',
      '',
      TRUTH_SEEKING_DIRECTIVE,
      '',
      stancePrimary,
      '',
      '출력 형식(반드시 정확히 두 줄):',
      '표결: 찬성 / 표결: 조건부 찬성 / 표결: 반대 / 표결: 기권 중 하나를 정확히 그 표기 그대로 쓰십시오. (큰 방향에는 동의하나 세부 조건·전제가 필요하면 "표결: 조건부 찬성"을 선택하고 그 조건을 이유에 명시)',
      '이유: [1~2문장, 한국어, 구체적으로 — 반드시 위 이유 형식 요건을 포함]',
    ].join('\n')
  }

  return [
    '당신은 제주도정 거버넌스 심의체의 표결 위원입니다. 의장(chair)이 최종 판단을 내렸습니다.',
    '어느 AI가 잘했는지 평가하는 것이 아닙니다.',
    '',
    TRUTH_SEEKING_DIRECTIVE,
    '',
    stancePrimary,
    '',
    '출력 형식(반드시 정확히 두 줄):',
    '표결: 찬성 / 표결: 조건부 찬성 / 표결: 반대 / 표결: 기권 중 하나를 정확히 그 표기 그대로 쓰십시오. (큰 방향에는 동의하나 세부 조건·전제가 필요하면 "표결: 조건부 찬성"을 선택하고 그 조건을 이유에 명시)',
    '이유: [1~2문장, 한국어, 구체적으로 — 반드시 위 이유 형식 요건을 포함]',
  ].join('\n')
}

/** Maps a parsed Korean choice token to a JejuVoteChoice. */
function parseVoteChoice(raw: string): JejuVoteChoice | null {
  if (raw === '조건부 찬성') return 'conditional'
  if (raw === '찬성') return 'approve'
  if (raw === '반대') return 'oppose'
  if (raw === '기권') return 'abstain'
  return null
}

/** Parses a vote response into { choice, reason }. Unparseable → choice:null. */
function parseVoteResponse(text: string | null): {
  choice: JejuVoteChoice | null
  reason: string | null
} {
  if (!text) return { choice: null, reason: null }
  // 조건부 찬성 MUST precede 찬성 in the alternation so it is not truncated to 찬성.
  const cMatch = text.match(/표결:\s*(조건부 찬성|찬성|반대|기권)/)
  const choice = cMatch ? parseVoteChoice(cMatch[1]!) : null
  const rMatch = text.match(/이유:\s*([\s\S]+)/)
  const reason = rMatch ? rMatch[1]!.trim() : null
  return { choice, reason }
}

/**
 * Cleans a vote reason of markup that leaks (especially from Perplexity, which
 * is search-backed): bracketed citation markers ([2], [2][9]), underscore
 * emphasis (_…_ / stray _), and markdown bold/italic asterisks. Returns clean
 * Korean prose. Applied to ALL panelists' reasons (harmless for the others).
 */
function sanitizeVoteReason(reason: string | null): string | null {
  if (!reason) return reason
  const cleaned = reason
    .replace(/\[\d+\](?:\[\d+\])*/g, '') // footnote/citation markers [n], [n][m]
    .replace(/_+/g, '') // underscore emphasis / stray underscores
    .replace(/\*+/g, '') // markdown bold/italic asterisks
    .replace(/[ \t]{2,}/g, ' ') // collapse runs of spaces
    .replace(/ +([,.])/g, '$1') // tidy space left before punctuation
    .trim()
  return cleaned || null
}

/** Soft ceiling for a single voter's injected debate transcript. */
const VOTE_TRANSCRIPT_MAX_CHARS = 2800

/** Truncates one free-text body; marks the cut so nothing reads as complete. */
function truncateVoteBody(body: string, budget: number): string {
  if (budget <= 0) return ''
  if (body.length <= budget) return body
  return `${body.slice(0, budget).trimEnd()} …(이하 생략)`
}

/**
 * Renders ONE voter's own attributable turns from the deliberation (round order).
 * Returns null when this provider has no turns (perplexity / non-seated panelists /
 * fail-safe exclusions) — caller then keeps today's recall-your-stance prompt.
 *
 * Budget: ~2800 chars. Truncate ONLY free-text bodies. NEVER drop a round header,
 * ACTION/CLAIM line, or 입장/견지 header. If still over budget, drop OLDEST rounds'
 * bodies first while keeping their ACTION/CLAIM (or 입장) one-liner.
 */
function buildVoterTranscript(
  deliberation: JejuDeliberation,
  provider: JejuProvider
): string | null {
  const ordered = [...deliberation.rounds].sort((a, b) => a.roundNumber - b.roundNumber)

  type RenderTurn = {
    chanban: boolean
    /** Lines that must survive truncation (round header + ACTION/CLAIM). */
    protectedLines: string[]
    /** Free-text body — truncatable / droppable (oldest first under pressure). */
    body: string
    /** Mode A only: present 견지/수용 labels (headers kept even when body dropped). */
    extraLabels: { label: string; value: string }[]
  }

  const own: RenderTurn[] = []
  for (const round of ordered) {
    for (const turn of round.turns) {
      if (!turn.ok || turn.provider !== provider) continue
      const position = (turn.position ?? '').trim()
      const claim = (turn.claim ?? '').trim()
      const isChanban = turn.actionTag != null || claim !== ''
      if (!position && !claim) continue

      if (isChanban) {
        own.push({
          chanban: true,
          protectedLines: [
            `### 라운드 ${round.roundNumber}`,
            `ACTION: ${turn.actionTag ?? '없음'}`,
            `CLAIM: ${claim || '없음'}`,
          ],
          body: position,
          extraLabels: [],
        })
      } else {
        if (!position) continue
        const extraLabels: { label: string; value: string }[] = []
        const holds = (turn.holds ?? '').trim()
        const concedes = (turn.concedes ?? '').trim()
        if (holds) extraLabels.push({ label: '견지: ', value: holds })
        if (concedes) extraLabels.push({ label: '수용: ', value: concedes })
        own.push({
          chanban: false,
          protectedLines: [`### 라운드 ${round.roundNumber}`],
          body: position,
          extraLabels,
        })
      }
    }
  }
  if (own.length === 0) return null

  const render = (turns: RenderTurn[], bodyBudgets: number[]): string => {
    const blocks: string[] = []
    for (let i = 0; i < turns.length; i++) {
      const t = turns[i]!
      const budget = bodyBudgets[i] ?? 0
      const lines = [...t.protectedLines]
      if (t.chanban) {
        if (budget > 0 && t.body) lines.push(truncateVoteBody(t.body, budget))
      } else {
        // 개방형: always keep an 입장 one-liner; truncate/drop only the free text.
        if (budget > 0 && t.body) {
          lines.push(`입장: ${truncateVoteBody(t.body, budget)}`)
        } else {
          lines.push('입장: (본문 생략)')
        }
        for (const { label, value } of t.extraLabels) {
          // 견지/수용 headers are never dropped; only their free-text values shrink.
          if (budget > 0) {
            lines.push(label + truncateVoteBody(value, Math.max(40, Math.floor(budget / 2))))
          } else {
            lines.push(label + '(본문 생략)')
          }
        }
      }
      blocks.push(lines.join('\n'))
    }
    return blocks.join('\n\n')
  }

  // Share remaining budget across turn bodies after accounting for protected lines.
  const protectedTotal = own.reduce((sum, t) => {
    const base = t.protectedLines.join('\n').length
    // Mode A always emits an 입장 line (header kept even when body is dropped).
    const stanceFloor = t.chanban ? 0 : '입장: (본문 생략)'.length
    const extraFloor = t.extraLabels.reduce((s, e) => s + e.label.length + '(본문 생략)'.length + 1, 0)
    return sum + base + stanceFloor + extraFloor + 2
  }, 0)
  let bodyBudgets = own.map(() =>
    Math.max(0, Math.floor(Math.max(0, VOTE_TRANSCRIPT_MAX_CHARS - protectedTotal) / own.length))
  )

  let text = render(own, bodyBudgets)
  if (text.length <= VOTE_TRANSCRIPT_MAX_CHARS) return text

  // Still over: shrink every body proportionally.
  const over = text.length - VOTE_TRANSCRIPT_MAX_CHARS
  const shrinkEach = Math.ceil(over / own.length) + 8
  bodyBudgets = bodyBudgets.map((b) => Math.max(0, b - shrinkEach))
  text = render(own, bodyBudgets)
  if (text.length <= VOTE_TRANSCRIPT_MAX_CHARS) return text

  // Last resort: drop OLDEST rounds' bodies first (keep ACTION/CLAIM or 입장 one-liner).
  for (let i = 0; i < own.length && text.length > VOTE_TRANSCRIPT_MAX_CHARS; i++) {
    bodyBudgets[i] = 0
    text = render(own, bodyBudgets)
  }

  return text
}

/**
 * Builds the voter's user prompt: the proposition to vote on + the unresolved
 * issues + the consensus score (if known). Voters who see only a polished
 * proposition tend to rubber-stamp; exposing the unresolved dissent and the
 * consensus level lets them cast an informed ballot.
 *
 *   - 'verdict' mode: proposition is the chair's 최종 판단; `unresolvedIssues` is
 *     the chair's minority report.
 *   - 'motion' mode: proposition is the official's original question (verbatim);
 *     `unresolvedIssues` is the deliberation's contested points.
 *   - `ownTranscript`: when set, this voter's attributable debate record is
 *     injected before the mission block; when null/omitted, today's
 *     recall-your-stance wording is kept unchanged.
 */
function buildVoteUserPrompt(params: {
  mode: JejuVoteMode
  question: string
  proposition: string
  unresolvedIssues?: string | null
  ownTranscript?: string | null
}): string {
  const { mode, question, proposition, unresolvedIssues, ownTranscript } = params

  const parts: string[] =
    mode === 'motion'
      ? [
          '# 표결 대상 안건 (원안 그대로 — 명시된 구체적 수단·방향으로 판단하며, 더 추상적인 가치로 바꿔 읽지 마십시오)',
          proposition,
        ]
      : [
          '# 심의 안건',
          question,
          '',
          '# 의장의 최종 판단 (표결 대상 — 원문 그대로 판단하며, 더 추상적인 가치로 바꿔 읽지 마십시오)',
          proposition,
        ]

  if (unresolvedIssues && unresolvedIssues.trim() !== '') {
    parts.push(
      '',
      '## 끝까지 해소되지 않은 쟁점',
      '(핵심 수단 자체를 거부하거나 다른 수단을 주장하는 쟁점이면 방향성 반대 사유 — 시행 조건·순서·규모 문제라면 조건부 찬성의 사유)',
      unresolvedIssues.trim()
    )
  }

  if (ownTranscript && ownTranscript.trim() !== '') {
    parts.push(
      '',
      '## 당신의 심의 토론 기록 (본인 발언만 — 이 기록에 충실히 표결하십시오)',
      ownTranscript.trim()
    )
  }

  parts.push(
    '',
    '# 당신의 임무',
    '먼저: 당신이 이 심의 토론에서 라운드 전반에 걸쳐 취한 입장을 떠올리십시오.',
    mode === 'motion'
      ? '그런 다음: 위 안건(명시된 수단·방향)과 끝까지 해소되지 않은 쟁점을 검토하고, 당신의 토론 기록과 일치하게 표결하십시오. 형식에 맞춰 정확히 두 줄로만 답하십시오.'
      : '그런 다음: 위 의장의 최종 판단(명시된 수단·방향)과 끝까지 해소되지 않은 쟁점을 검토하고, 당신의 토론 기록과 일치하게 표결하십시오. 형식에 맞춰 정확히 두 줄로만 답하십시오.'
  )

  return parts.join('\n')
}

/** Renders the deliberation's contested points into the "unresolved issues" block for a motion vote. */
function formatContestedForVote(contestedPoints: string[]): string | null {
  if (contestedPoints.length === 0) return null
  return contestedPoints.map((p) => `• ${p}`).join('\n')
}

/** Casts ONE provider's vote on the given proposition. Never throws. */
async function runOneVote(
  provider: JejuProvider,
  systemPrompt: string,
  userPrompt: string
): Promise<JejuVote> {
  let r
  try {
    r = await callJejuAi({
      provider,
      prompt: userPrompt,
      systemPrompt,
      maxCompletionTokens: VOTE_MAX_TOKENS,
    })
  } catch (e: unknown) {
    return {
      provider,
      ok: false,
      choice: null,
      reason: null,
      error: `표결 호출 실패: ${e instanceof Error ? e.message : 'unknown error'}`,
    }
  }

  if (r.error || !r.text) {
    return {
      provider,
      ok: false,
      choice: null,
      reason: null,
      error: r.error ?? '표결 응답이 비어 있습니다.',
    }
  }

  const parsedVote = parseVoteResponse(r.text)
  const choice = parsedVote.choice
  const reason = sanitizeVoteReason(parsedVote.reason)
  if (choice == null) {
    return {
      provider,
      ok: false,
      choice: null,
      reason,
      error: '표결을 해석할 수 없습니다(형식 불일치).',
    }
  }

  return { provider, ok: true, choice, reason }
}

/**
 * A clearly "not applicable / no ballot" result, with a Korean reason in
 * `summary`, so the UI can tell "no vote happened" from "vote failed" (both
 * ok:false, but the summary explains which).
 */
function emptyVoteResult(summary: string): JejuVoteResult {
  return {
    votes: [],
    approveCount: 0,
    conditionalCount: 0,
    opposeCount: 0,
    abstainCount: 0,
    approveProviders: [],
    conditionalProviders: [],
    opposeProviders: [],
    abstainProviders: [],
    outcome: 'divided',
    outcomeLabel: '',
    ok: false,
    summary,
  }
}

/**
 * Shared ballot engine: runs ALL panel providers IN PARALLEL, then tallies.
 * `userPromptOrBuilder` may be one shared string (verdict-mode / legacy) or a
 * per-provider builder so each voter can receive its own debate transcript.
 * Abstain never tips the outcome — only (찬성+조건부 찬성) vs 반대 do.
 * ok = at least one parseable vote landed. Never throws.
 */
async function runPanelBallot(
  systemPrompt: string,
  userPromptOrBuilder: string | ((provider: JejuProvider) => string)
): Promise<JejuVoteResult> {
  const buildUserPrompt =
    typeof userPromptOrBuilder === 'function'
      ? userPromptOrBuilder
      : (_provider: JejuProvider) => userPromptOrBuilder

  const settled = await Promise.allSettled(
    JEJU_VOTE_PANEL.map((p) => runOneVote(p, systemPrompt, buildUserPrompt(p)))
  )

  const votes: JejuVote[] = settled.map((s, i) => {
    const provider = JEJU_VOTE_PANEL[i]!
    if (s.status === 'fulfilled') return s.value
    return {
      provider,
      ok: false,
      choice: null,
      reason: null,
      error: `표결 처리 실패: ${s.reason instanceof Error ? s.reason.message : 'unknown error'}`,
    }
  })

  const approveProviders: string[] = []
  const conditionalProviders: string[] = []
  const opposeProviders: string[] = []
  const abstainProviders: string[] = []

  for (const v of votes) {
    if (!v.ok || v.choice == null) continue
    const label = JEJU_VOTE_BRAND_LABEL[v.provider]
    if (v.choice === 'approve') approveProviders.push(label)
    else if (v.choice === 'conditional') conditionalProviders.push(label)
    else if (v.choice === 'oppose') opposeProviders.push(label)
    else if (v.choice === 'abstain') abstainProviders.push(label)
  }

  const approveCount = approveProviders.length
  const conditionalCount = conditionalProviders.length
  const opposeCount = opposeProviders.length
  const abstainCount = abstainProviders.length

  // 조건부 찬성 is directional agreement (with conditions), so it counts on the
  // YES side when determining the outcome direction — but it is tallied and
  // displayed as its own category, never merged into 찬성.
  const passVotes = approveCount + conditionalCount
  let outcome: 'approved' | 'rejected' | 'divided'
  if (passVotes > opposeCount) outcome = 'approved'
  else if (opposeCount > passVotes) outcome = 'rejected'
  else outcome = 'divided'

  // Parallel display label — do not overload the outcome enum.
  const outcomeLabel =
    outcome === 'approved'
      ? conditionalCount > 0
        ? '조건부 가결'
        : '가결'
      : outcome === 'rejected'
        ? '부결'
        : '의견 분분'
  const summary = `찬성 ${approveCount} · 조건부 찬성 ${conditionalCount} · 기권 ${abstainCount} · 반대 ${opposeCount} — ${outcomeLabel}`

  const ok = approveCount + conditionalCount + opposeCount + abstainCount > 0

  return {
    votes,
    approveCount,
    conditionalCount,
    opposeCount,
    abstainCount,
    approveProviders,
    conditionalProviders,
    opposeProviders,
    abstainProviders,
    outcome,
    outcomeLabel,
    ok,
    summary,
  }
}

/**
 * PIECE 5 — the closing ballot. Asks ALL 8 panel providers whether they endorse
 * the chair's verdict (찬성/반대/기권 + reason).
 *
 * The proposition is the chair's 최종 판단, so this can only run once a concrete
 * ruling exists; with no judgment it returns ok:false (you can't vote on
 * nothing). Abstain is a first-class, honest option. Abstains never tip the
 * outcome — only 찬성 vs 반대 do. Never throws.
 */
export async function runJejuVote(params: {
  verdict: JejuVerdict
  question: string
  minorityReport?: string | null
  consensusScore?: number
}): Promise<JejuVoteResult> {
  const { verdict, question, minorityReport } = params

  // Can't vote on nothing — needs a concrete ruling to endorse or reject.
  if (!verdict.ok || !verdict.judgment || verdict.judgment.trim() === '') {
    return emptyVoteResult('표결할 의장 판단이 없어 표결을 건너뜁니다.')
  }

  const systemPrompt = buildVoteSystemPrompt('verdict')
  const userPrompt = buildVoteUserPrompt({
    mode: 'verdict',
    question,
    proposition: verdict.judgment.trim(),
    unresolvedIssues: minorityReport,
  })

  return runPanelBallot(systemPrompt, userPrompt)
}

/**
 * PIECE 5 (motion variant) — the body votes on the MOTION itself, i.e. the
 * official's original question taken verbatim as the proposition, cast BEFORE the
 * chair speaks. Voters see the deliberation's contested points (as the unresolved
 * issues) and its final consensus score. Abstain never tips the outcome. Never
 * throws.
 */
export async function runJejuMotionVote(params: {
  question: string
  deliberation: JejuDeliberation
}): Promise<JejuVoteResult> {
  const question = params.question?.trim() ?? ''
  if (!question) {
    return emptyVoteResult('표결할 안건이 없어 표결을 건너뜁니다.')
  }

  const systemPrompt = buildVoteSystemPrompt('motion')
  const unresolvedIssues = formatContestedForVote(params.deliberation.contestedPoints)

  return runPanelBallot(systemPrompt, (provider) => {
    const ownTranscript = buildVoterTranscript(params.deliberation, provider)
    return buildVoteUserPrompt({
      mode: 'motion',
      question,
      proposition: question,
      unresolvedIssues,
      ownTranscript,
    })
  })
}

/** The full DEEP result plus the closing ballot on the chair's verdict. */
export type JejuDeepCompleteWithVote = JejuDeepComplete & {
  /** The whole body's closing ballot on the chair's ruling. */
  vote: JejuVoteResult
}

/**
 * The COMPLETE governance pipeline with the voting branch, following the 2x2 rule:
 *
 *   - binary  + consensus <  CONSENSUS_VOTE_THRESHOLD → vote on the MOTION FIRST,
 *       then the chair renders its FULL verdict. (verdict + real vote)
 *   - binary  + consensus >= CONSENSUS_VOTE_THRESHOLD → NO vote; chair renders a
 *       SHORT (brief) verdict — consensus is high, little to adjudicate.
 *   - openEnded (any score)                          → NO vote; chair renders its
 *       normal verdict (brief if high-consensus, full otherwise).
 *
 * An unmeasurable score (-1) is treated as NOT high-consensus → for a binary
 * question that means NO vote + FULL verdict (the safe path: never show a vote we
 * can't justify). The no-vote cases return a clearly not-applicable JejuVoteResult
 * (ok:false, counts 0, Korean summary stating WHY). Never throws; partial data on
 * error.
 */
export async function runJejuDeepCompleteWithVote(params?: {
  question?: string
  orchestratorProvider?: string
  maxRounds?: number
}): Promise<JejuDeepCompleteWithVote> {
  const deliberationStage = await runJejuDeepThroughDeliberation(params)
  const finalScore = deliberationStage.deliberation.finalScore
  const questionType = deliberationStage.plan.questionType

  const emptyVerdict: JejuVerdict = {
    ok: false,
    keyIssues: null,
    judgment: null,
    beat1Summary: null,
    beat2Summary: null,
    beat3Summary: null,
    mediaRisk: null,
    minorityReport: null,
    consensusScore: finalScore,
    disclaimer: DEFAULT_DISCLAIMER,
    provider: 'anthropic',
    error: '상위 단계가 유효하지 않아 의장 판결을 건너뜁니다.',
  }

  // Nothing usable upstream → no verdict, no vote.
  if (!deliberationStage.ok) {
    return {
      ...deliberationStage,
      ok: false,
      verdict: emptyVerdict,
      vote: emptyVoteResult('상위 단계가 유효하지 않아 표결을 생략했습니다.'),
    }
  }

  // The 2x2 decision rule. An unmeasurable score (-1) is NOT high-consensus.
  const measurable = finalScore >= 0
  const highConsensus = measurable && finalScore >= CONSENSUS_VOTE_THRESHOLD
  const doVote = questionType === 'binary' && measurable && finalScore < CONSENSUS_VOTE_THRESHOLD
  const brief = highConsensus

  // Reason shown when no ballot is held (so the UI distinguishes "no vote" cases).
  const noVoteSummary =
    questionType !== 'binary'
      ? '개방형 질문으로 표결 생략'
      : !measurable
        ? '합의도 측정 불가로 표결 생략(안전 경로)'
        : highConsensus
          ? `${CONSENSUS_VOTE_THRESHOLD}점 이상 합의로 표결 생략`
          : '표결 생략'

  // In the doVote path the motion vote runs BEFORE the chair, so keep whatever
  // ballot we gathered even if the chair render later fails.
  let vote: JejuVoteResult = emptyVoteResult(noVoteSummary)

  try {
    if (doVote) {
      vote = await runJejuMotionVote({
        question: deliberationStage.question,
        deliberation: deliberationStage.deliberation,
      })
    }

    const verdict = await renderChairVerdict({
      question: deliberationStage.question,
      snapshot: deliberationStage.snapshot,
      analyses: deliberationStage.analyses,
      searches: deliberationStage.searches,
      revised: deliberationStage.revised,
      rebuttals: deliberationStage.debate,
      deliberation: deliberationStage.deliberation,
      brief,
      // The motion vote (if any) ran first; show it to the chair as advisory context.
      vote,
    })

    return { ...deliberationStage, ok: verdict.ok, verdict, vote }
  } catch (e: unknown) {
    return {
      ...deliberationStage,
      ok: false,
      verdict: {
        ...emptyVerdict,
        error: `의장 판결 실패(이전 결과는 유효): ${e instanceof Error ? e.message : 'unknown error'}`,
      },
      vote,
    }
  }
}
