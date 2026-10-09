import type { SupabaseClient } from '@supabase/supabase-js'
import { asRecord } from '../fetch'
import { gdeltFipsToIso3, type GdeltEventRow } from './gdelt'

export interface QuadCounts {
  '1': number
  '2': number
  '3': number
  '4': number
}

export interface RelationStats {
  events: number
  quad: QuadCounts
  conflict_share: number
  avg_goldstein: number
  avg_tone: number
  num_mentions: number
  num_sources: number
  cameo_18_20: number
  goldstein_sum: number
  tone_sum: number
  goldstein_n: number
  tone_n: number
  internet_outages: number
  advisory_changes: number
  wiki_mobilization_hits: number
}

export interface DyadDailyRow {
  actor1_country: string
  actor2_country: string
  day: string
  stats: RelationStats
}

export interface CountryDailyRow {
  country_iso3: string
  day: string
  stats: RelationStats
}

export function emptyRelationStats(): RelationStats {
  return {
    events: 0,
    quad: { '1': 0, '2': 0, '3': 0, '4': 0 },
    conflict_share: 0,
    avg_goldstein: 0,
    avg_tone: 0,
    num_mentions: 0,
    num_sources: 0,
    cameo_18_20: 0,
    goldstein_sum: 0,
    tone_sum: 0,
    goldstein_n: 0,
    tone_n: 0,
    internet_outages: 0,
    advisory_changes: 0,
    wiki_mobilization_hits: 0,
  }
}

export function finalizeRelationStats(stats: RelationStats): RelationStats {
  const events = Math.max(0, stats.events)
  const conflict = stats.quad['3'] + stats.quad['4']
  stats.conflict_share = events > 0 ? conflict / events : 0
  stats.avg_goldstein = stats.goldstein_n > 0 ? stats.goldstein_sum / stats.goldstein_n : 0
  stats.avg_tone = stats.tone_n > 0 ? stats.tone_sum / stats.tone_n : 0
  return stats
}

export function canonicalDyad(actor1: string | null, actor2: string | null): [string, string] | null {
  if (!actor1 || !actor2 || actor1 === actor2) return null
  return actor1 < actor2 ? [actor1, actor2] : [actor2, actor1]
}

/** Domestic when every known actor is the location country. A foreign actor is not domestic. */
export function isDomesticEvent(location: string | null, actor1: string | null, actor2: string | null): boolean {
  if (!location) return false
  if (actor1 && actor2 && actor1 !== actor2) return false
  if (actor1 && actor1 !== location) return false
  if (actor2 && actor2 !== location) return false
  return true
}

function addEvent(stats: RelationStats, row: GdeltEventRow): void {
  stats.events += 1
  const quad = row.quad
  if (quad === 1 || quad === 2 || quad === 3 || quad === 4) stats.quad[String(quad) as '1' | '2' | '3' | '4'] += 1
  if (row.goldstein != null) {
    stats.goldstein_sum += row.goldstein
    stats.goldstein_n += 1
  }
  if (row.tone != null) {
    stats.tone_sum += row.tone
    stats.tone_n += 1
  }
  stats.num_mentions += row.mentions
  stats.num_sources += row.sources
  if (row.root === '18' || row.root === '19' || row.root === '20') stats.cameo_18_20 += 1
}

export function mergeRelationStats(prev: Partial<RelationStats> | null | undefined, next: RelationStats): RelationStats {
  const out = emptyRelationStats()
  const base = prev ?? {}
  const quad = base.quad ?? { '1': 0, '2': 0, '3': 0, '4': 0 }
  out.events = (base.events ?? 0) + next.events
  out.quad['1'] = (quad['1'] ?? 0) + next.quad['1']
  out.quad['2'] = (quad['2'] ?? 0) + next.quad['2']
  out.quad['3'] = (quad['3'] ?? 0) + next.quad['3']
  out.quad['4'] = (quad['4'] ?? 0) + next.quad['4']
  out.goldstein_sum = (base.goldstein_sum ?? 0) + next.goldstein_sum
  out.tone_sum = (base.tone_sum ?? 0) + next.tone_sum
  out.goldstein_n = (base.goldstein_n ?? 0) + next.goldstein_n
  out.tone_n = (base.tone_n ?? 0) + next.tone_n
  out.num_mentions = (base.num_mentions ?? 0) + next.num_mentions
  out.num_sources = (base.num_sources ?? 0) + next.num_sources
  out.cameo_18_20 = (base.cameo_18_20 ?? 0) + next.cameo_18_20
  out.internet_outages = base.internet_outages ?? 0
  out.advisory_changes = base.advisory_changes ?? 0
  out.wiki_mobilization_hits = base.wiki_mobilization_hits ?? 0
  return finalizeRelationStats(out)
}

export function aggregateGdeltRelations(events: GdeltEventRow[], dayFallback: string): {
  dyads: DyadDailyRow[]
  countries: CountryDailyRow[]
} {
  const dyads = new Map<string, DyadDailyRow>()
  const countries = new Map<string, CountryDailyRow>()
  for (const row of events) {
    const day = row.day ?? dayFallback
    const actor1 = row.actor1
    const actor2 = row.actor2
    const pair = canonicalDyad(actor1, actor2)
    if (pair) {
      const key = `${pair[0]}|${pair[1]}|${day}`
      const cur = dyads.get(key) ?? { actor1_country: pair[0], actor2_country: pair[1], day, stats: emptyRelationStats() }
      addEvent(cur.stats, row)
      dyads.set(key, cur)
    }
    const location = gdeltFipsToIso3(row.fips)
    if (isDomesticEvent(location, actor1, actor2) && location) {
      const key = `${location}|${day}`
      const cur = countries.get(key) ?? { country_iso3: location, day, stats: emptyRelationStats() }
      addEvent(cur.stats, row)
      countries.set(key, cur)
    }
  }
  for (const row of dyads.values()) finalizeRelationStats(row.stats)
  for (const row of countries.values()) finalizeRelationStats(row.stats)
  return { dyads: [...dyads.values()], countries: [...countries.values()] }
}

/** GDELT 1.0 daily export. Probed 2026-10-09: 20261007 and 20260711 returned HTTP 200. 20261008 was 404. */
export function gdeltV1ExportUrl(yyyymmdd: string): string {
  return `http://data.gdeltproject.org/events/${yyyymmdd}.export.CSV.zip`
}

export function backfillDayList(endYmd: string, count: number): string[] {
  const end = Date.parse(`${endYmd.slice(0, 4)}-${endYmd.slice(4, 6)}-${endYmd.slice(6, 8)}T00:00:00Z`)
  const out: string[] = []
  for (let i = count - 1; i >= 0; i -= 1) {
    const day = new Date(end - i * 86_400_000)
    const y = day.getUTCFullYear()
    const m = String(day.getUTCMonth() + 1).padStart(2, '0')
    const d = String(day.getUTCDate()).padStart(2, '0')
    out.push(`${y}${m}${d}`)
  }
  return out
}

export function pendingBackfillDays(planned: string[], completed: string[]): string[] {
  const done = new Set(completed)
  return planned.filter((day) => !done.has(day))
}

function asStats(value: unknown): Partial<RelationStats> | null {
  const rec = asRecord(value)
  if (!rec) return null
  const quad = asRecord(rec.quad)
  return {
    ...(rec as Partial<RelationStats>),
    quad: {
      '1': Number(quad?.['1'] ?? 0),
      '2': Number(quad?.['2'] ?? 0),
      '3': Number(quad?.['3'] ?? 0),
      '4': Number(quad?.['4'] ?? 0),
    },
  }
}

async function existingByKey(
  client: SupabaseClient,
  table: 'crisis_dyad_daily' | 'crisis_country_daily',
  days: string[],
): Promise<Map<string, Partial<RelationStats>> | null> {
  if (!days.length) return new Map()
  const { data, error } = await client.from(table).select('*').in('day', days)
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) return null
    throw new Error(`${table}: ${error.message}`)
  }
  const out = new Map<string, Partial<RelationStats>>()
  for (const row of data ?? []) {
    const rec = row as {
      actor1_country?: string
      actor2_country?: string
      country_iso3?: string
      day?: string
      stats?: unknown
    }
    const key = table === 'crisis_dyad_daily'
      ? `${rec.actor1_country}|${rec.actor2_country}|${rec.day}`
      : `${rec.country_iso3}|${rec.day}`
    const stats = asStats(rec.stats)
    if (stats) out.set(key, stats)
  }
  return out
}

export async function mergeStoredRelations(
  client: SupabaseClient,
  dyads: DyadDailyRow[],
  countries: CountryDailyRow[],
): Promise<{ dyads: DyadDailyRow[]; countries: CountryDailyRow[]; missing: boolean }> {
  const dyadDays = [...new Set(dyads.map((row) => row.day))]
  const countryDays = [...new Set(countries.map((row) => row.day))]
  const prevDyads = await existingByKey(client, 'crisis_dyad_daily', dyadDays)
  const prevCountries = await existingByKey(client, 'crisis_country_daily', countryDays)
  if (prevDyads == null || prevCountries == null) return { dyads, countries, missing: true }
  return {
    missing: false,
    dyads: dyads.map((row) => ({
      ...row,
      stats: mergeRelationStats(prevDyads.get(`${row.actor1_country}|${row.actor2_country}|${row.day}`), row.stats),
    })),
    countries: countries.map((row) => ({
      ...row,
      stats: mergeRelationStats(prevCountries.get(`${row.country_iso3}|${row.day}`), row.stats),
    })),
  }
}
