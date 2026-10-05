/**
 * Sports proposition template — server-authored, zero user substrings.
 *
 * Soccer: named team WINS in 90 minutes + stoppage; a draw is No.
 * NFL: named team wins; a tie is No.
 * NHL: official final including OT/shootout unless the proposition says regulation.
 * MLB / NBA / UFC: named team wins the official result (regulation + extras).
 */

import { isUiHorizon, type UiHorizon } from '../../horizon'
import type { ComposedRound } from '../types'
import type { SportsInstrumentParts } from './sports-catalog'
import {
  decodeSportsInstrument,
  encodeSportsInstrument,
  FOOTBALL_RESOLVES_AFTER_KICKOFF_MS,
  isNflLeague,
  isNhlLeague,
  isSoccerLeague,
  leagueLabelEn,
  opponentTeamOf,
  SPORTS_RESOLVES_AFTER_KICKOFF_MS,
  subjectTeamOf,
} from './sports-catalog'

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
  if (isNflLeague(parts.league)) {
    return `Will ${subject} win the ${competition} game against ${opponent}? A tie is No.`
  }
  if (isNhlLeague(parts.league)) {
    return `Will ${subject} win the ${competition} game against ${opponent} (final result, including overtime and the shootout)?`
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
  if (isNflLeague(parts.league)) {
    return (
      `Official final result of the ${leagueLabelEn(parts.league)} game ${parts.home} vs ${parts.away}. ` +
      `${subject} wins = Yes. A tie or an opponent win = No. ` +
      `Graded from a published box-score URL.`
    )
  }
  if (isNhlLeague(parts.league)) {
    return (
      `Official final result of the ${leagueLabelEn(parts.league)} game ${parts.home} vs ${parts.away}. ` +
      `${subject} wins the final (including overtime and the shootout, unless the proposition names regulation) = Yes. ` +
      `Otherwise No. Graded from a published box-score URL.`
    )
  }
  return (
    `Official final result of the ${leagueLabelEn(parts.league)} game ${parts.home} vs ${parts.away}. ` +
    `${subject} wins (including extra innings / overtime when they are the official result) = Yes. ` +
    `Otherwise No. Graded from a published box-score URL.`
  )
}

export function buildSportsRankedRoundInput(
  instrument: string,
  uiHorizon?: UiHorizon,
  now: Date = new Date()
): ComposedRound | null {
  const parts = decodeSportsInstrument(instrument)
  if (!parts) return null
  const kickoffIso = new Date(parts.kickoffMs).toISOString()
  const afterMs = isSoccerLeague(parts.league) ? FOOTBALL_RESOLVES_AFTER_KICKOFF_MS : SPORTS_RESOLVES_AFTER_KICKOFF_MS
  const resolvesAt = new Date(parts.kickoffMs + afterMs).toISOString()
  const subject = subjectTeamOf(parts)
  const horizon = uiHorizon && isUiHorizon(uiHorizon) ? uiHorizon : horizonForKickoff(kickoffIso, now)
  const encoded = encodeSportsInstrument(parts)
  return {
    proposition_text: formatSportsProposition(parts),
    category: 'sports',
    instrument: encoded,
    horizon,
    resolution_rule: sportsResolutionRule(parts),
    resolves_at: resolvesAt,
    item_type: 'ranked',
    cache_key: `sports|${encoded}`,
    proposition_kind: 'binary_subject_outcome',
    subject_label: subject,
    observation_shape: 'name_match',
  }
}

