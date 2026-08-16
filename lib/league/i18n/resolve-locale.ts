import { normalizeLeagueLocale, type LeagueLocale } from './locales'

/**
 * AI Prediction League — locale RESOLUTION (Layer A), pure.
 *
 * Priority order (per spec): logged-in preference first, else
 * Accept-Language, else an IP-region hint, else 'en'. A live toggle override
 * sits ABOVE all of this and is handled by the client hook
 * (`use-league-locale.ts`) — this function only computes the "auto" locale.
 *
 * Pure and synchronous: takes already-extracted signals rather than reading
 * headers/DB itself, so it is trivially unit-testable and reusable from
 * either a server context (API route reading real headers) or a client
 * context (given signals fetched from `/api/league/context`).
 */
export type LeagueLocaleSignals = {
  /** e.g. `users.ui_locale` for the logged-in user. Highest priority. */
  profileLocale?: string | null
  /** Raw `Accept-Language` header value, e.g. "fr-FR,fr;q=0.9,en;q=0.8". */
  acceptLanguage?: string | null
  /** ISO 3166-1 alpha-2 country from IP geolocation (e.g. Vercel's `x-vercel-ip-country`). */
  ipCountry?: string | null
}

/** Only used as a last-resort hint when Accept-Language is absent/unparseable. Deliberately small and conservative. */
const IP_COUNTRY_LOCALE_HINT: Record<string, LeagueLocale> = {
  KR: 'ko',
  JP: 'ja',
  TW: 'zh-TW',
  HK: 'zh-TW',
  FR: 'fr',
  BE: 'fr',
  SA: 'ar',
  AE: 'ar',
  QA: 'ar',
  KW: 'ar',
  BH: 'ar',
  OM: 'ar',
  EG: 'ar',
  ES: 'es',
  MX: 'es',
  AR: 'es',
  CL: 'es',
  CO: 'es',
}

function parseAcceptLanguage(header: string): LeagueLocale | null {
  const tags = header
    .split(',')
    .map((part) => part.trim().split(';')[0]?.trim() ?? '')
    .filter(Boolean)
  for (const tag of tags) {
    const locale = normalizeLeagueLocale(tag)
    if (locale) return locale
  }
  return null
}

export function resolveLeagueLocale(signals: LeagueLocaleSignals): LeagueLocale {
  const fromProfile = normalizeLeagueLocale(signals.profileLocale)
  if (fromProfile) return fromProfile

  const fromHeader = signals.acceptLanguage ? parseAcceptLanguage(signals.acceptLanguage) : null
  if (fromHeader) return fromHeader

  const fromIp = signals.ipCountry ? IP_COUNTRY_LOCALE_HINT[signals.ipCountry.toUpperCase()] : undefined
  if (fromIp) return fromIp

  return 'en'
}
