/**
 * Run only after 20261008000002 has been pasted into the SQL editor
 * and crisis_regions are loaded.
 *
 * Inserts the Ruteng ocean earthquake sample, expects nearest_coast to an
 * Indonesian region with a positive distance, then deletes the row.
 *
 *   npx tsx --env-file=.env.local scripts/crisis/verify-2b1.ts
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { supabaseAdmin } from '../../lib/supabase/server'

const RUTENG = {
  lat: -7.7761,
  lon: 120.5395,
  title: 'M 5.0 - 92 km N of Ruteng, Indonesia',
}

function requireEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) {
    throw new Error('Copy cas-platform/.env.local into cas-platform-crisis first')
  }
}

async function main(): Promise<void> {
  requireEnvLocal()
  const dedupeKey = `crisis-verify-2b1:${new Date().toISOString()}`
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('crisis_raw_signals')
    .insert({
      department: 'geology',
      source: 'usgs',
      signal_type: 'earthquake',
      title: RUTENG.title,
      lat: RUTENG.lat,
      lon: RUTENG.lon,
      value_num: 5,
      value_raw: { mag: 5, depth_km: 10, tsunami: 0, place: '92 km N of Ruteng, Indonesia' },
      unit_raw: 'mb',
      event_time: '2026-10-08T04:48:59.943Z',
      fetched_at: new Date().toISOString(),
      url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us6000u0wa',
      dedupe_key: dedupeKey,
    })
    .select('id, region_id, country_iso3, region_assign_method, region_distance_km')
    .single()
  if (insertError || !inserted) {
    throw new Error(`insert failed: ${insertError?.message ?? 'no row'}`)
  }

  let regionLabel = 'null'
  if (inserted.region_id != null) {
    const { data: region, error: regionError } = await supabaseAdmin
      .from('crisis_regions')
      .select('id, level, iso3, admin1_code, name')
      .eq('id', inserted.region_id)
      .single()
    if (regionError) regionLabel = `lookup error ${regionError.message}`
    else if (region) {
      regionLabel = `id=${region.id} level=${region.level} iso3=${region.iso3} name=${region.name}`
    }
  }

  console.log(`signal id=${inserted.id}`)
  console.log(`method=${inserted.region_assign_method} distance_km=${inserted.region_distance_km}`)
  console.log(`country_iso3=${inserted.country_iso3 ?? 'null'} region=${regionLabel}`)

  const { error: deleteError } = await supabaseAdmin.from('crisis_raw_signals').delete().eq('id', inserted.id)
  if (deleteError) throw new Error(`delete failed: ${deleteError.message}`)
  console.log(`deleted signal id=${inserted.id}`)

  const methodOk = inserted.region_assign_method === 'nearest_coast'
  const isoOk = inserted.country_iso3 === 'IDN' || /\biso3=IDN\b/.test(regionLabel)
  const distOk = typeof inserted.region_distance_km === 'number' && inserted.region_distance_km > 0 && inserted.region_distance_km <= 300
  if (!methodOk || !isoOk || !distOk) {
    throw new Error(
      `expected nearest_coast to an Indonesian region within 300 km; got method=${inserted.region_assign_method} iso3=${inserted.country_iso3} km=${inserted.region_distance_km}`,
    )
  }
  console.log('verify-2b1 passed.')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
