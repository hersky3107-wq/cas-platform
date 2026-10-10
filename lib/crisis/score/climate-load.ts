import type { SupabaseClient } from '@supabase/supabase-js'
import type { ClimateNormals, MonthNormal } from '../climate/stats'

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export async function loadClimate(client: SupabaseClient): Promise<Map<number, ClimateNormals>> {
  const months = new Map<number, MonthNormal[]>()
  const extra = new Map<number, Pick<ClimateNormals, 'precip30d' | 'precip30dBase' | 'precip90d' | 'precip90dBase' | 'soilRecent'>>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from('crisis_region_climate')
      .select('region_id, month, tmax_p95, tmax_p5, tmin_p95, tmin_p5, tmax_mean, tmin_mean, precip_daily_mean, soil_mean, precip_30d, precip_30d_base, precip_90d, precip_90d_base, soil_recent, sample_days')
      .order('region_id', { ascending: true })
      .range(from, from + 999)
    if (error) {
      if (/crisis_region_climate|does not exist|schema cache/i.test(error.message)) return new Map()
      throw new Error(`climate: ${error.message}`)
    }
    const rows = data ?? []
    for (const row of rows) {
      const id = Number(row.region_id)
      const month: MonthNormal = {
        month: Number(row.month),
        tmaxP95: num(row.tmax_p95),
        tmaxP5: num(row.tmax_p5),
        tminP95: num(row.tmin_p95),
        tminP5: num(row.tmin_p5),
        tmaxMean: num(row.tmax_mean),
        tminMean: num(row.tmin_mean),
        precipDailyMean: num(row.precip_daily_mean),
        soilMean: num(row.soil_mean),
        sampleDays: typeof row.sample_days === 'number' ? row.sample_days : 0,
      }
      const list = months.get(id) ?? []
      list.push(month)
      months.set(id, list)
      if (!extra.has(id)) {
        extra.set(id, {
          precip30d: num(row.precip_30d),
          precip30dBase: num(row.precip_30d_base),
          precip90d: num(row.precip_90d),
          precip90dBase: num(row.precip_90d_base),
          soilRecent: num(row.soil_recent),
        })
      }
    }
    if (rows.length < 1000) break
  }
  const out = new Map<number, ClimateNormals>()
  for (const [id, list] of months) {
    list.sort((a, b) => a.month - b.month)
    out.set(id, { months: list, ...(extra.get(id) ?? { precip30d: null, precip30dBase: null, precip90d: null, precip90dBase: null, soilRecent: null }) })
  }
  return out
}
