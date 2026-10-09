/**
 * Slow-burn dry-run. Reads stored history. Does not write unless --apply,
 * and --apply only writes crisis_region_flags through the score job.
 *
 *   npx tsx --env-file=.env.local scripts/crisis/slow-burn.ts
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { loadAllRegions } from '../../lib/crisis/ingest/regions'
import { loadSlowBurn } from '../../lib/crisis/score/slowburn-load'
import type { ScoreRegion } from '../../lib/crisis/score/snapshot'

function pointOf(centroid: unknown): { lat: number; lon: number } | null {
  if (centroid && typeof centroid === 'object' && Array.isArray((centroid as { coordinates?: unknown }).coordinates)) {
    const [lon, lat] = (centroid as { coordinates: number[] }).coordinates
    if (Number.isFinite(lon) && Number.isFinite(lat)) return { lat, lon }
  }
  return null
}

async function main(): Promise<void> {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) throw new Error('Copy cas-platform/.env.local into cas-platform-crisis first')
  const { supabaseAdmin } = await import('../../lib/supabase/server')
  const raw = await loadAllRegions(supabaseAdmin)
  const names = new Map(raw.filter((row) => row.level === 0 && row.iso3).map((row) => [row.iso3 as string, row.name ?? row.iso3]))
  const regions: ScoreRegion[] = []
  for (const row of raw) {
    const point = pointOf(row.centroid)
    if (!point) continue
    regions.push({
      id: Number(row.id),
      level: Number(row.level),
      iso3: row.iso3,
      name: row.name ?? row.iso3 ?? String(row.id),
      country: row.iso3 ? names.get(row.iso3) ?? row.iso3 : '',
      parent_id: row.parent_id,
      lat: point.lat,
      lon: point.lon,
    })
  }
  const burn = await loadSlowBurn(supabaseAdmin, new Date(), regions, new Map())
  console.log(`slow-burn source=${burn.source} countries=${burn.countries.length} dyads=${burn.dyads.length}`)
  console.log('top countries')
  for (const [index, row] of burn.countries.slice(0, 20).entries()) {
    console.log(`${index + 1}. ${row.name} (${row.id}) value=${row.value.toFixed(1)} ${row.kind} ${row.note}`)
  }
  console.log('top dyads')
  if (!burn.dyads.length) console.log('(none — crisis_dyad_daily is empty until the migration is pasted and the backfill runs)')
  for (const [index, row] of burn.dyads.slice(0, 20).entries()) {
    console.log(`${index + 1}. ${row.name} value=${row.value.toFixed(1)} ${row.kind} ${row.note}`)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
