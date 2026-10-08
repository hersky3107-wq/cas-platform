import type { SupabaseClient } from '@supabase/supabase-js'

export const ASSIGN_BATCH = 500

export interface AssignedPoint {
  region_id: number
  country_iso3: string | null
  method: string
  distance_km: number | null
}

export async function assignLatLonBatch(
  client: SupabaseClient,
  points: Array<{ i: number; lat: number; lon: number }>,
): Promise<Map<number, AssignedPoint>> {
  const out = new Map<number, AssignedPoint>()
  if (!points.length) return out

  for (let start = 0; start < points.length; start += ASSIGN_BATCH) {
    const chunk = points.slice(start, start + ASSIGN_BATCH)
    const { data, error } = await client.rpc('crisis_assign_latlon_batch', { pts: chunk })
    if (error) throw new Error(`crisis_assign_latlon_batch: ${error.message}`)
    for (const row of data ?? []) {
      const rec = row as {
        i?: number
        region_id?: number
        country_iso3?: string | null
        method?: string
        distance_km?: number | null
      }
      if (rec.i == null || rec.region_id == null) continue
      out.set(Number(rec.i), {
        region_id: Number(rec.region_id),
        country_iso3: rec.country_iso3 ?? null,
        method: rec.method ?? 'contains',
        distance_km: rec.distance_km ?? 0,
      })
    }
  }
  return out
}
