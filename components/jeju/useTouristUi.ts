'use client'

import { useSyncExternalStore } from 'react'
import {
  getTouristUiPack,
  normalizeTouristLocale,
  type TouristLocale,
  type TouristUiPack,
} from '@/lib/jeju/tourist-labels'

/**
 * Shared tourist-mode locale store.
 *
 * Multiple components (the language toggle, the search panel, …) call
 * `useTouristUi()` independently, so the active locale lives in a single
 * module-level store consumed via `useSyncExternalStore`. Selecting a language
 * anywhere re-renders every subscriber. Persisted to localStorage; first load
 * falls back to navigator language, then Korean.
 */

export const TOURIST_LANG_STORAGE_KEY = 'aimani_jeju_lang'

let currentLocale: TouristLocale = 'ko'
let initialized = false
const listeners = new Set<() => void>()

/** Lazily resolve the initial locale on the client (localStorage → navigator → ko). */
function ensureInitialized(): void {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  try {
    const stored = window.localStorage.getItem(TOURIST_LANG_STORAGE_KEY)
    if (stored) {
      currentLocale = normalizeTouristLocale(stored)
      return
    }
  } catch {
    /* ignore storage access errors */
  }
  currentLocale = normalizeTouristLocale(
    typeof navigator !== 'undefined' ? navigator.language : null
  )
}

/** Update the active tourist locale, persist it, and notify all subscribers. */
export function setTouristLocale(locale: TouristLocale): void {
  currentLocale = locale
  try {
    window.localStorage.setItem(TOURIST_LANG_STORAGE_KEY, locale)
  } catch {
    /* ignore storage access errors */
  }
  listeners.forEach((notify) => notify())
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify)
  return () => {
    listeners.delete(notify)
  }
}

function getSnapshot(): TouristLocale {
  ensureInitialized()
  return currentLocale
}

/** Server render is always Korean-primary so hydration starts deterministic. */
function getServerSnapshot(): TouristLocale {
  return 'ko'
}

export function useTouristUi(): {
  locale: TouristLocale
  t: TouristUiPack
  setLocale: (locale: TouristLocale) => void
} {
  const locale = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return { locale, t: getTouristUiPack(locale), setLocale: setTouristLocale }
}
