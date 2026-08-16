'use client'

import { useEffect, useState } from 'react'

/**
 * Raw request signals used by BOTH independent gating layers (i18n locale
 * resolution, jurisdiction resolution). This hook does no resolution/policy
 * of its own — it just fetches `GET /api/league/context` once and hands back
 * the raw fields. Each layer runs its OWN pure resolver over these signals
 * (`lib/league/i18n/resolve-locale.ts` / `lib/league/jurisdiction/resolve.ts`),
 * so sharing this fetch does not couple the two layers' decisions.
 */
export type LeagueRequestSignals = {
  acceptLanguage: string | null
  ipCountry: string | null
  profileLocale: string | null
  declaredCountry: string | null
}

const EMPTY_SIGNALS: LeagueRequestSignals = {
  acceptLanguage: null,
  ipCountry: null,
  profileLocale: null,
  declaredCountry: null,
}

export type LeagueRequestSignalsState = LeagueRequestSignals & {
  /** True until the first fetch settles. Consumers that default-deny/default-'en' on empty signals should treat `loading` specially to avoid a flash of the denied/English state. */
  loading: boolean
}

/**
 * `devQuery` (e.g. "dev_ip_country=CN") lets a DEV-ONLY caller (the admin
 * preview page) simulate signals the real request can't produce locally
 * (there's no `x-vercel-ip-country` off Vercel). The route only honors these
 * params outside production — see `app/api/league/context/route.ts`.
 */
export function useLeagueRequestSignals(devQuery?: string): LeagueRequestSignalsState {
  const [state, setState] = useState<LeagueRequestSignalsState>({ ...EMPTY_SIGNALS, loading: true })

  useEffect(() => {
    let cancelled = false
    const url = devQuery ? `/api/league/context?${devQuery}` : '/api/league/context'
    fetch(url, { credentials: 'include' })
      .then((res) => (res.ok ? (res.json() as Promise<LeagueRequestSignals>) : EMPTY_SIGNALS))
      .then((data) => {
        if (!cancelled) setState({ ...data, loading: false })
      })
      .catch(() => {
        if (!cancelled) setState({ ...EMPTY_SIGNALS, loading: false })
      })
    return () => {
      cancelled = true
    }
  }, [devQuery])

  return state
}
