'use client'

import { useLeagueRequestSignals } from '@/lib/league/use-league-request-signals'

/** Operator flag from `GET /api/league/context` (same signal fetch as league i18n). */
export function useMotieFreeTextAccess(): { loading: boolean; isAdmin: boolean } {
  const signals = useLeagueRequestSignals()
  return { loading: signals.loading, isAdmin: signals.isAdmin }
}
