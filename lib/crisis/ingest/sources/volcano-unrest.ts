import { buildDedupeKey } from '../dedupe'
import { haversineKm } from '../../score/math'
import type { CrisisSource, IngestFetchResult, NormalizedSignal } from '../types'

export const VOLCANO_UNREST_KM = 15
export const VOLCANO_UNREST_HOURS = 72
export const VOLCANO_UNREST_COUNT = 10

const ALERT_RANK: Record<string, number> = {
  normal: 0,
  unassigned: 0,
  advisory: 1,
  watch: 2,
  warning: 3,
}

export function alertRank(value: string | null | undefined): number {
  return ALERT_RANK[(value ?? '').trim().toLowerCase()] ?? 0
}

export interface UnrestQuake {
  lat: number
  lon: number
  at: string | null
  source: string
}

export interface UnrestVolcano {
  id: string
  name: string
  lat: number
  lon: number
}

export interface HansAlert {
  id: string
  name: string
  lat: number
  lon: number
  alert: string | null
  at: string | null
}

export function deriveVolcanoUnrest(opts: {
  quakes: UnrestQuake[]
  volcanoes: UnrestVolcano[]
  hans: HansAlert[]
  now: Date
}): NormalizedSignal[] {
  const out: NormalizedSignal[] = []
  const since = opts.now.getTime() - VOLCANO_UNREST_HOURS * 3_600_000
  for (const volcano of opts.volcanoes) {
    const hits = opts.quakes.filter((quake) => {
      const t = quake.at ? Date.parse(quake.at) : opts.now.getTime()
      if (Number.isFinite(t) && t < since) return false
      return haversineKm(volcano.lat, volcano.lon, quake.lat, quake.lon) <= VOLCANO_UNREST_KM
    })
    if (hits.length < VOLCANO_UNREST_COUNT) continue
    const eventTime = opts.now.toISOString()
    out.push({
      department: 'geology',
      source: 'volcano_unrest',
      signal_type: 'volcano_unrest',
      title: `${volcano.name} ${hits.length} quakes / 72h`,
      lat: volcano.lat,
      lon: volcano.lon,
      country_iso3: null,
      value_num: hits.length,
      value_raw: { volcano_id: volcano.id, quakes: hits.length, rule: 'swarm_15km_72h' },
      unit_raw: 'quakes',
      event_time: eventTime,
      url: null,
      dedupe_key: buildDedupeKey({
        source: 'volcano_unrest',
        signalType: 'volcano_unrest',
        id: `${volcano.id}|swarm|${eventTime.slice(0, 13)}`,
        lat: volcano.lat,
        lon: volcano.lon,
        eventTime,
      }),
    })
  }
  const byId = new Map<string, HansAlert[]>()
  for (const row of opts.hans) {
    const list = byId.get(row.id) ?? []
    list.push(row)
    byId.set(row.id, list)
  }
  for (const [id, rows] of byId) {
    const sorted = [...rows].sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''))
    const prev = sorted.length > 1 ? alertRank(sorted[sorted.length - 2].alert) : null
    const current = sorted[sorted.length - 1]
    if (prev == null || alertRank(current.alert) <= prev) continue
    const eventTime = current.at ?? opts.now.toISOString()
    out.push({
      department: 'geology',
      source: 'volcano_unrest',
      signal_type: 'volcano_unrest',
      title: `${current.name} alert ${current.alert ?? ''}`.trim(),
      lat: current.lat,
      lon: current.lon,
      country_iso3: null,
      value_num: alertRank(current.alert),
      value_raw: { volcano_id: id, alert: current.alert, previous_rank: prev, rule: 'hans_increase' },
      unit_raw: 'alert_rank',
      event_time: eventTime,
      url: 'https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes',
      dedupe_key: buildDedupeKey({
        source: 'volcano_unrest',
        signalType: 'volcano_unrest',
        id: `${id}|hans|${eventTime}`,
        lat: current.lat,
        lon: current.lon,
        eventTime,
      }),
    })
  }
  return out
}

export const volcanoUnrestSource: CrisisSource = {
  key: 'volcano_unrest',
  department: 'geology',
  scheduleMinutes: 180,
  writes: 'signals',
  async fetch(ctx): Promise<IngestFetchResult> {
    const since = new Date(ctx.now.getTime() - VOLCANO_UNREST_HOURS * 3_600_000).toISOString()
    const { data: quakeRows, error: quakeError } = await ctx.client
      .from('crisis_raw_signals')
      .select('lat, lon, event_time, source')
      .eq('signal_type', 'earthquake')
      .gte('event_time', since)
      .limit(5000)
    if (quakeError) return { httpCalls: 0, error: quakeError.message }
    const { data: volcanoRows, error: volcanoError } = await ctx.client
      .from('crisis_raw_signals')
      .select('title, lat, lon, value_raw, signal_type, event_time')
      .in('signal_type', ['holocene_eruption', 'elevated_volcano'])
      .limit(2000)
    if (volcanoError) return { httpCalls: 0, error: volcanoError.message }
    const volcanoes: UnrestVolcano[] = []
    const hans: HansAlert[] = []
    for (const row of volcanoRows ?? []) {
      const raw = row.value_raw && typeof row.value_raw === 'object' ? row.value_raw as Record<string, unknown> : {}
      const name = String(raw.volcano ?? row.title ?? 'volcano')
      const id = String(raw.volcano_id ?? raw.volcano ?? name)
      if (row.lat == null || row.lon == null) continue
      if (row.signal_type === 'elevated_volcano') {
        hans.push({
          id,
          name,
          lat: row.lat,
          lon: row.lon,
          alert: typeof raw.alert_level === 'string' ? raw.alert_level : null,
          at: row.event_time,
        })
      }
      volcanoes.push({ id, name, lat: row.lat, lon: row.lon })
    }
    const signals = deriveVolcanoUnrest({
      quakes: (quakeRows ?? []).filter((row) => row.lat != null && row.lon != null).map((row) => ({
        lat: row.lat as number,
        lon: row.lon as number,
        at: row.event_time,
        source: row.source,
      })),
      volcanoes,
      hans,
      now: ctx.now,
    })
    return { signals, httpCalls: 0 }
  },
}
