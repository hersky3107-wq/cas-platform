import 'server-only'

import { getIpCountryFromHeaders } from '@/lib/geo/ip-country'
import { CRISIS_LANG_COOKIE, type CrisisLocale } from './locales'
import { readCookieValue, resolveCrisisLocale } from './resolve'

export function localeFromRequest(req: Request): CrisisLocale {
  const saved = readCookieValue(req.headers.get('cookie'), CRISIS_LANG_COOKIE)
  let urlLang: string | null = null
  try {
    urlLang = new URL(req.url).searchParams.get('lang')
  } catch {
    urlLang = null
  }
  return resolveCrisisLocale({
    saved: saved ?? urlLang,
    acceptLanguage: req.headers.get('accept-language'),
    ipCountry: getIpCountryFromHeaders(req.headers),
  })
}
