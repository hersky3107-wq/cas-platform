/**
 * Load fragility points from open datasets. Dry-run is the default and does not open the database.
 *
 *   npx tsx scripts/crisis/load-fragility.ts
 *   npx tsx scripts/crisis/load-fragility.ts --only=gdw
 *   npx tsx --env-file=.env.local scripts/crisis/load-fragility.ts --apply
 *
 * --apply requires migration 20261009000001. region_id is left null so crisis_assign_fragility fills it.
 * Does not call Open-Meteo or GloFAS.
 */
import Papa from 'papaparse'
import JSZip from 'jszip'
import {
  GDW_DOWNLOAD,
  GDW_LICENSE,
  GDW_PAGE,
  GDW_PAPER,
  GDW_SOURCE,
  GDW_ZIP_ENTRY,
  SKIPPED_DATASETS,
  UNHCR_LICENSE,
  UNHCR_LICENSE_URL,
  UNHCR_QUERY,
  UNHCR_SOURCE,
  WRI_CSV,
  WRI_LICENSE,
  WRI_PAGE,
  WRI_SOURCE,
  dedupePoints,
  normalizeGdwBarrier,
  normalizeUnhcrLocation,
  normalizeWriPlant,
  type FragilityPoint,
} from '../../lib/crisis/fragility/normalize'

const UA = 'AIMANI-CrisisIngest/knowledge'

function wants(flag: string): boolean {
  return process.argv.includes(flag)
}

function onlyArg(): string | null {
  const hit = process.argv.find((arg) => arg.startsWith('--only='))
  return hit ? hit.slice('--only='.length) : null
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' } })
  if (!response.ok) throw new Error(`${url} -> ${response.status}`)
  return response.arrayBuffer()
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/csv,application/json,*/*' } })
  if (!response.ok) throw new Error(`${url} -> ${response.status}`)
  return response.text()
}

function printSamples(points: FragilityPoint[]): void {
  for (const point of points.slice(0, 3)) {
    console.log(JSON.stringify(point))
  }
}

async function loadGdw(): Promise<{ raw: number; kept: number; points: FragilityPoint[] }> {
  console.log(`source ${GDW_SOURCE}`)
  console.log(`license ${GDW_LICENSE}`)
  console.log(`download ${GDW_DOWNLOAD}`)
  console.log(`page ${GDW_PAGE}`)
  console.log(`paper ${GDW_PAPER}`)
  console.log('filter height_m >= 15 OR capacity_mcm >= 100 OR GRanD id present; coordinates required')
  const zip = await JSZip.loadAsync(await fetchBytes(GDW_DOWNLOAD))
  const entry = zip.file(GDW_ZIP_ENTRY)
  if (!entry) throw new Error(`missing ${GDW_ZIP_ENTRY}`)
  const text = await entry.async('string')
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true })
  const points = dedupePoints(
    parsed.data.map((row) => normalizeGdwBarrier(row)).filter((row): row is FragilityPoint => row != null),
  )
  console.log(`rows_raw ${parsed.data.length} rows_kept ${points.length}`)
  printSamples(points)
  return { raw: parsed.data.length, kept: points.length, points }
}

async function loadWri(): Promise<{ raw: number; kept: number; points: FragilityPoint[] }> {
  console.log(`source ${WRI_SOURCE}`)
  console.log(`license ${WRI_LICENSE}`)
  console.log(`download ${WRI_CSV}`)
  console.log(`page ${WRI_PAGE}`)
  console.log('filter primary_fuel = Nuclear. Status is unspecified_in_source; GPPD has no operating/construction/shutdown column.')
  const text = await fetchText(WRI_CSV)
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true })
  const nuclear = parsed.data.filter((row) => String(row.primary_fuel ?? '').trim() === 'Nuclear')
  const points = dedupePoints(
    nuclear.map((row) => normalizeWriPlant(row)).filter((row): row is FragilityPoint => row != null),
  )
  console.log(`rows_raw ${parsed.data.length} rows_nuclear ${nuclear.length} rows_kept ${points.length}`)
  printSamples(points)
  return { raw: parsed.data.length, kept: points.length, points }
}

async function loadUnhcr(): Promise<{ raw: number; kept: number; points: FragilityPoint[] }> {
  console.log(`source ${UNHCR_SOURCE}`)
  console.log(`license ${UNHCR_LICENSE} ${UNHCR_LICENSE_URL}`)
  console.log('filter loc_subtype 38 Formal Settlement, 39 Informal Settlement, 44 Collective centre')
  const points: FragilityPoint[] = []
  let raw = 0
  const pageSize = 2000
  for (let offset = 0; offset < 100_000; offset += pageSize) {
    const url = new URL(UNHCR_QUERY)
    url.searchParams.set('where', "loc_subtype IN ('38','39','44')")
    url.searchParams.set(
      'outFields',
      'gis_name,iso3,latitude_d,longitude_d,loc_subtype,poc_subtype,pop_type',
    )
    url.searchParams.set('returnGeometry', 'false')
    url.searchParams.set('resultOffset', String(offset))
    url.searchParams.set('resultRecordCount', String(pageSize))
    url.searchParams.set('f', 'json')
    const body = JSON.parse(await fetchText(url.toString())) as {
      features?: Array<{ attributes?: Record<string, unknown> }>
      exceededTransferLimit?: boolean
    }
    const features = body.features ?? []
    raw += features.length
    for (const feature of features) {
      const point = normalizeUnhcrLocation(feature.attributes ?? {})
      if (point) points.push(point)
    }
    if (features.length < pageSize || body.exceededTransferLimit === false) break
  }
  const kept = dedupePoints(points)
  const byCountry = new Map<string, number>()
  for (const point of kept) {
    const iso = String(point.attributes.country_iso3 ?? 'UNK')
    byCountry.set(iso, (byCountry.get(iso) ?? 0) + 1)
  }
  const coverage = [...byCountry.entries()].sort((a, b) => b[1] - a[1])
  console.log(`rows_raw ${raw} rows_kept ${kept.length} countries ${coverage.length}`)
  console.log(`coverage ${coverage.map(([iso, n]) => `${iso}:${n}`).join(' ')}`)
  printSamples(kept)
  return { raw, kept: kept.length, points: kept }
}

function printSkipped(): void {
  for (const item of SKIPPED_DATASETS) {
    console.log(`skip ${item.id}: ${item.status} — ${item.detail}`)
  }
}

async function apply(points: FragilityPoint[]): Promise<void> {
  const { supabaseAdmin } = await import('../../lib/supabase/server')
  const chunk = 200
  let written = 0
  for (let i = 0; i < points.length; i += chunk) {
    const slice = points.slice(i, i + chunk).map((point) => ({
      kind: point.kind,
      name: point.name,
      lat: point.lat,
      lon: point.lon,
      attributes: point.attributes,
      evidence: point.evidence,
      confidence: point.confidence,
      source: point.source,
      source_license: point.source_license,
    }))
    const { error } = await supabaseAdmin.from('crisis_fragility').upsert(slice, { onConflict: 'dedupe_key' })
    if (error) throw new Error(error.message)
    written += slice.length
    console.log(`upserted ${written}/${points.length}`)
  }
}

async function main(): Promise<void> {
  const only = onlyArg()
  const selected = only ? [only] : ['gdw', 'wri_nuclear', 'unhcr_camps']
  const all: FragilityPoint[] = []
  for (const name of selected) {
    if (name === 'gdw') all.push(...(await loadGdw()).points)
    else if (name === 'wri_nuclear') all.push(...(await loadWri()).points)
    else if (name === 'unhcr_camps') all.push(...(await loadUnhcr()).points)
    else if (name === 'glacial_lakes') console.log('glacial_lakes: not available')
    else throw new Error(`unknown dataset ${name}`)
  }
  printSkipped()
  if (!wants('--apply')) {
    console.log(`dry-run: ${all.length} points ready, nothing written. Pass --apply to upsert.`)
    return
  }
  await apply(all)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
