/**
 * League-facing adapter contract. Fixed with the league track.
 *
 * This type is closed. Tape, headlines, and the league closed-book
 * payload are not on the contract and must never be added.
 */
import type { LeagueOracleCategoryId } from './types'

export const LEAGUE_DIVINATION_ADAPTER_INPUT_KEYS = [
  'proposition',
  'propositionType',
  'category',
  'subjectName',
  'firstViewedAt',
  'roundId',
] as const

export type LeagueDivinationAdapterInput = {
  proposition: string
  propositionType: 'binary' | 'pick_one'
  category: LeagueOracleCategoryId
  subjectName: string
  /** ISO datetime. First viewer stamps it; later viewers must send the same value. */
  firstViewedAt: string
  roundId: string
}

export type LeagueAdapterSystemId = 'iching' | 'tarot' | 'runes' | 'taeil' | 'astro' | 'ninestar'

export type LeagueAdapterSystemEntry = {
  id: LeagueAdapterSystemId
  ballot: 'up' | 'down' | 'a' | 'b' | null
  /** Null when 결번 — weight is off the denominator. INTERNAL. */
  weight: 3 | 2 | null
  /** INTERNAL — never render. */
  status: 'voted' | '결번'
  /** INTERNAL — never render. */
  statusLabel: '표를 냄' | '말을 아낌'
  /** INTERNAL — never render. */
  reason: string | null
  /** INTERNAL — never render. */
  unreadableCode: string | null
  source: string | null
  /** Native facts for logs / debug. Presence rows inside must not render. */
  chart: Record<string, unknown>
}

/** Customer-facing keys on the adapter output. Everything else is INTERNAL. */
export const LEAGUE_ADAPTER_CUSTOMER_KEYS = ['verdict', 'pick', 'rationale', 'confidence'] as const

export type LeagueDivinationAdapterOutput = {
  /** Never null. Code ballot; the reader cannot override it. */
  verdict: 'up' | 'down'
  pick: 'A' | 'B' | null
  rationale: string
  confidence: number
  /** INTERNAL — never render. */
  votedCount: 1 | 2 | 3 | 4
  /** INTERNAL — never render. */
  ichingAlone: boolean
  /** INTERNAL chart pack — never render status / 결번 / voter roll. */
  systems: LeagueAdapterSystemEntry[]
}
