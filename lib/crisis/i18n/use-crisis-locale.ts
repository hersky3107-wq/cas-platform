'use client'

import { useLeagueRequestSignals } from '@/lib/league/use-league-request-signals'
import { useSyncExternalStore } from 'react'
import { getCrisisUiPack, type CrisisUiPack } from './dictionary'
import { localeDir, type CrisisLocale } from './locales'
import { resolveCrisisLocale } from './resolve'
import {
  getCrisisLocaleOverride,
  getCrisisLocaleOverrideServerSnapshot,
  setCrisisLocaleOverride,
  subscribeCrisisLocaleOverride,
} from './store'

export type UseCrisisLocaleResult = {
  locale: CrisisLocale
  t: CrisisUiPack
  dir: 'ltr' | 'rtl'
  isOverridden: boolean
  setLocale: (locale: CrisisLocale | null) => void
}

/**
 * Crisis language: saved toggle > Accept-Language > IP country > English.
 * Reuses league request signals for browser language and IP country.
 */
export function useCrisisLocale(): UseCrisisLocaleResult {
  const signals = useLeagueRequestSignals()
  const override = useSyncExternalStore(
    subscribeCrisisLocaleOverride,
    getCrisisLocaleOverride,
    getCrisisLocaleOverrideServerSnapshot,
  )
  const auto = resolveCrisisLocale({
    saved: null,
    acceptLanguage: signals.acceptLanguage,
    ipCountry: signals.ipCountry,
  })
  const locale = override ?? auto
  return {
    locale,
    t: getCrisisUiPack(locale),
    dir: localeDir(locale),
    isOverridden: override !== null,
    setLocale: setCrisisLocaleOverride,
  }
}
