'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CardModelPrediction } from './card-types'
import type { LeagueLocale } from './i18n/locales'
import { rationaleSourceFingerprint, shouldTranslateRationaleLocale } from './rationale-display'

const DEBOUNCE_MS = 250
/** Force a batch even if tiles keep arriving (so generation does not starve translation). */
const MAX_WAIT_MS = 800

type RationalesResponse = {
  translations?: Record<string, string>
  byModelId?: Record<string, string>
}

/**
 * View-time rationale i18n. Triggers on the card stream/read path whenever
 * translatable snippets appear (hub poll snapshots or live NDJSON), not only
 * on the first mount. Cache hits stay on the server; this never blocks tiles.
 */
export function useRoundRationaleTranslations(
  roundId: string,
  locale: LeagueLocale,
  models: readonly CardModelPrediction[]
): {
  translations: Record<string, string> | null
  inFlight: boolean
  showOriginal: boolean
  onToggleOriginal: () => void
} {
  const [translations, setTranslations] = useState<Record<string, string> | null>(null)
  const [inFlight, setInFlight] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)
  const firstScheduledAt = useRef<number | null>(null)
  const fingerprint = useMemo(() => rationaleSourceFingerprint(models), [models])

  useEffect(() => {
    setTranslations(null)
    setShowOriginal(false)
    firstScheduledAt.current = null
  }, [roundId, locale])

  useEffect(() => {
    if (!shouldTranslateRationaleLocale(locale)) {
      setTranslations(null)
      setInFlight(false)
      setShowOriginal(false)
      firstScheduledAt.current = null
      return
    }
    if (!fingerprint) {
      setInFlight(false)
      return
    }

    setInFlight(true)
    const now = Date.now()
    if (firstScheduledAt.current == null) firstScheduledAt.current = now
    const waited = now - firstScheduledAt.current
    const delay = waited >= MAX_WAIT_MS ? 0 : DEBOUNCE_MS

    let cancelled = false
    const timer = window.setTimeout(() => {
      firstScheduledAt.current = null
      void (async () => {
        try {
          const res = await fetch(
            `/api/league/card/rationales?round_id=${encodeURIComponent(roundId)}&locale=${encodeURIComponent(locale)}`,
            { credentials: 'include' }
          )
          const body = (await res.json()) as RationalesResponse
          if (cancelled) return
          const next = { ...(body.translations ?? {}), ...(body.byModelId ?? {}) }
          setTranslations((prev) => (prev ? { ...prev, ...next } : Object.keys(next).length ? next : null))
        } catch {
          // Keep whatever we already have; tiles stay on the original.
        } finally {
          if (!cancelled) setInFlight(false)
        }
      })()
    }, delay)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [roundId, locale, fingerprint])

  return {
    translations,
    inFlight,
    showOriginal,
    onToggleOriginal: () => setShowOriginal((v) => !v),
  }
}
