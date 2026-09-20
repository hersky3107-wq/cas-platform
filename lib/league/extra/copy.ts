/**
 * Extra-tier customer copy. PRODUCT rules, not doctrine.
 *
 * Divination votes with 4 systems (육효 / 타로 / 룬 / 택일).
 * 점성술 and 구성기학 are chart-only — never a vote. Never write "6체계".
 */

import type { LeagueUiPack } from '../i18n/dictionary'

export const DIVINATION_VOTING_SYSTEM_COUNT = 4
export const DIVINATION_VOTING_SYSTEMS = ['육효', '타로', '룬', '택일'] as const
export const DIVINATION_CHART_ONLY_SYSTEMS = ['점성술', '구성기학'] as const

/** Customer-facing adapter keys. `systems` is internal-only — never render. */
export const DIVINATION_CUSTOMER_KEYS = ['verdict', 'pick', 'rationale', 'confidence'] as const

export const DIVINATION_INTERNAL_KEYS = [
  'systems',
  'votedCount',
  'ichingAlone',
  'status',
  'statusLabel',
  'unreadableCode',
  'voterRoll',
] as const

export const SIX_SYSTEM_BAN = ['6체계', '6 체계', 'six systems', '6 systems', '여섯 체계'] as const

/** Shared extra-tier entertainment / experimental disclaimer (enforced in compliance). */
export const EXTRA_EXPERIMENTAL_DISCLAIMER_KO = '오락·실험 목적, 투자 판단 근거 아님'

export type DivinationConfidenceTier = 'weak' | 'moderate' | 'strong'

export const DIVINATION_CONFIDENCE_THRESHOLDS = {
  WEAK_MAX: 0.25,
  MODERATE_MAX: 0.5,
} as const

/**
 * Classifies divination confidence into a qualitative tier (weak / moderate / strong).
 * Divination confidence averages ~0.38 and is LOWER by design than LLMs.
 * Handles both 0..1 unit scale (oracle adapter) and 0..100 ledger scale (model.probability).
 */
export function divinationConfidenceTier(
  probabilityOrConfidence: number | null | undefined,
): DivinationConfidenceTier | null {
  if (probabilityOrConfidence == null || !Number.isFinite(probabilityOrConfidence)) return null
  const unit = probabilityOrConfidence > 1 ? probabilityOrConfidence / 100 : probabilityOrConfidence
  if (unit < DIVINATION_CONFIDENCE_THRESHOLDS.WEAK_MAX) return 'weak'
  if (unit <= DIVINATION_CONFIDENCE_THRESHOLDS.MODERATE_MAX) return 'moderate'
  return 'strong'
}

/**
 * Customer-facing qualitative label for divination confidence (e.g. "보통 점괘", "약한 점괘", "강한 점괘").
 * Raw numeric percentages ("확신도 11%") are never shown for divination.
 */
export function divinationConfidenceLabel(
  probabilityOrConfidence: number | null | undefined,
  t: LeagueUiPack,
): string | null {
  const tier = divinationConfidenceTier(probabilityOrConfidence)
  if (!tier) return null
  return t.bracket.divinationConfidence[tier]
}

export function mentionsSixSystems(text: string): string | null {
  const lower = text.toLowerCase()
  for (const banned of SIX_SYSTEM_BAN) {
    if (lower.includes(banned.toLowerCase())) return banned
  }
  return null
}

export function divinationVotingSystemsLine(): string {
  return `${DIVINATION_VOTING_SYSTEM_COUNT} voting systems (${DIVINATION_VOTING_SYSTEMS.join('·')}). ${DIVINATION_CHART_ONLY_SYSTEMS.join('/')} are chart-only — no vote.`
}
