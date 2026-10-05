/**
 * Class selector for the operator void of legacy same-day 24h 1d rounds.
 * Pure — no I/O. The live script loads stored rows and filters with this.
 *
 * Rule: a 24h spot (gold XAU/XAG/XPT, FX pairs, crypto_spot, memecoin,
 * energy WTI/XBR) that was graded with anchor_session_date ==
 * resolution_session_date. Horizon must be 1d. Equities, KRSTOCK, and
 * session-clock ETFs (GLD/SLV/UNG…) are out. Outcome is ignored — winners
 * stay in the class.
 */

import { usesCompletedDailyBars } from './horizon'

export const LEGACY_SAME_DAY_24H_REASON = 'legacy_same_day_window' as const

export const EXPECTED_LEGACY_SAME_DAY_24H_COUNT = 7

export const LEGACY_SAME_DAY_24H_RULE = [
  'Class: stored 24h-spot 1d rounds graded with anchor_session_date == resolution_session_date',
  '(legacy same-day 1d window, fixed going forward in 6f69c69).',
  'Instruments: gold_metal spots XAU/XAG/XPT, fx pairs, crypto_spot, memecoin,',
  'commodity_energy spots WTI/USD and XBR/USD.',
  'Independent of actual_outcome / consensus_is_correct. Excludes 1w/1m, equities, KRSTOCK,',
  'and session-clock ETFs. Reason: legacy_same_day_window.',
].join(' ')

const GOLD_SPOTS = new Set(['XAU/USD', 'XAG/USD', 'XPT/USD'])
const ENERGY_SPOTS = new Set(['WTI/USD', 'XBR/USD'])
const FX_CRYPTO_MEME = new Set(['fx', 'crypto_spot', 'memecoin'])

export type LegacySameDay24hRow = {
  id: string
  instrument: string
  category: string
  horizon: string
  grading_status?: string | null
  actual_outcome?: string | null
  consensus_is_correct?: boolean | null
  anchor_session_date?: string | null
  resolution_session_date?: string | null
}

export function isLegacy24hSpotInstrument(category: string, instrument: string): boolean {
  const inst = instrument.trim().toUpperCase()
  if (!usesCompletedDailyBars(category, inst)) return false
  if (category === 'gold_metal') return GOLD_SPOTS.has(inst)
  if (category === 'commodity_energy') return ENERGY_SPOTS.has(inst)
  return FX_CRYPTO_MEME.has(category)
}

export function ymdOrNull(raw: string | null | undefined): string | null {
  if (!raw) return null
  const ymd = raw.trim().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null
}

export function isLegacySameDay24hRound(row: LegacySameDay24hRow): boolean {
  if (row.horizon !== '1d') return false
  if (row.grading_status === 'voided') return false
  if (!isLegacy24hSpotInstrument(row.category, row.instrument)) return false
  const graded = row.grading_status === 'graded' || Boolean(row.actual_outcome?.trim())
  if (!graded) return false
  const anchor = ymdOrNull(row.anchor_session_date)
  const resolution = ymdOrNull(row.resolution_session_date)
  return Boolean(anchor && resolution && anchor === resolution)
}

export function selectLegacySameDay24hRounds<T extends LegacySameDay24hRow>(rows: readonly T[]): T[] {
  return rows.filter(isLegacySameDay24hRound)
}
