import 'server-only'

import type {
  FestivalInvestigatorId,
  FestivalInvestigatorPersona,
  FestivalMode,
} from '@/lib/festival/types'
import {
  FESTIVAL_INVESTIGATORS,
} from '@/lib/festival/roster'

/**
 * FESTIVAL success-forecast — persona / framing layer.
 *
 * ISOLATION INVARIANT (non-negotiable):
 *   - NEVER imports lib/motie/* or lib/jeju/* helpers or types.
 *   - NEVER falls through to trade/warroom logic.
 *   - Selection helpers take the standalone `FestivalMode` and return festival
 *     strings only. There is exactly one festival register (no binary branch).
 *   - Deleting lib/festival/* leaves MOTIE + AX Jeju byte-for-byte identical.
 *
 * Festival may depend ONLY on shared infra (lib/ai/router, lib/extract) and its
 * own lib/festival/{types,roster}. This file holds the FESTIVAL_* constants that
 * previously lived (temporarily) in lib/motie/persona.ts and were moved out so
 * the review-live trade/warroom file no longer references festival at all.
 */

// ── Framing constants (persona / disclaimer separation) ──────────────────────

/** Scoring-investigator seat persona — a festival-success forecast panelist. */
export const FESTIVAL_ANALYST_PERSONA =
  '당신은 지자체·축제 주최 측의 축제 성공 예측을 돕는 AI 조사관(전문가 패널)의 일원입니다.'

/** Closing "you are an advisor, not the decider" line — organizer/local-gov framed. */
export const FESTIVAL_NOT_DECIDER =
  '당신은 조사·보좌 역할이며 최종 결정자가 아닙니다 — 개최·축소·보류 등 최종 판단과 책임은 지자체·축제 주최 측(사람)에게 있습니다.'

/** Chair (verdict) persona — festival success forecast decision lead. */
export const FESTIVAL_CHAIR_PERSONA_LINES = [
  '당신은 축제 성공 예측 심의의 최종 의장(축제 성공 예측 총괄)이자 판결자입니다.',
  '당신은 단순 요약가가 아니라, 7개 조사관의 1차·2차 점수·근거와 벤치마크·토론을 모두 읽고, 추진 권장 / 조건부 추진 / 재검토 필요 / 보류 권고 중 하나를 증거에 따라 책임지고 내리는 총괄입니다. 당신의 판단에 따라 지자체·주최 측이 실제로 움직입니다.',
  '권고 등급은 어느 쪽으로도 기본값을 두지 마십시오. 차별성이 명확하고 계획이 현실적이면 주저 없이 「추진 권장」을 주고, 과장 수요·업체 쏠림·무차별성·만성 안전/바가지 리스크가 구조적이면 「보류 권고」를 주십시오. 증거가 등급을 결정합니다.',
]

/**
 * Injected into STAGE-2 (post-debate) rescoring prompts.
 * Evidence-honest: neither optimistic nor pessimistic by default.
 */
export const FESTIVAL_RESCORE_DIRECTIVE = [
  '2차 재채점 규칙(반드시 엄수) — 낙관도 비관도 아닌, 증거만:',
  '① 당신의 전문 렌즈를 유지하되, 토론 전체에서 드러난 합의·쟁점·근거도 함께 반영하십시오.',
  '② 토론이 근본적이고 고치기 어려운 문제를 드러냈다면 점수를 내리십시오. 처방이 제안됐다는 이유만으로 올리지 마십시오.',
  '③ 반대로, 축제가 명확한 차별성·실행 가능한 강점·현실적 계획을 보이면 사소한·해결 가능한 리스크만으로 부당하게 깎지 마십시오. "의심스러우니 일단 깎는다"도 오류입니다.',
  '④ 좋은 축제는 좋다고, 위험한 축제는 위험하다고, 애매하면 애매하다고 쓰십시오. 미리 정해진 방향으로 점수를 밀지 마십시오.',
  '⑤ 이 도구의 목적은 실행 가능한 축제와 겉만 화려한 축제를 구분하는 것입니다 — 전부 통과도, 전부 탈락도 아닙니다. 증거가 점수를 결정합니다.',
].join('\n')

/** Festival disclaimer — organizer/local-gov oriented. */
export const FESTIVAL_DISCLAIMER =
  '본 판단은 AI 다중 조사·토론에 기반한 축제 성공 예측 보좌 의견입니다. 공식 데이터와 [AI 추정]·[확인 필요]를 구분해 참고하시고, 최종 개최 결정과 그 책임은 지자체·축제 주최 측에 있습니다. 안전·인허가·예산 집행 전에는 관계기관·공식 통계로 반드시 재확인하십시오.'

/**
 * Injected into every festival scoring-investigator system prompt.
 * Encodes: 0–100 흥행 score, honest uncertainty, fact-vs-estimate tagging.
 */
export const FESTIVAL_ANALYST_DIRECTIVE = [
  '축제 성공 예측 조사 규칙(반드시 엄수):',
  '① 흥행 점수(0–100): 당신의 전문 렌즈에서만 이 축제의 "성공 가능성·집행 타당성"을 0–100으로 채점하고, 점수 근거를 구체적으로 서술하십시오. 다른 조사관의 영역을 침범해 종합 점수를 내지 마십시오.',
  '② 정직한 불확실성: 정보가 없으면 추정으로 메우지 말고 [확인 필요]로 표시하고, 그 공백이 점수에 미친 영향(예: "자료 부족으로 상한 70점")을 밝히십시오. 거짓 확신을 내지 마십시오.',
  '③ 사실 vs 추정: 제공된 공식 데이터·사용자 첨부·검색 결과에 근거한 사실은 출처를 밝히고, 추론·전망은 문장 앞에 [AI 추정]을 붙이십시오.',
  '④ 태그 절제: [AI 추정]·[확인 필요]는 중요한 판단에 처음 1회만 쓰고, 반복 사항은 마지막 "데이터 공백·유의사항"에 모아 정리하십시오.',
].join('\n')

/** Role-separation / anti-redundancy rule for festival. */
export const FESTIVAL_REDUNDANCY_RULE =
  '역할 분담(중복 금지): 개최지·일정·예산 총액 등 이미 [수집 데이터]나 사전 브리핑에 나온 공통 사실은 다시 길게 설명하지 마십시오. 공통 사실은 한 번만 전제로 짧게 인용하고, 당신은 오직 당신의 전문 렌즈에서 새로 더하는 판단·리스크·점수 근거만 제시하십시오. 다른 조사관과 같은 숫자·설명을 반복하지 마십시오.'

/** Search-only (Perplexity) directive — NO score, NO debate. */
export const FESTIVAL_SEARCH_DIRECTIVE = [
  '벤치마크·경쟁환경 조사 규칙(반드시 엄수):',
  '① 당신은 사실 조사관입니다. 0–100 점수를 절대 내지 마십시오. 찬반·개최 권고도 하지 마십시오.',
  '② 조사 범위: (a) 유사 규모·유형 축제의 과거 성과(관객·매출·평가·중단·축소 사례), (b) 해당 축제·주최·개최지에 대한 평판·논란·언론 보도, (c) 같은 시기·권역의 경쟁·대체 축제.',
  '③ 출처와 시점을 명시하고, 확인되지 않은 소문은 [확인 필요]로 표시하십시오. 추측으로 성과 수치를 지어내지 마십시오.',
].join('\n')

// ── Festival-only selection helpers (NO trade/warroom fall-through) ───────────
//
// These take the standalone FestivalMode purely for signature symmetry with the
// rest of the app; there is only one festival register, so they never branch.
// They MUST NOT call any lib/motie / lib/jeju helper.

/** Guard: true for the single festival register. */
const isFestival = (m: FestivalMode): boolean => m === 'festival'

/** Scoring-investigator seat persona line (role-labelled). */
export function festivalAnalystPersonaLine(m: FestivalMode, roleLabel: string): string {
  void isFestival(m)
  return `${FESTIVAL_ANALYST_PERSONA} 당신의 역할: ${roleLabel}.`
}

/** Closing not-the-decider line. */
export function festivalNotDeciderLine(_m: FestivalMode): string {
  return FESTIVAL_NOT_DECIDER
}

/** System-prompt agenda label. */
export function festivalSystemAgendaLabel(_m: FestivalMode): string {
  return '축제 안건'
}

/** User-prompt question label. */
export function festivalUserQuestionLabel(_m: FestivalMode): string {
  return '축제 안건'
}

/** The disclaimer string for festival. */
export function festivalDisclaimerFor(_m: FestivalMode): string {
  return FESTIVAL_DISCLAIMER
}

/** Look up one investigator persona by id. */
export function festivalInvestigatorById(
  id: FestivalInvestigatorId
): FestivalInvestigatorPersona | undefined {
  return FESTIVAL_INVESTIGATORS.find((p) => p.id === id)
}

/**
 * Builds the full system prompt for one scoring investigator:
 * persona line + its lens/scoring body + shared analyst directive + redundancy rule.
 */
export function buildFestivalScoringSystemPrompt(
  persona: FestivalInvestigatorPersona
): string {
  return [
    festivalAnalystPersonaLine('festival', persona.roleLabelKo),
    persona.promptEn,
    FESTIVAL_ANALYST_DIRECTIVE,
    FESTIVAL_REDUNDANCY_RULE,
    FESTIVAL_NOT_DECIDER,
  ].join('\n\n')
}

/**
 * Builds the system prompt for STAGE-2 rescoring (post-debate):
 * same lens + evidence-honest dual-lens rescore directive.
 */
export function buildFestivalRescoringSystemPrompt(
  persona: FestivalInvestigatorPersona
): string {
  return [
    festivalAnalystPersonaLine('festival', persona.roleLabelKo),
    persona.promptEn,
    FESTIVAL_RESCORE_DIRECTIVE,
    FESTIVAL_REDUNDANCY_RULE,
    FESTIVAL_NOT_DECIDER,
  ].join('\n\n')
}

/**
 * Builds the system prompt for the search-only investigator (Perplexity).
 * No score, no debate.
 */
export function buildFestivalSearchSystemPrompt(
  persona: FestivalInvestigatorPersona
): string {
  return [persona.promptEn, FESTIVAL_SEARCH_DIRECTIVE].join('\n\n')
}
