import { normalizeLeagueLocale, type LeagueLocale } from './locales'

/**
 * Live language-toggle override, module-level so every card on a page shares
 * one active override (mirrors `components/jeju/useTouristUi.ts`'s store
 * shape). This ONLY holds the manual override — the "auto" resolution
 * (profile -> Accept-Language -> IP -> 'en') is computed separately in
 * `resolve-locale.ts` and combined in `use-league-locale.ts`. Persisted to
 * localStorage so a user's manual choice survives a reload, but it never
 * writes to `users.ui_locale` (that would silently change their app-wide
 * preference from a one-off toggle on a single card — out of scope here).
 */
const STORAGE_KEY = 'aimani_league_locale_override'

let override: LeagueLocale | null = null
let initialized = false
const listeners = new Set<() => void>()

function ensureInitialized(): void {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    override = normalizeLeagueLocale(stored)
  } catch {
    /* ignore storage access errors */
  }
}

export function setLeagueLocaleOverride(locale: LeagueLocale | null): void {
  override = locale
  try {
    if (locale) window.localStorage.setItem(STORAGE_KEY, locale)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore storage access errors */
  }
  listeners.forEach((notify) => notify())
}

export function subscribeLeagueLocaleOverride(notify: () => void): () => void {
  listeners.add(notify)
  return () => {
    listeners.delete(notify)
  }
}

export function getLeagueLocaleOverride(): LeagueLocale | null {
  ensureInitialized()
  return override
}

/** Server render has no override (no localStorage) — deterministic for hydration. */
export function getLeagueLocaleOverrideServerSnapshot(): LeagueLocale | null {
  return null
}
