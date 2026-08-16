'use client'

import { useSyncExternalStore } from 'react'
import { useLeagueRequestSignals } from '../use-league-request-signals'
import { getLeagueUiPack, type LeagueUiPack } from './dictionary'
import { localeDir, type LeagueLocale } from './locales'
import {
  getLeagueLocaleOverride,
  getLeagueLocaleOverrideServerSnapshot,
  setLeagueLocaleOverride,
  subscribeLeagueLocaleOverride,
} from './locale-store'
import { resolveLeagueLocale } from './resolve-locale'

export type UseLeagueLocaleResult = {
  locale: LeagueLocale
  t: LeagueUiPack
  dir: 'ltr' | 'rtl'
  /** True once the manual toggle has been used (vs. still on the auto-resolved locale). */
  isOverridden: boolean
  setLocale: (locale: LeagueLocale | null) => void
}

/**
 * Layer A: resolves + exposes the card's current language.
 *
 * Priority: manual toggle override (this session/device) > logged-in
 * preference > Accept-Language > IP-region hint > 'en'. The auto part is the
 * pure `resolveLeagueLocale`; this hook's only job is wiring it to live
 * signals + the toggle's override store.
 *
 * Deliberately has no knowledge of jurisdiction/visibility — see
 * `lib/league/jurisdiction/use-jurisdiction.ts` for the fully separate Layer B hook.
 */
export function useLeagueLocale(devQuery?: string): UseLeagueLocaleResult {
  const signals = useLeagueRequestSignals(devQuery)
  const override = useSyncExternalStore(
    subscribeLeagueLocaleOverride,
    getLeagueLocaleOverride,
    getLeagueLocaleOverrideServerSnapshot
  )

  const auto = resolveLeagueLocale({
    profileLocale: signals.profileLocale,
    acceptLanguage: signals.acceptLanguage,
    ipCountry: signals.ipCountry,
  })
  const locale = override ?? auto

  return {
    locale,
    t: getLeagueUiPack(locale),
    dir: localeDir(locale),
    isOverridden: override !== null,
    setLocale: setLeagueLocaleOverride,
  }
}
