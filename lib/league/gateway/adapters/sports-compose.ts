/**
 * Sports proposition template — server-authored, zero user substrings.
 *
 * Soccer: named team WINS in 90 minutes + stoppage; a draw is No.
 * MLB / NBA: named team wins the official result (regulation + extras).
 */

import type { UiHorizon } from '../../horizon'
import type { SportsInstrumentParts } from './sports-catalog'
import { isSoccerLeague, leagueLabelEn, opponentTeamOf, subjectTeamOf } from './sports-catalog'

export const SPORTS_PROPOSITION_TEMPLATE_SOCCER_EN =
  'Will {subject} win the {competition} match against {opponent} in regular time (90 minutes plus stoppage; a draw is No)?'

export const SPORTS_PROPOSITION_TEMPLATE_GAME_EN =
  'Will {subject} win the {competition} game against {opponent}?'

export function horizonForKickoff(kickoffIso: string, now: Date): UiHorizon {
  const target = Date.parse(kickoffIso)
  if (!Number.isFinite(target)) return '1d'
  const days = Math.ceil((target - now.getTime()) / 86_400_000)
  if (days <= 2) return '1d'
  if (days <= 10) return '1w'
  if (days <= 45) return '1m'
  return '3m'
}

export function formatSportsProposition(parts: SportsInstrumentParts): string {
  const subject = subjectTeamOf(parts)
  const opponent = opponentTeamOf(parts)
  const competition = leagueLabelEn(parts.league)
  if (isSoccerLeague(parts.league)) {
    return `Will ${subject} win the ${competition} match against ${opponent} in regular time (90 minutes plus stoppage; a draw is No)?`
  }
  return `Will ${subject} win the ${competition} game against ${opponent}?`
}

export function sportsResolutionRule(parts: SportsInstrumentParts): string {
  const subject = subjectTeamOf(parts)
  if (isSoccerLeague(parts.league)) {
    return (
      `Official full-time result of the ${leagueLabelEn(parts.league)} match ${parts.home} vs ${parts.away}. ` +
      `${subject} wins in regular time (90 minutes plus stoppage) = Yes. ` +
      `A draw, extra time, penalties, or an opponent win = No. ` +
      `Graded from a published match report URL.`
    )
  }
  return (
    `Official final result of the ${leagueLabelEn(parts.league)} game ${parts.home} vs ${parts.away}. ` +
    `${subject} wins (including extra innings / overtime when they are the official result) = Yes. ` +
    `Otherwise No. Graded from a published box-score URL.`
  )
}
