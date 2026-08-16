'use client'

import { useLeagueRequestSignals } from '../use-league-request-signals'
import { isCategoryAllowed, resolveJurisdictionGroups } from './resolve'

export type UseJurisdictionResult = {
  /** `'loading'` until the first signals fetch resolves — callers should not flash a "blocked" state during this. */
  allowed: boolean | 'loading'
  mismatch: boolean
}

/**
 * Layer B: is `category` visible to the current user? Fully independent of
 * `useLeagueLocale` — no shared state, no shared decision code, only the
 * same raw `useLeagueRequestSignals()` fetch (infra, not policy). There is
 * intentionally no manual override here: visibility is not something a
 * user's UI toggle should be able to change.
 */
export function useJurisdiction(category: string, devQuery?: string): UseJurisdictionResult {
  const signals = useLeagueRequestSignals(devQuery)

  if (signals.loading) {
    return { allowed: 'loading', mismatch: false }
  }

  const input = { declaredCountry: signals.declaredCountry, ipCountry: signals.ipCountry }
  return {
    allowed: isCategoryAllowed(category, input),
    mismatch: resolveJurisdictionGroups(input).mismatch,
  }
}
