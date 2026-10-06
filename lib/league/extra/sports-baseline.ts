/**
 * Sports market baseline for the consensus extra seat: the de-vigged price on
 * the round's own fixture. The Odds API price already sits on the fixture
 * cache; API-Football fixtures (`af-…`) without one fetch Match Winner odds.
 * The tile names the team and the probability only, never a book.
 */
import { decodeSportsInstrument, isSoccerLeague, subjectTeamOf } from '../gateway/adapters/sports-catalog'
import { parseApiFootballEventId } from '../sports/api-football-leagues'
import { teamsMatch } from '../sports/lineup-logic'
import type { DevigResult, SportsTeams } from '../sports/types'
import { acceptMarketPick, type AcceptedMarketMatch, type SportsBookSource } from './market-match'

/** The price is on the round's own fixture and the named team. */
export const SPORTS_BASELINE_RELEVANCE = 1

export type SportsBaselineRound = {
  instrument: string | null
  resolves_at: string | null
}

export type SportsBaselineDeps = {
  readCachedOdds: (fixtureId: string) => Promise<{ devig: DevigResult | null; kickoff: string | null } | null>
  fetchApiFootballOdds: (fixtureId: number, teams: SportsTeams) => Promise<DevigResult | null>
}

/** De-vigged P(named team wins). A draw is a "no" on a win proposition. */
export function subjectWinProbability(devig: DevigResult, subject: string): number | null {
  const hit = devig.outcomes.find((o) => !/^draw$/i.test(o.name) && teamsMatch(o.name, subject))
  const p = hit?.probability
  return p != null && Number.isFinite(p) && p > 0 && p < 1 ? p : null
}

export function sportsBaselineMatch(args: {
  venue: SportsBookSource
  fixtureId: string
  devig: DevigResult
  subject: string
  kickoff: string | null
  deadline: string | null
}): AcceptedMarketMatch | null {
  const impliedYes = subjectWinProbability(args.devig, args.subject)
  if (impliedYes == null) return null
  const accepted = acceptMarketPick({
    relevance: SPORTS_BASELINE_RELEVANCE,
    marketResolvesAt: args.kickoff,
    deadline: args.deadline,
    sameEvent: false,
  })
  if (!accepted) return null
  return {
    venue: args.venue,
    id: args.fixtureId,
    title: `${args.subject} win`,
    outcome: args.subject,
    impliedYes,
    relevance: SPORTS_BASELINE_RELEVANCE,
    resolvesAt: args.kickoff,
    sameEvent: true,
    brand: null,
    kind: 'sports_baseline',
  }
}

function apiFootballFixtureId(league: string, eventId: string): number | null {
  if (!isSoccerLeague(league) || !/^af-\d+$/.test(eventId)) return null
  return parseApiFootballEventId(eventId)
}

export async function matchSportsBaseline(
  round: SportsBaselineRound,
  deps: SportsBaselineDeps,
): Promise<AcceptedMarketMatch | null> {
  const parts = decodeSportsInstrument(round.instrument)
  if (!parts) return null
  const subject = subjectTeamOf(parts)
  const scheduled = new Date(parts.kickoffMs).toISOString()
  const cached = await deps.readCachedOdds(parts.eventId).catch(() => null)
  const kickoff = cached?.kickoff || scheduled
  if (cached?.devig) {
    const hit = sportsBaselineMatch({
      venue: 'odds_api',
      fixtureId: parts.eventId,
      devig: cached.devig,
      subject,
      kickoff,
      deadline: round.resolves_at,
    })
    if (hit) return hit
  }
  const apiFootballId = apiFootballFixtureId(parts.league, parts.eventId)
  if (apiFootballId == null) return null
  const devig = await deps.fetchApiFootballOdds(apiFootballId, { home: parts.home, away: parts.away }).catch(() => null)
  if (!devig) return null
  return sportsBaselineMatch({
    venue: 'api_football',
    fixtureId: parts.eventId,
    devig,
    subject,
    kickoff,
    deadline: round.resolves_at,
  })
}
