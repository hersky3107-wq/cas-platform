/**
 * Extra-tier customer copy. PRODUCT rules, not doctrine.
 *
 * Divination votes with 4 systems (육효 / 타로 / 룬 / 택일).
 * 점성술 and 구성기학 are chart-only — never a vote. Never write "6체계".
 */

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
