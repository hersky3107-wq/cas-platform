/**
 * Deterministic seeding. Every viewer of a round must see the identical draw.
 *
 * Draw systems: `${roundId}:${firstViewIso}:${system}` fed to createRng
 * (xmur3 + mulberry32) inside ichingDraw / tarotDraw / runeDraw.
 * Timing systems ignore the seed and read the pinned Seoul timestamp.
 */
import { civilFieldsInZone, formatYmd } from '../engines/calendar/utils'
import {
  LEAGUE_PINNED_LATE_HOUR,
  LEAGUE_SEOUL,
  type LeagueDrawSeedSystem,
} from './conventions'

export type SeoulCivilClock = {
  date: string
  time: string
  tz: typeof LEAGUE_SEOUL.tz
  lat: typeof LEAGUE_SEOUL.lat
  lng: typeof LEAGUE_SEOUL.lng
  /** True when the incoming instant was 23:xx Seoul and the hour was pinned. */
  hourPinned: boolean
}

export function leagueDrawSeed(roundId: string, firstViewIso: string, system: LeagueDrawSeedSystem): string {
  if (!roundId) throw new RangeError('league-divination: roundId must be non-empty')
  if (!firstViewIso) throw new RangeError('league-divination: firstViewIso must be non-empty')
  return `${roundId}:${firstViewIso}:${system}`
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * Convert an absolute ISO instant to Seoul civil date/time, then pin hour 23
 * to 22 so 사주 택일 / 구성 never sit on the 자시 day-boundary fork.
 */
export function seoulClockFromFirstView(firstViewIso: string): SeoulCivilClock {
  const utc = new Date(firstViewIso)
  if (Number.isNaN(utc.getTime())) {
    throw new RangeError(`league-divination: invalid firstViewIso "${firstViewIso}"`)
  }
  const civil = civilFieldsInZone(utc, LEAGUE_SEOUL.tz)
  const hourPinned = civil.h === 23
  const hour = hourPinned ? LEAGUE_PINNED_LATE_HOUR : civil.h
  return {
    date: formatYmd(civil.y, civil.m, civil.d),
    time: `${pad2(hour)}:${pad2(civil.mi)}`,
    tz: LEAGUE_SEOUL.tz,
    lat: LEAGUE_SEOUL.lat,
    lng: LEAGUE_SEOUL.lng,
    hourPinned,
  }
}
