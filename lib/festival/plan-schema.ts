/**
 * FESTIVAL plan input schema — the typed form payload (6 blocks).
 *
 * ISOMORPHIC / CLIENT-SAFE: pure types, labels, validation, and constants —
 * no secrets, DB, fs, or lib/extract. Imported by the client form
 * (app/festival/page.tsx) and server routes/pipeline alike.
 *
 * ISOLATION INVARIANT: festival-only. Depends on no MOTIE/Jeju type. The form
 * (app/festival/page.tsx) and routes (app/api/festival/*) read/write this shape;
 * the pipeline (lib/festival/pipeline.ts) renders it into the investigator
 * context block.
 *
 * Required = blocks 1–3 (the form blocks submit and the route rejects a start
 * without them). Optional = blocks 4–6. MISSING optional fields must WIDEN the
 * forecast's uncertainty and CAP the relevant seat's score — they must NEVER
 * default to a good score. The context renderer marks missing optional fields
 * explicitly as "[확인 필요 — 미입력]" so investigators cannot pretend they
 * were filled.
 *
 * Audience: BOTH local-government planners AND private festival operators /
 * agencies (B2G + B2B). Field labels and helper copy stay role-neutral
 * ("주최측", "기획 담당자") — never assume a public official. Because operators
 * have an incentive to oversell their own festival, the manual-supplement
 * provenance warning (organizer-provided, unverified) is load-bearing.
 */

// ── Block 1: 기본정보 (required) ─────────────────────────────────────────────
export type FestivalVenueType = 'indoor' | 'outdoor' | 'mixed'
export type FestivalEdition = 'new' | number // 'new' 신규 | N회차 (integer ≥1)

export type FestivalPlanBlock1 = {
  /** 축제명 */
  name: string
  /** 지역(시/군/구) — e.g. "제주특별자치도 서귀포시" */
  region: string
  /** 개최 시작일 (YYYY-MM-DD) */
  dateStart: string
  /** 개최 종료일 (YYYY-MM-DD) */
  dateEnd: string
  /** 장소유형 */
  venueType: FestivalVenueType
  /** 축제유형 (음악·먹거리·전통·불꽃·체험 등) — free text */
  festivalType: string
  /** 회차 — 'new' or an integer ≥1 */
  edition: FestivalEdition
}

// ── Block 2: 규모·예산 (required) ────────────────────────────────────────────
export type FestivalPlanBlock2 = {
  /** 총예산 (free text, e.g. "총 42억 원") */
  totalBudget: string
  /** 예상 방문객 목표 (free text, e.g. "연 목표 25만 명") */
  visitorTarget: string
  /**
   * 예산배분 대략 비율 — 프로그램/안전/홍보/운영. Each 0–100; the renderer
   * shows them as percentages and the form validates they are non-negative
   * (sum-to-100 is encouraged, not hard-enforced, because rough ratios are
   * expected at the planning stage).
   */
  budgetSplit: {
    program: number | ''
    safety: number | ''
    promo: number | ''
    operation: number | ''
  }
}

// ── Block 3: 프로그램 (required) ─────────────────────────────────────────────
export type FestivalPlanBlock3 = {
  /** 핵심 프로그램 3~5개 (free text, one per line) */
  corePrograms: string[]
  /** 대표콘텐츠/헤드라이너 유무 */
  hasHeadliner: 'yes' | 'no' | 'unknown'
  /** 우천 대체프로그램 유무 */
  hasRainBackup: 'yes' | 'no' | 'unknown'
}

// ── Block 4: 타깃·접근성 (optional) ──────────────────────────────────────────
export type FestivalPlanBlock4 = {
  /** 주 타깃층 (free text) — empty = 미입력 */
  primaryAudience?: string
  /** 대중교통 접근성 (free text) — empty = 미입력 */
  transitAccess?: string
  /** 주변 숙박·관광 인프라 (free text) — empty = 미입력 */
  lodgingTourism?: string
}

// ── Block 5: 안전·운영 (optional) ────────────────────────────────────────────
export type FestivalPlanBlock5 = {
  /** 예상 동시 최대인파 (free text or number-as-string) — empty = 미입력 */
  peakCrowd?: string
  /** 안전인력·의료계획 유무 */
  hasSafetyPlan?: 'yes' | 'no' | 'unknown'
  /** 입장방식 */
  entryMode?: 'free' | 'paid' | 'reservation'
}

// ── Block 6: 홍보·차별성 (optional) ──────────────────────────────────────────
export type FestivalPlanBlock6 = {
  /** 홍보채널 (free text) — empty = 미입력 */
  promoChannels?: string
  /** 홍보시작시점 (free text, e.g. "행사 60일 전") — empty = 미입력 */
  promoStart?: string
  /** 작년대비 새로운 것 / 재방문 유도요소 (free text) — empty = 미입력 */
  novelty?: string
  /**
   * 외국인 대상여부 + 다국어/결제/동선 계획 (free text) — empty = 미입력.
   * KEY DIFFERENTIATOR AXIS: this field is explicitly routed to the
   * global_tourism (글로벌관광관) seat's judgment. When empty, the context
   * reads "외국인 대응 계획 미입력" and that seat MUST cap its score + widen
   * uncertainty (see lib/festival/pipeline.ts buildFestivalPlanContext and the
   * global_tourism persona in lib/festival/roster.ts).
   */
  foreignVisitorPlan?: string
}

/**
 * The full typed festival plan. Required blocks 1–3 are non-optional; optional
 * blocks 4–6 are present-but-partial (each field individually optional).
 */
export type FestivalPlan = {
  block1: FestivalPlanBlock1
  block2: FestivalPlanBlock2
  block3: FestivalPlanBlock3
  block4?: FestivalPlanBlock4
  block5?: FestivalPlanBlock5
  block6?: FestivalPlanBlock6
}

// ── Manual supplement (paste / URL / file extract text) ──────────────────────

/**
 * One normalized supplement entry produced by app/api/festival/extract (or a
 * direct paste). The raw upload is NOT persisted — only this normalized text +
 * a short label travel into the session state.
 */
export type FestivalSupplement = {
  /** Short human label, e.g. "붙여넣기", "URL: example.com", "file: plan.pdf" */
  label: string
  /** Normalized text from lib/extract (paste passes through verbatim). */
  text: string
  /** Where it came from — controls the provenance framing in the context. */
  source: 'paste' | 'url' | 'file'
  /** Truncated by the extract layer? (forwarded for transparency) */
  truncated: boolean
  /** Extraction failed? When true, `text` is an error note, not content. */
  ok: boolean
  /** Populated when ok === false (extraction error message). */
  error?: string
}

// ── Labels (Korean, role-neutral) ────────────────────────────────────────────

export const FESTIVAL_VENUE_TYPE_LABELS: Record<FestivalVenueType, string> = {
  indoor: '실내',
  outdoor: '실외',
  mixed: '혼합',
}

export const FESTIVAL_HEADLINER_LABELS: Record<'yes' | 'no' | 'unknown', string> = {
  yes: '있음',
  no: '없음',
  unknown: '불확실',
}

export const FESTIVAL_RAIN_BACKUP_LABELS: Record<'yes' | 'no' | 'unknown', string> = {
  yes: '있음',
  no: '없음',
  unknown: '불확실',
}

export const FESTIVAL_SAFETY_PLAN_LABELS: Record<'yes' | 'no' | 'unknown', string> = {
  yes: '있음',
  no: '없음',
  unknown: '불확실',
}

export const FESTIVAL_ENTRY_MODE_LABELS: Record<'free' | 'paid' | 'reservation', string> = {
  free: '무료',
  paid: '유료',
  reservation: '사전예약',
}

// ── Investigator "what they examine" blurbs (Korean) ─────────────────────────
//
// Used by the progress UI to fill the "조사중" wait with REAL reading content —
// each card shows what that lens examines so the wait teaches the user the 8
// lenses instead of a fake progress animation. Keyed by investigator id (the
// same string set as FestivalInvestigatorId in lib/festival/types.ts; declared
// as a plain Record here to keep this module client-safe and not import the
// server-only types file).
export const FESTIVAL_INVESTIGATOR_BLURBS: Record<string, string> = {
  demand: '예상 방문객 목표와 유사 축제 실적·집객권·계절성을 대조해 수요의 현실성을 검증합니다.',
  budget: '총예산·예산배분·재원 조달·손익분기를 검토해 예산 집행의 타당성을 따집니다.',
  safety_reputation:
    '군중/교통/기상 리스크, 안전·의료계획, 인허가, 과거 논란·평판 하방을 점검합니다.',
  program_diff: '핵심 프로그램의 매력도·독창성, 인근/동시기 축제 대비 차별성을 평가합니다.',
  access_tourism: '대중교통·접근성, 주변 숙박·연계관광 인프라와 지역 파급 효과를 따집니다.',
  marketing: '홍보채널·타이밍·메시지·전환 경로(예매/참여)가 관객을 채울 수 있는지 평가합니다.',
  global_tourism: '외국인 대응 계획·다국어·결제·동선과 인바운드 수요의 현실성을 점검합니다.',
  benchmark_search:
    '유사 축제 실적·경쟁 축제·주최/개최지 평판을 검색으로 조사합니다(점수 없음, 사실만).',
}

/** Model display name per investigator id (matches lib/festival/roster.ts). */
export const FESTIVAL_INVESTIGATOR_MODEL_LABEL: Record<string, string> = {
  demand: 'ChatGPT',
  budget: 'Gemini',
  safety_reputation: 'Claude Opus',
  program_diff: 'Grok',
  access_tourism: 'DeepSeek',
  marketing: 'Mistral',
  global_tourism: 'Claude Sonnet',
  benchmark_search: 'Perplexity (sonar)',
}

export const FESTIVAL_SUPPLEMENT_PROVENANCE_NOTE =
  '※ 아래는 사용자(주최측)가 직접 제공한 자료로, 공식 검증된 정보가 아님. 주장과 사실을 구분해 참고할 것. 자기홍보성 표현이나 근거 없는 호전적 수치는 그대로 수용하지 말고, 검증 필요 표시([확인 필요]) 후 점수에 반영하십시오.'

// ── Validation ───────────────────────────────────────────────────────────────

/**
 * Validates the required blocks (1–3). Returns a list of Korean field errors;
 * empty array = ok to start. Optional blocks are NOT validated here — missing
 * optional fields are a legitimate (uncertainty-widening) state, not an error.
 */
export function validateFestivalPlan(plan: FestivalPlan): string[] {
  const errors: string[] = []
  const b1 = plan.block1
  if (!b1.name.trim()) errors.push('축제명을 입력하세요.')
  if (!b1.region.trim()) errors.push('지역(시/군/구)을 입력하세요.')
  if (!b1.dateStart.trim()) errors.push('개최 시작일을 입력하세요.')
  if (!b1.dateEnd.trim()) errors.push('개최 종료일을 입력하세요.')
  if (b1.dateStart && b1.dateEnd && b1.dateEnd < b1.dateStart) {
    errors.push('종료일이 시작일보다 빠릅니다.')
  }
  if (!b1.venueType) errors.push('장소유형을 선택하세요.')
  if (!b1.festivalType.trim()) errors.push('축제유형을 입력하세요.')
  if (b1.edition !== 'new' && !(Number.isInteger(b1.edition) && b1.edition >= 1)) {
    errors.push('회차를 정확히 입력하세요(신규 또는 1 이상 정수).')
  }

  const b2 = plan.block2
  if (!b2.totalBudget.trim()) errors.push('총예산을 입력하세요.')
  if (!b2.visitorTarget.trim()) errors.push('예상 방문객 목표를 입력하세요.')
  const split = b2.budgetSplit
  const splitVals = [split.program, split.safety, split.promo, split.operation]
  if (splitVals.some((v) => v === '' || (typeof v === 'number' && (v < 0 || v > 100)))) {
    errors.push('예산배분은 0~100 사이의 숫자로 입력하세요.')
  }

  const b3 = plan.block3
  const programs = b3.corePrograms.map((p) => p.trim()).filter(Boolean)
  if (programs.length < 3) {
    errors.push('핵심 프로그램을 3개 이상 입력하세요.')
  }
  if (!b3.hasHeadliner) errors.push('대표콘텐츠/헤드라이너 유무를 선택하세요.')
  if (!b3.hasRainBackup) errors.push('우천 대체프로그램 유무를 선택하세요.')

  return errors
}

// ── "예시로 채우기" stub (kept for testing / the form button) ────────────────

/**
 * A fully-filled example plan, role-neutral, used by the "예시로 채우기" button.
 * The pipeline's buildStubFestivalPlan() returns this exact object so the
 * stub-driven engine test path and the form-driven path share one shape.
 */
export function buildExampleFestivalPlan(): FestivalPlan {
  return {
    block1: {
      name: '제주 감귤 빛 축제',
      region: '제주특별자치도 서귀포시',
      dateStart: '2026-12-12',
      dateEnd: '2027-01-04',
      venueType: 'outdoor',
      festivalType: '체험·미디어아트·먹거리',
      edition: 'new',
    },
    block2: {
      totalBudget: '총 42억 원 (도비 20억, 시비 12억, 협찬·입장수익 10억 목표)',
      visitorTarget: '연 목표 25만 명',
      budgetSplit: { program: 45, safety: 15, promo: 20, operation: 20 },
    },
    block3: {
      corePrograms: [
        '감귤밭 미디어아트 야간 점등',
        '로컬 푸드 야시장',
        '주말 K-POP·트로트 공연',
        '감귤 따기 체험',
      ],
      hasHeadliner: 'yes',
      hasRainBackup: 'no',
    },
    block4: {
      primaryAudience: '가족 단위 관광객 + 20~30대 야간 나들이 + 외국인 개별관광객(FIT)',
      transitAccess: '서귀포 시내에서 차량 20분, 전용 주차 800면, 셔틀버스 시내 3개 노선',
      lodgingTourism: '중문 관광단지 숙박단지 인근, 감귤체험 농장 5곳과 연계',
    },
    block5: {
      peakCrowd: '야간 피크 1.2만 명',
      hasSafetyPlan: 'unknown',
      entryMode: 'free',
    },
    block6: {
      promoChannels: 'SNS 인플루언서 20팀, 지역 방송 협찬, 항공·숙박 연계 패키지',
      promoStart: '행사 90일 전',
      novelty: '미디어아트 점등 루트 2개 신규 추가, 재방문 시 감귤 디저트 쿠폰',
      foreignVisitorPlan: '영어·중국어 안내판, 주요 결제 다언어 키오스크 3대, 동선 다언어 표지',
    },
  }
}
