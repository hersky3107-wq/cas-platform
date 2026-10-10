import { buildDedupeKey } from '../dedupe'
import { politeFetch } from '../fetch'
import { normalizeUsgs } from './usgs'
import { cellCenter, cellKey, dedupeQuakes, rateFlags, type QuakePoint, type RateFlag } from '../../precursors/earthquake'
import type { CrisisSource, IngestFetchResult, NormalizedSignal } from '../types'
import type { SupabaseClient } from '@supabase/supabase-js'

const COUNT_CAP = 15_000

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 19)
}

async function usgsCount(start: string, end: string): Promise<{ count: number; error?: string }> {
  const url =
    `https://earthquake.usgs.gov/fdsnws/event/1/count?format=text&starttime=${encodeURIComponent(start)}` +
    `&endtime=${encodeURIComponent(end)}&minmagnitude=2.5`
  const res = await politeFetch(url, { sourceKey: 'usgs_catalog', minIntervalMs: 1500, timeoutMs: 60_000, as: 'text' })
  if (!res.ok) return { count: 0, error: res.error ?? `HTTP ${res.status}` }
  const count = Number(String(res.text).trim().split(/\s+/)[0])
  if (!Number.isFinite(count)) return { count: 0, error: 'USGS count was not a number' }
  return { count }
}

async function usgsGeo(start: string, end: string): Promise<{ signals: NormalizedSignal[]; error?: string }> {
  const url =
    `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${encodeURIComponent(start)}` +
    `&endtime=${encodeURIComponent(end)}&minmagnitude=2.5&orderby=time`
  const res = await politeFetch(url, { sourceKey: 'usgs_catalog', minIntervalMs: 1500, timeoutMs: 120_000 })
  if (!res.ok) return { signals: [], error: res.error ?? `HTTP ${res.status}` }
  return { signals: normalizeUsgs(res.data).filter((row) => (row.value_num ?? 0) >= 2.5 && row.lat != null && row.lon != null) }
}

async function fetchSpan(start: Date, end: Date, calls: { n: number }): Promise<NormalizedSignal[]> {
  const startS = isoDay(start)
  const endS = isoDay(end)
  if (end.getTime() - start.getTime() < 36 * 3_600_000) {
    calls.n += 1
    const geo = await usgsGeo(startS, endS)
    if (geo.error) throw new Error(geo.error)
    return geo.signals
  }
  calls.n += 1
  const counted = await usgsCount(startS, endS)
  if (counted.error) throw new Error(counted.error)
  if (counted.count <= 0) return []
  if (counted.count > COUNT_CAP) {
    const mid = new Date((start.getTime() + end.getTime()) / 2)
    const left = await fetchSpan(start, mid, calls)
    const right = await fetchSpan(mid, end, calls)
    return left.concat(right)
  }
  calls.n += 1
  const geo = await usgsGeo(startS, endS)
  if (geo.error) throw new Error(geo.error)
  return geo.signals
}

async function loadYearCounts(client: SupabaseClient): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  const page = 1000
  for (let from = 0; ; from += page) {
    const { data, error } = await client
      .from('crisis_raw_signals')
      .select('value_num, value_raw')
      .eq('signal_type', 'eq_cell_background')
      .order('event_time', { ascending: false })
      .range(from, from + page - 1)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    for (const row of rows) {
      const raw = row.value_raw && typeof row.value_raw === 'object' ? (row.value_raw as Record<string, unknown>) : {}
      const cell = typeof raw.cell === 'string' ? raw.cell : null
      if (!cell || map.has(cell)) continue
      map.set(cell, typeof row.value_num === 'number' ? row.value_num : 0)
    }
    if (rows.length < page) break
    if (from > 20_000) break
  }
  return map
}

async function loadRecentDb(client: SupabaseClient, sinceIso: string): Promise<QuakePoint[]> {
  const out: QuakePoint[] = []
  const page = 1000
  for (let from = 0; ; from += page) {
    const { data, error } = await client
      .from('crisis_raw_signals')
      .select('lat, lon, value_num, event_time, source')
      .eq('signal_type', 'earthquake')
      .gte('event_time', sinceIso)
      .range(from, from + page - 1)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    for (const row of rows) {
      if (row.lat == null || row.lon == null || row.value_num == null) continue
      out.push({ lat: row.lat, lon: row.lon, mag: row.value_num, at: row.event_time })
    }
    if (rows.length < page) break
  }
  return out
}

function pointsOf(signals: NormalizedSignal[]): QuakePoint[] {
  return signals.flatMap((row) => {
    if (row.lat == null || row.lon == null || row.value_num == null) return []
    return [{ lat: row.lat, lon: row.lon, mag: row.value_num, at: row.event_time }]
  })
}

function backgroundSignals(counts: Map<string, number>, windowStart: string, windowEnd: string): NormalizedSignal[] {
  const out: NormalizedSignal[] = []
  for (const [cell, count] of counts) {
    if (count <= 0) continue
    const center = cellCenter(cell)
    out.push({
      department: 'geology',
      source: 'usgs_catalog',
      signal_type: 'eq_cell_background',
      title: `${cell} ${count}`,
      // Null coordinates skip the per-row spatial region trigger. Cell centers live in value_raw.
      lat: null,
      lon: null,
      country_iso3: null,
      value_num: count,
      value_raw: { cell, year_count: count, lat: center.lat, lon: center.lon, window_start: windowStart, window_end: windowEnd },
      unit_raw: 'events',
      event_time: windowEnd,
      url: 'https://earthquake.usgs.gov/fdsnws/event/1/',
      dedupe_key: buildDedupeKey({
        source: 'usgs_catalog',
        signalType: 'eq_cell_background',
        id: cell,
        eventTime: windowEnd,
      }),
    })
  }
  return out
}

function rateSignals(flags: RateFlag[], day: string): NormalizedSignal[] {
  return flags.map((flag) => ({
    department: 'geology',
    source: 'usgs_catalog',
    signal_type: 'eq_rate_cell',
    title: `M2.5+ ${flag.multiplier.toFixed(1)}x`,
    lat: flag.lat,
    lon: flag.lon,
    country_iso3: null,
    value_num: Number(flag.multiplier.toFixed(2)),
    value_raw: {
      cell: flag.cell,
      count_7d: flag.count7d,
      usual_7d: Number(flag.expected7d.toFixed(2)),
      year_count: flag.yearCount,
      forecast: 'probability',
    },
    unit_raw: 'multiplier',
    event_time: day,
    url: 'https://earthquake.usgs.gov/fdsnws/event/1/',
    dedupe_key: buildDedupeKey({
      source: 'usgs_catalog',
      signalType: 'eq_rate_cell',
      id: flag.cell,
      eventTime: day,
    }),
  }))
}

export function aggregateYearCells(signals: NormalizedSignal[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of signals) {
    if (row.lat == null || row.lon == null || (row.value_num ?? 0) < 2.5) continue
    const key = cellKey(row.lat, row.lon)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

export const usgsCatalogSource: CrisisSource = {
  key: 'usgs_catalog',
  department: 'geology',
  scheduleMinutes: 360,
  writes: 'signals',
  async fetch(ctx): Promise<IngestFetchResult> {
    const calls = { n: 0 }
    const now = ctx.now
    const day = `${now.toISOString().slice(0, 10)}T00:00:00.000Z`
    const since7 = new Date(now.getTime() - 7 * 86_400_000).toISOString()
    let yearCounts = new Map<string, number>()
    let yearSignals: NormalizedSignal[] = []
    let error: string | undefined
    try {
      yearCounts = await loadYearCounts(ctx.client)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
    if (yearCounts.size === 0 && !error) {
      const start = new Date(now.getTime() - 365 * 86_400_000)
      try {
        yearSignals = await fetchSpan(start, now, calls)
        yearCounts = aggregateYearCells(yearSignals)
        ctx.log(`[usgs_catalog] backfill events=${yearSignals.length} cells=${yearCounts.size}`)
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
        ctx.log(`[usgs_catalog] backfill failed: ${error}`)
      }
    }
    let weekSignals: NormalizedSignal[] = []
    if (yearSignals.length === 0) {
      try {
        weekSignals = await fetchSpan(new Date(now.getTime() - 7 * 86_400_000), now, calls)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        error = error ? `${error}; ${message}` : message
      }
    }
    const recentFetched = (yearSignals.length ? yearSignals : weekSignals).filter((row) => (row.event_time ?? '') >= since7)
    let dbRecent: QuakePoint[] = []
    try {
      dbRecent = await loadRecentDb(ctx.client, since7)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      error = error ? `${error}; ${message}` : message
    }
    const recent = dedupeQuakes([...pointsOf(recentFetched), ...dbRecent])
    const flags = yearCounts.size ? rateFlags(recent, yearCounts, now) : []
    const windowEnd = now.toISOString()
    const windowStart = new Date(now.getTime() - 365 * 86_400_000).toISOString()
    // The year download is kept as per-cell counts. Inserting each M2.5+ event runs the
    // spatial region trigger and the statement times out (~28k rows). The 7-day side of
    // the rate uses earthquakes already stored by the usgs and emsc sources.
    const signals: NormalizedSignal[] = [
      ...(yearSignals.length ? backgroundSignals(yearCounts, windowStart, windowEnd) : []),
      ...rateSignals(flags, day),
    ]
    if (yearSignals.length) {
      signals.push({
        department: 'geology',
        source: 'usgs_catalog',
        signal_type: 'eq_catalog_marker',
        title: `USGS M2.5+ ${yearSignals.length}`,
        lat: null,
        lon: null,
        country_iso3: null,
        value_num: yearSignals.length,
        value_raw: {
          events: yearSignals.length,
          cells: yearCounts.size,
          stored: 'cell_counts',
          window_start: windowStart,
          window_end: windowEnd,
        },
        unit_raw: 'events',
        event_time: windowEnd,
        url: 'https://earthquake.usgs.gov/fdsnws/event/1/',
        dedupe_key: buildDedupeKey({
          source: 'usgs_catalog',
          signalType: 'eq_catalog_marker',
          id: windowStart.slice(0, 10),
          eventTime: windowEnd,
        }),
      })
    }
    ctx.log(`[usgs_catalog] rate_cells=${flags.length} recent=${recent.length} background_cells=${yearCounts.size} stored=${signals.length}`)
    return {
      httpCalls: calls.n,
      signals,
      error: signals.length ? undefined : error,
      quotaNote: error && signals.length ? error : `flags=${flags.length} cells=${yearCounts.size}`,
    }
  },
}
