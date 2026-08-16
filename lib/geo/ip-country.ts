import 'server-only'

/**
 * Infra-only: reads the platform-provided IP-country header. This is NOT
 * business logic — it is shared plumbing that BOTH the language resolver
 * (`lib/league/i18n/resolve-locale.ts`) and the jurisdiction resolver
 * (`lib/league/jurisdiction/resolve.ts`) happen to need as a raw input.
 * Sharing this one-line header read does not couple those two layers: each
 * still has its own independent policy/decision logic and data table.
 *
 * Vercel automatically populates `x-vercel-ip-country` (ISO 3166-1 alpha-2)
 * on requests it proxies, with no extra package required. Returns null off
 * Vercel (e.g. local dev) or when the header is absent.
 */
export function getIpCountryFromHeaders(headers: Headers): string | null {
  const country = headers.get('x-vercel-ip-country')
  if (!country || !country.trim()) return null
  return country.trim().toUpperCase()
}
