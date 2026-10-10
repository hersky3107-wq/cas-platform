import { CRISIS_LANG_COOKIE, CRISIS_LANG_STORAGE, normalizeCrisisLocale, type CrisisLocale } from './locales'

let override: CrisisLocale | null = null
let initialized = false
const listeners = new Set<() => void>()

function writeCookie(locale: CrisisLocale | null): void {
  if (typeof document === 'undefined') return
  if (locale) {
    document.cookie = `${CRISIS_LANG_COOKIE}=${encodeURIComponent(locale)}; path=/; max-age=31536000; samesite=lax`
    return
  }
  document.cookie = `${CRISIS_LANG_COOKIE}=; path=/; max-age=0; samesite=lax`
}

function readCookie(): CrisisLocale | null {
  if (typeof document === 'undefined') return null
  const parts = document.cookie.split(';')
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed.startsWith(`${CRISIS_LANG_COOKIE}=`)) continue
    return normalizeCrisisLocale(decodeURIComponent(trimmed.slice(CRISIS_LANG_COOKIE.length + 1)))
  }
  return null
}

function ensureInitialized(): void {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  try {
    override = normalizeCrisisLocale(window.localStorage.getItem(CRISIS_LANG_STORAGE)) ?? readCookie()
  } catch {
    override = readCookie()
  }
}

export function setCrisisLocaleOverride(locale: CrisisLocale | null): void {
  override = locale
  try {
    if (locale) window.localStorage.setItem(CRISIS_LANG_STORAGE, locale)
    else window.localStorage.removeItem(CRISIS_LANG_STORAGE)
  } catch {
    /* ignore storage access errors */
  }
  writeCookie(locale)
  listeners.forEach((notify) => notify())
}

export function subscribeCrisisLocaleOverride(notify: () => void): () => void {
  listeners.add(notify)
  return () => {
    listeners.delete(notify)
  }
}

export function getCrisisLocaleOverride(): CrisisLocale | null {
  ensureInitialized()
  return override
}

export function getCrisisLocaleOverrideServerSnapshot(): CrisisLocale | null {
  return null
}
