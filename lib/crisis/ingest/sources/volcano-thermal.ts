import { buildDedupeKey } from '../dedupe'
import { haversineKm } from '../../score/math'
import type { CrisisSource, IngestFetchResult, NormalizedSignal } from '../types'

const THERMAL_KM = 15

/**
 * MIROVA's NRT page has no open point feed (probed 2026-10-10).
 * A FIRMS hotspot already stored within 15 km of a Holocene volcano is the thermal precursor.
 */
export const volcanoThermalSource: CrisisSource = {
  key: 'volcano_thermal',
  department: 'geology',
  scheduleMinutes: 180,
  writes: 'signals',
  async fetch(ctx): Promise<IngestFetchResult> {
    const since = new Date(ctx.now.getTime() - 48 * 3_600_000).toISOString()
    const { count, error: volcanoError } = await ctx.client
      .from('crisis_raw_signals')
      .select('id', { count: 'exact', head: true })
      .eq('signal_type', 'holocene_volcano')
    if (volcanoError) return { httpCalls: 0, error: volcanoError.message }
    if ((count ?? 0) < 50) {
      return { httpCalls: 0, skipped: 'Holocene volcano catalog is not loaded yet', quotaNote: 'MIROVA skipped (no point feed); FIRMS fallback waiting on GVP' }
    }
    const volcanoes: Array<{ title: string | null; lat: number | null; lon: number | null; value_raw: unknown }> = []
    for (let from = 0; ; from += 1000) {
      const { data, error: listError } = await ctx.client
        .from('crisis_raw_signals')
        .select('title, lat, lon, value_raw')
        .eq('signal_type', 'holocene_volcano')
        .order('id', { ascending: true })
        .range(from, from + 999)
      if (listError) return { httpCalls: 0, error: listError.message }
      const rows = data ?? []
      volcanoes.push(...rows)
      if (rows.length < 1000) break
    }
    const fires: Array<{ lat: number | null; lon: number | null; event_time: string | null; value_num: number | null }> = []
    for (let from = 0; ; from += 1000) {
      const { data, error: fireError } = await ctx.client
        .from('crisis_raw_signals')
        .select('lat, lon, event_time, value_num')
        .eq('signal_type', 'active_fire')
        .gte('event_time', since)
        .order('id', { ascending: true })
        .range(from, from + 999)
      if (fireError) return { httpCalls: 0, error: fireError.message }
      const rows = data ?? []
      fires.push(...rows)
      if (rows.length < 1000 || fires.length >= 8000) break
    }
    const signals: NormalizedSignal[] = []
    const seen = new Set<string>()
    for (const volcano of volcanoes ?? []) {
      if (volcano.lat == null || volcano.lon == null) continue
      const raw = volcano.value_raw && typeof volcano.value_raw === 'object' ? (volcano.value_raw as Record<string, unknown>) : {}
      const name = String(raw.volcano ?? volcano.title ?? 'volcano')
      const id = String(raw.volcano_number ?? name)
      let hits = 0
      let latest: string | null = null
      for (const fire of fires ?? []) {
        if (fire.lat == null || fire.lon == null) continue
        if (haversineKm(volcano.lat, volcano.lon, fire.lat, fire.lon) > THERMAL_KM) continue
        hits += 1
        if (!latest || (fire.event_time ?? '') > latest) latest = fire.event_time
      }
      if (!hits || seen.has(id)) continue
      seen.add(id)
      const eventTime = latest ?? ctx.now.toISOString()
      signals.push({
        department: 'geology',
        source: 'volcano_thermal',
        signal_type: 'volcano_thermal',
        title: `${name} thermal`,
        lat: volcano.lat,
        lon: volcano.lon,
        country_iso3: null,
        value_num: hits,
        value_raw: { volcano: name, hotspots: hits, rule: 'firms_15km', forecast: 'probability' },
        unit_raw: 'hotspots',
        event_time: eventTime,
        url: 'https://firms.modaps.eosdis.nasa.gov/',
        dedupe_key: buildDedupeKey({
          source: 'volcano_thermal',
          signalType: 'volcano_thermal',
          id: `${id}|${eventTime.slice(0, 10)}`,
          lat: volcano.lat,
          lon: volcano.lon,
          eventTime,
        }),
      })
    }
    return {
      httpCalls: 0,
      signals,
      quotaNote: 'MIROVA skipped (no open point feed); FIRMS hotspots on Holocene volcanoes',
    }
  },
}
