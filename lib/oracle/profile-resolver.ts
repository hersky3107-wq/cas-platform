import type { ApproxBirthBand, Gender, OracleBirthProfileV1 } from './types'
import { approxBandToMidpointHHMM, birthTimeToSijin } from './sijin'

export type ResolvedBirthForOracle = {
  dob: string
  birthCity: string
  genderLabel: string
  timeHHMM: string
  sijin: ReturnType<typeof birthTimeToSijin>
  genderRaw: Gender
}

function genderLabel(g: Gender): string {
  if (g === 'male') return 'Male'
  if (g === 'female') return 'Female'
  return 'Prefer not to say'
}

function hhmmParts(hhmm: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (Number.isNaN(h) || Number.isNaN(min) || h < 0 || h > 23 || min < 0 || min > 59) return null
  return { h, m: min }
}

export function resolveOracleBirth(profile: OracleBirthProfileV1): ResolvedBirthForOracle | null {
  if (!profile.dob || !profile.birth_city) return null

  let timeStr: string | null = profile.birth_time_24h

  if (!profile.birth_time_known) {
    if (profile.time_approx_band) {
      timeStr = approxBandToMidpointHHMM(profile.time_approx_band as ApproxBirthBand)
    } else if (profile.birth_time_24h) {
      timeStr = profile.birth_time_24h
    }
  }

  if (!timeStr || !hhmmParts(timeStr)) {
    timeStr = '12:00'
  }

  const { h: hour, m: minute } = hhmmParts(timeStr)!

  const sijin = birthTimeToSijin(hour, minute)

  return {
    dob: profile.dob,
    birthCity: profile.birth_city,
    genderRaw: profile.gender,
    genderLabel: genderLabel(profile.gender),
    timeHHMM: timeStr,
    sijin,
  }
}

export function fateBirthLine(rb: ResolvedBirthForOracle): string {
  const t = rb.timeHHMM
  return `date ${rb.dob}; local time approx. ${t}; hour pillar ${rb.sijin.kr} (${rb.sijin.rangeLabel}); city ${rb.birthCity}; gender ${rb.genderLabel}`
}
