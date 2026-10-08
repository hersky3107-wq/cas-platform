/**
 * Load Natural Earth 1:10m country and admin1 polygons into crisis_regions.
 *
 * Default is a dry run: download, simplify locally, print counts and an
 * estimated geometry size. Nothing is written.
 *
 *   npx tsx scripts/crisis/load-regions.ts
 *   npx tsx scripts/crisis/load-regions.ts --tolerance 0.01
 *   npx tsx --env-file=.env.local scripts/crisis/load-regions.ts --apply
 *
 * --apply is the only mode that touches the database. Run it only after the
 * crisis_core migration has been pasted into the Supabase SQL editor.
 * The production database is a small compute tier: geometries are simplified
 * locally (Douglas–Peucker at the same degree tolerance as
 * ST_SimplifyPreserveTopology) before insert, and rows are upserted in
 * batches of 100. Dry-run never opens a database connection, so the size
 * estimate matches the payload --apply would send.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'

const ADMIN0_URLS = [
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_0_countries.geojson',
  'https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_countries.geojson',
]

const ADMIN1_URLS = [
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_1_states_provinces.geojson',
  'https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_states_provinces.geojson',
]

const BATCH_SIZE = 100
const BATCH_PAUSE_MS = 250
const DEFAULT_TOLERANCE = 0.01

const SANITY_POINTS = [
  { lat: 27.7172, lon: 85.324, label: 'Nepal' },
  { lat: 15.3694, lon: 44.191, label: 'Yemen' },
  { lat: 50.4501, lon: 30.5234, label: 'Ukraine' },
]

type Position = [number, number]
type Ring = Position[]
type Polygon = Ring[]

interface FeatureCollection {
  type: string
  features: Array<{
    type: string
    properties: Record<string, unknown> | null
    geometry: { type: string; coordinates: unknown } | null
  }>
}

interface RegionRow {
  level: 0 | 1
  iso3: string
  admin1_code: string | null
  name: string | null
  name_local: string | null
  parent_iso3: string | null
  wkt: string
  vertices: number
}

function requireEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) {
    throw new Error('Copy cas-platform/.env.local into cas-platform-crisis first')
  }
}

function argValue(flag: string): string | null {
  const argv = process.argv.slice(2)
  const eq = argv.find((item) => item.startsWith(`${flag}=`))
  if (eq) return eq.slice(flag.length + 1)
  const index = argv.indexOf(flag)
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--')) return argv[index + 1]
  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function prop(properties: Record<string, unknown> | null, ...keys: string[]): string | null {
  if (!properties) return null
  const entries = Object.entries(properties)
  for (const key of keys) {
    const wanted = key.toLowerCase()
    const found = entries.find(([name]) => name.toLowerCase() === wanted)
    if (!found) continue
    const value = found[1]
    if (value == null) continue
    const text = String(value).trim()
    if (text && text !== '-99') return text
  }
  return null
}

function perpendicularDistance(point: Position, start: Position, end: Position): number {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  if (dx === 0 && dy === 0) {
    const px = point[0] - start[0]
    const py = point[1] - start[1]
    return Math.hypot(px, py)
  }
  const t = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)
  const clamped = Math.max(0, Math.min(1, t))
  const cx = start[0] + clamped * dx
  const cy = start[1] + clamped * dy
  return Math.hypot(point[0] - cx, point[1] - cy)
}

/** Douglas–Peucker in degrees. Closed rings stay closed. Rings that collapse are kept. */
function simplifyRing(ring: Ring, tolerance: number): Ring {
  if (ring.length < 4) return ring
  const open = ring.slice(0, -1)
  const keep = new Array<boolean>(open.length).fill(false)
  keep[0] = true
  keep[open.length - 1] = true
  const stack: Array<[number, number]> = [[0, open.length - 1]]
  while (stack.length > 0) {
    const [start, end] = stack.pop() as [number, number]
    let maxDistance = 0
    let maxIndex = -1
    for (let i = start + 1; i < end; i += 1) {
      const distance = perpendicularDistance(open[i], open[start], open[end])
      if (distance > maxDistance) {
        maxDistance = distance
        maxIndex = i
      }
    }
    if (maxIndex >= 0 && maxDistance > tolerance) {
      keep[maxIndex] = true
      stack.push([start, maxIndex], [maxIndex, end])
    }
  }
  const simplified = open.filter((_, index) => keep[index])
  if (simplified.length < 3) return ring
  const first = simplified[0]
  const last = simplified[simplified.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) simplified.push([first[0], first[1]])
  return simplified.length >= 4 ? simplified : ring
}

function asPolygons(geometry: { type: string; coordinates: unknown; geometries?: Array<{ type: string; coordinates: unknown }> } | null): Polygon[] {
  if (!geometry) return []
  if (geometry.type === 'Polygon') return [geometry.coordinates as Polygon]
  if (geometry.type === 'MultiPolygon') return geometry.coordinates as Polygon[]
  if (geometry.type === 'GeometryCollection' && Array.isArray(geometry.geometries)) {
    return geometry.geometries.flatMap((child) => asPolygons(child))
  }
  return []
}

function countVertices(polygons: Polygon[]): number {
  let count = 0
  for (const polygon of polygons) {
    for (const ring of polygon) count += ring.length
  }
  return count
}

function simplifyPolygons(polygons: Polygon[], tolerance: number): Polygon[] {
  const simplified: Polygon[] = []
  for (const polygon of polygons) {
    const rings = polygon
      .map((ring) => simplifyRing(ring, tolerance))
      .filter((ring) => ring.length >= 4)
    if (rings.length > 0) simplified.push(rings)
  }
  return simplified
}

function coord(n: number): string {
  return n.toFixed(5)
}

function mergeWkt(left: string, right: string): string {
  const inner = (wkt: string) => wkt.slice('SRID=4326;MULTIPOLYGON('.length, -1)
  return `SRID=4326;MULTIPOLYGON(${inner(left)},${inner(right)})`
}

function toMultiPolygonWkt(polygons: Polygon[]): string {
  const body = polygons
    .map((polygon) => {
      const rings = polygon
        .map((ring) => `(${ring.map(([lon, lat]) => `${coord(lon)} ${coord(lat)}`).join(',')})`)
        .join(',')
      return `(${rings})`
    })
    .join(',')
  return `SRID=4326;MULTIPOLYGON(${body})`
}

function rawText(properties: Record<string, unknown> | null, ...keys: string[]): string | null {
  if (!properties) return null
  const entries = Object.entries(properties)
  for (const key of keys) {
    const wanted = key.toLowerCase()
    const found = entries.find(([name]) => name.toLowerCase() === wanted)
    if (!found || found[1] == null) continue
    const text = String(found[1]).trim()
    if (text) return text
  }
  return null
}

function iso3Of(properties: Record<string, unknown> | null): string | null {
  const iso = prop(properties, 'ISO_A3', 'ADM0_A3', 'iso_a3', 'adm0_a3', 'SOV_A3')
  if (!iso) return null
  const code = iso.toUpperCase()
  return /^[A-Z]{3}$/.test(code) ? code : null
}

function hasCountryPrefix(code: string): boolean {
  return /^[A-Za-z]{2,3}-.+$/.test(code)
}

function isPlaceholderCode(code: string | null): boolean {
  if (code == null) return true
  const text = code.trim()
  return text === '' || text === '-99' || text === '-1'
}

function isValidMergeCode(code: string | null): boolean {
  return !isPlaceholderCode(code) && hasCountryPrefix(code as string)
}

function oldAdmin1Code(
  properties: Record<string, unknown> | null,
  iso3: string,
  name: string | null,
): string {
  return (
    prop(properties, 'iso_3166_2', 'ISO_3166_2') ??
    prop(properties, 'adm1_code', 'ADM1_CODE') ??
    prop(properties, 'gn_a1_code') ??
    `${iso3}-${(name ?? 'unnamed').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
  )
}

function candidateMergeCode(properties: Record<string, unknown> | null): string | null {
  return (
    rawText(properties, 'iso_3166_2', 'ISO_3166_2') ??
    rawText(properties, 'adm1_code', 'ADM1_CODE') ??
    rawText(properties, 'gn_a1_code')
  )
}

function normalizeName(name: string | null): string {
  return (name ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function countryRows(collection: FeatureCollection): RegionRow[] {
  const byKey = new Map<string, RegionRow>()
  let skipped = 0
  for (const feature of collection.features) {
    const iso3 = iso3Of(feature.properties)
    const polygons = simplifyPolygons(asPolygons(feature.geometry), tolerance())
    if (!iso3 || polygons.length === 0) {
      skipped += 1
      continue
    }
    const row: RegionRow = {
      level: 0,
      iso3,
      admin1_code: null,
      name: prop(feature.properties, 'NAME_EN', 'ADMIN', 'NAME', 'NAME_LONG'),
      name_local: prop(feature.properties, 'NAME_LOCAL', 'NAME'),
      parent_iso3: null,
      wkt: toMultiPolygonWkt(polygons),
      vertices: countVertices(polygons),
    }
    const existing = byKey.get(iso3)
    if (existing) {
      existing.wkt = mergeWkt(existing.wkt, row.wkt)
      existing.vertices += row.vertices
    } else {
      byKey.set(iso3, row)
    }
  }
  console.log(`  countries kept ${byKey.size}, skipped ${skipped} (missing iso3 or empty geometry)`)
  return [...byKey.values()]
}

interface Admin1Draft {
  index: number
  iso3: string
  isoA3: string | null
  adm0A3: string | null
  name: string | null
  nameLocal: string | null
  oldCode: string
  candidate: string | null
  adm1Code: string | null
  neId: string | null
  wkt: string
  vertices: number
}

function admin1Rows(collection: FeatureCollection): RegionRow[] {
  const drafts: Admin1Draft[] = []
  let skipped = 0
  for (let index = 0; index < collection.features.length; index += 1) {
    const feature = collection.features[index]
    const iso3 = iso3Of(feature.properties)
    const polygons = simplifyPolygons(asPolygons(feature.geometry), tolerance())
    if (!iso3 || polygons.length === 0) {
      skipped += 1
      continue
    }
    const name = prop(feature.properties, 'name', 'NAME', 'name_en')
    drafts.push({
      index,
      iso3,
      isoA3: rawText(feature.properties, 'iso_a3', 'ISO_A3'),
      adm0A3: rawText(feature.properties, 'adm0_a3', 'ADM0_A3'),
      name,
      nameLocal: prop(feature.properties, 'name_local', 'name_nl', 'gn_name'),
      oldCode: oldAdmin1Code(feature.properties, iso3, name),
      candidate: candidateMergeCode(feature.properties),
      adm1Code: rawText(feature.properties, 'adm1_code', 'ADM1_CODE'),
      neId: rawText(feature.properties, 'ne_id', 'NE_ID'),
      wkt: toMultiPolygonWkt(polygons),
      vertices: countVertices(polygons),
    })
  }

  const oldGroups = new Map<string, Admin1Draft[]>()
  for (const draft of drafts) {
    const key = `${draft.iso3}|${draft.oldCode}`
    const group = oldGroups.get(key)
    if (group) group.push(draft)
    else oldGroups.set(key, [draft])
  }
  const oldCollisions = [...oldGroups.entries()].filter(([, group]) => group.length > 1)
  const oldMergedCount = oldCollisions.reduce((sum, [, group]) => sum + group.length - 1, 0)
  console.log(`  previous merge collisions: ${oldCollisions.length} codes, ${oldMergedCount} extra features`)
  for (const [key, group] of oldCollisions) {
    console.log(`  MERGE-CANDIDATE ${key} (${group.length} features)`)
    for (const draft of group) {
      console.log(
        `    iso_a3=${draft.isoA3 ?? ''} adm0_a3=${draft.adm0A3 ?? ''} name=${draft.name ?? ''} code=${draft.oldCode}`,
      )
    }
  }

  const countriesByCode = new Map<string, Set<string>>()
  for (const draft of drafts) {
    if (!draft.candidate) continue
    const set = countriesByCode.get(draft.candidate) ?? new Set<string>()
    set.add(draft.iso3)
    countriesByCode.set(draft.candidate, set)
  }
  const crossCountryCodes = new Set<string>()
  for (const [code, countries] of countriesByCode) {
    if (countries.size > 1) crossCountryCodes.add(code)
  }

  const usedKeys = new Set<string>()
  const byKey = new Map<string, RegionRow>()
  let fallbackCount = 0
  const legitimateMerged = new Map<string, number>()

  const draftsByCountryCode = new Map<string, Admin1Draft[]>()
  for (const draft of drafts) {
    const groupKey = `${draft.iso3}|${draft.candidate ?? ''}`
    const group = draftsByCountryCode.get(groupKey)
    if (group) group.push(draft)
    else draftsByCountryCode.set(groupKey, [draft])
  }

  function takeFallback(draft: Admin1Draft): string {
    fallbackCount += 1
    const options = [draft.adm1Code, draft.neId ? `ne:${draft.neId}` : null, `${draft.iso3}-${draft.index}`]
    for (const option of options) {
      if (!option) continue
      if (option === draft.adm1Code && !isValidMergeCode(option)) continue
      const key = `${draft.iso3}|${option}`
      if (!usedKeys.has(key)) return option
    }
    return `${draft.iso3}-${draft.index}`
  }

  function sameNameGroup(group: Admin1Draft[]): boolean {
    const names = new Set(group.map((item) => normalizeName(item.name)))
    return names.size === 1 && Boolean([...names][0])
  }

  for (const draft of drafts) {
    const code = draft.candidate
    const group = draftsByCountryCode.get(`${draft.iso3}|${code ?? ''}`) ?? [draft]
    const sameCountryOnly = Boolean(code && (countriesByCode.get(code)?.size ?? 0) === 1)
    const canMerge =
      isValidMergeCode(code) &&
      sameCountryOnly &&
      !crossCountryCodes.has(code as string) &&
      sameNameGroup(group)
    const admin1Code = canMerge ? (code as string) : takeFallback(draft)
    const key = `${draft.iso3}|${admin1Code}`
    const row: RegionRow = {
      level: 1,
      iso3: draft.iso3,
      admin1_code: admin1Code,
      name: draft.name,
      name_local: draft.nameLocal,
      parent_iso3: draft.iso3,
      wkt: draft.wkt,
      vertices: draft.vertices,
    }
    const existing = byKey.get(key)
    if (existing && canMerge) {
      existing.wkt = mergeWkt(existing.wkt, row.wkt)
      existing.vertices += row.vertices
      if (!existing.name && row.name) existing.name = row.name
      if (!existing.name_local && row.name_local) existing.name_local = row.name_local
      legitimateMerged.set(admin1Code, (legitimateMerged.get(admin1Code) ?? 1) + 1)
    } else {
      byKey.set(key, row)
      usedKeys.add(key)
    }
  }

  const legitCodes = [...legitimateMerged.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  console.log(`  admin1 kept ${byKey.size}, skipped ${skipped}`)
  console.log(`  legitimate merges: ${legitCodes.length} codes, extra features ${legitCodes.reduce((sum, [, n]) => sum + n - 1, 0)}`)
  if (legitCodes.length > 0) {
    console.log(`  legitimately merged codes: ${legitCodes.map(([code, n]) => `${code}×${n}`).join(', ')}`)
  }
  console.log(`  fallback unique keys: ${fallbackCount}`)
  return [...byKey.values()]
}

let toleranceDegrees = DEFAULT_TOLERANCE
function tolerance(): number {
  return toleranceDegrees
}

async function download(label: string, urls: string[]): Promise<{ url: string; collection: FeatureCollection }> {
  const errors: string[] = []
  for (const url of urls) {
    console.log(`GET ${url}`)
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        headers: { 'user-agent': 'aimani-crisis-region-loader' },
      })
      console.log(`  HTTP ${response.status} ${label}`)
      if (!response.ok) {
        errors.push(`${url} -> HTTP ${response.status}`)
        continue
      }
      const text = await response.text()
      const trimmed = text.trimStart()
      if (!trimmed.startsWith('{')) {
        errors.push(`${url} -> body is not GeoJSON`)
        continue
      }
      const collection = JSON.parse(text) as FeatureCollection
      if (!Array.isArray(collection.features)) {
        errors.push(`${url} -> missing features`)
        continue
      }
      const sample = collection.features[0]?.properties
      console.log(`  features ${collection.features.length}; property keys: ${sample ? Object.keys(sample).slice(0, 12).join(', ') : '(none)'}`)
      return { url, collection }
    } catch (error) {
      errors.push(`${url} -> ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(`Could not download ${label}:\n${errors.join('\n')}`)
}

function estimate(rows: RegionRow[]): { wktMb: number; binaryMb: number; vertices: number } {
  let bytes = 0
  let vertices = 0
  for (const row of rows) {
    bytes += Buffer.byteLength(row.wkt)
    vertices += row.vertices
  }
  return {
    wktMb: bytes / (1024 * 1024),
    binaryMb: (vertices * 16) / (1024 * 1024),
    vertices,
  }
}

function printEstimate(label: string, rows: RegionRow[]): void {
  const size = estimate(rows)
  console.log(
    `${label}: ${rows.length} rows, ${size.vertices} vertices, ` +
      `WKT ${size.wktMb.toFixed(2)} MB, binary ~${size.binaryMb.toFixed(2)} MB`,
  )
}

async function upsertBatches(
  client: SupabaseClient,
  rows: RegionRow[],
  parentByIso3: Map<string, number>,
): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows.slice(offset, offset + BATCH_SIZE).map((row) => ({
      level: row.level,
      iso3: row.iso3,
      admin1_code: row.admin1_code,
      name: row.name,
      name_local: row.name_local,
      parent_id: row.parent_iso3 ? parentByIso3.get(row.parent_iso3) ?? null : null,
      geom: row.wkt,
      source: 'naturalearth',
    }))
    const { error } = await client.from('crisis_regions').upsert(batch, {
      onConflict: 'level,iso3,admin1_code',
    })
    if (error) {
      throw new Error(`upsert failed at offset ${offset}: ${error.message}`)
    }
    console.log(`  upserted ${Math.min(offset + BATCH_SIZE, rows.length)} / ${rows.length}`)
    if (offset + BATCH_SIZE < rows.length) await sleep(BATCH_PAUSE_MS)
  }
}

async function loadParents(client: SupabaseClient): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('crisis_regions')
      .select('id, iso3')
      .eq('level', 0)
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`country lookup failed: ${error.message}`)
    for (const row of data ?? []) {
      if (row.iso3) map.set(row.iso3, Number(row.id))
    }
    if (!data || data.length < pageSize) break
  }
  return map
}

async function sanity(client: SupabaseClient): Promise<void> {
  for (const point of SANITY_POINTS) {
    const { data, error } = await client.rpc('crisis_lookup_point', {
      p_lat: point.lat,
      p_lon: point.lon,
    })
    if (error) {
      console.log(`sanity ${point.label} (${point.lat}, ${point.lon}): ERROR ${error.message}`)
      continue
    }
    const row = Array.isArray(data) ? data[0] : null
    if (!row) {
      console.log(`sanity ${point.label} (${point.lat}, ${point.lon}): no containing region`)
      continue
    }
    console.log(
      `sanity ${point.label} (${point.lat}, ${point.lon}): ` +
        `id=${row.id} level=${row.level} iso3=${row.iso3} admin1=${row.admin1_code ?? ''} name=${row.name}`,
    )
  }
}

async function main(): Promise<void> {
  requireEnvLocal()
  const apply = process.argv.includes('--apply')
  const toleranceArg = argValue('--tolerance')
  if (toleranceArg) {
    const parsed = Number(toleranceArg)
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`invalid --tolerance ${toleranceArg}`)
    }
    toleranceDegrees = parsed
  }

  console.log(apply ? 'mode: apply' : 'mode: dry-run (no database writes)')
  console.log(`simplify tolerance: ${toleranceDegrees} degrees`)

  const countriesDownload = await download('admin_0_countries', ADMIN0_URLS)
  const countries = countryRows(countriesDownload.collection)
  printEstimate('countries', countries)

  const admin1Download = await download('admin_1_states_provinces', ADMIN1_URLS)
  const provinces = admin1Rows(admin1Download.collection)
  printEstimate('admin1', provinces)

  const combined = estimate([...countries, ...provinces])
  console.log(
    `total: ${countries.length + provinces.length} rows, ${combined.vertices} vertices, ` +
      `WKT ${combined.wktMb.toFixed(2)} MB, binary ~${combined.binaryMb.toFixed(2)} MB`,
  )
  console.log(`country URL: ${countriesDownload.url}`)
  console.log(`admin1 URL: ${admin1Download.url}`)
  for (const iso3 of ['NPL', 'YEM', 'UKR']) {
    const row = countries.find((item) => item.iso3 === iso3)
    console.log(row ? `dry-run has ${iso3} ${row.name} (${row.vertices} vertices)` : `dry-run missing ${iso3}`)
  }

  if (!apply) {
    console.log('dry-run complete. Re-run with --apply after the migration is in the database.')
    return
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --apply')
  }
  const { createClient } = await import('@supabase/supabase-js')
  const client = createClient(url, key)
  console.log('writing countries')
  await upsertBatches(client, countries, new Map())
  const parents = await loadParents(client)
  console.log(`country ids loaded: ${parents.size}`)
  console.log('writing admin1')
  await upsertBatches(client, provinces, parents)
  await sanity(client)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
