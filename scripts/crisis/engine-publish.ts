/**
 * Admin publish. Inserts the picked hypotheses into the append-only ledger.
 * Does not run by itself from engine-run.
 *
 *   npx tsx --require ./scripts/crisis/register-server-only.cjs --env-file=.env.local scripts/crisis/engine-publish.ts --run=<uuid> --pick=0,2
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { buildLedgerInserts } from '../../lib/crisis/engine/publish'

function arg(name: string): string | undefined {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`))
  return hit?.slice(name.length + 3)
}

async function main(): Promise<void> {
  const runId = arg('run')
  const pick = arg('pick')
  if (!runId || !pick) throw new Error('Pass --run=<uuid> and --pick=0,2')
  const indices = pick.split(',').map((part) => Number(part.trim()))
  if (indices.length === 0 || indices.some((index) => !Number.isInteger(index) || index < 0)) {
    throw new Error('--pick must be comma-separated indexes, for example 0,2')
  }
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) throw new Error('Copy cas-platform/.env.local into cas-platform-crisis first')
  const { supabaseAdmin } = await import('../../lib/supabase/server')
  const { loadRun, insertHypothesis, markPublished } = await import('../../lib/crisis/engine/store')
  const run = await loadRun(supabaseAdmin, runId)
  if (!run) throw new Error(`no engine run ${runId}`)
  const all = [...(run.result?.headlines ?? []), ...(run.result?.missed_by_others ?? [])]
  all.forEach((hypothesis, index) => {
    console.log(`${index}\tstage=${hypothesis.stage}\toutsider=${hypothesis.outsider}\t${hypothesis.title}`)
  })
  const inserts = buildLedgerInserts(run, indices, new Date().toISOString())
  const ids: number[] = []
  for (const insert of inserts) {
    const saved = await insertHypothesis(supabaseAdmin, insert)
    ids.push(saved.id)
    console.log(`published id=${saved.id} prev_hash=${saved.prev_hash ?? ''} content_hash=${saved.content_hash}`)
  }
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('crisis_engine_runs')
    .select('published_hypothesis_ids')
    .eq('id', runId)
    .single()
  if (existingError) throw new Error(existingError.message)
  const previous = Array.isArray(existing?.published_hypothesis_ids) ? existing.published_hypothesis_ids.map(Number) : []
  await markPublished(supabaseAdmin, runId, [...previous, ...ids])
  console.log(`run=${runId} published_hypothesis_ids=${[...previous, ...ids].join(',')}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
