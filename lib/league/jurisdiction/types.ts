/**
 * AI Prediction League — country-gating (Layer B) shared types.
 *
 * Deliberately has NO import from `lib/league/i18n/*` — visibility and
 * language are independent layers with independent data. The only thing
 * they share is the raw "what does this request's IP say" plumbing in
 * `lib/geo/ip-country.ts`, which carries no policy.
 */

/**
 * Jurisdictions are grouped (not handled per-country) because the recorded
 * plan's rules are regional (EU, ME, ...), and a per-country matrix would be
 * an unmaintainable wall of near-duplicate rows. Add a new group here +
 * `country-groups.ts` before it can appear in the matrix.
 */
export type JurisdictionGroup = 'US' | 'EU' | 'UK' | 'KR' | 'JP' | 'ME' | 'CN' | 'OTHER' | 'UNKNOWN'

export const JURISDICTION_GROUPS: readonly JurisdictionGroup[] = [
  'US',
  'EU',
  'UK',
  'KR',
  'JP',
  'ME',
  'CN',
  'OTHER',
  'UNKNOWN',
]
