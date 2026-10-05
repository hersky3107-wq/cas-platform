/**
 * Official football MATCH packet lines from API-Football facts.
 * Pure. Never includes bookmaker odds or /predictions.
 */

import type { LineupSnapshot } from './types'
import type {
  ApiFootballFixture,
  ApiFootballInjury,
  ApiFootballStandingRow,
  ApiFootballTeamStats,
} from './api-football-parse'
import { lastFiveForm, standingForTeam } from './api-football-parse'

export type FootballMatchFacts = {
  fixture: ApiFootballFixture | null
  homeStanding: ApiFootballStandingRow | null
  awayStanding: ApiFootballStandingRow | null
  homeForm: string | null
  awayForm: string | null
  homeAwayRecord: { home: string | null; away: string | null }
  h2h: Array<{ date: string; home: string; away: string; score: string }>
  injuries: { home: ApiFootballInjury[]; away: ApiFootballInjury[] }
  lineups: LineupSnapshot | null
  homeStats: ApiFootballTeamStats | null
  awayStats: ApiFootballTeamStats | null
  unavailable: string | null
}

function none(label: string, reason?: string | null): string {
  return reason ? `  ${label}: UNAVAILABLE (${reason})` : `  ${label}: none measured`
}

function formLine(label: string, form: string | null): string {
  return form ? `  ${label}: last 5 ${form}` : none(label)
}

function standingLine(label: string, row: ApiFootballStandingRow | null): string {
  if (!row) return none(label)
  return `  ${label}: ${row.team.name} P${row.played} ${row.win}W-${row.draw}D-${row.lose}L ${row.points} pts (rank ${row.rank})`
}

function recordLine(label: string, row: ApiFootballStandingRow | null, side: 'home' | 'away'): string {
  if (!row) return none(label)
  if (side === 'home') {
    if (row.homePlayed == null) return none(label)
    return `  ${label}: ${row.homeWin ?? 0}W-${row.homeDraw ?? 0}D-${row.homeLose ?? 0}L in ${row.homePlayed} home`
  }
  if (row.awayPlayed == null) return none(label)
  return `  ${label}: ${row.awayWin ?? 0}W-${row.awayDraw ?? 0}D-${row.awayLose ?? 0}L in ${row.awayPlayed} away`
}

function statsLine(label: string, stats: ApiFootballTeamStats | null): string {
  if (!stats || (stats.goalsForAvg == null && stats.goalsAgainstAvg == null)) return none(label)
  const gf = stats.goalsForAvg == null ? 'none measured' : stats.goalsForAvg.toFixed(2)
  const ga = stats.goalsAgainstAvg == null ? 'none measured' : stats.goalsAgainstAvg.toFixed(2)
  return `  ${label}: GF/game ${gf}; GA/game ${ga}${stats.played != null ? ` (n=${stats.played})` : ''}`
}

function injuryLine(label: string, rows: readonly ApiFootballInjury[]): string {
  if (!rows.length) return none(label)
  const bits = rows.slice(0, 8).map((r) => `${r.player}${r.reason || r.type ? ` (${r.reason || r.type})` : ''}`)
  return `  ${label}: ${bits.join('; ')}`
}

function lineupLine(facts: FootballMatchFacts): string[] {
  const snap = facts.lineups
  if (!snap || snap.unavailable || !snap.teams.length) {
    return [none('Lineups', snap?.unavailable ?? null)]
  }
  const lines = [`  Lineups (${snap.confidence}${snap.immutable ? ', confirmed' : ''}):`]
  for (const team of snap.teams) {
    const xi = team.startXI.length
      ? team.startXI.map((p) => (p.number != null ? `${p.number} ${p.name}` : p.name)).join(', ')
      : 'none measured'
    lines.push(`    ${team.team}${team.formation ? ` ${team.formation}` : ''}: ${xi}`)
  }
  return lines
}

export function formatFootballMatchFacts(facts: FootballMatchFacts | null | undefined): string[] {
  const lines = [
    'FOOTBALL MATCH FACTS (API-Football standings / form / H2H / injuries / lineups / team stats)',
    'Bookmaker odds and API-Football /predictions are not in this packet.',
  ]
  if (!facts || facts.unavailable) {
    lines.push(none('Facts', facts?.unavailable ?? 'none measured'))
    lines.push('BOTH SIDES — real factors only. Do not invent balance.')
    lines.push('  Up: none measured')
    lines.push('  Down: none measured')
    return lines
  }

  const home = facts.fixture?.home.name ?? 'home'
  const away = facts.fixture?.away.name ?? 'away'
  if (facts.fixture) {
    lines.push(
      `  Fixture ${facts.fixture.fixtureId}: ${home} vs ${away} (${facts.fixture.leagueName}${facts.fixture.round ? `, ${facts.fixture.round}` : ''})`,
    )
  }

  lines.push(standingLine(`${home} table`, facts.homeStanding))
  lines.push(standingLine(`${away} table`, facts.awayStanding))
  lines.push(formLine(`${home} form`, facts.homeForm ?? lastFiveForm(facts.homeStanding?.form)))
  lines.push(formLine(`${away} form`, facts.awayForm ?? lastFiveForm(facts.awayStanding?.form)))
  lines.push(recordLine(`${home} home record`, facts.homeStanding, 'home'))
  lines.push(recordLine(`${away} away record`, facts.awayStanding, 'away'))

  if (!facts.h2h.length) {
    lines.push(none('Head-to-head last 5'))
  } else {
    lines.push('  Head-to-head last 5:')
    for (const row of facts.h2h.slice(0, 5)) {
      lines.push(`    ${row.date.slice(0, 10)} ${row.home} ${row.score} ${row.away}`)
    }
  }

  lines.push(injuryLine(`${home} injuries/suspensions`, facts.injuries.home))
  lines.push(injuryLine(`${away} injuries/suspensions`, facts.injuries.away))
  lines.push(...lineupLine(facts))
  lines.push(statsLine(`${home} attack/defence`, facts.homeStats))
  lines.push(statsLine(`${away} attack/defence`, facts.awayStats))

  lines.push('BOTH SIDES — measured football facts only. Do not invent injuries, XI, or table rows.')
  const upBits: string[] = []
  const downBits: string[] = []
  const hs = facts.homeStanding
  const as = facts.awayStanding
  if (hs && as) {
    if (hs.points > as.points) upBits.push(`${home} higher in the table (${hs.points} vs ${as.points} pts)`)
    if (as.points > hs.points) downBits.push(`${away} higher in the table (${as.points} vs ${hs.points} pts)`)
  } else {
    upBits.push('table: none measured')
    downBits.push('table: none measured')
  }
  const hf = facts.homeForm ?? lastFiveForm(hs?.form)
  const af = facts.awayForm ?? lastFiveForm(as?.form)
  if (hf) upBits.push(`${home} form ${hf}`)
  else upBits.push('home form: none measured')
  if (af) downBits.push(`${away} form ${af}`)
  else downBits.push('away form: none measured')
  if (facts.injuries.away.length) upBits.push(`${away} missing ${facts.injuries.away.length}`)
  if (facts.injuries.home.length) downBits.push(`${home} missing ${facts.injuries.home.length}`)
  if (!facts.injuries.home.length && !facts.injuries.away.length) {
    upBits.push('injuries: none measured')
    downBits.push('injuries: none measured')
  }
  lines.push(`  Up (${home}): ${upBits.join('; ')}`)
  lines.push(`  Down (${away}): ${downBits.join('; ')}`)
  return lines
}

export function footballFactsFromParts(args: {
  fixture: ApiFootballFixture | null
  standings: ApiFootballStandingRow[]
  h2h: ApiFootballFixture[]
  injuries: ApiFootballInjury[]
  lineups: LineupSnapshot | null
  homeStats: ApiFootballTeamStats | null
  awayStats: ApiFootballTeamStats | null
  unavailable?: string | null
}): FootballMatchFacts {
  const fixture = args.fixture
  const home = fixture?.home
  const away = fixture?.away
  const homeStanding = home ? standingForTeam(args.standings, home) : null
  const awayStanding = away ? standingForTeam(args.standings, away) : null
  const h2h = args.h2h.slice(-5).reverse().map((f) => ({
    date: f.date,
    home: f.home.name,
    away: f.away.name,
    score:
      f.fulltimeHome != null && f.fulltimeAway != null
        ? `${f.fulltimeHome}-${f.fulltimeAway}`
        : f.goalsHome != null && f.goalsAway != null
          ? `${f.goalsHome}-${f.goalsAway}`
          : 'none measured',
  }))
  return {
    fixture,
    homeStanding,
    awayStanding,
    homeForm: lastFiveForm(homeStanding?.form) ?? lastFiveForm(args.homeStats?.form),
    awayForm: lastFiveForm(awayStanding?.form) ?? lastFiveForm(args.awayStats?.form),
    homeAwayRecord: {
      home: homeStanding && homeStanding.homePlayed != null
        ? `${homeStanding.homeWin ?? 0}W-${homeStanding.homeDraw ?? 0}D-${homeStanding.homeLose ?? 0}L`
        : null,
      away: awayStanding && awayStanding.awayPlayed != null
        ? `${awayStanding.awayWin ?? 0}W-${awayStanding.awayDraw ?? 0}D-${awayStanding.awayLose ?? 0}L`
        : null,
    },
    h2h,
    injuries: {
      home: home ? args.injuries.filter((i) => i.teamId === home.id) : [],
      away: away ? args.injuries.filter((i) => i.teamId === away.id) : [],
    },
    lineups: args.lineups,
    homeStats: args.homeStats,
    awayStats: args.awayStats,
    unavailable: args.unavailable ?? null,
  }
}
