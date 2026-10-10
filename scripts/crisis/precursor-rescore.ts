/**
 * Ingest earthquake/volcano precursors, print a dry-run stage delta, then write today's scores.
 * Does not touch the running crisis:sweep process.
 *
 *   npx tsx --require ./scripts/crisis/register-server-only.cjs --env-file=.env.local scripts/crisis/precursor-rescore.ts
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { PRECURSOR_LICENSES } from '../../lib/crisis/precursors/licenses'
import { CRISIS_SOURCES } from '../../lib/crisis/ingest/registry'
import { runSource } from '../../lib/crisis/ingest/run'
import { runLayer1Score } from '../../lib/crisis/score/job'
import type { RegionScore } from '../../lib/crisis/score/types'

const INGEST = ['usgs_catalog', 'gvp_holocene', 'usgs_oaf', 'vaac', 'volcano_thermal', 'gvp_weekly', 'so2_daily', 'gnss_ngl']

function stages(rows: RegionScore[]): Record<number, number> {
  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (const row of rows) counts[row.stage] = (counts[row.stage] ?? 0) + 1
  return counts
}

function printFlags(rows: RegionScore[]): void {
  const hits = rows.filter((row) =>
    row.components.some((component) =>
      (component.key === 'quake' || component.key === 'volcano') && component.raw.forecast === 'probability',
    ),
  )
  console.log(`probability_flags=${hits.length}`)
  for (const row of hits) {
    const quake = row.components.find((component) => component.key === 'quake' && component.raw.forecast === 'probability')
    const volcano = row.components.find((component) => component.key === 'volcano' && component.raw.forecast === 'probability')
    if (quake) {
      console.log(
        `earthquake ${row.name} ${row.iso3 ?? ''} stage=${row.stage} x${quake.raw.rate_multiplier} ` +
          `7d=${quake.raw.count_7d} usual=${quake.raw.usual_7d} zone=${quake.raw.hazard_zone} ` +
          `swarm=${quake.raw.swarm_72h ?? 0} b=${quake.raw.b_value ?? '-'} ` +
          `oaf=${quake.raw.oaf_m5 ?? '-'}/${quake.raw.oaf_m6 ?? '-'}/${quake.raw.oaf_m7 ?? '-'}`,
      )
    }
    if (volcano) {
      const bits = Array.isArray(volcano.raw.precursors) ? JSON.stringify(volcano.raw.precursors) : ''
      console.log(`volcano ${row.name} ${row.iso3 ?? ''} stage=${row.stage} ${bits}`)
    }
  }
}

async function main(): Promise<void> {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) throw new Error('Copy cas-platform/.env.local into cas-platform-crisis first')
  for (const row of PRECURSOR_LICENSES) {
    console.log(`license ${row.status} ${row.source} | ${row.license} | ${row.terms}`)
  }
  const { supabaseAdmin } = await import('../../lib/supabase/server')
  for (const key of INGEST) {
    const source = CRISIS_SOURCES.find((row) => row.key === key)
    if (!source) throw new Error(`missing source ${key}`)
    const summary = await runSource(source, supabaseAdmin, { dryRun: false, force: true })
    console.log(`ingest ${key} status=${summary.status} in=${summary.rowsIn} written=${summary.rowsWritten} http=${summary.httpCalls} note=${summary.quotaNote ?? ''} error=${summary.error ?? ''}`)
  }
  const before = await runLayer1Score(supabaseAdmin, { dryRun: true, write: false, precursors: false, log: () => {} })
  const after = await runLayer1Score(supabaseAdmin, { dryRun: true, write: false, precursors: true, log: (message) => console.log(message) })
  console.log(`stages before ${JSON.stringify(stages(before.rows))}`)
  console.log(`stages after ${JSON.stringify(stages(after.rows))}`)
  printFlags(after.rows)
  const written = await runLayer1Score(supabaseAdmin, { dryRun: false, write: true, precursors: true, log: (message) => console.log(message) })
  console.log(`wrote day=${written.day} scored=${written.scored} cards=${written.cards}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exit(1)
})
