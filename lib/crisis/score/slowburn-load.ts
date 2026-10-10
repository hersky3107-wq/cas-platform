import type { SupabaseClient } from '@supabase/supabase-js'
import { WIKI_HUMAN_CONCEPTS } from './wiki-roles'
import {
  concentratedRegions,
  conflictSpread,
  fourWeekConflictRise,
  hasNewActorCounted,
  scoreVolume,
  slowBurnValue,
  type DailyVolume,
  type TrendReading,
} from './slowburn'
import { lastCompleteUtcDay } from './silence'
import { SLOW_BURN } from './thresholds'
import type { ScoreRegion } from './snapshot'
import { asRecord, finite } from './math'

export interface SlowBurnHit {
  value: number
  kind: string
  detail: Record<string, unknown>
}

export interface SlowBurnRank {
  id: string
  name: string
  value: number
  kind: string
  note: string
}

export interface SlowBurnLoad {
  byRegion: Map<number, SlowBurnHit>
  regionSpecific?: Set<number>
  countries: SlowBurnRank[]
  dyads: SlowBurnRank[]
  source: string
}

function dayShift(day: string, days: number): string {
  const t = Date.parse(`${day}T00:00:00Z`) + days * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

function num(value: unknown): number {
  return finite(value) ?? 0
}

function volumeFromStats(day: string, stats: Record<string, unknown>, cameoKey = 'cameo_18_20'): DailyVolume {
  const events = num(stats.events ?? stats.total_events)
  const cameo = num(stats[cameoKey] ?? num(stats.assault) + num(stats.fight) + num(stats.mass_violence))
  const share = stats.conflict_share == null ? (events > 0 ? cameo / events : 0) : num(stats.conflict_share)
  return {
    day,
    events,
    conflict_share: share,
    avg_goldstein: num(stats.avg_goldstein),
    avg_tone: num(stats.avg_tone),
    cameo_18_20: cameo,
    cameo_share: events > 0 ? cameo / events : 0,
    num_sources: num(stats.num_sources),
  }
}

function addVolume(map: Map<string, DailyVolume>, key: string, row: DailyVolume): void {
  const prev = map.get(key)
  if (!prev) {
    map.set(key, { ...row })
    return
  }
  const events = prev.events + row.events
  prev.avg_goldstein = events > 0 ? (prev.avg_goldstein * prev.events + row.avg_goldstein * row.events) / events : 0
  prev.avg_tone = events > 0 ? (prev.avg_tone * prev.events + row.avg_tone * row.events) / events : 0
  prev.events = events
  prev.cameo_18_20 += row.cameo_18_20
  prev.num_sources += row.num_sources
  prev.conflict_share = events > 0 ? prev.cameo_18_20 / events : 0
  prev.cameo_share = prev.conflict_share
}

async function pageAll(
  client: SupabaseClient,
  table: string,
  columns: string,
  day: string,
  source?: string,
): Promise<{ rows: Array<Record<string, unknown>>; missing: boolean }> {
  const rows: Array<Record<string, unknown>> = []
  const page = 1000
  for (let from = 0; ; from += page) {
    let query = client.from(table).select(columns).gte('day', day)
    if (source) query = query.eq('source', source)
    const { data, error } = await query.range(from, from + page - 1)
    if (error) {
      if (/does not exist|schema cache/i.test(error.message)) return { rows: [], missing: true }
      throw new Error(`${table}: ${error.message}`)
    }
    const chunk = (data ?? []) as unknown as Array<Record<string, unknown>>
    rows.push(...chunk)
    if (chunk.length < page) break
  }
  return { rows, missing: false }
}

function weakIndicator(key: string, active: boolean): TrendReading {
  return { key, slope: active ? 1 : 0, worsening: active, significant: active, spiked: false }
}

export async function loadSlowBurn(
  client: SupabaseClient,
  now: Date,
  regions: ScoreRegion[],
  neighbors: Map<number, number[]>,
): Promise<SlowBurnLoad> {
  const endDay = lastCompleteUtcDay(now)
  const since = dayShift(endDay, -(SLOW_BURN.baselineDays - 1))
  const recentStart = dayShift(endDay, -(SLOW_BURN.recentDays - 1))
  const priorEnd = dayShift(recentStart, -1)
  const priorStart = dayShift(priorEnd, -(SLOW_BURN.priorDays - 1))
  const byIso = new Map<string, DailyVolume[]>()
  const byDyad = new Map<string, DailyVolume[]>()
  let source = 'crisis_country_daily'

  const storedCountries = await pageAll(client, 'crisis_country_daily', 'country_iso3, day, stats', since)
  if (!storedCountries.missing && storedCountries.rows.length) {
    for (const row of storedCountries.rows) {
      const iso3 = String(row.country_iso3 ?? '')
      const day = String(row.day ?? '').slice(0, 10)
      const stats = asRecord(row.stats)
      if (!iso3 || !day || !stats) continue
      const list = byIso.get(iso3) ?? []
      list.push(volumeFromStats(day, stats))
      byIso.set(iso3, list)
    }
  } else {
    source = 'crisis_region_daily'
    const daily = await pageAll(client, 'crisis_region_daily', 'region_id, day, source, stats', since, 'gdelt').catch(() => ({ rows: [], missing: true }))
    const regionIso = new Map(regions.filter((row) => row.level === 1 && row.iso3).map((row) => [row.id, row.iso3 as string]))
    const rolled = new Map<string, DailyVolume>()
    for (const row of daily.rows) {
      const regionId = Number(row.region_id)
      const iso3 = regionIso.get(regionId)
      const day = String(row.day ?? '').slice(0, 10)
      const stats = asRecord(row.stats)
      if (!iso3 || !day || !stats) continue
      addVolume(rolled, `${iso3}|${day}`, volumeFromStats(day, stats))
    }
    for (const [key, row] of rolled) {
      const iso3 = key.slice(0, key.indexOf('|'))
      const list = byIso.get(iso3) ?? []
      list.push(row)
      byIso.set(iso3, list)
    }
  }

  const storedDyads = await pageAll(client, 'crisis_dyad_daily', 'actor1_country, actor2_country, day, stats', since)
  if (!storedDyads.missing) {
    for (const row of storedDyads.rows) {
      const pair = `${row.actor1_country}|${row.actor2_country}`
      const day = String(row.day ?? '').slice(0, 10)
      const stats = asRecord(row.stats)
      if (!day || !stats) continue
      const list = byDyad.get(pair) ?? []
      list.push(volumeFromStats(day, stats))
      byDyad.set(pair, list)
    }
  }

  const advisorySince = new Date(now.getTime() - SLOW_BURN.advisoryDays * 86_400_000).toISOString()
  const weakSince = new Date(now.getTime() - SLOW_BURN.windowDays * 86_400_000).toISOString()
  const advisoryUp = new Set<string>()
  const internet = new Set<string>()
  const wiki = new Set<string>()
  const advisory = await client
    .from('crisis_advisory_history')
    .select('country_iso3, level, previous_level')
    .gte('changed_at', advisorySince)
    .limit(5000)
  if (!advisory.error) {
    for (const row of advisory.data ?? []) {
      if (row.previous_level != null && row.level > row.previous_level) advisoryUp.add(String(row.country_iso3))
    }
  }
  const outages = await client
    .from('crisis_raw_signals')
    .select('country_iso3')
    .eq('signal_type', 'internet_outage')
    .gte('event_time', weakSince)
    .limit(5000)
  if (!outages.error) {
    for (const row of outages.data ?? []) if (row.country_iso3) internet.add(String(row.country_iso3))
  }
  const pages = await client
    .from('crisis_raw_signals')
    .select('country_iso3, value_raw')
    .eq('signal_type', 'wiki_new_top')
    .gte('event_time', weakSince)
    .limit(5000)
  if (!pages.error) {
    for (const row of pages.data ?? []) {
      const concept = String(asRecord(row.value_raw)?.concept ?? '')
      if ((WIKI_HUMAN_CONCEPTS as readonly string[]).includes(concept) && row.country_iso3) wiki.add(String(row.country_iso3))
    }
  }

  const cameoRecent = new Map<string, Map<number, number>>()
  const cameoPrior = new Map<string, Set<number>>()
  const regionIso = new Map(regions.filter((row) => row.iso3).map((row) => [row.id, row.iso3 as string]))
  const regionRows = await pageAll(client, 'crisis_region_daily', 'region_id, day, source, stats', priorStart, 'gdelt').catch(() => ({ rows: [], missing: true }))
  for (const row of regionRows?.rows ?? []) {
    const regionId = Number(row.region_id)
    const iso3 = regionIso.get(regionId)
    const day = String(row.day ?? '').slice(0, 10)
    const stats = asRecord(row.stats)
    if (!iso3 || !stats) continue
    const cameo = num(stats.cameo_18_20 ?? num(stats.assault) + num(stats.fight) + num(stats.mass_violence))
    if (cameo <= 0) continue
    if (day >= recentStart && day <= endDay) {
      const bag = cameoRecent.get(iso3) ?? new Map()
      bag.set(regionId, (bag.get(regionId) ?? 0) + cameo)
      cameoRecent.set(iso3, bag)
    } else if (day >= priorStart && day <= priorEnd) {
      const bag = cameoPrior.get(iso3) ?? new Set()
      bag.add(regionId)
      cameoPrior.set(iso3, bag)
    }
  }

  const dyadQuiet = new Set<string>()
  const dyadRanks: SlowBurnRank[] = []
  for (const [pair, rows] of byDyad) {
    const scored = scoreVolume(rows, endDay)
    const value = slowBurnValue({ quiet: scored.quiet, dyad: false, escalation: false })
    if (scored.quiet) {
      dyadQuiet.add(pair)
      for (const iso of pair.split('|')) dyadQuiet.add(iso)
    }
    if (value > 0) {
      dyadRanks.push({
        id: pair,
        name: pair.replace('|', '–'),
        value,
        kind: 'quiet_rise',
        note: scored.indicators.filter((row) => row.significant).map((row) => row.key).join(','),
      })
    }
  }

  const byRegion = new Map<number, SlowBurnHit>()
  const countryRanks: SlowBurnRank[] = []
  const nameByIso = new Map(regions.filter((row) => row.level === 0).map((row) => [row.iso3, row.name]))
  for (const [iso3, rows] of byIso) {
    const extras = [
      weakIndicator('advisory_up', advisoryUp.has(iso3)),
      weakIndicator('internet_outages', internet.has(iso3)),
      weakIndicator('wiki_mobilization', wiki.has(iso3)),
    ]
    const scored = scoreVolume(rows, endDay, extras)
    const partnerCounts = (start: string, finish: string): Map<string, number> => {
      const found = new Map<string, number>()
      for (const [pair, series] of byDyad) {
        const parts = pair.split('|')
        if (!parts.includes(iso3)) continue
        const events = series
          .filter((row) => row.day >= start && row.day <= finish)
          .reduce((sum, row) => sum + row.events, 0)
        if (events <= 0) continue
        for (const part of parts) {
          if (part === iso3) continue
          found.set(part, (found.get(part) ?? 0) + events)
        }
      }
      return found
    }
    const spread = conflictSpread(
      [...(cameoRecent.get(iso3)?.keys() ?? [])],
      [...(cameoPrior.get(iso3) ?? [])],
      neighbors,
    )
    const recentPartners = partnerCounts(recentStart, endDay)
    const priorPartners = new Set(partnerCounts(priorStart, priorEnd).keys())
    const actor = hasNewActorCounted(recentPartners, priorPartners)
    const escalation = scored.cameoRising && (spread || actor)
    const quiet = scored.quiet
    const dyad = quiet && dyadQuiet.has(iso3)
    const value = slowBurnValue({ quiet, dyad, escalation })
    if (value <= 0) continue
    const kind = escalation ? 'escalation' : dyad ? 'dyad' : 'quiet_rise'
    const detail = {
      kind,
      spread,
      new_actor: actor,
      indicators: scored.indicators.filter((row) => row.significant).map((row) => ({
        key: row.key,
        slope: Number(row.slope.toFixed(4)),
      })),
      rise_pct: fourWeekConflictRise(rows, endDay),
    }
    const hit: SlowBurnHit = { value, kind, detail }
    countryRanks.push({
      id: iso3,
      name: nameByIso.get(iso3) ?? iso3,
      value,
      kind,
      note: detail.indicators.map((row) => row.key).join(','),
    })
    for (const region of regions) {
      if (region.iso3 !== iso3) continue
      if (region.level === 0) byRegion.set(region.id, hit)
    }
    for (const regionId of concentratedRegions(cameoRecent.get(iso3) ?? new Map())) {
      byRegion.set(regionId, hit)
    }
  }

  countryRanks.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
  dyadRanks.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
  return { byRegion, countries: countryRanks, dyads: dyadRanks, source }
}
