/**
 * Sports closed-book packet — market baseline first, then cache stats, then
 * search lineups / news. Lineups are SEARCH, not the API-Sports XI feed:
 * users predict days ahead, when a confirmed lineup does not exist yet.
 */

import type { FootballMatchFacts } from '../../sports/api-football-packet'
import { formatFootballMatchFacts } from '../../sports/api-football-packet'
import { teamsMatch } from '../../sports/lineup-logic'
import type { DevigResult, FixtureStats, SportsFixtureCacheRow } from '../../sports/types'
import type { CategoryPacket, PacketBuildContext, PacketRound } from '../types'
import {
  decodeSportsInstrument,
  isSoccerLeague,
  leagueLabelEn,
  opponentTeamOf,
  subjectTeamOf,
  type SportsInstrumentParts,
} from './sports-catalog'

export const SPORTS_SEARCH_QUERY_MAX = 8
export const SPORTS_PACKET_FRESH_COST_USD = 0.06

export type SportsResearchFinding = {
  query: string
  summary: string
  citations?: string[]
  searchResults?: { url?: string; title?: string; date?: string; snippet?: string }[]
}

export type SportsResearchPacket = {
  available: boolean
  cached: boolean
  cacheKey: string
  queries: string[]
  findings: SportsResearchFinding[]
  costUsd: number
  tier: string
  error?: string
}

export type SportsPacketIo = {
  listUpcomingFixtures(now?: Date): Promise<
    Array<{ fixture_id: string; league: string; home: string; away: string; kickoff: string }>
  >
  searchFootballFixtures?(
    query: string,
    now?: Date,
  ): Promise<
    | Array<{ fixture_id: string; league: string; home: string; away: string; kickoff: string }>
    | {
        fixtures: Array<{ fixture_id: string; league: string; home: string; away: string; kickoff: string }>
        reason: 'ok' | 'api_failure' | 'team_not_found' | 'no_upcoming_fixture' | 'non_public_fixture'
      }
  >
  readFixture(eventId: string): Promise<SportsFixtureCacheRow | null>
  fetchFixtureStats(eventId: string): Promise<FixtureStats | null>
  fetchFootballFacts?(
    eventId: string,
    hint?: { home: string; away: string; kickoffIso: string },
  ): Promise<FootballMatchFacts | null>
  getResearchPacket(args: {
    round: PacketRound
    budgetRemainingUsd: number
    tier: 'high'
    forcedQueries: Array<{ q: string; lang: string }>
  }): Promise<SportsResearchPacket>
}

export function sportsSearchQueries(parts: SportsInstrumentParts): Array<{ q: string; lang: string }> {
  const kickoffDay = new Date(parts.kickoffMs).toISOString().slice(0, 10)
  const queries: Array<{ q: string; lang: string }> = [
    { q: `${parts.home} 예상 선발 부상자 ${kickoffDay}`, lang: 'ko' },
    { q: `${parts.away} 예상 선발 부상자 ${kickoffDay}`, lang: 'ko' },
    {
      q: `${parts.home} vs ${parts.away} projected lineup key absences injury news ${kickoffDay}`,
      lang: 'en',
    },
    { q: `${parts.home} vs ${parts.away} head-to-head recent form last five`, lang: 'en' },
    { q: `${parts.home} vs ${parts.away} tactical preview rest travel`, lang: 'en' },
  ]
  if (parts.league === 'baseball_mlb') {
    queries.push({
      q: `${parts.home} vs ${parts.away} confirmed starting pitcher announced ${kickoffDay}`,
      lang: 'en',
    })
  }
  // Real counterweights, not a scripted upset: home/travel and workload
  // exist for every fixture. Models may use them only when search returns them.
  queries.push({
    q: `${parts.home} home advantage rest days travel vs ${parts.away} ${kickoffDay}`,
    lang: 'en',
  })
  queries.push({
    q: `${parts.home} ${parts.away} bullpen workload rotation resting starters late season ${kickoffDay}`,
    lang: 'en',
  })
  return queries.slice(0, SPORTS_SEARCH_QUERY_MAX)
}

export function subjectImpliedPct(devig: DevigResult | null | undefined, subject: string): number | null {
  if (!devig?.outcomes?.length) return null
  const hit = devig.outcomes.find((o) => teamsMatch(o.name, subject) && !/^draw$/i.test(o.name))
  if (!hit || !Number.isFinite(hit.probability)) return null
  return Math.round(hit.probability * 1000) / 10
}

function pct(p: number): string {
  return `${(p * 100).toFixed(1)}%`
}

function formatMarketBaseline(devig: DevigResult | null | undefined, subject: string): string[] {
  const lines = ['MARKET BASELINE (a price, not a required vote)']
  if (!devig) {
    lines.push('UNAVAILABLE')
    return lines
  }
  for (const o of devig.outcomes) {
    lines.push(`${o.name}: ${pct(o.probability)}`)
  }
  const subjectPct = subjectImpliedPct(devig, subject)
  lines.push(
    `Subject implied (yes = named team wins${subject ? '' : ''}): ${
      subjectPct == null ? 'UNAVAILABLE' : `${subjectPct.toFixed(1)}%`
    }`,
  )
  return lines
}

function formatStats(stats: FixtureStats | null | undefined, home: string, away: string): string[] {
  const lines = ['ADVANCED STATS (cache)']
  if (!stats || stats.unavailable) {
    lines.push(stats?.unavailable ? `UNAVAILABLE (${stats.unavailable})` : 'UNAVAILABLE')
    return lines
  }
  if (stats.football) {
    const fmt = (row: { team: string; xg: number; xga: number; matches: number } | null, fallback: string) =>
      row
        ? `${row.team} xG ${row.xg.toFixed(2)} xGA ${row.xga.toFixed(2)} (Understat, n=${row.matches})`
        : `${fallback}: UNAVAILABLE`
    lines.push(fmt(stats.football.home, home))
    lines.push(fmt(stats.football.away, away))
  } else if (stats.baseball) {
    const fmt = (
      row: { team: string; fip: number | null; xwoba: number | null; era: number | null } | null,
      fallback: string,
    ) =>
      row
        ? `${row.team} FIP ${row.fip ?? 'n/a'} xwOBA ${row.xwoba ?? 'n/a'} ERA ${row.era ?? 'n/a'}`
        : `${fallback}: UNAVAILABLE`
    lines.push(fmt(stats.baseball.home, home))
    lines.push(fmt(stats.baseball.away, away))
  } else if (stats.basketball) {
    const fmt = (
      row: { team: string; netRating: number | null; pace: number | null } | null,
      fallback: string,
    ) =>
      row
        ? `${row.team} net rating ${row.netRating ?? 'n/a'} pace ${row.pace ?? 'n/a'}`
        : `${fallback}: UNAVAILABLE`
    lines.push(fmt(stats.basketball.home, home))
    lines.push(fmt(stats.basketball.away, away))
  } else {
    lines.push('UNAVAILABLE')
  }
  return lines
}

/**
 * Favorite edge AND the underdog's priced chance, from the same book.
 * Structural facts (home side, single-game variance) are properties of the
 * fixture. Workload, rest, and fatigue are named only as a checklist the
 * search section must actually fill — this function never invents them.
 */
export function formatBothSides(
  parts: SportsInstrumentParts,
  devig: DevigResult | null | undefined,
  stats: FixtureStats | null | undefined,
): string[] {
  const lines = [
    'BOTH SIDES — real factors only. Do not invent balance.',
    'The baseline is an input, not a vote you must copy. A strong favorite can still be the right call. Weigh that measured edge against the underdog\'s priced chance and the structural facts below. Use rest, bullpen, or rotation only when the news section states them.',
  ]
  const teams = (devig?.outcomes ?? [])
    .filter((o) => !/^draw$/i.test(o.name) && Number.isFinite(o.probability))
    .slice()
    .sort((a, b) => b.probability - a.probability)
  if (!devig || teams.length < 2) {
    lines.push('Priced favorite / underdog: UNAVAILABLE. Do not invent odds.')
  } else {
    const fav = teams[0]!
    const dog = teams[teams.length - 1]!
    const gap = (fav.probability - dog.probability) * 100
    lines.push(
      `Favorite edge: ${fav.name} ${pct(fav.probability)} vs ${dog.name} ${pct(dog.probability)} (gap ${gap.toFixed(1)} points).`,
    )
    lines.push(
      `Underdog live chance: ${dog.name} is still priced at ${pct(dog.probability)} for this single game. That residual is the upset's probability in the same book.`,
    )
  }
  const draw = devig?.outcomes.find((o) => /^draw$/i.test(o.name))
  if (draw && Number.isFinite(draw.probability)) {
    lines.push(
      `Draw is priced at ${pct(draw.probability)}. On a win proposition a draw resolves as No.`,
    )
  }
  lines.push(
    `Home side: ${parts.home}. Away side: ${parts.away}. Home advantage in this single game belongs to ${parts.home}.`,
  )
  if (parts.league === 'baseball_mlb') {
    lines.push(
      'Single-game variance (MLB): one night is one starter plus a bullpen. Season FIP or ERA does not settle the game.',
    )
  } else if (parts.league === 'basketball_nba') {
    lines.push(
      'Single-game variance (NBA): one game compresses a season net-rating edge. Rest and back-to-backs matter only when the news section states them.',
    )
  } else {
    lines.push(
      'Single-game variance: one match compresses a season edge. A draw is a live result.',
    )
  }
  lines.push(...measuredStatContrast(stats))
  return lines
}

function measuredStatContrast(stats: FixtureStats | null | undefined): string[] {
  if (!stats || stats.unavailable) {
    return ['Measured stat contrast: UNAVAILABLE. Do not invent xG, FIP, or net rating.']
  }
  if (stats.football?.home && stats.football?.away) {
    const h = stats.football.home
    const a = stats.football.away
    return [
      `Measured chance contrast: ${h.team} xG ${h.xg.toFixed(2)} xGA ${h.xga.toFixed(2)} vs ${a.team} xG ${a.xg.toFixed(2)} xGA ${a.xga.toFixed(2)}. The lower-xG side still has a live chance in one match.`,
    ]
  }
  if (stats.baseball?.home && stats.baseball?.away) {
    const h = stats.baseball.home
    const a = stats.baseball.away
    return [
      `Measured chance contrast: ${h.team} FIP ${h.fip ?? 'n/a'} ERA ${h.era ?? 'n/a'} vs ${a.team} FIP ${a.fip ?? 'n/a'} ERA ${a.era ?? 'n/a'}. One starter can flip a season edge.`,
    ]
  }
  if (stats.basketball?.home && stats.basketball?.away) {
    const h = stats.basketball.home
    const a = stats.basketball.away
    return [
      `Measured chance contrast: ${h.team} net rating ${h.netRating ?? 'n/a'} vs ${a.team} net rating ${a.netRating ?? 'n/a'}. One game compresses that gap.`,
    ]
  }
  return ['Measured stat contrast: UNAVAILABLE. Do not invent xG, FIP, or net rating.']
}

function formatFindings(research: SportsResearchPacket): string[] {
  const lines = ['LINEUPS / ABSENCES / NEWS (search — projected until a confirmed XI exists)']
  if (!research.available) {
    lines.push(`Research: UNAVAILABLE${research.error ? ` (${research.error})` : ''}`)
    return lines
  }
  if (!research.findings.length) {
    lines.push('Usable findings: 0')
    return lines
  }
  for (const f of research.findings) {
    const tag = /pitcher|선발|lineup|선발|absence|부상/i.test(f.query) ? tagLineupQuery(f.query) : 'news'
    lines.push(`[${tag}] ${f.query}`)
    lines.push(`  ${f.summary.slice(0, 400)}`)
  }
  return lines
}

function tagLineupQuery(query: string): string {
  if (/confirmed starting pitcher|확정 선발/i.test(query)) return 'confirmed'
  if (/projected lineup|예상 선발/i.test(query)) return 'projected'
  if (/absence|injury|부상/i.test(query)) return 'projected'
  return 'search'
}

export function assembleSportsInjection(args: {
  round: PacketRound
  parts: SportsInstrumentParts
  cache: SportsFixtureCacheRow | null
  stats: FixtureStats | null
  research: SportsResearchPacket
  football?: FootballMatchFacts | null
}): string {
  const { parts } = args
  const subject = subjectTeamOf(parts)
  const opponent = opponentTeamOf(parts)
  const kickoffIso = new Date(parts.kickoffMs).toISOString()
  const football = isSoccerLeague(parts.league)
  const sportNote = football
    ? 'Regular time 90 minutes + stoppage. Draw = No.'
    : 'Official final result (extras count when they are official).'
  const resolveNote = football ? 'Resolves ~3h after kickoff.' : 'Resolves ~2.5h after kickoff.'
  const lines: string[] = [
    football
      ? 'SPORTS PACKET — closed book. Football facts only in this block. Informational analysis only. Not gambling advice.'
      : 'SPORTS PACKET — closed book. Read the favorite edge AND the underdog\'s priced chance. Informational analysis only. Not gambling advice.',
    `Proposition: ${args.round.proposition_text}`,
    `Subject: ${subject}`,
    `Opponent: ${opponent}`,
    `Kickoff: ${kickoffIso}`,
    `Competition: ${leagueLabelEn(parts.league)}`,
    `Resolution: ${sportNote} ${resolveNote}`,
  ]
  if (football) {
    lines.push('', ...formatFootballMatchFacts(args.football ?? null))
  } else {
    lines.push(
      '',
      ...formatMarketBaseline(args.cache?.devigged_odds ?? null, subject),
      '',
      ...formatBothSides(parts, args.cache?.devigged_odds ?? null, args.stats ?? args.cache?.stats ?? null),
      '',
      ...formatStats(args.stats ?? args.cache?.stats ?? null, parts.home, parts.away),
    )
  }
  lines.push('', ...formatFindings(args.research))
  return lines.join('\n')
}

/** Compact real brief for the crow seat — baseline, both sides, cache stats. No search prose. */
export function formatSportsCrowBrief(
  parts: SportsInstrumentParts,
  cache: SportsFixtureCacheRow | null,
): string {
  const subject = subjectTeamOf(parts)
  return [
    `Subject: ${subject}`,
    `Opponent: ${opponentTeamOf(parts)}`,
    ...formatMarketBaseline(cache?.devigged_odds ?? null, subject),
    '',
    ...formatBothSides(parts, cache?.devigged_odds ?? null, cache?.stats ?? null),
    '',
    ...formatStats(cache?.stats ?? null, parts.home, parts.away),
  ].join('\n')
}

export async function buildSportsPacket(ctx: PacketBuildContext, io: SportsPacketIo): Promise<CategoryPacket> {
  const parts = decodeSportsInstrument(ctx.round.instrument)
  const queries = parts ? sportsSearchQueries(parts) : []
  const [cache, stats, football, research] = await Promise.all([
    parts ? io.readFixture(parts.eventId).catch(() => null) : Promise.resolve(null),
    parts ? io.fetchFixtureStats(parts.eventId).catch(() => null) : Promise.resolve(null),
    parts && isSoccerLeague(parts.league) && io.fetchFootballFacts
      ? io.fetchFootballFacts(parts.eventId, {
          home: parts.home,
          away: parts.away,
          kickoffIso: new Date(parts.kickoffMs).toISOString(),
        }).catch(() => null)
      : Promise.resolve(null),
    io.getResearchPacket({
      round: ctx.round,
      budgetRemainingUsd: ctx.costCapUsd,
      tier: 'high',
      forcedQueries: queries,
    }),
  ])
  const injection = parts
    ? assembleSportsInjection({ round: ctx.round, parts, cache, stats, research, football })
    : `SPORTS PACKET — UNAVAILABLE (instrument ${ctx.round.instrument})`
  return {
    injection,
    researchCacheKey: research.cacheKey,
    researchCostUsd: research.costUsd,
    dataPacket: {
      available: Boolean(cache?.devigged_odds),
      symbol: ctx.round.instrument,
      error: cache?.devigged_odds ? undefined : 'no market baseline in cache',
    },
    research: {
      available: research.available,
      cached: research.cached,
      costUsd: Number(research.costUsd.toFixed(6)),
      queries: research.queries,
      tier: research.tier,
      tierSignal: `sports: high-tier search ${queries.length} queries (lineups via search, not API XI)`,
      error: research.error,
    },
    relatedCreditsSpent: 0,
  }
}
