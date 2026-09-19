/**
 * Display-only charts. 점성술 and 구성기학 compute a pack for the later
 * adapter and do not receive a ballot.
 *
 * Astro: natalChart at the pinned Seoul instant, timeKnown true, Placidus
 * (engine default). No horary judgement (quesited ruler, reception, etc.).
 *
 * 구성: year / month / day stars only. 오황살 and 길방 are not implemented;
 * 방위 taboos are not price direction even if those tables land later.
 */
import { natalChart } from '../engines/astro'
import { nineStar } from '../engines/calendar'
import { LEAGUE_SEOUL } from './conventions'
import type { SeoulCivilClock } from './seed'
import type { LeagueAstroPack, LeagueNineStarPack } from './types'

export function computeAstroChartPack(clock: SeoulCivilClock): LeagueAstroPack {
  const chart = natalChart({
    date: clock.date,
    time: clock.time,
    tz: clock.tz,
    lat: clock.lat,
    lng: clock.lng,
    timeKnown: true,
  })
  return {
    ballot: null,
    reason: 'horary_judgment_not_implemented',
    chart,
    location: { lat: LEAGUE_SEOUL.lat, lng: LEAGUE_SEOUL.lng, tz: LEAGUE_SEOUL.tz },
  }
}

export function computeNineStarChartPack(clock: SeoulCivilClock): LeagueNineStarPack {
  return {
    ballot: null,
    reason: 'five_yellow_and_auspicious_direction_not_implemented',
    result: nineStar({ date: clock.date, time: clock.time, timezone: clock.tz }),
  }
}
