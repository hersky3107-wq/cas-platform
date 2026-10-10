import type { SupabaseClient } from '@supabase/supabase-js'
import { asRecord, finite } from './math'
import type { UcdpPoint } from './more-hazards'

export interface ExtraHazards {
  outbreaks: Map<string, string>
  ucdp: UcdpPoint[]
  geomagneticG: number | null
  landslideRegions: Set<number>
  landslideCountries: Set<string>
  locust: Map<string, string>
}

function empty(): ExtraHazards {
  return {
    outbreaks: new Map(),
    ucdp: [],
    geomagneticG: null,
    landslideRegions: new Set(),
    landslideCountries: new Set(),
    locust: new Map(),
  }
}

export async function loadExtraHazards(client: SupabaseClient, now: Date): Promise<ExtraHazards> {
  const since = new Date(now.getTime() - 45 * 86_400_000).toISOString()
  const ucdpSince = now.getTime() - 14 * 86_400_000
  const slideSince = now.getTime() - 2 * 86_400_000
  const out = empty()
  const { data, error } = await client
    .from('crisis_raw_signals')
    .select('region_id, country_iso3, signal_type, value_raw, event_time')
    .in('signal_type', ['outbreak', 'ucdp_event', 'landslide_nowcast', 'locust_situation'])
    .gte('event_time', since)
    .limit(5000)
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) return out
    throw new Error(`extra hazards: ${error.message}`)
  }
  for (const row of data ?? []) {
    const raw = asRecord(row.value_raw) ?? {}
    const at = typeof row.event_time === 'string' ? Date.parse(row.event_time) : NaN
    const iso3 = typeof row.country_iso3 === 'string' ? row.country_iso3 : null
    if (row.signal_type === 'outbreak' && iso3 && typeof raw.disease === 'string' && !out.outbreaks.has(iso3)) {
      out.outbreaks.set(iso3, raw.disease)
    } else if (row.signal_type === 'ucdp_event' && Number.isFinite(at) && at >= ucdpSince) {
      out.ucdp.push({
        lat: finite(raw.lat),
        lon: finite(raw.lon),
        regionId: finite(raw.region_id),
        iso3,
        at: row.event_time,
      })
    } else if (row.signal_type === 'landslide_nowcast' && Number.isFinite(at) && at >= slideSince) {
      if (row.region_id != null) out.landslideRegions.add(Number(row.region_id))
      if (iso3) out.landslideCountries.add(iso3)
    } else if (row.signal_type === 'locust_situation' && iso3 && typeof raw.level === 'string') {
      out.locust.set(iso3, raw.level)
    }
  }
  const metric = await client
    .from('crisis_global_metrics')
    .select('value, issued_at')
    .eq('metric', 'geomagnetic_g')
    .order('issued_at', { ascending: false })
    .limit(1)
  if (!metric.error && metric.data?.[0]) out.geomagneticG = finite(metric.data[0].value)
  return out
}
