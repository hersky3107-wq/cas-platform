/**
 * Run only after the crisis_core migration has been applied in the SQL editor.
 * Does not load regions. Inserts one probe signal, prints the assigned region,
 * deletes that signal, then inserts one append-only hypothesis and confirms
 * UPDATE and DELETE are rejected.
 *
 *   npx tsx --env-file=.env.local scripts/crisis/verify-schema.ts
 *
 * The hypothesis row titled GENESIS TEST ENTRY cannot be deleted. Leave it.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

interface ProbeRecord {
  department: string
  source: string
  signal_type: string
  title: string | null
  lat: number | null
  lon: number | null
  country_iso3: string | null
  value_raw: unknown
  unit_raw: string | null
  event_time: string | null
  fetched_at: string | null
  url: string | null
}

function probePath(): string {
  const fromArg = process.argv.find((item) => item.startsWith('--probe='))
  if (fromArg) return fromArg.slice('--probe='.length)
  return path.resolve(process.cwd(), '..', 'crisis-probe', 'out', 'normalized.json')
}

function valueNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  }
  const client = createClient(url, key)
  const file = probePath()
  const records = JSON.parse(readFileSync(file, 'utf8')) as ProbeRecord[]
  const sample = records.find(
    (row) => typeof row.lat === 'number' && typeof row.lon === 'number' && Number.isFinite(row.lat) && Number.isFinite(row.lon),
  )
  if (!sample || sample.lat == null || sample.lon == null) {
    throw new Error(`no lat/lon sample in ${file}`)
  }

  const dedupeKey = `crisis-verify:${new Date().toISOString()}`
  const { data: inserted, error: insertError } = await client
    .from('crisis_raw_signals')
    .insert({
      department: sample.department,
      source: sample.source,
      signal_type: sample.signal_type,
      title: sample.title,
      lat: sample.lat,
      lon: sample.lon,
      country_iso3: sample.country_iso3,
      value_num: valueNum(sample.value_raw),
      value_raw: sample.value_raw == null ? null : { raw: sample.value_raw },
      unit_raw: sample.unit_raw,
      event_time: sample.event_time,
      fetched_at: sample.fetched_at ?? new Date().toISOString(),
      url: sample.url,
      dedupe_key: dedupeKey,
    })
    .select('id, region_id, country_iso3, geom')
    .single()
  if (insertError || !inserted) {
    throw new Error(`signal insert failed: ${insertError?.message ?? 'no row'}`)
  }

  let regionLabel = 'null (no containing region, or regions not loaded)'
  if (inserted.region_id != null) {
    const { data: region, error: regionError } = await client
      .from('crisis_regions')
      .select('id, level, iso3, admin1_code, name')
      .eq('id', inserted.region_id)
      .single()
    if (regionError) regionLabel = `id=${inserted.region_id} lookup error: ${regionError.message}`
    else if (region) {
      regionLabel = `id=${region.id} level=${region.level} iso3=${region.iso3} admin1=${region.admin1_code ?? ''} name=${region.name}`
    }
  }
  console.log(`sample: ${sample.title}`)
  console.log(`signal id=${inserted.id} country_iso3=${inserted.country_iso3 ?? 'null'} region=${regionLabel}`)

  const { error: deleteError } = await client.from('crisis_raw_signals').delete().eq('id', inserted.id)
  if (deleteError) throw new Error(`signal delete failed: ${deleteError.message}`)
  console.log(`deleted signal id=${inserted.id}`)

  const { data: hypothesis, error: hypothesisError } = await client
    .from('crisis_hypotheses')
    .insert({
      region_ids: [],
      stage: 1,
      confidence: 'low',
      novelty: 'unknown',
      title: 'GENESIS TEST ENTRY',
      body: 'Schema verification row. Append-only. Do not try to delete it.',
      evidence_signal_ids: [],
      evidence_snapshot: { probe_file: file, sample_title: sample.title },
      ai_roster: { models: [] },
    })
    .select('id, prev_hash, content_hash')
    .single()
  if (hypothesisError || !hypothesis) {
    throw new Error(`hypothesis insert failed: ${hypothesisError?.message ?? 'no row'}`)
  }
  console.log(`hypothesis id=${hypothesis.id}`)
  console.log(`prev_hash=${hypothesis.prev_hash ?? '(genesis, empty)'}`)
  console.log(`content_hash=${hypothesis.content_hash}`)

  const updated = await client.from('crisis_hypotheses').update({ title: 'mutated' }).eq('id', hypothesis.id)
  const updateRejected = Boolean(updated.error && /append-only/i.test(updated.error.message))
  console.log(`update rejected=${updateRejected} message=${updated.error?.message ?? 'no error'}`)

  const deleted = await client.from('crisis_hypotheses').delete().eq('id', hypothesis.id)
  const deleteRejected = Boolean(deleted.error && /append-only/i.test(deleted.error.message))
  console.log(`delete rejected=${deleteRejected} message=${deleted.error?.message ?? 'no error'}`)

  if (!updateRejected || !deleteRejected) {
    throw new Error('append-only guard did not reject both UPDATE and DELETE')
  }
  console.log('verify-schema passed. GENESIS TEST ENTRY remains in crisis_hypotheses.')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
