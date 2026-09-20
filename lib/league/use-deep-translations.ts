'use client'

import { useEffect, useMemo, useState } from 'react'
import type { LeagueLocale } from './i18n/locales'
import type { DeepSnapshot } from './deep-snapshot'
import {
  deepTranslationFingerprint,
  shouldTranslateDeepLocale,
} from './deep-display'

const DEBOUNCE_MS = 250

type DeepTranslationsResponse = {
  translations?: Record<string, string>
}

/**
 * View-time deep-analysis i18n. Triggers on the poll/read path whenever
 * translatable briefs appear, not only on first mount. Cache hits stay on
 * the server; this never blocks the English snapshot from rendering.
 */
export function useDeepTranslations(
  roundId: string,
  locale: LeagueLocale,
  snapshot: DeepSnapshot | null
): {
  translations: Record<string, string> | null
  inFlight: boolean
  showOriginal: boolean
  onToggleOriginal: () => void
} {
  const kind = snapshot?.kind ?? null
  const identity = `${roundId}:${locale}:${kind ?? ''}`
  const fingerprint = useMemo(() => deepTranslationFingerprint(snapshot), [snapshot])

  const [identityState, setIdentityState] = useState(identity)
  const [translations, setTranslations] = useState<Record<string, string> | null>(null)
  const [inFlight, setInFlight] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)

  if (identityState !== identity) {
    setIdentityState(identity)
    setTranslations(null)
    setInFlight(false)
    setShowOriginal(false)
  }

  const canTranslate = shouldTranslateDeepLocale(locale) && Boolean(kind) && Boolean(fingerprint)

  useEffect(() => {
    if (!canTranslate || !kind) return

    let cancelled = false
    const timer = window.setTimeout(() => {
      setInFlight(true)
      void (async () => {
        try {
          const res = await fetch(
            `/api/league/deep/translations?round_id=${encodeURIComponent(roundId)}&kind=${encodeURIComponent(kind)}&locale=${encodeURIComponent(locale)}`,
            { credentials: 'include' }
          )
          const body = (await res.json()) as DeepTranslationsResponse
          if (cancelled) return
          const next = body.translations ?? {}
          setTranslations((prev) => (prev ? { ...prev, ...next } : Object.keys(next).length ? next : null))
        } catch {
          // Keep whatever we already have; the snapshot stays on the original.
        } finally {
          if (!cancelled) setInFlight(false)
        }
      })()
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [roundId, locale, kind, fingerprint, canTranslate])

  return {
    translations: canTranslate && identityState === identity ? translations : null,
    inFlight: canTranslate && identityState === identity && inFlight,
    showOriginal: canTranslate && identityState === identity && showOriginal,
    onToggleOriginal: () => setShowOriginal((v) => !v),
  }
}
