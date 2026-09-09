/**
 * ISO 3166-1 alpha-2 codes offered at signup / first-touch country registration.
 * DATA ONLY. Anything not listed is rejected — do not accept a free-typed
 * country string (that is how a false declaration gets laundered).
 */

export const SIGNUP_COUNTRY_CODES = [
  'KR',
  'US',
  'JP',
  'CN',
  'GB',
  'DE',
  'FR',
  'IT',
  'ES',
  'NL',
  'BE',
  'AT',
  'CH',
  'SE',
  'NO',
  'DK',
  'FI',
  'IE',
  'PT',
  'PL',
  'CZ',
  'AU',
  'NZ',
  'CA',
  'MX',
  'BR',
  'AR',
  'IN',
  'SG',
  'HK',
  'TW',
  'TH',
  'VN',
  'ID',
  'MY',
  'PH',
  'AE',
  'SA',
  'QA',
  'IL',
  'ZA',
  'NG',
  'EG',
  'TR',
] as const

export type SignupCountryCode = (typeof SIGNUP_COUNTRY_CODES)[number]

export function normalizeSignupCountry(raw: unknown): SignupCountryCode | null {
  if (typeof raw !== 'string') return null
  const code = raw.trim().toUpperCase()
  return (SIGNUP_COUNTRY_CODES as readonly string[]).includes(code) ? (code as SignupCountryCode) : null
}
