/**
 * Recompute persisted AI 종합 (log-odds / brand_table #1) for every round
 * that has model predictions, then stamp consensus_is_correct on graded
 * rounds. No LLM calls.
 *
 * Apply supabase/migrations/20261005000001_prediction_rounds_consensus_is_correct.sql
 * before the is_correct half (aggregates can write without it).
 *
 *   npx tsx scripts/backfill-league-consensus.ts
 */
import Module from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load
;(Module as unknown as { _load: typeof Module._load })._load = function (request, parent, isMain) {
  if (request === 'server-only') return {}
  // @ts-expect-error — patching Node internals for script use
  return originalLoad.call(this, request, parent, isMain)
}

function loadEnvLocal() {
  const path = join(process.cwd(), '.env.local')
  const raw = readFileSync(path, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = val
  }
}

async function main() {
  loadEnvLocal()
  const { supabaseAdmin } = await import('../lib/supabase/server')
  const { persistLeagueConsensusFromDb } = await import('../lib/league/orchestrator')
  const { stampConsensusIsCorrect } = await import('../lib/league/consensus-correctness')

  const { data: predRows, error: predErr } = await supabaseAdmin.from('model_predictions').select('round_id')
  if (predErr) throw predErr
  const roundIds = [...new Set((predRows ?? []).map((r) => String((r as { round_id: string }).round_id)))]
  console.log(`rounds_with_predictions=${roundIds.length}`)

  let persisted = 0
  let persistFailed = 0
  for (const id of roundIds) {
    try {
      await persistLeagueConsensusFromDb(id)
      persisted += 1
    } catch (e: unknown) {
      persistFailed += 1
      console.warn(`persist ${id}: ${e instanceof Error ? e.message : e}`)
    }
  }

  const { data: graded, error: gErr } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id, grading_status, actual_outcome')
    .not('actual_outcome', 'is', null)
  if (gErr) throw gErr
  const toStamp = (graded ?? []).filter(
    (r) => r.grading_status !== 'voided' && String(r.actual_outcome ?? '').trim() !== '',
  )

  let stamped = 0
  let stampFailed = 0
  let correct = 0
  for (const r of toStamp) {
    try {
      const value = await stampConsensusIsCorrect(String(r.id))
      stamped += 1
      if (value === true) correct += 1
    } catch (e: unknown) {
      stampFailed += 1
      console.warn(`stamp ${r.id}: ${e instanceof Error ? e.message : e}`)
    }
  }

  console.log(
    JSON.stringify(
      {
        persisted,
        persistFailed,
        stamped,
        stampFailed,
        consensusCorrect: correct,
        consensusN: stamped,
      },
      null,
      2,
    ),
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
