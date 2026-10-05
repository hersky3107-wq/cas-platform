/**
 * Sports target search — team+opponent / team-alone / dated fixture.
 *
 * Vague input is refused, not over-parsed. Player→club is light help only
 * when the rest of the text is a schedule ask (or just the name). A
 * prediction question with no opponent ("손흥민 이길까") is vague.
 *
 * Pure. Consumes the merged public slate (API-Football + Odds-API); never invents a match.
 */

import { TARGET_WINDOW_MS, MAX_TARGET_PICKS, type TargetSearchResult } from '../target-resolve'
import {
  decodeSportsInstrument,
  encodeSportsInstrument,
  extractSportsMentions,
  fixtureChipLabel,
  partsFromFixture,
  sideForTeam,
  type MentionHit,
  type SportsFixtureLite,
  type SportsSide,
} from './sports-catalog'
import { teamsMatch } from '../../sports/lineup-logic'

const STALE_MS = 3 * 60 * 60 * 1000

const VAGUE_QUESTION =
  /이길까|누가\s*이겨|오늘\s*경기|내일\s*경기|오늘밤|tonight'?s?\s+game|who\s+wins|will\s+.+\s+win/i
const SCHEDULE_HINT =
  /다음\s*경기|다음경기|일정|schedule|next\s+(?:game|match)|fixtures?|prochain\s+match|pr[oó]ximo\s+(?:jogo|partido)|次の試合|下一場|القادم/i

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
}

export type ParsedSearchDate = { year: number; month: number; day: number }

export function parseSportsSearchDate(raw: string, now: Date): ParsedSearchDate | null {
  const ko = raw.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/)
  if (ko) return clampDate(now.getUTCFullYear(), Number(ko[1]), Number(ko[2]))

  const iso = raw.match(/\b(20\d{2})[-./](\d{1,2})[-./](\d{1,2})\b/)
  if (iso) return clampDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  const en = raw.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})\b/i,
  )
  if (en) {
    const month = MONTHS[en[1]!.toLowerCase()]
    if (month) return clampDate(now.getUTCFullYear(), month, Number(en[2]))
  }

  const md = raw.match(/\b(\d{1,2})[./](\d{1,2})\b/)
  if (md) return clampDate(now.getUTCFullYear(), Number(md[1]), Number(md[2]))

  return null
}

function clampDate(year: number, month: number, day: number): ParsedSearchDate | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const utc = Date.UTC(year, month - 1, day)
  if (!Number.isFinite(utc)) return null
  return { year, month, day }
}

export function fixtureMatchesDate(kickoffIso: string, date: ParsedSearchDate): boolean {
  const t = Date.parse(kickoffIso)
  if (!Number.isFinite(t)) return false
  const target = `${date.year}-${pad2(date.month)}-${pad2(date.day)}`
  const utc = new Date(t).toISOString().slice(0, 10)
  const kst = new Date(t + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return utc === target || kst === target
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function isPastSearchDate(date: ParsedSearchDate, now: Date): boolean {
  const endUtc = Date.UTC(date.year, date.month - 1, date.day, 23, 59, 59)
  return endUtc < now.getTime() - STALE_MS
}

export function upcomingInWindow(
  slate: readonly SportsFixtureLite[],
  now: Date,
): SportsFixtureLite[] {
  const nowMs = now.getTime()
  return slate
    .filter((row) => {
      const t = Date.parse(row.kickoff)
      return Number.isFinite(t) && t > nowMs - STALE_MS && t <= nowMs + TARGET_WINDOW_MS
    })
    .sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff))
}

function slateNameHits(raw: string, slate: readonly SportsFixtureLite[]): string[] {
  const lower = raw.toLowerCase()
  const found: Array<{ name: string; at: number }> = []
  const seen = new Set<string>()
  for (const row of slate) {
    for (const name of [row.home, row.away]) {
      const key = name.toLowerCase()
      if (seen.has(key) || name.length < 4) continue
      const at = lower.indexOf(key)
      if (at < 0) continue
      seen.add(key)
      found.push({ name, at })
    }
  }
  found.sort((a, b) => a.at - b.at)
  return found.map((row) => row.name)
}

function uniqueTeams(hits: MentionHit[], slateNames: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (name: string) => {
    const key = name.toLowerCase()
    if (seen.has(key)) return
    if (out.some((existing) => teamsMatch(existing, name))) return
    seen.add(key)
    out.push(name)
  }
  for (const h of hits) push(h.canonical)
  for (const n of slateNames) push(n)
  return out
}

function instrumentFor(fixture: SportsFixtureLite, team: string): { id: string; label: string } | null {
  const side: SportsSide | null = sideForTeam(fixture, team)
  if (!side) return null
  const parts = partsFromFixture(fixture, side)
  return { id: encodeSportsInstrument(parts), label: fixtureChipLabel(fixture, team) }
}

function fixturesForTeam(window: readonly SportsFixtureLite[], team: string): SportsFixtureLite[] {
  return window.filter((row) => sideForTeam(row, team) !== null)
}

function fixturesForBoth(window: readonly SportsFixtureLite[], a: string, b: string): SportsFixtureLite[] {
  return window.filter((row) => sideForTeam(row, a) !== null && sideForTeam(row, b) !== null)
}

function missKind(all: readonly SportsFixtureLite[], now: Date): 'past' | 'unsupported' {
  const future = all.filter((row) => Date.parse(row.kickoff) > now.getTime() - STALE_MS)
  if (future.length === 0 && all.length > 0) return 'past'
  return 'unsupported'
}

/**
 * Resolve a sports freeform query onto the public slate.
 * First-named team is the Yes subject when two sides are named.
 */
export function resolveSportsTarget(
  raw: string,
  slate: readonly SportsFixtureLite[],
  now: Date,
): TargetSearchResult {
  const trimmed = raw.trim()
  if (decodeSportsInstrument(trimmed)) {
    return { kind: 'ready', entityId: trimmed, label: trimmed, skipConfirm: true }
  }

  const window = upcomingInWindow(slate, now)
  const date = parseSportsSearchDate(trimmed, now)
  const mentions = extractSportsMentions(trimmed)
  const teams = uniqueTeams(mentions, slateNameHits(trimmed, window))
  const athleteOnly = mentions.length === 1 && mentions[0]?.kind === 'athlete' && teams.length === 1
  const dated = date ? window.filter((row) => fixtureMatchesDate(row.kickoff, date)) : window

  if (teams.length === 0) return { kind: 'vague' }

  if (athleteOnly && VAGUE_QUESTION.test(trimmed) && !SCHEDULE_HINT.test(trimmed)) {
    return { kind: 'vague' }
  }

  if (date && isPastSearchDate(date, now) && dated.length === 0) {
    return { kind: 'past' }
  }

  if (teams.length >= 2) {
    const a = teams[0]!
    const b = teams[1]!
    const hits = fixturesForBoth(dated, a, b)
    if (hits.length === 0) return { kind: missKind(fixturesForBoth(slate, a, b), now) }
    const inst = instrumentFor(hits[0]!, a)
    if (!inst) return { kind: 'unsupported' }
    return { kind: 'ready', entityId: inst.id, label: inst.label, skipConfirm: true }
  }

  const team = teams[0]!
  const hits = fixturesForTeam(dated, team)
  if (hits.length === 0) return { kind: missKind(fixturesForTeam(slate, team), now) }
  const footballNext =
    SCHEDULE_HINT.test(trimmed) && hits.length > 1 && hits.every((row) => row.league.startsWith('soccer_'))
  if (hits.length === 1 || footballNext) {
    const inst = instrumentFor(hits[0]!, team)
    if (!inst) return { kind: 'unsupported' }
    return { kind: 'ready', entityId: inst.id, label: inst.label, ...(footballNext ? { skipConfirm: true } : {}) }
  }
  const options = hits
    .slice(0, MAX_TARGET_PICKS)
    .map((row) => instrumentFor(row, team))
    .filter((row): row is { id: string; label: string } => row !== null)
  if (options.length === 0) return { kind: 'unsupported' }
  return { kind: 'picks', options }
}
