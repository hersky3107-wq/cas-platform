/**
 * Conflict-country watchlist for FIRMS raw-point retention.
 *
 * Seed only. Edit this list when UCDP/ACLED state-based conflict coverage changes.
 * Status: editable seed (not an automated UCDP/ACLED pull).
 *
 * Keep a FIRMS detection as an individual crisis_raw_signals row when
 * the assigned country's ISO3 is in this set, or when FRP >= 100 MW.
 */
export const WATCHLIST_STATUS = 'editable_seed' as const

/** ISO3 codes with recent active state-based conflict (UCDP/ACLED knowledge, 2025–2026). */
export const CONFLICT_WATCHLIST_ISO3: readonly string[] = [
  'AFG',
  'BFA',
  'CAF',
  'CMR',
  'COD',
  'COL',
  'ETH',
  'HTI',
  'IRN',
  'IRQ',
  'ISR',
  'LBN',
  'LBY',
  'MLI',
  'MMR',
  'MOZ',
  'NER',
  'NGA',
  'PAK',
  'PHL',
  'PSE',
  'RUS',
  'SDN',
  'SOM',
  'SSD',
  'SYR',
  'TCD',
  'UKR',
  'YEM',
]

const WATCH = new Set(CONFLICT_WATCHLIST_ISO3)

export function isConflictWatchlistIso3(iso3: string | null | undefined): boolean {
  if (!iso3) return false
  return WATCH.has(iso3.trim().toUpperCase())
}
