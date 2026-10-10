import { resolveLeagueLocale } from '@/lib/league/i18n/resolve-locale'
import { normalizeCrisisLocale, type CrisisLocale } from './locales'

export type CrisisLocaleSignals = {
  /** Saved user toggle (cookie / localStorage). Highest priority. */
  saved?: string | null
  acceptLanguage?: string | null
  ipCountry?: string | null
}

/**
 * Language choice order: user toggle (saved) > Accept-Language > IP country > English.
 * Reuses the league resolver by mapping the saved toggle onto its profile slot.
 */
export function resolveCrisisLocale(signals: CrisisLocaleSignals): CrisisLocale {
  return resolveLeagueLocale({
    profileLocale: signals.saved,
    acceptLanguage: signals.acceptLanguage,
    ipCountry: signals.ipCountry,
  })
}

export function readCookieValue(header: string | null | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const trimmed = part.trim()
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    if (trimmed.slice(0, eq) !== name) continue
    try {
      return decodeURIComponent(trimmed.slice(eq + 1))
    } catch {
      return trimmed.slice(eq + 1)
    }
  }
  return null
}

export function isCrisisLocale(raw: string | null | undefined): raw is CrisisLocale {
  return normalizeCrisisLocale(raw) != null
}
