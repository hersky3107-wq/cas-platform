/**
 * Load GHSL Urban Centre Database (GHS-UCDB R2024A V1.2) into crisis_region_metrics.
 * Dry-run is the default and does not open the database.
 *
 *   npx tsx scripts/crisis/load-population.ts
 *   npx tsx --env-file=.env.local scripts/crisis/load-population.ts --apply
 *
 * License: CC BY 4.0 (European Commission / JRC GHSL). Dataset year = 2025.
 * Does not call Open-Meteo or GloFAS.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import Papa from 'papaparse'
import { assignLatLonBatch } from '../../lib/crisis/ingest/assign'
import { loadAllRegions } from '../../lib/crisis/ingest/regions'
import { normalizeName } from '../../lib/crisis/ingest/iso'
import {
  GHS_GENERAL_CSV,
  GHS_GENERAL_GPKG,
  GHS_GENERAL_ZIP,
  GHS_LICENSE,
  GHS_PAGE,
  GHS_SOURCE,
  GHS_YEAR,
  aggregateUrbanPop,
  normalizeGhsCentre,
} from '../../lib/crisis/population/normalize'

const UA = 'AIMANI-CrisisIngest/knowledge'

function wants(flag: string): boolean {
  return process.argv.includes(flag)
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' } })
  if (!response.ok) throw new Error(`${url} -> ${response.status}`)
  return response.arrayBuffer()
}

function readCentroids(gpkgBytes: Buffer): Map<string, { x: number; y: number }> {
  const dir = mkdtempSync(path.join(tmpdir(), 'ghs-ucdb-'))
  const gpkgPath = path.join(dir, 'ucdb.gpkg')
  writeFileSync(gpkgPath, gpkgBytes)
  const helper = path.join(process.cwd(), 'scripts/crisis/ghs-centroids.py')
  const proc = spawnSync('python', [helper, gpkgPath], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (proc.status !== 0) throw new Error(proc.stderr || 'ghs-centroids.py failed')
  const rows = JSON.parse(proc.stdout) as Array<{ id: string; x: number; y: number }>
  return new Map(rows.map((row) => [String(row.id), { x: row.x, y: row.y }]))
}

async function main(): Promise<void> {
  console.log(`source ${GHS_SOURCE}`)
  console.log(`license ${GHS_LICENSE}`)
  console.log(`page ${GHS_PAGE}`)
  console.log(`download ${GHS_GENERAL_ZIP}`)
  console.log(`year ${GHS_YEAR} metric urban_pop / urban_centres`)

  const zip = await JSZip.loadAsync(await fetchBytes(GHS_GENERAL_ZIP))
  const csvFile = zip.file(GHS_GENERAL_CSV)
  const gpkgFile = zip.file(GHS_GENERAL_GPKG)
  if (!csvFile || !gpkgFile) throw new Error('general zip missing csv/gpkg')
  const text = await csvFile.async('string')
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true })
  const xy = readCentroids(Buffer.from(await gpkgFile.async('nodebuffer')))
  const centres = parsed.data
    .map((row) => normalizeGhsCentre(row, xy.get(String(row.ID_UC_G0 ?? '')) ?? null))
    .filter((row): row is NonNullable<typeof row> => row != null)

  console.log(`rows_raw ${parsed.data.length} rows_kept ${centres.length} centroids ${xy.size}`)
  for (const row of centres.slice(0, 3)) console.log(JSON.stringify(row))

  if (!wants('--apply')) {
    console.log('dry-run: nothing written. Pass --apply to upsert urban_pop / urban_centres.')
    return
  }

  const { supabaseAdmin } = await import('../../lib/supabase/server')
  const points = centres.map((row, i) => ({ i, lat: row.lat, lon: row.lon }))
  let assigned = new Map<number, { region_id: number }>()
  try {
    assigned = await assignLatLonBatch(supabaseAdmin, points)
  } catch (error) {
    console.log(`assign rpc missing, falling back to country name: ${error instanceof Error ? error.message : error}`)
  }
  const regions = await loadAllRegions(supabaseAdmin)
  const countryByName = new Map<string, number>()
  const parentById = new Map<number, number>()
  for (const row of regions) {
    if (row.level === 0 && row.name) countryByName.set(normalizeName(row.name), Number(row.id))
    if (row.parent_id != null) parentById.set(Number(row.id), Number(row.parent_id))
  }

  const placed: Array<(typeof centres)[0] & { region_id: number }> = []
  for (let i = 0; i < centres.length; i += 1) {
    const hit = assigned.get(i)?.region_id ?? countryByName.get(normalizeName(centres[i].country_name))
    if (hit == null) continue
    placed.push({ ...centres[i], region_id: hit })
  }

  const admin = aggregateUrbanPop(placed)
  const extras: typeof placed = []
  for (const row of placed) {
    const parent = parentById.get(row.region_id)
    if (parent != null) extras.push({ ...row, region_id: parent })
  }
  const rolled = new Map(admin.map((row) => [row.region_id, row]))
  for (const row of aggregateUrbanPop(extras)) rolled.set(row.region_id, row)

  const valid = `${GHS_YEAR}-01-01T00:00:00.000Z`
  const issued = new Date().toISOString()
  const metrics = [...rolled.values()].flatMap((row) => [
    {
      region_id: row.region_id,
      metric: 'urban_pop',
      valid_time: valid,
      issued_at: issued,
      value: row.urban_pop,
      unit: 'people',
      source: GHS_SOURCE,
      detail: { top5: row.top5, year: GHS_YEAR },
    },
    {
      region_id: row.region_id,
      metric: 'urban_centres',
      valid_time: valid,
      issued_at: issued,
      value: row.urban_centres,
      unit: 'count',
      source: GHS_SOURCE,
      detail: { year: GHS_YEAR },
    },
  ])

  const chunk = 200
  for (let i = 0; i < metrics.length; i += chunk) {
    const { error } = await supabaseAdmin.from('crisis_region_metrics').upsert(metrics.slice(i, i + chunk), {
      onConflict: 'region_id,metric,valid_time,issued_at',
    })
    if (error) throw new Error(error.message)
    console.log(`upserted ${Math.min(i + chunk, metrics.length)}/${metrics.length}`)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
