import type { JurisdictionGroup } from './types'

/**
 * ISO 3166-1 alpha-2 country code -> jurisdiction group. DATA ONLY, so
 * regions can be recategorized without touching resolution logic.
 * Not exhaustive by design — anything absent falls back to 'OTHER' in
 * `groupForCountry` (a real, known country we simply haven't grouped is
 * treated as rest-of-world, NOT as unknown/deny; 'UNKNOWN' is reserved for
 * "we have no country signal at all").
 */
const EU_COUNTRIES = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU',
  'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]

const ME_COUNTRIES = [
  'AE', 'SA', 'QA', 'KW', 'BH', 'OM', 'EG', 'JO', 'LB', 'IQ', 'YE', 'IL', 'IR', 'SY',
]

export const COUNTRY_TO_JURISDICTION_GROUP: Record<string, JurisdictionGroup> = {
  US: 'US',
  GB: 'UK',
  KR: 'KR',
  JP: 'JP',
  CN: 'CN',
  ...Object.fromEntries(EU_COUNTRIES.map((c) => [c, 'EU' as const])),
  ...Object.fromEntries(ME_COUNTRIES.map((c) => [c, 'ME' as const])),
}

/** null/unrecognized-but-present country -> 'OTHER'; no country signal at all -> 'UNKNOWN' (call with null explicitly for that case). */
export function groupForCountry(countryCode: string | null | undefined): JurisdictionGroup {
  if (!countryCode || !countryCode.trim()) return 'UNKNOWN'
  return COUNTRY_TO_JURISDICTION_GROUP[countryCode.trim().toUpperCase()] ?? 'OTHER'
}
