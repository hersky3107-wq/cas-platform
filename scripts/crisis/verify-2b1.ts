/**
 * Run only after 20261008000002 and 20261008000003 have been pasted
 * and crisis_regions are loaded.
 *
 * 1. Ruteng ocean point → nearest_coast, level=1 Indonesian admin1.
 * 2. Mid-ocean (0, -150) → none.
 * Both rows are deleted.
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

const MID_OCEAN = { lat: 0, lon: -150, title: 'mid-ocean verify' }

function requireEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) {
    throw new Error('Copy cas-platform/.env.local into cas-platform-crisis first')
  }
}

async function insertPoint(opts: {
  lat: number
  lon: number
  title: string
  key: string
}): Promise<{
  id: number
  region_id: number | null
  country_iso3: string | null
  region_assign_method: string | null
  region_distance_km: number | null
}> {
  const { data, error } = await supabaseAdmin
    .from('crisis_raw_signals')
    .insert({
      department: 'geology',
      source: 'usgs',
      signal_type: 'earthquake',
      title: opts.title,
      lat: opts.lat,
      lon: opts.lon,
      value_num: 5,
      value_raw: { verify: true },
      unit_raw: 'mb',
      event_time: new Date().toISOString(),
      fetched_at: new Date().toISOString(),
      url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us6000u0wa',
      dedupe_key: opts.key,
    })
    .select('id, region_id, country_iso3, region_assign_method, region_distance_km')
    .single()
  if (error || !data) throw new Error(`insert failed: ${error?.message ?? 'no row'}`)
  return data
}

async function lookupRegion(id: number | null): Promise<{
  level: number | null
  iso3: string | null
  name: string | null
  label: string
}> {
  if (id == null) return { level: null, iso3: null, name: null, label: 'null' }
  const { data, error } = await supabaseAdmin
    .from('crisis_regions')
    .select('id, level, iso3, admin1_code, name')
    .eq('id', id)
    .single()
  if (error || !data) return { level: null, iso3: null, name: null, label: `lookup error ${error?.message ?? 'missing'}` }
  return {
    level: data.level,
    iso3: data.iso3,
    name: data.name,
    label: `id=${data.id} level=${data.level} iso3=${data.iso3} admin1=${data.admin1_code ?? ''} name=${data.name}`,
  }
}

async function main(): Promise<void> {
  requireEnvLocal()
  const stamp = new Date().toISOString()

  const ruteng = await insertPoint({ ...RUTENG, key: `crisis-verify-2b1:ruteng:${stamp}` })
  const rutengRegion = await lookupRegion(ruteng.region_id)
  console.log(`ruteng id=${ruteng.id}`)
  console.log(`method=${ruteng.region_assign_method} distance_km=${ruteng.region_distance_km}`)
  console.log(`country_iso3=${ruteng.country_iso3 ?? 'null'} region=${rutengRegion.label}`)
  console.log(`admin1_name=${rutengRegion.name ?? 'null'}`)

  const { error: delRuteng } = await supabaseAdmin.from('crisis_raw_signals').delete().eq('id', ruteng.id)
  if (delRuteng) throw new Error(`delete ruteng failed: ${delRuteng.message}`)
  console.log(`deleted signal id=${ruteng.id}`)

  const methodOk = ruteng.region_assign_method === 'nearest_coast'
  const levelOk = rutengRegion.level === 1
  const isoOk = ruteng.country_iso3 === 'IDN' || rutengRegion.iso3 === 'IDN'
  const distOk =
    typeof ruteng.region_distance_km === 'number' && ruteng.region_distance_km > 0 && ruteng.region_distance_km <= 300
  if (!methodOk || !levelOk || !isoOk || !distOk) {
    throw new Error(
      `expected nearest_coast to an Indonesian admin1 (e.g. Nusa Tenggara Timur); got method=${ruteng.region_assign_method} level=${rutengRegion.level} iso3=${ruteng.country_iso3} name=${rutengRegion.name} km=${ruteng.region_distance_km}`,
    )
  }

  const ocean = await insertPoint({ ...MID_OCEAN, key: `crisis-verify-2b1:ocean:${stamp}` })
  const oceanRegion = await lookupRegion(ocean.region_id)
  console.log(`ocean id=${ocean.id} method=${ocean.region_assign_method} region=${oceanRegion.label}`)
  const { error: delOcean } = await supabaseAdmin.from('crisis_raw_signals').delete().eq('id', ocean.id)
  if (delOcean) throw new Error(`delete ocean failed: ${delOcean.message}`)
  console.log(`deleted signal id=${ocean.id}`)

  if (ocean.region_assign_method !== 'none' || ocean.region_id != null) {
    throw new Error(`expected mid-ocean (0,-150) method=none; got method=${ocean.region_assign_method} region_id=${ocean.region_id}`)
  }

  console.log('verify-2b1 passed.')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
