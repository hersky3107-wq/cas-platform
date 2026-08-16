'use client'

import type { ReactNode } from 'react'
import { useJurisdiction } from '@/lib/league/jurisdiction/use-jurisdiction'
import { useLeagueLocale } from '@/lib/league/i18n/use-league-locale'

/**
 * Layer B wrapper: shows `children` only if `category` is allowed for the
 * current user's resolved jurisdiction (declared country + IP, stricter of
 * the two, default-deny — see `lib/league/jurisdiction/resolve.ts`).
 *
 * This component decides ONLY whether the category is shown — it never
 * touches card content or tone (that stays `CardCompliance`'s job) and it
 * has no say over which language renders (that's `useLeagueLocale`, used
 * here ONLY to localize the optional "unavailable" message — the on/off
 * DECISION above is 100% Layer B, independent of locale).
 */
export function JurisdictionGate({
  category,
  children,
  devSignalsQuery,
}: {
  category: string
  children: ReactNode
  /** DEV-ONLY: see `PredictionCard`'s prop of the same name. */
  devSignalsQuery?: string
}) {
  const { allowed } = useJurisdiction(category, devSignalsQuery)
  const { t, dir } = useLeagueLocale(devSignalsQuery)

  if (allowed === 'loading') return null
  if (allowed) return <>{children}</>

  return (
    <p dir={dir} className="rounded-2xl border border-dashed border-league-border px-4 py-6 text-center text-xs text-league-fg-muted">
      {t.gating.unavailable}
    </p>
  )
}
