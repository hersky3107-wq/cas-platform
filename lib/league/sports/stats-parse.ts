/**
 * Parsers for the three free advanced-metric feeds. Pure.
 *   football  — Understat GET /getLeagueData/{league}/{season}  (xG / xGA)
 *   baseball  — MLB Stats API counting stats → FIP; Savant CSV → xwOBA
 *   basketball — stats.nba.com leaguedashteamstats MeasureType=Advanced
 */

import type { FootballTeamStats, MlbTeamStats, NbaTeamStats } from './types'
import { normalizeTeamName, teamsMatch } from './lineup-logic'

/** Common FIP constant; season-specific cFIP moves ~0.05 and is not published here. */
export const FIP_CONSTANT = 3.1

export function parseUnderstatLeague(raw: unknown): FootballTeamStats[] {
  const teamsObj =
    raw && typeof raw === 'object' && (raw as { teams?: unknown }).teams && typeof (raw as { teams: unknown }).teams === 'object'
      ? ((raw as { teams: Record<string, unknown> }).teams as Record<string, unknown>)
      : raw && typeof raw === 'object'
        ? (raw as Record<string, unknown>)
        : {}
  const out: FootballTeamStats[] = []
  for (const value of Object.values(teamsObj)) {
    if (!value || typeof value !== 'object') continue
    const rec = value as Record<string, unknown>
    const team = typeof rec.title === 'string' ? rec.title : typeof rec.name === 'string' ? rec.name : ''
    if (!team) continue
    const history = Array.isArray(rec.history) ? rec.history : []
    let xg = 0
    let xga = 0
    let xpts = 0
    for (const row of history) {
      if (!row || typeof row !== 'object') continue
      const h = row as Record<string, unknown>
      xg += Number(h.xG ?? 0) || 0
      xga += Number(h.xGA ?? 0) || 0
      xpts += Number(h.xpts ?? 0) || 0
    }
    out.push({
      team,
      matches: history.length,
      xg: round2(xg),
      xga: round2(xga),
      xgd: round2(xg - xga),
      xpts: round2(xpts),
    })
  }
  return out
}

export function lookupFootballTeam(rows: readonly FootballTeamStats[], name: string): FootballTeamStats | null {
  return rows.find((r) => teamsMatch(r.team, name)) ?? null
}

export function computeFip(args: { hr: number; bb: number; hbp: number; k: number; ip: number }): number | null {
  if (!Number.isFinite(args.ip) || args.ip <= 0) return null
  const fip = (13 * args.hr + 3 * (args.bb + args.hbp) - 2 * args.k) / args.ip + FIP_CONSTANT
  return Number.isFinite(fip) ? round2(fip) : null
}

/** inningsPitched like "169.1" means 169 + 1/3. */
export function parseInningsPitched(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw !== 'string' || !raw.trim()) return 0
  const [whole, frac] = raw.split('.')
  const w = Number(whole)
  if (!Number.isFinite(w)) return 0
  if (frac == null) return w
  const outs = Number(frac)
  if (!Number.isFinite(outs)) return w
  return w + outs / 3
}

export function parseMlbTeamPitching(raw: unknown): MlbTeamStats[] {
  const splits = extractMlbSplits(raw)
  const out: MlbTeamStats[] = []
  for (const split of splits) {
    const team = teamNameOf(split)
    if (!team) continue
    const st = (split.stat && typeof split.stat === 'object' ? split.stat : {}) as Record<string, unknown>
    const ip = parseInningsPitched(st.inningsPitched)
    out.push({
      team,
      era: numOrNull(st.era),
      fip: computeFip({
        hr: Number(st.homeRuns ?? 0) || 0,
        bb: Number(st.baseOnBalls ?? 0) || 0,
        hbp: Number(st.hitByPitch ?? 0) || 0,
        k: Number(st.strikeOuts ?? 0) || 0,
        ip,
      }),
      whip: numOrNull(st.whip),
      xwoba: null,
    })
  }
  return out
}

export function parseSavantExpectedCsv(csv: string): Array<{ player: string; pa: number; xwoba: number }> {
  const lines = csv.trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const header = splitCsvLine(lines[0] ?? '')
  const xIdx = header.findIndex((h) => /^est_woba$|^xwoba$/i.test(h.replace(/"/g, '')))
  const paIdx = header.findIndex((h) => /^pa$/i.test(h.replace(/"/g, '')))
  const nameIdx = 0
  if (xIdx < 0) return []
  const rows: Array<{ player: string; pa: number; xwoba: number }> = []
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line)
    const xwoba = Number(cols[xIdx])
    if (!Number.isFinite(xwoba)) continue
    rows.push({
      player: (cols[nameIdx] ?? '').replace(/^"|"$/g, ''),
      pa: Number(cols[paIdx] ?? 0) || 0,
      xwoba,
    })
  }
  return rows
}

export function parseNbaAdvanced(raw: unknown): NbaTeamStats[] {
  const resultSets = raw && typeof raw === 'object' ? (raw as { resultSets?: unknown }).resultSets : null
  const set = Array.isArray(resultSets) ? resultSets[0] : null
  if (!set || typeof set !== 'object') return []
  const headers = Array.isArray((set as { headers?: unknown }).headers)
    ? ((set as { headers: unknown[] }).headers as unknown[]).map((h) => String(h))
    : []
  const rows = Array.isArray((set as { rowSet?: unknown }).rowSet) ? ((set as { rowSet: unknown[] }).rowSet as unknown[]) : []
  const idx = (name: string) => headers.indexOf(name)
  const iName = idx('TEAM_NAME')
  const iNet = idx('NET_RATING')
  const iPace = idx('PACE')
  const iOff = idx('OFF_RATING')
  const iDef = idx('DEF_RATING')
  const out: NbaTeamStats[] = []
  for (const row of rows) {
    if (!Array.isArray(row)) continue
    const team = typeof row[iName] === 'string' ? row[iName] : ''
    if (!team) continue
    out.push({
      team,
      netRating: numOrNull(row[iNet]),
      pace: numOrNull(row[iPace]),
      offRating: numOrNull(row[iOff]),
      defRating: numOrNull(row[iDef]),
    })
  }
  return out
}

export function lookupByTeam<T extends { team: string }>(rows: readonly T[], name: string): T | null {
  return rows.find((r) => teamsMatch(r.team, name) || normalizeTeamName(r.team) === normalizeTeamName(name)) ?? null
}

/** Understat season year: the calendar year the campaign started (August). */
export function understatSeasonYear(kickoffIso: string, now: Date): number {
  const d = Number.isFinite(Date.parse(kickoffIso)) ? new Date(kickoffIso) : now
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  return m >= 7 ? y : y - 1
}

function extractMlbSplits(raw: unknown): Array<Record<string, unknown>> {
  if (!raw || typeof raw !== 'object') return []
  const stats = (raw as { stats?: unknown }).stats
  const first = Array.isArray(stats) ? stats[0] : null
  const splits = first && typeof first === 'object' ? (first as { splits?: unknown }).splits : null
  if (!Array.isArray(splits)) return []
  return splits.filter((s) => s && typeof s === 'object') as Array<Record<string, unknown>>
}

function teamNameOf(split: Record<string, unknown>): string {
  const team = split.team
  if (team && typeof team === 'object' && typeof (team as { name?: unknown }).name === 'string') {
    return (team as { name: string }).name
  }
  return ''
}

function numOrNull(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQ = !inQ
      continue
    }
    if (ch === ',' && !inQ) {
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur)
  return out
}
