/**
 * Ingest the new hazard sources, print a dry-run stage delta and top 20, then write.
 * Does not touch the running crisis:sweep process.
 *
 *   npx tsx --require ./scripts/crisis/register-server-only.cjs --env-file=.env.local scripts/crisis/more-hazards-rescore.ts
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { EXTRA_LICENSES } from '../../lib/crisis/hazards-extra/licenses'
import { CRISIS_SOURCES } from '../../lib/crisis/ingest/registry'
import { runSource } from '../../lib/crisis/ingest/run'
import { explainRegion } from '../../lib/crisis/score/print'
import { runLayer1Score } from '../../lib/crisis/score/job'
import type { RegionScore } from '../../lib/crisis/score/types'

const INGEST = ['who_don', 'promed', 'locust', 'lhasa', 'swpc', 'ucdp', 'advisories']

function stages(rows: RegionScore[]): Record<number, number> {
  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (const row of rows) counts[row.stage] = (counts[row.stage] ?? 0) + 1
  return counts
}

function top(rows: RegionScore[]): string {
  return [...rows]
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((row, index) => explainRegion(index + 1, row))
    .join('\n')
}

async function main(): Promise<void> {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) throw new Error('Copy cas-platform/.env.local into cas-platform-crisis first')
  for (const row of EXTRA_LICENSES) {
    console.log(`license ${row.status} ${row.source} | ${row.license} | ${row.terms}`)
  }
  const { supabaseAdmin } = await import('../../lib/supabase/server')
  for (const key of INGEST) {
    const source = CRISIS_SOURCES.find((row) => row.key === key)
    if (!source) throw new Error(`missing source ${key}`)
    const summary = await runSource(source, supabaseAdmin, { dryRun: false, force: true })
    console.log(`ingest ${key} status=${summary.status} in=${summary.rowsIn} written=${summary.rowsWritten} http=${summary.httpCalls} note=${summary.quotaNote ?? ''} error=${summary.error ?? ''}`)
  }
  const before = await runLayer1Score(supabaseAdmin, { dryRun: true, write: false, moreHazards: false, log: () => {} })
  const after = await runLayer1Score(supabaseAdmin, { dryRun: true, write: false, moreHazards: true, log: (message) => console.log(message) })
  console.log(`stages before ${JSON.stringify(stages(before.rows))}`)
  console.log(`stages after ${JSON.stringify(stages(after.rows))}`)
  console.log('top20 before')
  console.log(top(before.rows))
  console.log('top20 after')
  console.log(top(after.rows))
  const written = await runLayer1Score(supabaseAdmin, { dryRun: false, write: true, moreHazards: true, log: (message) => console.log(message) })
  console.log(`wrote day=${written.day} scored=${written.scored} cards=${written.cards}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exit(1)
})
