/**
 * Sports closed-book packet — market baseline first, then cache stats, then
 * search lineups / news. Lineups are SEARCH, not the API-Sports XI feed:
 * users predict days ahead, when a confirmed lineup does not exist yet.
 */

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

export const SPORTS_SEARCH_QUERY_MAX = 6
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
  readFixture(eventId: string): Promise<SportsFixtureCacheRow | null>
  fetchFixtureStats(eventId: string): Promise<FixtureStats | null>
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
  const lines = ['MARKET BASELINE (Shin-devigged sharp book — #1 anchor)']
  if (!devig) {
    lines.push('UNAVAILABLE')
    return lines
  }
  lines.push(`Book: ${devig.bookTitle} (${devig.bookClass})`)
  lines.push(`Method: ${devig.method}${devig.shinZ != null ? ` z=${devig.shinZ.toFixed(3)}` : ''}`)
  for (const o of devig.outcomes) {
    lines.push(`${o.name}: ${pct(o.probability)}`)
  }
  const subjectPct = subjectImpliedPct(devig, subject)
  lines.push(
    `Subject implied (yes = named team wins${subject ? '' : ''}): ${
      subjectPct == null ? 'UNAVAILABLE' : `${subjectPct.toFixed(1)}%`
    }`,
  )
  if (devig.limitation) lines.push(`Limitation: ${devig.limitation}`)
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
}): string {
  const { parts } = args
  const subject = subjectTeamOf(parts)
  const opponent = opponentTeamOf(parts)
  const kickoffIso = new Date(parts.kickoffMs).toISOString()
  const sportNote = isSoccerLeague(parts.league)
    ? 'Regular time 90 minutes + stoppage. Draw = No.'
    : 'Official final result (extras count when they are official).'
  const lines: string[] = [
    'SPORTS PACKET — closed book. Numbers first, search last. Informational analysis only. Not gambling advice.',
    `Proposition: ${args.round.proposition_text}`,
    `Subject: ${subject}`,
    `Opponent: ${opponent}`,
    `Kickoff: ${kickoffIso}`,
    `Competition: ${leagueLabelEn(parts.league)}`,
    `Resolution: ${sportNote} Resolves ~2.5h after kickoff.`,
    '',
    ...formatMarketBaseline(args.cache?.devigged_odds ?? null, subject),
    '',
    ...formatStats(args.stats ?? args.cache?.stats ?? null, parts.home, parts.away),
    '',
    ...formatFindings(args.research),
  ]
  return lines.join('\n')
}

export async function buildSportsPacket(ctx: PacketBuildContext, io: SportsPacketIo): Promise<CategoryPacket> {
  const parts = decodeSportsInstrument(ctx.round.instrument)
  const queries = parts ? sportsSearchQueries(parts) : []
  const [cache, stats, research] = await Promise.all([
    parts ? io.readFixture(parts.eventId).catch(() => null) : Promise.resolve(null),
    parts ? io.fetchFixtureStats(parts.eventId).catch(() => null) : Promise.resolve(null),
    io.getResearchPacket({
      round: ctx.round,
      budgetRemainingUsd: ctx.costCapUsd,
      tier: 'high',
      forcedQueries: queries,
    }),
  ])
  const injection = parts
    ? assembleSportsInjection({ round: ctx.round, parts, cache, stats, research })
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
