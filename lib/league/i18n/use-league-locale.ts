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
import { useAdminPreview } from '../admin-preview'
import { shouldShowLeagueLanguageToggle } from '../korea-lane-features'

export type UseLeagueLocaleResult = {
  locale: LeagueLocale
  t: LeagueUiPack
  dir: 'ltr' | 'rtl'
  /** True once the manual toggle has been used (vs. still on the auto-resolved locale). */
  isOverridden: boolean
  setLocale: (locale: LeagueLocale | null) => void
  /** False for Korean-lane non-admins — selector is absent, not disabled. */
  showLanguageToggle: boolean
}

/**
 * Layer A: resolves + exposes the card's current language.
 *
 * Priority: Korean-lane lock to `'ko'` (via `resolveLeagueLocale` /
 * `admissionStockLane`) then, for viewers who may change language, a manual
 * toggle override > logged-in preference > Accept-Language > IP-region hint
 * > 'en'. Korean-lane non-admins cannot override. Visibility of categories
 * is still Layer B (`use-jurisdiction.ts`).
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
    declaredCountry: signals.declaredCountry,
  })
  const preview = useAdminPreview()
  const showLanguageToggle = shouldShowLeagueLanguageToggle({
    isAdmin: preview.isRealAdmin ? preview.effectiveIsAdmin : signals.isAdmin,
    jurisdiction: {
      declaredCountry: signals.declaredCountry,
      ipCountry: signals.ipCountry,
    },
  })
  const locale = (showLanguageToggle ? override : null) ?? auto

  return {
    locale,
    t: getLeagueUiPack(locale),
    dir: localeDir(locale),
    isOverridden: showLanguageToggle && override !== null,
    setLocale: setLeagueLocaleOverride,
    showLanguageToggle,
  }
}
