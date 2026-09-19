/**
 * Divination extra seat — league-side adapter to oracle.
 *
 * CONTRACT (oracle team):
 *  1. Customer sees only verdict / pick / rationale / confidence.
 *  2. No market data — packet / injection is forbidden.
 *  3. No league-side cache. Oracle owns public.oracle_league_divination_cache.
 *  4. Confidence stays as computed (~0.38 mean). Scale 0–1 → 0–100 for the
 *     ledger only. Do not boost toward other AI ranges.
 *  5. Cost is estimated (HCX-007 returns no billed USD).
 *  6. Copy: 4 voting systems, never 6체계.
 *  7. A code-generated fallback rationale is acceptable.
 */
import {
  LEAGUE_DIVINATION_ADAPTER_INPUT_KEYS,
  type LeagueDivinationAdapterInput,
  type LeagueDivinationAdapterOutput,
} from '@/lib/oracle/league-divination/adapter-types'
import type { LeagueOracleCategoryId } from '@/lib/oracle/league-divination/types'
import { LEAGUE_ORACLE_CATEGORY_IDS } from '@/lib/oracle/league-divination/types'
import { LEAGUE_READER_COST_IS_ESTIMATED, LEAGUE_READER_ESTIMATED_COST_USD } from '@/lib/oracle/league-divination/conventions'
import type { AnswerSide } from '../answer-contract'
import { PUBLIC_CATEGORY_IDS } from '../catalog'
import { DIVINATION_CUSTOMER_KEYS, DIVINATION_INTERNAL_KEYS } from './copy'

export const DIVINATION_PACKET_BAN = [
  'packet',
  'injection',
  'dataPacket',
  'data_packet',
  'research',
  'closedBook',
  'closed_book_packet_text',
  'priceSeries',
  'price_series',
] as const

const LEDGER_TO_ORACLE: Record<string, LeagueOracleCategoryId> = {
  sports: 'sports',
  crypto: 'crypto',
  crypto_spot: 'crypto',
  crypto_perps: 'crypto',
  stocks: 'stocks',
  stock: 'stocks',
  fx: 'fx',
  gold_metals: 'gold_metals',
  gold_metal: 'gold_metals',
  index_etf: 'index_etf',
  etf_index: 'index_etf',
  commodities_energy: 'commodities_energy',
  commodity_energy: 'commodities_energy',
  politics_election: 'politics_election',
  entertainment: 'entertainment',
  entertainment_awards: 'entertainment',
  memecoin: 'memecoin',
  real_estate: 'real_estate',
  macro_econ: 'macro_econ',
  bond_rate: 'macro_econ',
}

const PICK_ONE_CATEGORIES = new Set<LeagueOracleCategoryId>([
  'sports',
  'politics_election',
  'entertainment',
])

export type DivinationCustomerFields = Pick<
  LeagueDivinationAdapterOutput,
  (typeof DIVINATION_CUSTOMER_KEYS)[number]
>

export type DivinationLeagueInput = {
  proposition: string
  propositionType: 'binary' | 'pick_one'
  category: LeagueOracleCategoryId
  subjectName: string
  firstViewedAt: string
  roundId: string
}

export function oracleCategoryFromLedger(category: string): LeagueOracleCategoryId {
  if ((LEAGUE_ORACLE_CATEGORY_IDS as readonly string[]).includes(category)) {
    return category as LeagueOracleCategoryId
  }
  if ((PUBLIC_CATEGORY_IDS as readonly string[]).includes(category)) {
    return category as LeagueOracleCategoryId
  }
  return LEDGER_TO_ORACLE[category] ?? 'stocks'
}

export function oraclePropositionType(input: {
  category: string
  propositionKind?: string | null
}): 'binary' | 'pick_one' {
  if (input.propositionKind === 'binary_subject_outcome') return 'pick_one'
  const oracle = oracleCategoryFromLedger(input.category)
  return PICK_ONE_CATEGORIES.has(oracle) ? 'pick_one' : 'binary'
}

export function buildDivinationInput(round: {
  id: string
  proposition_text: string
  category: string
  subject_label?: string | null
  instrument: string
  opened_at?: string | null
  created_at?: string | null
  proposition_kind?: string | null
}): DivinationLeagueInput {
  const category = oracleCategoryFromLedger(round.category)
  return {
    proposition: round.proposition_text,
    propositionType: oraclePropositionType({ category: round.category, propositionKind: round.proposition_kind }),
    category,
    subjectName: round.subject_label?.trim() || round.instrument,
    firstViewedAt: round.opened_at || round.created_at || new Date().toISOString(),
    roundId: round.id,
  }
}

/** Reject any league-side packet / injection backdoor before the oracle call. */
export function assertNoPacketOnDivinationInput(input: object): asserts input is DivinationLeagueInput {
  const record = input as Record<string, unknown>
  for (const banned of DIVINATION_PACKET_BAN) {
    if (Object.prototype.hasOwnProperty.call(record, banned) && record[banned] != null) {
      throw new Error(`divination seat must not receive ${banned}`)
    }
  }
  for (const key of Object.keys(record)) {
    if (!(LEAGUE_DIVINATION_ADAPTER_INPUT_KEYS as readonly string[]).includes(key)) {
      throw new Error(`divination input forbids extra key "${key}"`)
    }
  }
}

export function customerFacingDivination(output: LeagueDivinationAdapterOutput): DivinationCustomerFields {
  return {
    verdict: output.verdict,
    pick: output.pick,
    rationale: output.rationale,
    confidence: output.confidence,
  }
}

export function findInternalDivinationLeak(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  for (const key of DIVINATION_INTERNAL_KEYS) {
    if (Object.prototype.hasOwnProperty.call(record, key)) return key
  }
  const blob = JSON.stringify(payload).toLowerCase()
  if (blob.includes('"systems"') || blob.includes('결번') || blob.includes('말을 아낌')) {
    return 'systems'
  }
  return null
}

/**
 * Ledger scale only: oracle confidence is 0–1. 0.38 → 38.
 * Do not boost a lone-ballot or low-participation reading.
 */
export function leagueProbabilityFromOracleConfidence(confidence: number): number {
  if (!Number.isFinite(confidence)) return 0
  const unit = confidence > 1 ? confidence / 100 : confidence
  return Math.round(Math.min(1, Math.max(0, unit)) * 1000) / 10
}

export function leagueSideFromDivination(
  verdict: 'up' | 'down',
  pick: 'A' | 'B' | null,
  propositionKind: string | null | undefined,
): AnswerSide {
  const plus = pick === 'B' ? false : pick === 'A' ? true : verdict === 'up'
  if (propositionKind === 'binary_subject_outcome') return plus ? 'yes' : 'no'
  if (propositionKind === 'binary_threshold') return plus ? 'above' : 'below'
  return plus ? 'up' : 'down'
}

export function estimatedDivinationCostUsd(output: LeagueDivinationAdapterOutput): {
  costUsd: number
  estimatedCostUsd: number
  costIsEstimated: true
} {
  const raw = typeof output.costUsd === 'number' && output.costUsd > 0 ? output.costUsd : LEAGUE_READER_ESTIMATED_COST_USD
  const costUsd = Math.round(raw * 1e6) / 1e6
  return {
    costUsd,
    estimatedCostUsd: costUsd,
    costIsEstimated: LEAGUE_READER_COST_IS_ESTIMATED,
  }
}

export type DivinationReader = (input: LeagueDivinationAdapterInput) => Promise<LeagueDivinationAdapterOutput>

export async function defaultDivinationReader(input: LeagueDivinationAdapterInput): Promise<LeagueDivinationAdapterOutput> {
  assertNoPacketOnDivinationInput(input)
  const { readLeagueDivinationLive } = await import('@/lib/oracle/league-divination/live')
  return readLeagueDivinationLive(input)
}
