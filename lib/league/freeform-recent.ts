/**
 * Recent-question list for free-prompt hub tabs.
 *
 * Public-gateway marker: there is no durable gateway_receipt on
 * `prediction_rounds` (receipts live in `league_gateway_receipts` with a
 * 5-minute TTL). Script/experiment openers such as `_open-tech-round.ts`
 * call `generatePredictions` directly and never insert a
 * `league_generation_jobs` row. The public hub path (gateway → generate)
 * always does. Combined with the compose cache_key prefixes and the
 * gateway instrument codecs, that excludes the September TECH:AAPL
 * experiment and any other script-opened row.
 */

import type { LeagueLocale } from './i18n/locales'
import { resolveLocalizedProposition } from './proposition-i18n'

export const FREEFORM_RECENT_LIMIT = 6

export const PUBLIC_GATEWAY_CACHE_PREFIXES = [
  'tech|',
  'airank|',
  'sports|',
  'politics|',
  'entertainment|',
  'property|',
] as const

export type FreeformRecentRow = {
  id: string
  instrument: string
  proposition_text: string
  resolves_at: string
  category: string
  created_at: string
  grading_status?: string | null
  actual_outcome?: string | null
  cache_key?: string | null
  horizon?: string | null
  propositions?: Record<string, string> | null
}

export type FreeformRecentItem = {
  round_id: string
  instrument: string
  horizon: string
  proposition_text: string
  resolves_at: string
  propositions?: Record<string, string> | null
}

const PUBLIC_GATEWAY_INSTRUMENT =
  /^(TECH:OPEN:|AIRANK:|MATCH:|ELECTION:|SHOW:|PROPERTY:)/

export function isPublicGatewayFreeformInstrument(instrument: string): boolean {
  return PUBLIC_GATEWAY_INSTRUMENT.test(instrument)
}

export function isPublicGatewayCacheKey(cacheKey: string | null | undefined): boolean {
  if (!cacheKey) return false
  return PUBLIC_GATEWAY_CACHE_PREFIXES.some((prefix) => cacheKey.startsWith(prefix))
}

export function isOpenUngradedRound(
  row: Pick<FreeformRecentRow, 'resolves_at' | 'grading_status' | 'actual_outcome'>,
  now: Date = new Date(),
): boolean {
  const resolves = Date.parse(row.resolves_at)
  if (!Number.isFinite(resolves) || resolves <= now.getTime()) return false
  if (row.grading_status === 'graded' || row.grading_status === 'voided') return false
  if (row.actual_outcome != null && String(row.actual_outcome).trim() !== '') return false
  return true
}

export function publicCategoryForLedger(category: string): 'sports' | 'politics_election' | 'entertainment' | 'real_estate' | 'tech' | null {
  if (category === 'sports') return 'sports'
  if (category === 'politics_election') return 'politics_election'
  if (category === 'entertainment_awards' || category === 'entertainment') return 'entertainment'
  if (category === 'real_estate') return 'real_estate'
  if (category === 'tech' || category === 'ai_models') return 'tech'
  return null
}

export function selectRecentPublicFreeformRounds(
  rows: readonly FreeformRecentRow[],
  jobRoundIds: ReadonlySet<string>,
  now: Date = new Date(),
  limit: number = FREEFORM_RECENT_LIMIT,
  locale?: LeagueLocale,
): FreeformRecentItem[] {
  const picked: FreeformRecentItem[] = []
  for (const row of rows) {
    if (!jobRoundIds.has(row.id)) continue
    if (!isPublicGatewayFreeformInstrument(row.instrument)) continue
    if (!isPublicGatewayCacheKey(row.cache_key)) continue
    if (!isOpenUngradedRound(row, now)) continue
    picked.push({
      round_id: row.id,
      instrument: row.instrument,
      horizon: row.horizon && row.horizon.trim() ? row.horizon : '1m',
      proposition_text: locale ? resolveLocalizedProposition(row, locale) : row.proposition_text,
      resolves_at: row.resolves_at,
      propositions: row.propositions ?? null,
    })
    if (picked.length >= limit) break
  }
  return picked
}
