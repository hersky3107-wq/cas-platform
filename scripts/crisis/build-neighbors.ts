/**
 * Rebuild admin1 neighbour pairs one batch at a time.
 *
 *   npx tsx --env-file=.env.local scripts/crisis/build-neighbors.ts
 *   npx tsx --env-file=.env.local scripts/crisis/build-neighbors.ts --apply
 *
 * --apply calls crisis_refresh_neighbor_batch (migration 20261009000004).
 * Each call is one country, or one slice of at most 200 admin1 regions.
 * The join is not limited to the same country. Completed batch keys are
 * stored on crisis_ingest_state source neighbor_build, so a timeout can resume.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { planNeighborBatches, pendingNeighborBatches } from '../../lib/crisis/ingest/neighbors'

const SOURCE = 'neighbor_build'

function wants(flag: string): boolean {
  return process.argv.includes(flag)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

async function loadAdmin1(client: {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: number) => {
        range: (from: number, to: number) => Promise<{ data: Array<{ id: number; iso3: string | null; level: number }> | null; error: { message: string } | null }>
      }
    }
  }
}): Promise<Array<{ id: number; iso3: string | null; level: number }>> {
  const rows: Array<{ id: number; iso3: string | null; level: number }> = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from('crisis_regions').select('id,iso3,level').eq('level', 1).range(from, from + 999)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return rows
}

async function main(): Promise<void> {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) throw new Error('Copy cas-platform/.env.local into cas-platform-crisis first')
  const { supabaseAdmin } = await import('../../lib/supabase/server')
  const started = Date.now()
  if (!wants('--apply')) {
    const { count, error } = await supabaseAdmin
      .from('crisis_region_neighbors')
      .select('region_id', { count: 'exact', head: true })
    if (error) {
      console.log(`migration unapplied or unreadable: ${error.message}`)
      console.log('Paste docs/crisis/APPLY_PREEVENT.md, then re-run.')
      return
    }
    console.log(`directed_pairs=${count ?? 0} undirected_pairs=${Math.round((count ?? 0) / 2)} read_ms=${Date.now() - started}`)
    return
  }

  const regions = await loadAdmin1(supabaseAdmin)
  const batches = planNeighborBatches(regions)
  const { data: state, error: stateError } = await supabaseAdmin
    .from('crisis_ingest_state')
    .select('cursor')
    .eq('source', SOURCE)
    .maybeSingle()
  if (stateError) throw new Error(stateError.message)
  const cursor = asRecord(state?.cursor)
  const completed = Array.isArray(cursor?.completed)
    ? cursor.completed.filter((key): key is string => typeof key === 'string')
    : []
  const pending = pendingNeighborBatches(batches, completed)
  console.log(`admin1=${regions.length} batches=${batches.length} pending=${pending.length} already=${completed.length}`)
  console.log('cross-border: each batch joins every other admin1, not only the same country')

  for (let index = 0; index < pending.length; index += 1) {
    const batch = pending[index]
    console.log(`[${index + 1}/${pending.length}] ${batch.key} regions=${batch.ids.length} starting`)
    const { data, error } = await supabaseAdmin.rpc('crisis_refresh_neighbor_batch', { batch: batch.ids })
    if (error) {
      throw new Error(`${error.message}. Paste docs/crisis/APPLY_ENGINE.md if crisis_refresh_neighbor_batch is missing. Completed batches stay in crisis_ingest_state source ${SOURCE}.`)
    }
    completed.push(batch.key)
    const { error: saveError } = await supabaseAdmin.from('crisis_ingest_state').upsert(
      {
        source: SOURCE,
        last_success_at: new Date().toISOString(),
        cursor: { completed, last_key: batch.key },
      },
      { onConflict: 'source' },
    )
    if (saveError) throw new Error(saveError.message)
    console.log(`[${index + 1}/${pending.length}] ${batch.key} inserted=${Number(data ?? 0)} elapsed_ms=${Date.now() - started}`)
  }
  console.log(`done batches=${completed.length} runtime_ms=${Date.now() - started}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
