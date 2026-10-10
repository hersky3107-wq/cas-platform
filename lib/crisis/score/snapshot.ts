/**
 * Optional ST_Touches RPC (paste in the SQL editor; not applied here):
 *
 * create or replace function public.crisis_touching_region_pairs()
 * returns table(a bigint, b bigint)
 * language sql stable security definer set search_path = public, extensions as $$
 *   select a.id, b.id from public.crisis_regions a
 *   join public.crisis_regions b
 *     on a.id < b.id and extensions.ST_Touches(a.geom, b.geom);
 * $$;
 * grant execute on function public.crisis_touching_region_pairs() to service_role;
 *
 * Without it, neighbors fall back to same-country admin1.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { isConflictWatchlistIso3 } from '../config/watchlist'
import { loadAllRegions } from '../ingest/regions'
import { isHealthWikiConcept } from '../config/wiki-health'
import { wikiTitleRole } from './wiki-roles'
import type { EventPoint } from '../events/link'
import { politeFetch } from '../ingest/fetch'
import { advisoryPairDiverges } from './advisory'
import { asRecord, finite } from './math'
import { ADVISORY, INTERNET, OBSERVED_RAIN, RAIN, WIKI } from './thresholds'
import { forecastRainFired, } from './vector-watch'
import { eventIsOlderThan, loadWikiYearCache, lookupWikiEventYear, saveWikiYearCache } from './wikidata'
import { classifyWikiTitle, wikiArticleTitle } from './wiki'
import type { CampSite, DamSite, PlantSite, PointEvent, QuakeEvent, RelatedSignal, UrbanCentre } from './types'
import { outageActive, type ObservedRain } from './trigger'

export interface ScoreRegion {
  id: number
  level: number
  iso3: string | null
  name: string
  country: string
  parent_id: number | null
  lat: number
  lon: number
}

export interface RegionInputs {
  precip: Array<number | null> | null
  discharge: Array<number | null> | null
  ratioTo30d: Array<number | null> | null
  glofasDays: number
  frpSum: number
  frpCount: number
  conflictCount: number
  conflictMean: number | null
  conflictDays: number
  totalEvents: number
  totalMean: number | null
  gdeltDays: number
  gdeltSeries: Array<{ day: string; total: number; cameo: number }>
  urbanPop: number
  centres: UrbanCentre[]
  informExposure: number | null
  informVulnerability: number | null
  informCoping: number | null
  ipc: number | null
  internet: boolean
  internetSources: string[]
  observedRain: ObservedRain | null
  wiki: boolean
  wikiTitle: string | null
  advisoryChange: boolean
  advisoryDiverge: boolean
  regionSpecificInternet: boolean
  regionSpecificAdvisory: boolean
}

export interface ScoreSnapshot {
  day: string
  regions: ScoreRegion[]
  inputs: Map<number, RegionInputs>
  neighbors: Map<number, number[]>
  quakes: QuakeEvent[]
  cyclones: PointEvent[]
  gdacs: PointEvent[]
  volcanoes: PointEvent[]
  dams: DamSite[]
  camps: CampSite[]
  plants: PlantSite[]
  frpByRegion: Map<number, number>
  conflictCounts: number[]
  signalsByRegion: Map<number, RelatedSignal[]>
  neighborSource: 'st_touches' | 'same_country'
  advisoryBoth: number
  advisoryDiverge: string[]
  wikiKept: string[]
  wikiDropped: string[]
  wikiByIso: Map<string, { natural: string[]; human: string[]; health: string[] }>
  enso: { status: string; anomaly: number | null } | null
  oil: OilContext | null
  observations: EventPoint[]
  rainDays: Map<number, string[]>
}

export interface OilQuote {
  value: number
  day: string
  change30: number | null
}

export interface OilContext {
  brent: OilQuote | null
  wti: OilQuote | null
}

function centroidLonLat(centroid: unknown): { lon: number; lat: number } | null {
  if (centroid && typeof centroid === 'object' && Array.isArray((centroid as { coordinates?: unknown }).coordinates)) {
    const [lon, lat] = (centroid as { coordinates: number[] }).coordinates
    if (Number.isFinite(lon) && Number.isFinite(lat)) return { lon, lat }
  }
  if (typeof centroid === 'string') {
    const match = /POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i.exec(centroid)
    if (match) return { lon: Number(match[1]), lat: Number(match[2]) }
  }
  return null
}

async function pageSelect<T>(
  client: SupabaseClient,
  table: string,
  columns: string,
  apply: (query: any) => any,
): Promise<T[]> {
  const rows: T[] = []
  const page = 1000
  for (let from = 0; ; from += page) {
    const query = apply(client.from(table).select(columns))
    const { data, error } = await query.range(from, from + page - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    const chunk = (data ?? []) as T[]
    rows.push(...chunk)
    if (chunk.length < page) break
  }
  return rows
}

function emptyInputs(): RegionInputs {
  return {
    precip: null,
    discharge: null,
    ratioTo30d: null,
    glofasDays: 0,
    frpSum: 0,
    frpCount: 0,
    conflictCount: 0,
    conflictMean: null,
    conflictDays: 0,
    totalEvents: 0,
    totalMean: null,
    gdeltDays: 0,
    gdeltSeries: [],
    urbanPop: 0,
    centres: [],
    informExposure: null,
    informVulnerability: null,
    informCoping: null,
    ipc: null,
    internet: false,
    internetSources: [],
    observedRain: null,
    wiki: false,
    wikiTitle: null,
    advisoryChange: false,
    advisoryDiverge: false,
    regionSpecificInternet: false,
    regionSpecificAdvisory: false,
  }
}

export async function loadScoreSnapshot(client: SupabaseClient, now: Date): Promise<ScoreSnapshot> {
  const day = now.toISOString().slice(0, 10)
  const since30 = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10)
  const since63 = new Date(now.getTime() - 63 * 86_400_000).toISOString().slice(0, 10)
  const since14 = new Date(now.getTime() - 14 * 86_400_000).toISOString()
  const sinceWiki = new Date(now.getTime() - WIKI.days * 86_400_000).toISOString()
  const sinceAdvisory = new Date(now.getTime() - ADVISORY.changeHours * 3_600_000).toISOString()
  const sinceInternet = new Date(now.getTime() - INTERNET.activeHours * 3_600_000).toISOString()

  const rawRegions = await loadAllRegions(client)
  const countryName = new Map<string, string>()
  const countryId = new Map<string, number>()
  for (const row of rawRegions) {
    if (row.level === 0 && row.iso3) {
      countryName.set(row.iso3, row.name ?? row.iso3)
      countryId.set(row.iso3, Number(row.id))
    }
  }
  const regions: ScoreRegion[] = []
  for (const row of rawRegions) {
    const point = centroidLonLat(row.centroid)
    if (!point) continue
    regions.push({
      id: Number(row.id),
      level: Number(row.level),
      iso3: row.iso3,
      name: row.name ?? row.iso3 ?? String(row.id),
      country: row.iso3 ? countryName.get(row.iso3) ?? row.iso3 : '',
      parent_id: row.parent_id,
      lat: point.lat,
      lon: point.lon,
    })
  }
  const byId = new Map(regions.map((row) => [row.id, row]))
  const inputs = new Map<number, RegionInputs>()
  for (const row of regions) inputs.set(row.id, emptyInputs())

  const put = (id: number): RegionInputs => {
    const cur = inputs.get(id) ?? emptyInputs()
    inputs.set(id, cur)
    return cur
  }

  const inheritCountry = (iso3: string | null, patch: (row: RegionInputs) => void) => {
    if (!iso3) return
    for (const row of regions) {
      if (row.iso3 === iso3) patch(put(row.id))
    }
  }

  const forecasts = await pageSelect<{ region_id: number; source: string; issued_date: string; series: unknown }>(
    client,
    'crisis_region_forecasts',
    'region_id, source, issued_date, series',
    (q) => q.gte('issued_date', since30).in('source', ['openmeteo_forecast', 'glofas']),
  )
  const latest = new Map<string, (typeof forecasts)[0]>()
  const glofasDays = new Map<number, number>()
  for (const row of forecasts) {
    const key = `${row.region_id}|${row.source}`
    const prev = latest.get(key)
    if (!prev || row.issued_date >= prev.issued_date) latest.set(key, row)
    if (row.source === 'glofas') glofasDays.set(Number(row.region_id), (glofasDays.get(Number(row.region_id)) ?? 0) + 1)
  }
  for (const row of latest.values()) {
    const series = asRecord(row.series) ?? {}
    const cur = put(Number(row.region_id))
    if (row.source === 'openmeteo_forecast') {
      cur.precip = Array.isArray(series.precip_mm) ? series.precip_mm.map((value) => finite(value)) : null
    } else if (row.source === 'glofas') {
      cur.discharge = Array.isArray(series.discharge_m3s) ? series.discharge_m3s.map((value) => finite(value)) : null
      cur.ratioTo30d = Array.isArray(series.ratio_to_30d_mean)
        ? series.ratio_to_30d_mean.map((value) => finite(value))
        : null
      cur.glofasDays = glofasDays.get(Number(row.region_id)) ?? 0
    }
  }

  const observations: EventPoint[] = []
  const daily = await pageSelect<{ region_id: number; day: string; source: string; stats: unknown }>(
    client,
    'crisis_region_daily',
    'region_id, day, source, stats',
    (q) => q.gte('day', since63).in('source', ['firms', 'gdelt']),
  )
  const firmsToday = new Map<number, number>()
  const gdeltHist = new Map<number, { conflict: number[]; total: number[]; series: Array<{ day: string; total: number; cameo: number }> }>()
  for (const row of daily) {
    const stats = asRecord(row.stats) ?? {}
    const id = Number(row.region_id)
    if (row.source === 'firms') {
      observations.push({
        kind: 'fire_cluster',
        key: String(id),
        name: `fire ${id}`,
        at: `${row.day}T00:00:00.000Z`,
        value: finite(stats.frp_sum) ?? 0,
        unit: 'frp',
        region_id: id,
        source: 'firms',
        ref: row.day,
      })
    }
    if (row.source === 'firms' && row.day === day) {
      const frp = finite(stats.frp_sum) ?? 0
      firmsToday.set(id, frp)
      const cur = put(id)
      cur.frpSum = frp
      cur.frpCount = finite(stats.count) ?? 0
    }
    if (row.source === 'gdelt') {
      const hist = gdeltHist.get(id) ?? { conflict: [], total: [], series: [] }
      const conflict = (finite(stats.assault) ?? 0) + (finite(stats.fight) ?? 0) + (finite(stats.mass_violence) ?? 0)
      const total = finite(stats.total_events) ?? 0
      const dayKey = String(row.day).slice(0, 10)
      hist.conflict.push(conflict)
      hist.total.push(total)
      hist.series.push({ day: dayKey, total, cameo: conflict })
      gdeltHist.set(id, hist)
      if (conflict > 0) {
        observations.push({
          kind: 'conflict',
          key: String(id),
          name: `conflict ${id}`,
          at: `${row.day}T00:00:00.000Z`,
          value: conflict,
          unit: 'cameo_18_20',
          region_id: id,
          source: 'gdelt',
          ref: row.day,
        })
      }
      if (row.day === day) {
        const cur = put(id)
        cur.conflictCount = conflict
        cur.totalEvents = total
        cur.totalMean = finite(stats.mean_30d)
      }
    }
  }
  for (const [id, hist] of gdeltHist) {
    const cur = put(id)
    cur.conflictDays = hist.conflict.length
    cur.gdeltDays = hist.total.length
    cur.gdeltSeries = hist.series.sort((a, b) => a.day.localeCompare(b.day))
    if (hist.conflict.length) cur.conflictMean = hist.conflict.reduce((a, b) => a + b, 0) / hist.conflict.length
    if (cur.totalMean == null && hist.total.length) {
      cur.totalMean = hist.total.reduce((a, b) => a + b, 0) / hist.total.length
    }
  }

  const metrics = await pageSelect<{
    region_id: number
    metric: string
    value: number | null
    detail: unknown
    issued_at: string
  }>(
    client,
    'crisis_region_metrics',
    'region_id, metric, value, detail, issued_at',
    (q) =>
      q.in('metric', [
        'urban_pop',
        'urban_centres',
        'inform_exposure',
        'inform_vulnerability',
        'inform_coping',
        'ipc_ml1',
        'ipc_ml2',
      ]),
  )
  const latestMetric = new Map<string, (typeof metrics)[0]>()
  for (const row of metrics) {
    const key = `${row.region_id}|${row.metric}`
    const prev = latestMetric.get(key)
    if (!prev || row.issued_at >= prev.issued_at) latestMetric.set(key, row)
  }
  const countryInform = new Map<string, { e: number | null; v: number | null; c: number | null }>()
  const countryIpc = new Map<string, number>()
  for (const row of latestMetric.values()) {
    const cur = put(Number(row.region_id))
    const region = byId.get(Number(row.region_id))
    if (row.metric === 'urban_pop') {
      cur.urbanPop = row.value ?? 0
      const detail = asRecord(row.detail)
      const top = Array.isArray(detail?.top5) ? detail.top5 : []
      cur.centres = top.flatMap((item) => {
        const rec = asRecord(item)
        if (!rec) return []
        const name = String(rec.name ?? '')
        const pop = finite(rec.pop) ?? 0
        const lat = finite(rec.lat)
        const lon = finite(rec.lon)
        if (!name || lat == null || lon == null) return []
        return [{ name, pop, lat, lon }]
      })
    }
    if (row.metric === 'inform_exposure') cur.informExposure = row.value
    if (row.metric === 'inform_vulnerability') cur.informVulnerability = row.value
    if (row.metric === 'inform_coping') cur.informCoping = row.value
    if (row.metric === 'ipc_ml2' || row.metric === 'ipc_ml1') {
      cur.ipc = Math.max(cur.ipc ?? 0, row.value ?? 0)
    }
    if (region?.level === 0 && region.iso3) {
      const bag = countryInform.get(region.iso3) ?? { e: null, v: null, c: null }
      if (row.metric === 'inform_exposure') bag.e = row.value
      if (row.metric === 'inform_vulnerability') bag.v = row.value
      if (row.metric === 'inform_coping') bag.c = row.value
      countryInform.set(region.iso3, bag)
      if ((row.metric === 'ipc_ml1' || row.metric === 'ipc_ml2') && row.value != null) {
        countryIpc.set(region.iso3, Math.max(countryIpc.get(region.iso3) ?? 0, row.value))
      }
    }
  }
  for (const row of regions) {
    if (!row.iso3) continue
    const cur = put(row.id)
    const bag = countryInform.get(row.iso3)
    if (bag) {
      if (cur.informExposure == null) cur.informExposure = bag.e
      if (cur.informVulnerability == null) cur.informVulnerability = bag.v
      if (cur.informCoping == null) cur.informCoping = bag.c
    }
    if (cur.ipc == null && countryIpc.has(row.iso3)) cur.ipc = countryIpc.get(row.iso3) ?? null
  }

  const signals = await pageSelect<{
    region_id: number | null
    country_iso3: string | null
    source: string
    signal_type: string
    title: string | null
    url: string | null
    lat: number | null
    lon: number | null
    value_num: number | null
    value_raw: unknown
    event_time: string | null
  }>(
    client,
    'crisis_raw_signals',
    'region_id, country_iso3, source, signal_type, title, url, lat, lon, value_num, value_raw, event_time',
    (q) =>
      q
        .in('signal_type', [
          'earthquake',
          'cyclone_forecast_point',
          'elevated_volcano',
          'internet_outage',
          'wiki_new_top',
          'advisory_change',
          'advisory_divergence',
          'EQ',
          'TC',
          'FL',
          'VO',
          'DR',
          'WF',
          'cyclone_formation',
          'enso_status',
          'volcano_unrest',
          'holocene_eruption',
        ])
        .gte('event_time', since14)
        .order('event_time', { ascending: false }),
  )

  const wikiKept: string[] = []
  const wikiDropped: string[] = []
  const wikiSeen = new Set<string>()
  const wikiPending: Array<{ title: string; term: string; concept: string; iso3: string | null }> = []
  let enso: ScoreSnapshot['enso'] = null
  const quakes: QuakeEvent[] = []
  const cyclones: PointEvent[] = []
  const gdacs: PointEvent[] = []
  const volcanoes: PointEvent[] = []
  const signalsByRegion = new Map<number, RelatedSignal[]>()
  const pushSignal = (regionId: number | null, iso3: string | null, item: RelatedSignal) => {
    const ids = new Set<number>()
    if (regionId != null) ids.add(regionId)
    if (iso3) {
      const cid = countryId.get(iso3)
      if (cid != null) ids.add(cid)
      for (const row of regions) if (row.iso3 === iso3) ids.add(row.id)
    }
    for (const id of ids) {
      const list = signalsByRegion.get(id) ?? []
      if (list.length < 8) list.push(item)
      signalsByRegion.set(id, list)
    }
  }

  for (const row of signals) {
    const raw = asRecord(row.value_raw) ?? {}
    const related: RelatedSignal = {
      source: row.source,
      title: row.title,
      url: row.url,
      event_time: row.event_time,
    }
    pushSignal(row.region_id == null ? null : Number(row.region_id), row.country_iso3, related)
    if (row.signal_type === 'earthquake' && row.lat != null && row.lon != null && row.value_num != null) {
      quakes.push({
        lat: row.lat,
        lon: row.lon,
        mag: row.value_num,
        source: row.source,
        event_time: row.event_time,
      })
    } else if ((row.signal_type === 'cyclone_forecast_point' || row.signal_type === 'cyclone_formation' || row.signal_type === 'TC') && row.lat != null && row.lon != null) {
      cyclones.push({ lat: row.lat, lon: row.lon, event_time: row.event_time })
      const storm = String(raw.storm_id ?? raw.name ?? row.title ?? 'storm')
      observations.push({
        kind: 'cyclone',
        key: storm,
        name: storm,
        at: row.event_time ?? now.toISOString(),
        value: finite(row.value_num) ?? 0,
        unit: row.signal_type === 'cyclone_formation' ? 'percent' : 'kt',
        region_id: row.region_id == null ? null : Number(row.region_id),
        lat: row.lat,
        lon: row.lon,
        source: row.source,
        ref: storm,
      })
    } else if (row.signal_type === 'enso_status') {
      enso = { status: String(raw.status ?? row.title ?? 'unspecified'), anomaly: finite(row.value_num) }
    } else if (row.source === 'gdacs' && row.lat != null && row.lon != null) {
      gdacs.push({
        lat: row.lat,
        lon: row.lon,
        event_time: row.event_time,
        alert: typeof raw.alert_level === 'string' ? raw.alert_level : null,
        region_id: row.region_id == null ? null : Number(row.region_id),
        country_iso3: row.country_iso3,
        event_type: typeof raw.event_type === 'string' ? raw.event_type : row.signal_type ?? null,
      })
      if (row.signal_type === 'FL' && row.region_id != null) {
        observations.push({
          kind: 'flood',
          key: String(row.region_id),
          name: row.title ?? 'flood',
          at: row.event_time ?? now.toISOString(),
          value: finite(row.value_num) ?? 1,
          unit: 'alert',
          region_id: Number(row.region_id),
          source: row.source,
          ref: row.title ?? 'flood',
        })
      }
    } else if (row.signal_type === 'elevated_volcano' && row.lat != null && row.lon != null) {
      const alert = String(raw.color_code ?? raw.alert_level ?? '')
      volcanoes.push({ lat: row.lat, lon: row.lon, event_time: row.event_time, alert })
    } else if (row.signal_type === 'internet_outage') {
      const until = typeof raw.until === 'string' ? raw.until : null
      if (outageActive({ source: row.source, eventTime: row.event_time, until }, sinceInternet)) {
        if (row.region_id != null && byId.get(Number(row.region_id))?.level === 1) {
          put(Number(row.region_id)).regionSpecificInternet = true
        }
        inheritCountry(row.country_iso3, (cur) => {
          cur.internet = true
          if (!cur.internetSources.includes(row.source)) cur.internetSources.push(row.source)
        })
      }
    } else if (row.signal_type === 'wiki_new_top' && (row.event_time ?? '') >= sinceWiki) {
      const stored = row.title ?? ''
      const title = wikiArticleTitle(stored)
      const term = typeof raw.term === 'string' ? raw.term : ''
      const verdict = classifyWikiTitle(title, term, now.getUTCFullYear())
      const tag = `${title} [${verdict.reason ?? 'keep'}]`
      if (!wikiSeen.has(title)) {
        wikiSeen.add(title)
        if (verdict.keep) {
          wikiPending.push({
            title,
            term,
            concept: typeof raw.concept === 'string' ? raw.concept : '',
            iso3: row.country_iso3,
          })
        }
        else wikiDropped.push(tag)
      }
    } else if (row.signal_type === 'FL' && row.region_id != null) {
      observations.push({
        kind: 'flood',
        key: String(row.region_id),
        name: row.title ?? 'flood',
        at: row.event_time ?? now.toISOString(),
        value: finite(row.value_num) ?? 1,
        unit: 'alert',
        region_id: Number(row.region_id),
        source: row.source,
        ref: row.title ?? 'flood',
      })
    } else if (row.signal_type === 'advisory_change' && (row.event_time ?? '') >= sinceAdvisory) {
      if (row.region_id != null && byId.get(Number(row.region_id))?.level === 1) {
        put(Number(row.region_id)).regionSpecificAdvisory = true
      }
      inheritCountry(row.country_iso3, (cur) => { cur.advisoryChange = true })
    } else if (row.signal_type === 'advisory_divergence') {
      if (row.region_id != null && byId.get(Number(row.region_id))?.level === 1) {
        put(Number(row.region_id)).regionSpecificAdvisory = true
      }
    }
  }

  const wikiByIso = new Map<string, { natural: string[]; human: string[]; health: string[] }>()
  const yearCache = loadWikiYearCache()
  let yearCacheDirty = false
  for (const row of wikiPending) {
    let ancient = false
    try {
      const year = await lookupWikiEventYear(row.title, yearCache, async (url) => {
        const res = await politeFetch(url, { sourceKey: 'wikidata', minIntervalMs: 250 })
        if (!res.ok || res.data == null) throw new Error(res.error ?? 'wikidata')
        yearCacheDirty = true
        return res.data
      })
      if (Object.prototype.hasOwnProperty.call(yearCache, row.title)) yearCacheDirty = true
      ancient = eventIsOlderThan(year, now.getUTCFullYear())
    } catch {
      ancient = false
    }
    if (ancient) {
      wikiDropped.push(`${row.title} [wikidata]`)
      continue
    }
    wikiKept.push(row.title)
    if (!row.iso3) continue
    const bag = wikiByIso.get(row.iso3) ?? { natural: [], human: [], health: [] }
    if (isHealthWikiConcept(row.title, row.term)) bag.health.push(row.title)
    else {
      const role = wikiTitleRole(row.title, row.term, row.concept)
      if (role === 'natural') bag.natural.push(row.title)
      else if (role === 'human') bag.human.push(row.title)
    }
    wikiByIso.set(row.iso3, bag)
  }
  if (yearCacheDirty) {
    try { saveWikiYearCache(yearCache) } catch { /* cache is optional */ }
  }

  const advisoryRows = await pageSelect<{ country_iso3: string; source: string; level: number | null; updated_at: string | null }>(
    client,
    'crisis_advisory_state',
    'country_iso3, source, level, updated_at',
    (q) => q.in('source', ['us_state', 'uk_fcdo']),
  )
  const historyRows = await pageSelect<{ country_iso3: string; source: string; changed_at: string }>(
    client,
    'crisis_advisory_history',
    'country_iso3, source, changed_at',
    (q) => q.gte('changed_at', sinceAdvisory),
  )
  const changedByCountry = new Map<string, Set<string>>()
  for (const row of historyRows) {
    const set = changedByCountry.get(row.country_iso3) ?? new Set()
    set.add(row.source)
    changedByCountry.set(row.country_iso3, set)
  }
  const pair = new Map<string, { us: number | null; uk: number | null }>()
  for (const row of advisoryRows) {
    const bag = pair.get(row.country_iso3) ?? { us: null, uk: null }
    if (row.source === 'us_state') bag.us = finite(row.level)
    if (row.source === 'uk_fcdo') bag.uk = finite(row.level)
    pair.set(row.country_iso3, bag)
  }
  const advisoryDiverge: string[] = []
  let advisoryBoth = 0
  for (const [iso3, sides] of pair) {
    const us = sides.us == null ? null : { level: sides.us }
    const uk = sides.uk == null ? null : { level: sides.uk }
    if (us && uk) advisoryBoth += 1
    const changed = changedByCountry.get(iso3) ?? new Set()
    if (advisoryPairDiverges({
      us,
      uk,
      usChanged: changed.has('us_state'),
      ukChanged: changed.has('uk_fcdo'),
    })) {
      advisoryDiverge.push(iso3)
      inheritCountry(iso3, (cur) => { cur.advisoryDiverge = true })
    }
  }

  const fragility = await pageSelect<{
    region_id: number | null
    kind: string
    name: string
    lat: number
    lon: number
    attributes: unknown
  }>(
    client,
    'crisis_fragility',
    'region_id, kind, name, lat, lon, attributes',
    (q) => q.in('kind', ['dam', 'levee', 'refugee_camp', 'nuclear_plant', 'chemical_plant', 'port']).in('confidence', ['dataset', 'confirmed', 'candidate']),
  )
  const dams: DamSite[] = []
  const camps: CampSite[] = []
  const plants: PlantSite[] = []
  for (const row of fragility) {
    const attrs = asRecord(row.attributes) ?? {}
    const site = {
      name: row.name,
      lat: row.lat,
      lon: row.lon,
      region_id: row.region_id == null ? null : Number(row.region_id),
    }
    if (row.kind === 'dam' || row.kind === 'levee') {
      dams.push({
        ...site,
        kind: row.kind,
        height_m: finite(attrs.height_m),
        year_built: finite(attrs.year_built),
      })
    } else if (row.kind === 'refugee_camp') camps.push(site)
    else if (row.kind === 'nuclear_plant' || row.kind === 'chemical_plant' || row.kind === 'port') {
      plants.push({ ...site, kind: row.kind })
    }
  }

  let neighborSource: ScoreSnapshot['neighborSource'] = 'same_country'
  const neighbors = new Map<number, number[]>()
  let geometryPairs = false
  try {
    const stored = await pageSelect<{ region_id: number; neighbor_id: number }>(
      client,
      'crisis_region_neighbors',
      'region_id, neighbor_id',
      (q) => q,
    )
    if (stored.length) {
      geometryPairs = true
      neighborSource = 'st_touches'
      for (const row of stored) {
        const a = Number(row.region_id)
        const b = Number(row.neighbor_id)
        if (!a || !b) continue
        neighbors.set(a, [...(neighbors.get(a) ?? []), b])
      }
    }
  } catch {
    geometryPairs = false
  }
  const { data: touch, error: touchError } = geometryPairs
    ? { data: null, error: null }
    : await client.rpc('crisis_touching_region_pairs')
  if (!geometryPairs && !touchError && Array.isArray(touch) && touch.length) {
    neighborSource = 'st_touches'
    for (const row of touch as Array<{ a?: number; b?: number }>) {
      const a = Number(row.a)
      const b = Number(row.b)
      if (!a || !b) continue
      neighbors.set(a, [...(neighbors.get(a) ?? []), b])
      neighbors.set(b, [...(neighbors.get(b) ?? []), a])
    }
  } else if (!geometryPairs) {
    const byCountry = new Map<string, number[]>()
    for (const row of regions) {
      if (!row.iso3) continue
      const list = byCountry.get(row.iso3) ?? []
      list.push(row.id)
      byCountry.set(row.iso3, list)
    }
    for (const ids of byCountry.values()) {
      for (const id of ids) neighbors.set(id, ids.filter((other) => other !== id))
    }
  }

  for (const [id, observed] of await loadObservedRain(client, now)) put(id).observedRain = observed
  const oil = await loadOil(client, now)

  return {
    day,
    regions,
    inputs,
    neighbors,
    quakes,
    cyclones,
    gdacs,
    volcanoes,
    dams,
    camps,
    plants,
    frpByRegion: firmsToday,
    conflictCounts: [...inputs.values()].map((row) => row.conflictCount),
    signalsByRegion,
    neighborSource,
    advisoryBoth,
    advisoryDiverge,
    wikiKept,
    wikiDropped,
    wikiByIso,
    enso,
    oil,
    observations,
    rainDays: await loadRainDays(client, now),
  }
}

/** Latest IMERG three-day total per region, with the daily values it was built from. */
export function observedRainFromRows(
  rows: Array<{ region_id: number; metric: string; valid_time: string; value: number | null; detail: unknown; issued_at: string }>,
): Map<number, ObservedRain> {
  const daily = new Map<string, { value: number; issued: string }>()
  const latest3 = new Map<number, { valid: string; issued: string; value: number; days: string[]; runs: string[] }>()
  for (const row of rows) {
    const id = Number(row.region_id)
    const value = finite(row.value)
    if (value == null) continue
    const day = String(row.valid_time).slice(0, 10)
    if (row.metric === 'imerg_precip_1d') {
      const key = `${id}|${day}`
      const prev = daily.get(key)
      if (!prev || row.issued_at >= prev.issued) daily.set(key, { value, issued: row.issued_at })
    } else if (row.metric === 'imerg_precip_3d') {
      const prev = latest3.get(id)
      if (!prev || day > prev.valid || (day === prev.valid && row.issued_at >= prev.issued)) {
        const detail = asRecord(row.detail) ?? {}
        const days = Array.isArray(detail.days) ? detail.days.map(String) : []
        const runs = Array.isArray(detail.runs) ? detail.runs.map(String) : []
        latest3.set(id, { valid: day, issued: row.issued_at, value, days, runs })
      }
    }
  }
  const out = new Map<number, ObservedRain>()
  for (const [id, row] of latest3) {
    const values = row.days.map((day) => daily.get(`${id}|${day}`)?.value).filter((value): value is number => value != null)
    out.set(id, { sum3: row.value, maxDay: values.length ? Math.max(...values) : 0, days: row.days, runs: row.runs })
  }
  return out
}

async function loadObservedRain(client: SupabaseClient, now: Date): Promise<Map<number, ObservedRain>> {
  const since = new Date(now.getTime() - OBSERVED_RAIN.maxAgeDays * 86_400_000).toISOString()
  try {
    const rows = await pageSelect<{ region_id: number; metric: string; valid_time: string; value: number | null; detail: unknown; issued_at: string }>(
      client,
      'crisis_region_metrics',
      'region_id, metric, valid_time, value, detail, issued_at',
      (q) => q.in('metric', ['imerg_precip_1d', 'imerg_precip_3d']).gte('valid_time', since),
    )
    return observedRainFromRows(rows)
  } catch {
    return new Map()
  }
}

export function oilFromRows(rows: Array<{ metric: string; valid_time: string; value: number | null }>): OilContext | null {
  const quote = (metric: string): OilQuote | null => {
    const series = rows
      .filter((row) => row.metric === metric && finite(row.value) != null)
      .map((row) => ({ day: String(row.valid_time).slice(0, 10), value: row.value as number }))
      .sort((a, b) => b.day.localeCompare(a.day))
    const head = series[0]
    if (!head) return null
    const cutoff = new Date(Date.parse(`${head.day}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10)
    const base = series.find((row) => row.day <= cutoff)
    const change30 = base && base.value > 0 ? Math.round(((head.value - base.value) / base.value) * 1000) / 10 : null
    return { value: head.value, day: head.day, change30 }
  }
  const brent = quote('brent_usd')
  const wti = quote('wti_usd')
  return brent || wti ? { brent, wti } : null
}

async function loadOil(client: SupabaseClient, now: Date): Promise<OilContext | null> {
  const since = new Date(now.getTime() - 50 * 86_400_000).toISOString()
  const { data, error } = await client
    .from('crisis_global_metrics')
    .select('metric, valid_time, value')
    .in('metric', ['brent_usd', 'wti_usd'])
    .eq('source', 'eia')
    .gte('valid_time', since)
    .limit(500)
  if (error) return null
  return oilFromRows((data ?? []) as Array<{ metric: string; valid_time: string; value: number | null }>)
}

export function oilContextLine(oil: OilContext | null): string | null {
  if (!oil) return null
  const part = (label: string, quote: OilQuote | null) => {
    if (!quote) return null
    const change = quote.change30 == null ? '' : `, ${quote.change30 >= 0 ? '+' : ''}${quote.change30}% vs 30d`
    return `${label} $${quote.value.toFixed(2)} (${quote.day}${change})`
  }
  const parts = [part('Brent', oil.brent), part('WTI', oil.wti)].filter(Boolean)
  return parts.length ? `oil: ${parts.join('; ')} [EIA]` : null
}

async function loadRainDays(client: SupabaseClient, now: Date): Promise<Map<number, string[]>> {
  const rainDays = new Map<number, string[]>()
  const from = new Date(now.getTime() - 56 * 86_400_000).toISOString().slice(0, 10)
  const to = new Date(now.getTime() - 21 * 86_400_000).toISOString().slice(0, 10)
  const page = 1000
  try {
    for (let start = 0; start < 3000; start += page) {
      const { data, error } = await client
        .from('crisis_region_forecasts')
        .select('region_id, issued_date, series')
        .eq('source', 'openmeteo_forecast')
        .gte('issued_date', from)
        .lte('issued_date', to)
        .range(start, start + page - 1)
      if (error) break
      const rows = data ?? []
      for (const row of rows) {
        if (!forecastRainFired(row.series, RAIN.sumSoftMm, RAIN.dayMm)) continue
        const id = Number(row.region_id)
        const list = rainDays.get(id) ?? []
        list.push(String(row.issued_date))
        rainDays.set(id, list)
      }
      if (rows.length < page) break
    }
  } catch {
    return rainDays
  }
  return rainDays
}

export function watchlistIso3(iso3: string | null): boolean {
  return isConflictWatchlistIso3(iso3)
}
