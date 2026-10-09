/**
 * Seed crisis_cascades. Dry-run is the default and does not open the database.
 *
 *   npx tsx scripts/crisis/seed-cascades.ts
 *   npx tsx --env-file=.env.local scripts/crisis/seed-cascades.ts --apply
 *
 * --apply requires migration 20261009000001 to be pasted first.
 */
import { CASCADE_SEEDS, cascadeCounts } from '../../lib/crisis/knowledge/cascades.seed'
import { assertCascades } from '../../lib/crisis/knowledge/validate'

function wants(flag: string): boolean {
  return process.argv.includes(flag)
}

async function main(): Promise<void> {
  assertCascades()
  const counts = cascadeCounts()
  console.log(`cascades ${counts.total} sourced ${counts.sourced} hypothesis ${counts.hypothesis}`)
  for (const row of CASCADE_SEEDS) {
    console.log(
      `${row.id}\t${row.trigger_type} -> ${row.effect_type}\t${row.lag_min_days}-${row.lag_max_days}d\t${row.evidence_level}`,
    )
  }
  if (!wants('--apply')) {
    console.log('dry-run: nothing written. Pass --apply to upsert.')
    return
  }
  const { supabaseAdmin } = await import('../../lib/supabase/server')
  const payload = CASCADE_SEEDS.map((row) => ({
    id: row.id,
    trigger_type: row.trigger_type,
    effect_type: row.effect_type,
    lag_min_days: row.lag_min_days,
    lag_max_days: row.lag_max_days,
    conditions: row.conditions,
    mechanism: row.mechanism,
    evidence_level: row.evidence_level,
    sources: row.sources,
    notes: row.notes,
    updated_at: new Date().toISOString(),
  }))
  const { error } = await supabaseAdmin.from('crisis_cascades').upsert(payload, { onConflict: 'id' })
  if (error) throw new Error(error.message)
  console.log(`upserted ${payload.length} cascades`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
