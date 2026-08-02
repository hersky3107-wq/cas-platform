/**
 * Origin-aware navigation for shared Jeju resident pages.
 *
 * Senior home links append `?from=senior`. Shared feature pages read that
 * flag (at click time) so "처음으로"/back returns to /jeju/resident/senior —
 * without changing the general 도민 mode's existing back targets.
 *
 * /jeju/resident redirects to the general lobby (picker retired); prefer
 * GENERAL_HOME for non-senior back targets.
 */

export const SENIOR_HOME = '/jeju/resident/senior'
/** @deprecated Picker removed — redirects to GENERAL_HOME. Prefer GENERAL_HOME. */
export const RESIDENT_PICKER = '/jeju/resident'
export const GENERAL_HOME = '/jeju/resident/general'

/** True when the current URL carries `from=senior` (client-only). */
export function isFromSeniorNow(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('from') === 'senior'
}

/** Append or preserve `from=senior` on an internal href. */
export function withSeniorOrigin(href: string, fromSenior: boolean = isFromSeniorNow()): string {
  if (!fromSenior) return href
  const q = href.indexOf('?')
  const path = q >= 0 ? href.slice(0, q) : href
  const params = new URLSearchParams(q >= 0 ? href.slice(q + 1) : '')
  params.set('from', 'senior')
  return `${path}?${params.toString()}`
}

/**
 * Home target for "처음으로"/back.
 * @param fallback used when not from senior (defaults to general lobby).
 */
export function residentHome(fallback: string = GENERAL_HOME): string {
  return isFromSeniorNow() ? SENIOR_HOME : fallback
}
