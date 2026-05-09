import type { OracleBirthProfileV1 } from './types'

export function oracleProfileLooksComplete(profile: OracleBirthProfileV1 | null | undefined): boolean {
  if (!profile?.dob?.trim()) return false
  if (!profile.birth_city?.trim()) return false
  if (!profile.gender) return false

  const timeOk = profile.birth_time_24h?.trim() && /^([01]?\d|2[0-3]):([0-5]\d)$/.test(profile.birth_time_24h.trim())

  if (profile.birth_time_known) {
    return !!timeOk
  }

  /** Unknown exact time: need a band or an HH:mm (e.g. survey midpoint). */
  return !!(profile.time_approx_band?.trim() || timeOk)
}
