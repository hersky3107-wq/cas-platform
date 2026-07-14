import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'
import type {
  FestivalInvestigatorId,
  FestivalInvestigatorPersona,
  FestivalProvider,
} from '@/lib/festival/types'
import {
  FESTIVAL_SCORING_INVESTIGATORS,
  FESTIVAL_SEARCH_INVESTIGATOR,
} from '@/lib/festival/roster'
import {
  buildFestivalScoringSystemPrompt,
  buildFestivalRescoringSystemPrompt,
  buildFestivalSearchSystemPrompt,
  FESTIVAL_DISCLAIMER,
  FESTIVAL_CHAIR_PERSONA_LINES,
} from '@/lib/festival/persona'
import {
  FESTIVAL_SUPPLEMENT_PROVENANCE_NOTE,
  FESTIVAL_VENUE_TYPE_LABELS,
  FESTIVAL_HEADLINER_LABELS,
  FESTIVAL_RAIN_BACKUP_LABELS,
  FESTIVAL_SAFETY_PLAN_LABELS,
  FESTIVAL_ENTRY_MODE_LABELS,
  buildExampleFestivalPlan,
  type FestivalPlan,
  type FestivalSupplement,
  type FestivalVenueType,
} from '@/lib/festival/plan-schema'
import {
  FESTIVAL_DEBATE_ROSTER,
  openingSystemPrompt,
  turnSystemPrompt,
  facilitatorSystemPrompt,
  buildDeliberationContext,
  buildFacilitatorInput,
  parseActionTag,
  parseClaim,
  safeParseJson,
  FESTIVAL_KOREAN_ONLY_DIRECTIVE,
  type FestivalTurn,
  type FestivalFacilitatorSummary,
  type FestivalDebateSeatVoice,
} from '@/lib/festival/debate'
import {
  searchFestivalOfficial,
  formatOfficialFestivalsForPrompt,
} from '@/lib/festival/connectors'

/**
 * FESTIVAL success-forecast pipeline —
 *   investigate (1차) → debate → rescoring (2차) → converge → verdict.
 *
 * ISOLATION INVARIANT (non-negotiable):
 *   - Depends ONLY on shared infra (lib/ai/router) and its own lib/festival/*.
 *   - NEVER imports lib/motie/* or lib/jeju/* — the debate loop, the tuning
 *     constants, and the chair are COPIED/ADAPTED into lib/festival, not branched.
 *   - Deleting lib/festival/* leaves MOTIE + AX Jeju byte-for-byte identical.
 *
 * Stages:
 *   (a) investigate — split into two POSTs so neither exceeds ~250s:
 *         runFestivalScoring   → 7 scoring LLMs, each a 0–100 1차 점수 (전문분야 진단)
 *         runFestivalBenchmark → 2-step fact anchor, NO score, NO debate:
 *           step 1: lib/festival/connectors.ts searchFestivalOfficial() —
 *                   [공식 데이터] TourAPI official PAST comparable festivals in
 *                   the same region (past ~2yr window, NOT the plan's own
 *                   future dates — TourAPI has no record of not-yet-held
 *                   events), ranked by 축제유형 keyword overlap + seasonal
 *                   (month) proximity to the plan's dates (fact anchor,
 *                   existence-level).
 *           step 2: Perplexity — [웹 검색] real-world outcomes (visitors,
 *                   controversies, bagaji, success/failure) of THOSE named
 *                   past official festivals specifically, not a from-scratch
 *                   open-ended search. Falls back to an open search only if
 *                   step 1 found no official comparable.
 *   (b) debate      — runFestivalOpen + runFestivalRound + runFestivalFacilitate,
 *                     6 merged debate seats, SYNOD-style, 3–5 rounds, red-team rotation
 *   (c) rescoring   — runFestivalRescoring: each of the 7 re-scores 0–100 after
 *                     reading a debate summary (lens + whole-picture, evidence-honest)
 *   (d) converge    — convergeFestival: trimmed mean of the 7 STAGE-2 scores
 *                     (drop highest + lowest, average middle 5). NO vote stage.
 *   (e) verdict     — renderFestivalVerdict: chair writes 권고 등급 + 흥행 확률 +
 *                     신뢰구간, top-3 risks, 보완 처방 A/B/C, minority report.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tuning (COPIED from the SYNOD/JEJU deliberation tuning — festival owns its own)
// ─────────────────────────────────────────────────────────────────────────────
export const FESTIVAL_TUNING = {
  MIN_CONVERGENCE_ROUNDS: 3,
  MAX_CONVERGENCE_ROUNDS: 5,
  CONSENSUS_TARGET: 85,
  STALL_DELTA: 4,
  /** Sentinel: a score we could not measure (parse/format failure), never a real 0. */
  SCORE_UNAVAILABLE: -1,
} as const

const OPENING_MAX_TOKENS = 1600
const TURN_MAX_TOKENS = 1600
const FACILITATOR_MAX_TOKENS = 4096
/**
 * Raised 1400 → 2200: a full 0–100 score + real reasoning (risks + uncertainty
 * caveats) for a Korean-output investigator runs long, and the SCORE line was
 * observed getting cut off before the cap was hit (safety_reputation/Opus,
 * the most verbose seat). Prompt now also asks for SCORE FIRST (see
 * SCORE_FIRST_RULE below) so even a truncated tail never loses the score.
 */
const SCORING_MAX_TOKENS = 2200
/**
 * Per-seat headroom override. safety_reputation runs on Claude Opus (the most
 * verbose flagship in this roster) and reasons over the widest surface (crowd/
 * traffic/permits/reputation) — extra headroom on top of SCORING_MAX_TOKENS so
 * its longer reasoning never truncates. Falls back to SCORING_MAX_TOKENS when a
 * seat has no override.
 */
const SCORING_MAX_TOKENS_OVERRIDE: Partial<Record<FestivalInvestigatorId, number>> = {
  safety_reputation: 2600,
}
const BENCHMARK_MAX_TOKENS = 1600
const VERDICT_MAX_TOKENS = 6000

/** Neutral facilitator brand (not a debate seat). */
const FACILITATOR_PROVIDER: ExtendedAiProviderName = 'anthropic'

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The festival plan under review. Re-exports the typed 6-block FestivalPlan from
 * lib/festival/plan-schema (the form payload shape). The previous flat
 * FestivalPlanInput shape is removed — the engine now reads the structured plan.
 */
export type { FestivalPlan, FestivalSupplement } from '@/lib/festival/plan-schema'

/** One scoring investigator's STAGE-1 result (전문분야 진단). */
export type FestivalInvestigatorScore = {
  id: FestivalInvestigatorId
  roleLabelKo: string
  provider: FestivalProvider
  /** 0–100, or FESTIVAL_TUNING.SCORE_UNAVAILABLE when unparseable. */
  score: number
  reasoning: string
  ok: boolean
  error?: string
}

/**
 * STAGE-2 rescore — after debate. Carries both 1차/2차 so the UI can show
 * delta (↑/↓/=) + a one-line change reason.
 */
export type FestivalRescore = {
  id: FestivalInvestigatorId
  roleLabelKo: string
  provider: FestivalProvider
  /** STAGE-1 score (전문분야 진단), or UNAVAILABLE. */
  stage1Score: number
  /** STAGE-2 score (lens + debate whole-picture), or UNAVAILABLE. */
  stage2Score: number
  /** stage2 − stage1 (0 when either is unavailable). */
  delta: number
  /** One-line Korean reason for any change (or "변화 없음"). */
  changeReason: string
  /** Full STAGE-2 reasoning. */
  reasoning: string
  ok: boolean
  error?: string
}

/**
 * Benchmark/competitive-environment facts (no score). Combines two
 * provenance-tagged layers: [공식 데이터] TourAPI searchFestival2 (official
 * existence of comparable festivals in the same region+period) and
 * [웹 검색] Perplexity (their actual real-world outcomes). `facts` is the
 * combined, ready-to-render text; the `official*` fields are additive
 * structured data for future UI use.
 */
export type FestivalBenchmark = {
  ok: boolean
  facts: string | null
  error?: string
  officialOk: boolean
  officialCount: number
  /** True when sigungu query was empty and results came from wider 시/도 scope. */
  fallbackUsed: boolean
}

export type FestivalConfidence = 'high' | 'medium' | 'low'

/** Explicit recommendation grade — evidence decides; no default. */
export type FestivalRecommendationGrade =
  | '추진 권장'
  | '조건부 추진'
  | '재검토 필요'
  | '보류 권고'

export const FESTIVAL_RECOMMENDATION_GRADES: readonly FestivalRecommendationGrade[] = [
  '추진 권장',
  '조건부 추진',
  '재검토 필요',
  '보류 권고',
] as const

/**
 * The converge stage output — trimmed mean of STAGE-2 scores + dispersion.
 * Facilitator consensus is NOT the headline score (that is demoted to 합의 진행도 in UI).
 */
export type FestivalConverge = {
  ok: boolean
  /** Trimmed mean of STAGE-2 scores (drop highest + lowest, average middle), 0–100. */
  overallScore: number
  /** How the overall was computed (always 'trimmed_mean' for STAGE-2). */
  method: 'trimmed_mean'
  /** Population std-dev of the STAGE-2 scores used (the dispersion). */
  dispersion: number
  confidence: FestivalConfidence
  /** Confidence interval derived from dispersion (clamped 0–100). */
  intervalLow: number
  intervalHigh: number
  /** How many of the 7 scoring seats produced a measurable STAGE-2 score. */
  measuredCount: number
  /** Per-seat STAGE-2 score used in the mean (transparency). */
  contributions: { id: FestivalInvestigatorId; roleLabelKo: string; weight: number; score: number }[]
}

export type FestivalStopReason = 'target_reached' | 'stalled' | 'max_rounds' | 'error'

/** The chair's final festival forecast — the deliverable. */
export type FestivalVerdict = {
  ok: boolean
  /** Explicit grade: 추진 권장 / 조건부 추진 / 재검토 필요 / 보류 권고. */
  recommendationGrade: FestivalRecommendationGrade | null
  /** 1–2 sentence rationale under the grade section (optional). */
  recommendationRationale: string | null
  /** 흥행 확률 + 신뢰구간 section. */
  successProbability: string | null
  /** Top-3 risks section. */
  topRisks: string | null
  /** 보완 처방 (A/B/C) section. */
  prescriptions: string | null
  /** Honestly-preserved dissent. */
  minorityReport: string | null
  disclaimer: string
  provider: string
  overallScore: number
  error?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Weights — equal by default (all 7 scoring seats weigh the same). Kept explicit
// so a later tuning pass can rebalance without touching the mean logic.
// ─────────────────────────────────────────────────────────────────────────────
const SCORING_WEIGHTS: Record<FestivalInvestigatorId, number> = {
  demand: 1,
  budget: 1,
  safety_reputation: 1,
  program_diff: 1,
  access_tourism: 1,
  marketing: 1,
  global_tourism: 1,
  // search-only seat never scores; present for exhaustiveness, weight 0.
  benchmark_search: 0,
}

// ─────────────────────────────────────────────────────────────────────────────
// AI call wrapper — sessionId/userId null ⇒ router does NO DB writes.
// ─────────────────────────────────────────────────────────────────────────────
function noDbSupabase(): SupabaseClient {
  return createClient('http://localhost', 'festival-no-db') as unknown as SupabaseClient
}

async function callProvider(params: {
  provider: ExtendedAiProviderName
  systemPrompt: string
  prompt: string
  maxCompletionTokens: number
  modelOverride?: string
}): Promise<{ text: string | null; error?: string | null }> {
  const r = await runSingleAiProvider({
    supabase: noDbSupabase(),
    sessionId: null,
    userId: null,
    provider: params.provider,
    prompt: params.prompt,
    systemPrompt: params.systemPrompt,
    maxCompletionTokens: params.maxCompletionTokens,
    modelOverride: params.modelOverride,
  })
  return { text: r.text, error: r.error }
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan → investigator context rendering
// ─────────────────────────────────────────────────────────────────────────────

/**
 * "예시로 채우기" — returns the fully-filled example FestivalPlan. Kept as the
 * stub path so the form's example button and any direct engine test share one
 * shape (buildExampleFestivalPlan in lib/festival/plan-schema). The previous
 * buildStubFestivalPlan(partial?) overload is removed; callers either submit a
 * real plan or use this example verbatim.
 */
export function buildStubFestivalPlan(): FestivalPlan {
  return buildExampleFestivalPlan()
}

/** Sentinel rendered for any optional field the user left empty. */
const MISSING = '[확인 필요 — 미입력]'

/** Renders "value 또는 MISSING" for an optional free-text field. */
function opt(v: string | undefined): string {
  return v && v.trim() ? v.trim() : MISSING
}

/** Renders an optional yes/no/unknown label, or MISSING when undefined. */
function optLabel(
  v: 'yes' | 'no' | 'unknown' | undefined,
  labels: Record<'yes' | 'no' | 'unknown', string>
): string {
  return v === undefined ? MISSING : labels[v]
}

function optEntryLabel(
  v: 'free' | 'paid' | 'reservation' | undefined,
  labels: Record<'free' | 'paid' | 'reservation', string>
): string {
  return v === undefined ? MISSING : labels[v]
}

function editionLabel(e: FestivalPlan['block1']['edition']): string {
  return e === 'new' ? '신규' : `${e}회차`
}

/** Renders the budget split block (percentages; blanks → MISSING). */
function budgetSplitLines(split: FestivalPlan['block2']['budgetSplit']): string[] {
  const line = (label: string, v: number | '') =>
    `  · ${label}: ${typeof v === 'number' ? `${v}%` : MISSING}`
  return [
    line('프로그램', split.program),
    line('안전', split.safety),
    line('홍보', split.promo),
    line('운영', split.operation),
  ]
}

/**
 * Renders the typed FestivalPlan (6 blocks) into the shared Korean context block
 * that EVERY investigator, debater, and the chair read.
 *
 * Missing OPTIONAL blocks/fields (4–6) render explicitly as [확인 필요 — 미입력]
 * — investigators are instructed (persona layer) to CAP their score and widen
 * uncertainty when inputs are missing, never to default to a good score.
 *
 * Block 6 foreignVisitorPlan is the key differentiator axis: when empty it
 * renders as "외국인 대응 계획 미입력" and the global_tourism seat's persona
 * explicitly surfaces this field (see lib/festival/roster.ts) so the missing
 * plan caps that seat's score.
 *
 * `supplements` (manual paste/URL/file extracts) are appended as a separate
 * [첨부·추가 자료] section, prefixed with the organizer-provided/unverified
 * provenance note so a self-promotional document cannot inflate scores.
 */
export function buildFestivalPlanContext(
  plan: FestivalPlan,
  supplements?: FestivalSupplement[]
): string {
  const b1 = plan.block1
  const b2 = plan.block2
  const b3 = plan.block3
  const b4 = plan.block4
  const b5 = plan.block5
  const b6 = plan.block6

  const lines: string[] = []

  // Block 1 — 기본정보 (required)
  lines.push('■ [Block 1] 기본정보')
  lines.push(`  · 축제명: ${b1.name}`)
  lines.push(`  · 지역(시/군/구): ${b1.region}`)
  lines.push(`  · 개최기간: ${b1.dateStart} ~ ${b1.dateEnd}`)
  lines.push(`  · 장소유형: ${FESTIVAL_VENUE_TYPE_LABELS[b1.venueType]}`)
  lines.push(`  · 축제유형: ${b1.festivalType}`)
  lines.push(`  · 회차: ${editionLabel(b1.edition)}`)

  // Block 2 — 규모·예산 (required)
  lines.push('', '■ [Block 2] 규모·예산')
  lines.push(`  · 총예산: ${b2.totalBudget}`)
  lines.push(`  · 예상 방문객 목표: ${b2.visitorTarget}`)
  lines.push('  · 예산배분(대략 비율):')
  lines.push(...budgetSplitLines(b2.budgetSplit))

  // Block 3 — 프로그램 (required)
  lines.push('', '■ [Block 3] 프로그램')
  const programs = b3.corePrograms.map((p) => p.trim()).filter(Boolean)
  if (programs.length > 0) {
    programs.forEach((p, i) => lines.push(`  · 핵심 프로그램 ${i + 1}: ${p}`))
  } else {
    lines.push(`  · 핵심 프로그램: ${MISSING}`)
  }
  lines.push(`  · 대표콘텐츠/헤드라이너: ${FESTIVAL_HEADLINER_LABELS[b3.hasHeadliner]}`)
  lines.push(`  · 우천 대체프로그램: ${FESTIVAL_RAIN_BACKUP_LABELS[b3.hasRainBackup]}`)

  // Block 4 — 타깃·접근성 (optional; missing → [확인 필요])
  lines.push('', '■ [Block 4] 타깃·접근성 (선택)')
  lines.push(`  · 주 타깃층: ${opt(b4?.primaryAudience)}`)
  lines.push(`  · 대중교통 접근성: ${opt(b4?.transitAccess)}`)
  lines.push(`  · 주변 숙박·관광 인프라: ${opt(b4?.lodgingTourism)}`)

  // Block 5 — 안전·운영 (optional)
  lines.push('', '■ [Block 5] 안전·운영 (선택)')
  lines.push(`  · 예상 동시 최대인파: ${opt(b5?.peakCrowd)}`)
  lines.push(`  · 안전인력·의료계획: ${optLabel(b5?.hasSafetyPlan, FESTIVAL_SAFETY_PLAN_LABELS)}`)
  lines.push(`  · 입장방식: ${optEntryLabel(b5?.entryMode, FESTIVAL_ENTRY_MODE_LABELS)}`)

  // Block 6 — 홍보·차별성 (optional). foreignVisitorPlan is the key axis.
  lines.push('', '■ [Block 6] 홍보·차별성 (선택)')
  lines.push(`  · 홍보채널: ${opt(b6?.promoChannels)}`)
  lines.push(`  · 홍보시작시점: ${opt(b6?.promoStart)}`)
  lines.push(`  · 작년대비 새로운 것/재방문 유도요소: ${opt(b6?.novelty)}`)
  // Explicit, separately-labeled line so the global_tourism seat can locate it.
  const foreignPlan = b6?.foreignVisitorPlan && b6.foreignVisitorPlan.trim()
  lines.push(
    `  · 외국인 대응 계획(다국어/결제/동선): ${foreignPlan ? foreignPlan.trim() : '외국인 대응 계획 미입력'}`
  )

  // Supplements — organizer-provided, unverified (provenance warning first).
  if (supplements && supplements.length > 0) {
    lines.push('', '■ [첨부·추가 자료]')
    lines.push(FESTIVAL_SUPPLEMENT_PROVENANCE_NOTE)
    supplements.forEach((s, i) => {
      const trunc = s.truncated ? ' (일부 잘림)' : ''
      const okMark = s.ok ? '' : ' [추출 실패]'
      lines.push(`  · [자료 ${i + 1}] ${s.label}${trunc}${okMark}`)
      lines.push(s.text.trim() ? s.text.trim() : '(내용 없음)')
    })
  }

  return lines.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// (a) INVESTIGATE — scoring (7 LLMs) + benchmark (Perplexity, no score)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Score-FIRST rule (moved from the end of the response): a truncated response
 * (token cap hit, network cutoff, etc.) always loses whatever comes LAST. When
 * the score was the final line, truncation silently produced an unmeasurable
 * seat with otherwise-good reasoning (observed: safety_reputation/Opus). Asking
 * for the score as the very FIRST line means it survives any later truncation.
 */
const SCORE_FIRST_RULE =
  '출력 순서(반드시 준수, 매우 중요): 응답의 맨 첫 줄을 다른 어떤 텍스트도 없이 정확히 이 형식으로 시작하십시오:\nSCORE: <0-100 정수>\n그 다음 줄부터 당신 렌즈의 근거·리스크·불확실성을 충분히 서술하십시오. 근거를 먼저 쓰고 점수를 맨 뒤에 두지 마십시오 — 응답이 중간에 잘려도 점수가 반드시 보존되도록 점수를 항상 가장 먼저 씁니다.'

/**
 * STAGE-2 output order: SCORE first, then one-line CHANGE_REASON, then reasoning.
 * CHANGE_REASON survives truncation better when placed near the top.
 */
const RESCORE_FIRST_RULE =
  '출력 순서(반드시 준수, 매우 중요):\n1행: SCORE: <0-100 정수>\n2행: CHANGE_REASON: <한 줄 — 1차 대비 변동 사유. 변화 없으면 "변화 없음: (사유)" >\n3행부터: 전문 렌즈 + 토론 전체 그림을 함께 고려한 근거·리스크·불확실성.\n점수를 맨 뒤에 두지 마십시오.'

/** Clamp a model-supplied score to 0–100, else mark unavailable. */
function clampScore(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return FESTIVAL_TUNING.SCORE_UNAVAILABLE
  return Math.max(0, Math.min(100, Math.round(n)))
}

/**
 * Extracts a 0–100 score from a scoring investigator's response, robust to
 * BOTH position (line 1, per SCORE_FIRST_RULE, or anywhere else a model still
 * puts it) and to models that ignore the exact "SCORE:" token.
 *
 * Search order (first match wins):
 *   1. An explicit "SCORE: NN" line anywhere in the text (not anchored to start
 *      or end) — the primary, most reliable signal.
 *   2. Korean score phrasings a model might use instead ("점수: 82", "82점").
 *   3. "NN/100" style.
 * Returns the reasoning with the matched SCORE line (if any) stripped out, so
 * it never leaks into the displayed reasoning text.
 */
function parseScore(raw: string): { reasoning: string; score: number } {
  const lines = raw.split('\n')
  const scoreLineRe = /SCORE:\s*(-?\d{1,3})/i
  const scoreLineIdx = lines.findIndex((l) => scoreLineRe.test(l))
  if (scoreLineIdx !== -1) {
    const m = lines[scoreLineIdx]!.match(scoreLineRe)!
    const score = clampScore(Number(m[1]))
    const reasoning = lines
      .filter((_, i) => i !== scoreLineIdx)
      .join('\n')
      .trim()
    return { reasoning: reasoning || raw.trim(), score }
  }

  // Fallback — model didn't use the "SCORE:" token. Try common Korean/plain
  // score phrasings anywhere in the text before giving up.
  const fallbackPatterns = [
    /점수\s*[:\-]?\s*(-?\d{1,3})\s*점?/i,
    /(-?\d{1,3})\s*\/\s*100/,
    /(-?\d{1,3})\s*점(?:으로|을|입니다|\.)/,
  ]
  for (const re of fallbackPatterns) {
    const m = raw.match(re)
    if (m) return { reasoning: raw.trim(), score: clampScore(Number(m[1])) }
  }

  return { reasoning: raw.trim(), score: FESTIVAL_TUNING.SCORE_UNAVAILABLE }
}

/** Runs ONE scoring investigator. */
async function scoreOneInvestigator(
  persona: FestivalInvestigatorPersona,
  planContext: string
): Promise<FestivalInvestigatorScore> {
  const base: Omit<FestivalInvestigatorScore, 'score' | 'reasoning' | 'ok'> = {
    id: persona.id,
    roleLabelKo: persona.roleLabelKo,
    provider: persona.provider,
  }
  const userPrompt = [
    '[축제 기획안]',
    planContext,
    '',
    SCORE_FIRST_RULE,
    '',
    '위 기획안을 당신의 전문 렌즈에서만 검토하여, 이 축제의 흥행·집행 타당성을 0–100으로 채점하십시오(첫 줄, SCORE:). 그런 다음 그 근거를 구체적으로 서술하십시오.',
  ].join('\n')

  const { text, error } = await callProvider({
    provider: persona.provider as ExtendedAiProviderName,
    systemPrompt: buildFestivalScoringSystemPrompt(persona),
    prompt: userPrompt,
    maxCompletionTokens: SCORING_MAX_TOKENS_OVERRIDE[persona.id] ?? SCORING_MAX_TOKENS,
    ...(persona.modelOverride ? { modelOverride: persona.modelOverride } : {}),
  })

  if (error || !text || !text.trim()) {
    return {
      ...base,
      score: FESTIVAL_TUNING.SCORE_UNAVAILABLE,
      reasoning: '',
      ok: false,
      error: error ?? '조사관이 빈 응답을 반환했습니다.',
    }
  }
  const { reasoning, score } = parseScore(text)
  return { ...base, score, reasoning, ok: score !== FESTIVAL_TUNING.SCORE_UNAVAILABLE }
}

/** Investigate — 7 scoring LLMs in parallel (Perplexity handled separately). STAGE-1. */
export async function runFestivalScoring(
  plan: FestivalPlan,
  supplements?: FestivalSupplement[]
): Promise<FestivalInvestigatorScore[]> {
  const planContext = buildFestivalPlanContext(plan, supplements)
  return Promise.all(
    FESTIVAL_SCORING_INVESTIGATORS.map((p) => scoreOneInvestigator(p, planContext))
  )
}

/**
 * Investigate — 2-step benchmark/competitive-environment fact anchor (NO score).
 *
 * Step 1 (fact anchor): searchFestivalOfficial() — TourAPI's OFFICIAL list of
 * PAST comparable festivals in the same region (past ~2yr window, ranked by
 * festival-type + seasonal match to the plan — NOT the plan's own future
 * dates, which TourAPI cannot have a record of yet). Deterministic, not an
 * LLM call; tagged [공식 데이터] in the output.
 *
 * Step 2 (real outcomes): Perplexity is given THOSE specific official names
 * and asked to find their actual performance/reputation — not an open-ended
 * from-scratch search. If step 1 found nothing official (unresolved region,
 * API error, or a genuinely empty official list), Perplexity falls back to an
 * open search for similar/competing festivals, clearly noted as such. Tagged
 * [웹 검색] in the output.
 *
 * This combination — official existence + real outcomes — is what lets the
 * verdict stage catch overstatement (e.g. "plan projects 250k visitors but the
 * only official comparable in the area actually drew 30k").
 */
export async function runFestivalBenchmark(
  plan: FestivalPlan,
  supplements?: FestivalSupplement[]
): Promise<FestivalBenchmark> {
  const planContext = buildFestivalPlanContext(plan, supplements)

  const official = await searchFestivalOfficial({
    region: plan.block1.region,
    dateStart: plan.block1.dateStart,
    dateEnd: plan.block1.dateEnd,
    festivalType: plan.block1.festivalType,
  })
  const officialBlock = formatOfficialFestivalsForPrompt(official)
  const officialOk = official.ok
  const officialCount = official.ok ? official.events.length : 0
  const fallbackUsed = official.ok ? official.fallbackUsed : false

  const persona = FESTIVAL_SEARCH_INVESTIGATOR
  const namedTitles = officialOk && official.ok ? official.events.map((e) => e.title) : []

  const userPrompt =
    namedTitles.length > 0
      ? [
          '[축제 기획안]',
          planContext,
          '',
          '[공식 데이터 — 이미 확보됨, 재검색 금지]',
          officialBlock,
          '',
          '위 목록은 한국관광공사 TourAPI에서 조회한 공식 데이터입니다. 목록 자체의 존재 여부나 진위를 재검색하지 마십시오.',
          '당신의 임무: 위에 나열된 각 축제의 "실제 성과·평판"을 조사하십시오 — 방문객 수, 논란(바가지 등), 성공/실패 여부, 언론 보도. 목록에 없는 축제를 새로 찾지 마십시오.',
          '각 축제별로 항목을 나누어 제시하고, 출처·시점을 명시하며, 확인되지 않은 것은 [확인 필요]로 표시하십시오.',
        ].join('\n')
      : [
          '[축제 기획안]',
          planContext,
          '',
          '[공식 데이터]',
          officialBlock,
          '',
          'TourAPI에서 해당 지역·기간의 공식 비교 축제를 찾지 못했습니다. 이 경우에 한해 위 축제와 유사·경쟁하는 축제들을 폭넓게 검색하여 사실을 조사하십시오. 점수나 개최 권고는 하지 마십시오.',
        ].join('\n')

  const { text, error } = await callProvider({
    provider: persona.provider as ExtendedAiProviderName,
    systemPrompt: buildFestivalSearchSystemPrompt(persona),
    prompt: userPrompt,
    maxCompletionTokens: BENCHMARK_MAX_TOKENS,
  })

  if (error || !text || !text.trim()) {
    // Official step may still be useful on its own even if Perplexity failed.
    if (officialOk) {
      return {
        ok: true,
        facts: [officialBlock, '', `[웹 검색 — Perplexity] 조사 실패: ${error ?? '빈 응답'}`].join('\n'),
        officialOk,
        officialCount,
        fallbackUsed,
      }
    }
    return {
      ok: false,
      facts: null,
      error: error ?? '벤치마크 조사가 빈 응답을 반환했습니다.',
      officialOk,
      officialCount,
      fallbackUsed,
    }
  }

  const facts = [officialBlock, '', '[웹 검색 — Perplexity] 위 공식 목록(또는 유사 축제)의 실제 성과·평판:', text.trim()].join(
    '\n'
  )
  return { ok: true, facts, officialOk, officialCount, fallbackUsed }
}

// ─────────────────────────────────────────────────────────────────────────────
// (c) RESCORING — STAGE-2 after last facilitate, before converge
// ─────────────────────────────────────────────────────────────────────────────

/** Compact debate summary fed to each STAGE-2 rescoring investigator. */
function buildDebateSummaryForRescore(
  turns: FestivalTurn[],
  summaries: FestivalFacilitatorSummary[],
  stage1Scores: FestivalInvestigatorScore[],
  benchmark: FestivalBenchmark | undefined
): string {
  const blocks: string[] = []
  blocks.push('■ 1차 점수 (전문분야 진단)')
  for (const s of stage1Scores) {
    const sc = s.score === FESTIVAL_TUNING.SCORE_UNAVAILABLE ? '측정 불가' : `${s.score}`
    blocks.push(`- ${s.roleLabelKo}: ${sc}점${s.ok ? '' : ' (실패)'}`)
  }
  if (benchmark?.facts) {
    blocks.push('', '■ 벤치마크·경쟁환경 (요약)')
    blocks.push(benchmark.facts.slice(0, 1200) + (benchmark.facts.length > 1200 ? '…' : ''))
  }
  blocks.push('', '■ 토론 수렴 요약')
  if (summaries.length === 0) {
    blocks.push('(토론 기록 없음)')
  } else {
    for (const s of summaries) {
      const roundTurns = turns.filter((t) => t.roundNumber === s.roundNumber)
      blocks.push(`▷ 라운드 ${s.roundNumber} (합의 진행도 ${s.roundConsensusScore}/100)`)
      for (const cp of s.consensusPoints) blocks.push(`  · 합의: ${cp.point}`)
      for (const oi of s.openIssues) blocks.push(`  · 쟁점: ${oi.issue}`)
      for (const t of roundTurns) {
        const claim = t.claim ?? t.content.slice(0, 160)
        blocks.push(`  · [${t.seatLabel}${t.isRedTeam ? ' · 스트레스테스트' : ''}] ${claim}`)
      }
    }
  }
  return blocks.join('\n')
}

function parseChangeReason(raw: string): string {
  const lines = raw.split('\n')
  const re = /CHANGE_REASON:\s*(.+)/i
  const idx = lines.findIndex((l) => re.test(l))
  if (idx !== -1) {
    const m = lines[idx]!.match(re)!
    return (m[1] ?? '').trim() || '변화 사유 미기재'
  }
  // Fallback: look for Korean one-liners near the top
  const ko = raw.match(/(?:변동\s*사유|변화\s*사유|변경\s*사유)\s*[:：]\s*(.+)/)
  if (ko?.[1]) return ko[1].trim()
  return '변화 사유 미기재'
}

function stripChangeReasonLine(raw: string): string {
  return raw
    .split('\n')
    .filter((l) => !/CHANGE_REASON:/i.test(l) && !/(?:변동\s*사유|변화\s*사유|변경\s*사유)\s*[:：]/.test(l))
    .join('\n')
    .trim()
}

/** Runs ONE STAGE-2 rescoring investigator. */
async function rescoreOneInvestigator(
  persona: FestivalInvestigatorPersona,
  planContext: string,
  debateSummary: string,
  stage1: FestivalInvestigatorScore | undefined
): Promise<FestivalRescore> {
  const stage1Score = stage1?.score ?? FESTIVAL_TUNING.SCORE_UNAVAILABLE
  const base = {
    id: persona.id,
    roleLabelKo: persona.roleLabelKo,
    provider: persona.provider,
    stage1Score,
  }
  const stage1Label =
    stage1Score === FESTIVAL_TUNING.SCORE_UNAVAILABLE ? '측정 불가' : `${stage1Score}`

  const userPrompt = [
    '[축제 기획안]',
    planContext,
    '',
    '[토론·조사 요약]',
    debateSummary,
    '',
    `당신의 1차 점수(전문분야 진단): ${stage1Label}점`,
    '',
    RESCORE_FIRST_RULE,
    '',
    '위 기획안과 토론 요약을 읽고, 당신의 전문 렌즈와 토론 전체 그림을 함께 고려해 2차 점수(0–100)를 매기십시오.',
    '낙관·비관 기본값 없이, 증거에만 근거하십시오. 근본적·고치기 어려운 문제가 드러났으면 내리고, 명확한 강점·실행가능성이 보이면 사소한 리스크로 부당하게 깎지 마십시오.',
  ].join('\n')

  const { text, error } = await callProvider({
    provider: persona.provider as ExtendedAiProviderName,
    systemPrompt: buildFestivalRescoringSystemPrompt(persona),
    prompt: userPrompt,
    maxCompletionTokens: SCORING_MAX_TOKENS_OVERRIDE[persona.id] ?? SCORING_MAX_TOKENS,
    ...(persona.modelOverride ? { modelOverride: persona.modelOverride } : {}),
  })

  if (error || !text || !text.trim()) {
    return {
      ...base,
      stage2Score: FESTIVAL_TUNING.SCORE_UNAVAILABLE,
      delta: 0,
      changeReason: '',
      reasoning: '',
      ok: false,
      error: error ?? '2차 재채점이 빈 응답을 반환했습니다.',
    }
  }

  const { score: stage2Score, reasoning: rawReasoning } = parseScore(text)
  const changeReason = parseChangeReason(text)
  const reasoning = stripChangeReasonLine(rawReasoning)
  const delta =
    stage1Score === FESTIVAL_TUNING.SCORE_UNAVAILABLE ||
    stage2Score === FESTIVAL_TUNING.SCORE_UNAVAILABLE
      ? 0
      : stage2Score - stage1Score

  return {
    ...base,
    stage2Score,
    delta,
    changeReason:
      changeReason ||
      (delta === 0 ? '변화 없음' : delta > 0 ? '상향 (사유 미기재)' : '하향 (사유 미기재)'),
    reasoning,
    ok: stage2Score !== FESTIVAL_TUNING.SCORE_UNAVAILABLE,
  }
}

/**
 * STAGE-2 rescoring — after last facilitate, before converge.
 * Each of the 7 scoring investigators re-scores with debate summary + own lens.
 */
export async function runFestivalRescoring(params: {
  plan: FestivalPlan
  supplements?: FestivalSupplement[]
  stage1Scores: FestivalInvestigatorScore[]
  turns: FestivalTurn[]
  summaries: FestivalFacilitatorSummary[]
  benchmark?: FestivalBenchmark
}): Promise<FestivalRescore[]> {
  const { plan, supplements, stage1Scores, turns, summaries, benchmark } = params
  const planContext = buildFestivalPlanContext(plan, supplements)
  const debateSummary = buildDebateSummaryForRescore(turns, summaries, stage1Scores, benchmark)
  return Promise.all(
    FESTIVAL_SCORING_INVESTIGATORS.map((p) =>
      rescoreOneInvestigator(
        p,
        planContext,
        debateSummary,
        stage1Scores.find((s) => s.id === p.id)
      )
    )
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Debate briefing seed — scores + benchmark rendered for the debaters + chair
// ─────────────────────────────────────────────────────────────────────────────

/** One-liner display name for a scoring seat's brand. */
function scoreLine(s: FestivalInvestigatorScore): string {
  const score = s.score === FESTIVAL_TUNING.SCORE_UNAVAILABLE ? '측정 불가' : `${s.score}점`
  const reasoning = s.reasoning.trim()
  return `- ${s.roleLabelKo} (${score})\n${reasoning || '(근거 없음)'}`
}

/**
 * The pre-debate briefing prepended to every debater's prompt (and fed to the
 * chair): the 7 investigator scores + reasoning, then the Perplexity benchmark.
 */
export function buildFestivalBriefing(
  scores: FestivalInvestigatorScore[],
  benchmark: FestivalBenchmark | undefined
): string {
  const parts: string[] = ['[사전 조사 요약 — 토론 전 반드시 숙지]', '', '■ 조사관별 흥행 점수 및 근거']
  for (const s of scores) parts.push(scoreLine(s))
  parts.push('', '■ 벤치마크·경쟁환경 조사 (Perplexity, 점수 없음)')
  parts.push(benchmark?.ok && benchmark.facts ? benchmark.facts : '(벤치마크 조사 결과 없음)')
  return parts.join('\n')
}

function briefingPreamble(briefing: string): string {
  if (!briefing.trim()) return ''
  return [briefing.trim(), '', '---', ''].join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// (b) DEBATE — open (round 1) + per-round turn + facilitate
// ─────────────────────────────────────────────────────────────────────────────

/** Round 1 — all 6 seats give independent opinions (parallel). */
export async function runFestivalOpen(params: {
  question: string
  briefing: string
}): Promise<FestivalTurn[]> {
  const { question, briefing } = params
  const preamble = briefingPreamble(briefing)
  const results = await Promise.all(
    FESTIVAL_DEBATE_ROSTER.map(async (seat) => {
      const userPrompt = [
        preamble,
        '[심의 안건]',
        question,
        '',
        '위 안건에 대해, 사전 조사 요약을 근거로 당신 좌석의 독립적이고 명확한 전망을 제시하세요.',
      ].join('\n')
      const { text } = await callProvider({
        provider: seat.provider as ExtendedAiProviderName,
        systemPrompt: openingSystemPrompt(seat),
        prompt: userPrompt,
        maxCompletionTokens: OPENING_MAX_TOKENS,
        ...(seat.modelOverride ? { modelOverride: seat.modelOverride } : {}),
      })
      return { seat, text }
    })
  )

  const turns: FestivalTurn[] = []
  for (const { seat, text } of results) {
    if (!text || !text.trim()) continue
    const a = parseActionTag(text)
    const c = parseClaim(a.content)
    turns.push({
      roundNumber: 1,
      seatLabel: seat.labelKo,
      seatId: seat.seatId,
      ...(a.tag ? { actionTag: a.tag } : {}),
      ...(c.claim ? { claim: c.claim } : {}),
      content: c.content,
      isRedTeam: false,
    })
  }
  return turns
}

/** ONE debate round (serial so each seat reacts), with red-team rotation. */
export async function runFestivalRound(params: {
  question: string
  briefing: string
  roundNumber: number
  priorSummaries: FestivalFacilitatorSummary[]
}): Promise<FestivalTurn[]> {
  const { question, briefing, roundNumber, priorSummaries } = params
  const roster = FESTIVAL_DEBATE_ROSTER

  // Rotate the stress-tester each round; OFF on the final round so the panel can
  // genuinely converge (SYNOD-faithful).
  const isFinalRound = roundNumber >= FESTIVAL_TUNING.MAX_CONVERGENCE_ROUNDS
  const redTeamSeat: FestivalDebateSeatVoice | null = isFinalRound
    ? null
    : roster[roundNumber % roster.length]!

  const preamble = briefingPreamble(briefing)
  const currentRoundTurns: FestivalTurn[] = []
  for (const seat of roster) {
    const isRedTeam = redTeamSeat !== null && seat.seatId === redTeamSeat.seatId
    const ctx = buildDeliberationContext({ question, priorSummaries, currentRoundTurns })
    const userPrompt = [preamble, ctx].filter((s) => s !== '').join('\n')
    const { text } = await callProvider({
      provider: seat.provider as ExtendedAiProviderName,
      systemPrompt: turnSystemPrompt(seat, isRedTeam, roundNumber),
      prompt: userPrompt,
      maxCompletionTokens: TURN_MAX_TOKENS,
      ...(seat.modelOverride ? { modelOverride: seat.modelOverride } : {}),
    })
    if (!text || !text.trim()) continue
    const a = parseActionTag(text)
    const c = parseClaim(a.content)
    currentRoundTurns.push({
      roundNumber,
      seatLabel: seat.labelKo,
      seatId: seat.seatId,
      ...(a.tag ? { actionTag: a.tag } : {}),
      ...(c.claim ? { claim: c.claim } : {}),
      content: c.content,
      isRedTeam,
    })
  }
  return currentRoundTurns
}

/** Parses the facilitator's strict-JSON output into a FestivalFacilitatorSummary. */
export function parseFacilitatorSummary(
  raw: string,
  roundNumber: number
): FestivalFacilitatorSummary | null {
  const parsed = safeParseJson(raw)
  if (!parsed) return null

  const consensusPoints: FestivalFacilitatorSummary['consensusPoints'] = Array.isArray(
    parsed.consensusPoints
  )
    ? parsed.consensusPoints
        .map((cp): FestivalFacilitatorSummary['consensusPoints'][number] | null => {
          if (!cp || typeof cp !== 'object') return null
          const o = cp as Record<string, unknown>
          const point = typeof o.point === 'string' ? o.point.trim() : ''
          if (!point) return null
          const agreedBy = Array.isArray(o.agreedBy)
            ? o.agreedBy.filter((x): x is string => typeof x === 'string')
            : []
          return { point, agreedBy }
        })
        .filter((x): x is FestivalFacilitatorSummary['consensusPoints'][number] => x !== null)
    : []

  const openIssues: FestivalFacilitatorSummary['openIssues'] = Array.isArray(parsed.openIssues)
    ? parsed.openIssues
        .map((oi): FestivalFacilitatorSummary['openIssues'][number] | null => {
          if (!oi || typeof oi !== 'object') return null
          const o = oi as Record<string, unknown>
          const issue = typeof o.issue === 'string' ? o.issue.trim() : ''
          if (!issue) return null
          const positions = Array.isArray(o.positions)
            ? o.positions
                .map((p): { ai: string; stance: string } | null => {
                  if (!p || typeof p !== 'object') return null
                  const po = p as Record<string, unknown>
                  const ai = typeof po.ai === 'string' ? po.ai.trim() : ''
                  const stance = typeof po.stance === 'string' ? po.stance.trim() : ''
                  if (!ai || !stance) return null
                  return { ai, stance }
                })
                .filter((x): x is { ai: string; stance: string } => x !== null)
            : []
          return { issue, positions }
        })
        .filter((x): x is FestivalFacilitatorSummary['openIssues'][number] => x !== null)
    : []

  const nextDirective = typeof parsed.nextDirective === 'string' ? parsed.nextDirective.trim() : ''

  return {
    roundNumber,
    consensusPoints,
    openIssues,
    roundConsensusScore: clampScore(parsed.roundConsensusScore),
    nextDirective,
  }
}

/** Runs ONE facilitator call for the given round. */
export async function runFestivalFacilitate(params: {
  question: string
  roundNumber: number
  allTurnsThisRound: FestivalTurn[]
  priorSummaries: FestivalFacilitatorSummary[]
}): Promise<FestivalFacilitatorSummary | null> {
  const { question, roundNumber, allTurnsThisRound, priorSummaries } = params
  const input = buildFacilitatorInput({ question, roundNumber, allTurnsThisRound, priorSummaries })
  const { text } = await callProvider({
    provider: FACILITATOR_PROVIDER,
    systemPrompt: facilitatorSystemPrompt(),
    prompt: input,
    maxCompletionTokens: FACILITATOR_MAX_TOKENS,
  })
  return text ? parseFacilitatorSummary(text, roundNumber) : null
}

/**
 * Loop control — SYNOD's monotonic facilitator-scored stop logic. Evaluated only
 * AFTER a completed round. `score` must be measurable (caller guards UNAVAILABLE).
 */
export function festivalLoopControl(
  summaries: FestivalFacilitatorSummary[]
): { done: boolean; stoppedReason?: FestivalStopReason } {
  const { MIN_CONVERGENCE_ROUNDS, MAX_CONVERGENCE_ROUNDS, CONSENSUS_TARGET, STALL_DELTA } =
    FESTIVAL_TUNING
  const roundsRun = summaries.length
  const score = summaries[summaries.length - 1]?.roundConsensusScore ?? FESTIVAL_TUNING.SCORE_UNAVAILABLE
  let done = false
  let stoppedReason: FestivalStopReason | undefined

  if (roundsRun >= MIN_CONVERGENCE_ROUNDS) {
    if (score >= CONSENSUS_TARGET) {
      done = true
      stoppedReason = 'target_reached'
    } else {
      const prevScore = summaries[summaries.length - 2]?.roundConsensusScore ?? score
      if (score - prevScore < STALL_DELTA) {
        done = true
        stoppedReason = 'stalled'
      }
    }
  }
  if (!done && roundsRun >= MAX_CONVERGENCE_ROUNDS) {
    done = true
    stoppedReason = 'max_rounds'
  }
  return done ? { done, stoppedReason } : { done }
}

// ─────────────────────────────────────────────────────────────────────────────
// (d) CONVERGE — trimmed mean of the 7 STAGE-2 scores + dispersion → confidence
// ─────────────────────────────────────────────────────────────────────────────

function stdDev(values: number[], mean: number): number {
  if (values.length === 0) return 0
  const variance = values.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / values.length
  return Math.sqrt(variance)
}

/**
 * Trimmed mean: drop highest + lowest, average the middle.
 * With 7 scores → middle 5. With fewer than 3 measured → plain mean (can't trim).
 */
function trimmedMean(values: number[]): number {
  if (values.length === 0) return FESTIVAL_TUNING.SCORE_UNAVAILABLE
  if (values.length < 3) {
    return Math.round(values.reduce((a, v) => a + v, 0) / values.length)
  }
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.slice(1, -1)
  return Math.round(middle.reduce((a, v) => a + v, 0) / middle.length)
}

/**
 * No vote. Trimmed mean of STAGE-2 scores = overall 흥행 score; spread = confidence.
 * Accepts either FestivalRescore[] (preferred) or FestivalInvestigatorScore[]
 * (legacy / mapped stage2).
 */
export function convergeFestival(
  scores: FestivalRescore[] | FestivalInvestigatorScore[]
): FestivalConverge {
  const asStage2: FestivalInvestigatorScore[] = scores.map((s) => {
    if ('stage2Score' in s) {
      return {
        id: s.id,
        roleLabelKo: s.roleLabelKo,
        provider: s.provider,
        score: s.stage2Score,
        reasoning: s.reasoning,
        ok: s.ok,
      }
    }
    return s
  })

  const measured = asStage2.filter((s) => s.ok && s.score !== FESTIVAL_TUNING.SCORE_UNAVAILABLE)

  const contributions = measured.map((s) => ({
    id: s.id,
    roleLabelKo: s.roleLabelKo,
    weight: SCORING_WEIGHTS[s.id] ?? 1,
    score: s.score,
  }))

  if (measured.length === 0) {
    return {
      ok: false,
      overallScore: FESTIVAL_TUNING.SCORE_UNAVAILABLE,
      method: 'trimmed_mean',
      dispersion: 0,
      confidence: 'low',
      intervalLow: FESTIVAL_TUNING.SCORE_UNAVAILABLE,
      intervalHigh: FESTIVAL_TUNING.SCORE_UNAVAILABLE,
      measuredCount: 0,
      contributions,
    }
  }

  const values = contributions.map((c) => c.score)
  const overallScore = trimmedMean(values)
  const meanForDispersion = values.reduce((a, v) => a + v, 0) / values.length
  const dispersion = stdDev(values, meanForDispersion)

  const confidence: FestivalConfidence =
    measured.length < 2 ? 'low' : dispersion <= 8 ? 'high' : dispersion <= 16 ? 'medium' : 'low'

  const margin = Math.round(dispersion)
  const intervalLow = Math.max(0, overallScore - margin)
  const intervalHigh = Math.min(100, overallScore + margin)

  return {
    ok: true,
    overallScore,
    method: 'trimmed_mean',
    dispersion: Math.round(dispersion * 10) / 10,
    confidence,
    intervalLow,
    intervalHigh,
    measuredCount: measured.length,
    contributions,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// (e) VERDICT — chair (Claude Opus) renders the festival forecast + 권고 등급
// ─────────────────────────────────────────────────────────────────────────────

const CONFIDENCE_KO: Record<FestivalConfidence, string> = {
  high: '높음',
  medium: '보통',
  low: '낮음',
}

/** Renders the converge result as chair context. */
function convergeForChair(c: FestivalConverge): string {
  const overall = c.overallScore === FESTIVAL_TUNING.SCORE_UNAVAILABLE ? '측정 불가' : `${c.overallScore}점`
  const interval =
    c.intervalLow === FESTIVAL_TUNING.SCORE_UNAVAILABLE
      ? '측정 불가'
      : `${c.intervalLow}~${c.intervalHigh}점`
  const lines = [
    `최종 흥행 점수(2차 점수 trimmed mean): ${overall} (측정 좌석 ${c.measuredCount}/7)`,
    `산출 방식: 최고·최저 제외 후 중간값 평균 (trimmed mean)`,
    `점수 분산(표준편차): ${c.dispersion} → 신뢰도 ${CONFIDENCE_KO[c.confidence]}`,
    `점수 분산 기반 신뢰구간: ${interval}`,
    '좌석별 2차 점수:',
    ...c.contributions.map((x) => `  - ${x.roleLabelKo}: ${x.score}점`),
  ]
  return lines.join('\n')
}

/** Renders 1차/2차 comparison for the chair. */
function rescoresForChair(rescores: FestivalRescore[]): string {
  if (rescores.length === 0) return '(2차 재채점 없음)'
  return rescores
    .map((r) => {
      const s1 = r.stage1Score === FESTIVAL_TUNING.SCORE_UNAVAILABLE ? '—' : String(r.stage1Score)
      const s2 = r.stage2Score === FESTIVAL_TUNING.SCORE_UNAVAILABLE ? '—' : String(r.stage2Score)
      const arrow = r.delta > 0 ? '↑' : r.delta < 0 ? '↓' : '='
      return `- ${r.roleLabelKo}: 1차 ${s1} → 2차 ${s2} (${arrow}${r.delta !== 0 ? Math.abs(r.delta) : ''}) — ${r.changeReason}`
    })
    .join('\n')
}

/** Renders the debate rounds (facilitator summaries + turns) as chair context. */
function debateForChair(
  turns: FestivalTurn[],
  summaries: FestivalFacilitatorSummary[]
): string {
  if (summaries.length === 0) return '(토론 기록 없음)'
  const blocks: string[] = []
  for (const s of summaries) {
    const roundTurns = turns.filter((t) => t.roundNumber === s.roundNumber)
    const agreed = s.consensusPoints.map((cp) => `  · 합의: ${cp.point}`).join('\n')
    const contested = s.openIssues.map((oi) => `  · 쟁점: ${oi.issue}`).join('\n')
    const speaker = roundTurns
      .map((t) => `  [${t.seatLabel}${t.isRedTeam ? ' · 스트레스테스트' : ''}] ${t.claim ?? t.content.slice(0, 120)}`)
      .join('\n')
    blocks.push(
      [
        `▷ 라운드 ${s.roundNumber} (합의 진행도 ${s.roundConsensusScore}/100)`,
        agreed || '  · 합의: 없음',
        contested || '  · 쟁점: 없음',
        speaker,
      ].join('\n')
    )
  }
  return blocks.join('\n\n')
}

/** Chair system prompt — festival forecast structure (no MOTIE/Jeju import). */
function buildFestivalChairSystemPrompt(converge: FestivalConverge): string {
  const lines = [...FESTIVAL_CHAIR_PERSONA_LINES]

  if (converge.ok && converge.confidence === 'high') {
    lines.push(
      `조사관들의 2차 점수 분산이 작아(신뢰도 높음) 전망이 비교적 명확합니다. 그 합의를 확정하고 날카롭게 다듬으십시오.`
    )
  } else {
    lines.push(
      `조사관들의 2차 점수 분산이 큽니다(신뢰도 ${CONFIDENCE_KO[converge.confidence]}). 바로 이럴 때 당신의 판단이 가장 중요합니다. "조사관들이 갈렸다"로 회피하지 말고, 흩어진 근거를 저울질하여 방어 가능한 단일 전망과 신뢰구간을 책임지고 제시하십시오. 신뢰도가 낮다는 사실 자체도 정직하게 밝히십시오.`
    )
  }

  lines.push(
    '',
    '아래 구조를 정확히 따르되 각 절은 한국어 산문으로 작성하고, 각 절은 반드시 "## " 머리말로 시작하십시오.',
    '분량 배분: "## 권고 등급"을 맨 앞에, 이어서 "## 흥행 확률 및 신뢰구간"과 "## 보완 처방(A/B/C)"에 큰 비중을 두고, 반드시 마지막 "## 소수의견(마이너리티 리포트)"와 "## 참고 사항"까지 빠짐없이 작성하십시오.',
    '',
    '## 권고 등급',
    '출력을 반드시 이 절로 시작하십시오. 아래 네 가지 중 정확히 하나만, 그 등급명만 한 줄로 쓰십시오(다른 문구 금지):',
    '추진 권장 / 조건부 추진 / 재검토 필요 / 보류 권고',
    '그 다음 1~2문장으로 왜 그 등급인지 근거를 적으십시오.',
    '등급 선택 원칙(증거 결정, 기본값 없음):',
    '- 추진 권장: 차별성·실행가능성·현실적 계획이 분명한 강건한 축제 — 주저 없이 부여',
    '- 조건부 추진: 핵심은 살릴 만하나 필수 보완(예산·안전·홍보 등)이 선행되어야 함',
    '- 재검토 필요: 불확실성·자료 공백·쟁점이 커서 현 기획안으로는 판단이 성급함',
    '- 보류 권고: 과장 수요·업체 쏠림·무차별성·만성 안전/바가지 등 구조적 결함 — 주저 없이 부여',
    '어느 등급으로도 기본값을 두지 마십시오. "안전한 중간"으로 조건부만 고르지 마십시오.',
    '',
    '## 흥행 확률 및 신뢰구간',
    '2차 점수 trimmed mean을 흥행 확률로 제시하고(예: "약 ○○% 흥행 유망"), 점수 분산 기반 신뢰구간과 그 신뢰도(높음/보통/낮음)를 함께 밝히십시오. 분산이 크면 왜 신뢰도가 낮은지 한 문장으로 설명하십시오. 추정에는 [AI 추정]을 붙이십시오.',
    '',
    '## 핵심 리스크 Top 3',
    '이 축제의 흥행을 위협하는 가장 중요한 리스크 3가지를, 각 줄 "- "로 시작해 정확히 3개만 제시하고, 각 리스크가 어느 조사관·토론에서 제기됐는지 근거를 짧게 붙이십시오.',
    '',
    '## 보완 처방(A/B/C)',
    '리스크를 낮추고 흥행을 끌어올릴 실행 처방을 A/B/C 세 갈래로 제시하십시오. A는 즉시 실행(저비용·필수), B는 중기 보강(예산·협업 필요), C는 확장 시나리오(성공 시 규모 확대). 각 처방은 구체적 행동으로 쓰되, 근거 없는 수치는 [AI 추정] 또는 정성적으로 표현하십시오.',
    '',
    '## 소수의견(마이너리티 리포트)',
    '이 절은 형식적으로 채우지 말고 실질적으로 쓰십시오. (1) 어느 조사관·좌석이 왜 이견을 냈는지, (2) 그 반대 근거를 스틸맨(steelman)하여 공정하게 서술, (3) 어떤 근거·조건이 확인되면 전망이 바뀔지 적으십시오. 최소 3~4문장. 분산이 작아도 토론 중 가장 중요한 유보·리스크 하나는 반드시 짚으십시오.',
    '',
    '## 참고 사항',
    FESTIVAL_DISCLAIMER,
    '',
    '데이터 정직성: 반드시 제공된 심의 자료(기획안·1차/2차 점수·벤치마크·토론)에 근거하십시오. 공식 데이터와 [AI 추정]을 구분하고, 자료에 없는 사실을 지어내지 마십시오. 근거 없는 구체 수치(관객 수·매출·예산)는 반복하지 말고 정성적으로 다루십시오.',
    '',
    FESTIVAL_KOREAN_ONLY_DIRECTIVE,
  )
  return lines.join('\n')
}

type ChairSections = {
  recommendationGrade: FestivalRecommendationGrade | null
  recommendationRationale: string | null
  successProbability: string | null
  topRisks: string | null
  prescriptions: string | null
  minorityReport: string | null
  disclaimer: string | null
  matchedAny: boolean
}

function parseRecommendationGrade(text: string): FestivalRecommendationGrade | null {
  for (const g of FESTIVAL_RECOMMENDATION_GRADES) {
    if (text.includes(g)) return g
  }
  return null
}

function chairSectionField(
  heading: string
): keyof Omit<ChairSections, 'matchedAny' | 'recommendationGrade' | 'recommendationRationale'> | 'recommendation' | null {
  const h = heading.trim().toLowerCase()
  if (h.includes('권고') || h.includes('등급') || h.includes('recommendation')) return 'recommendation'
  if (h.includes('흥행 확률') || h.includes('신뢰구간') || h.includes('흥행확률')) return 'successProbability'
  if (h.includes('리스크') || h.includes('risk')) return 'topRisks'
  if (h.includes('보완') || h.includes('처방')) return 'prescriptions'
  if (h.includes('마이너리티') || h.includes('소수의견') || h.includes('minority')) return 'minorityReport'
  if (h.includes('참고')) return 'disclaimer'
  return null
}

function parseChairOutput(text: string): ChairSections {
  const result: ChairSections = {
    recommendationGrade: null,
    recommendationRationale: null,
    successProbability: null,
    topRisks: null,
    prescriptions: null,
    minorityReport: null,
    disclaimer: null,
    matchedAny: false,
  }
  const parts = text.split(/^\s*##\s+/m)
  for (const part of parts) {
    if (part.trim() === '') continue
    const nl = part.indexOf('\n')
    if (nl === -1) continue
    const heading = part.slice(0, nl)
    const body = part.slice(nl + 1).trim()
    const field = chairSectionField(heading)
    if (!field || body === '') continue
    if (field === 'recommendation') {
      result.recommendationGrade = parseRecommendationGrade(body)
      result.recommendationRationale = body
      result.matchedAny = true
      continue
    }
    result[field] = body
    result.matchedAny = true
  }
  // Fallback: grade may appear anywhere if section split failed
  if (!result.recommendationGrade) {
    result.recommendationGrade = parseRecommendationGrade(text)
  }
  return result
}

/** Reconstructs a minority report from surviving contested points (never lose dissent). */
function fallbackMinorityReport(summaries: FestivalFacilitatorSummary[]): string | null {
  const last = summaries[summaries.length - 1]
  if (!last || last.openIssues.length === 0) return null
  return [
    '(토론 기록에서 자동 보존된 잔존 쟁점 — 판결문에 명시되지 않아 미합의 항목을 복원함)',
    '',
    '다음 쟁점들은 토론 종료 시점까지 합의에 이르지 못한 채 남았습니다:',
    ...last.openIssues.map((oi) => `• ${oi.issue}`),
  ].join('\n')
}

/** The chair reads the whole case file and renders the festival forecast. Never throws. */
export async function renderFestivalVerdict(params: {
  plan: FestivalPlan
  supplements?: FestivalSupplement[]
  scores: FestivalInvestigatorScore[]
  rescores?: FestivalRescore[]
  benchmark: FestivalBenchmark | undefined
  turns: FestivalTurn[]
  summaries: FestivalFacilitatorSummary[]
  converge: FestivalConverge
}): Promise<FestivalVerdict> {
  const { plan, supplements, scores, rescores, benchmark, turns, summaries, converge } = params
  const base = {
    disclaimer: FESTIVAL_DISCLAIMER,
    provider: 'anthropic',
    overallScore: converge.overallScore,
    recommendationGrade: null as FestivalRecommendationGrade | null,
    recommendationRationale: null as string | null,
  }

  const contextBlock = [
    '# 심의 안건 (축제 기획안)',
    buildFestivalPlanContext(plan, supplements),
    '',
    '# 1. 조사관 1차 점수 (전문분야 진단, 7인)',
    buildFestivalBriefing(scores, benchmark),
    '',
    '# 2. 다중 라운드 토론 수렴 (합의 진행도 — 최종 점수가 아님)',
    debateForChair(turns, summaries),
    '',
    '# 3. 조사관 2차 재채점 (토론 반영)',
    rescoresForChair(rescores ?? []),
    '',
    '# 4. 종합(converge) — 2차 점수 trimmed mean + 분산 기반 신뢰도',
    convergeForChair(converge),
    '',
    '# 당신의 임무',
    '위 전체 심의 자료(case file)를 모두 읽고, 의장으로서 권고 등급과 축제 흥행 전망을 구조에 맞춰 작성하십시오.',
    '권고 등급은 증거에 따라 네 가지 중 하나를 주저 없이 고르십시오 — 기본값 없음.',
  ].join('\n')

  let r
  try {
    r = await callProvider({
      provider: 'anthropic',
      systemPrompt: buildFestivalChairSystemPrompt(converge),
      prompt: contextBlock,
      maxCompletionTokens: VERDICT_MAX_TOKENS,
      modelOverride: 'claude-opus-4-8',
    })
  } catch (e: unknown) {
    return {
      ...base,
      ok: false,
      successProbability: null,
      topRisks: null,
      prescriptions: null,
      minorityReport: null,
      error: `의장 판결 호출 실패: ${e instanceof Error ? e.message : 'unknown error'}`,
    }
  }

  if (r.error || !r.text) {
    return {
      ...base,
      ok: false,
      successProbability: null,
      topRisks: null,
      prescriptions: null,
      minorityReport: null,
      error: r.error ?? '의장이 빈 판결을 반환했습니다.',
    }
  }

  const parsed = parseChairOutput(r.text)
  // If section split found nothing, keep the whole text so output is never lost.
  const successProbability = parsed.matchedAny
    ? parsed.successProbability
    : r.text.trim()
  const minorityReport = parsed.minorityReport ?? fallbackMinorityReport(summaries)

  return {
    ...base,
    ok: true,
    recommendationGrade: parsed.recommendationGrade,
    recommendationRationale: parsed.recommendationRationale,
    successProbability,
    topRisks: parsed.topRisks,
    prescriptions: parsed.prescriptions,
    minorityReport,
    ...(parsed.disclaimer ? { disclaimer: parsed.disclaimer } : {}),
  }
}
