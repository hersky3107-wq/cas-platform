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
  weight: 3 | 2 | null
  collapsedFromHold: boolean
  source: string | null
  /** Compact native facts for the UI. No market fields. */
  chart: Record<string, unknown>
}

export type LeagueDivinationAdapterOutput = {
  /** Never null. Code ballot; the reader cannot override it. */
  verdict: 'up' | 'down'
  pick: 'A' | 'B' | null
  rationale: string
  confidence: number
  systems: LeagueAdapterSystemEntry[]
}
