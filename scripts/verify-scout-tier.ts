/**
 * STEP 3 verification: re-run Scout tier only on the latest AAPL round and
 * confirm DB rows now carry real directions (not forced null).
 *
 * Run:
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/verify-scout-tier.ts
 */
import { supabaseAdmin } from '../lib/supabase/server'
import { generatePredictions } from '../lib/league/orchestrator'
import { getRoster } from '../lib/league/roster'

async function main() {
  const { data: round, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id, instrument, proposition_text')
    .eq('instrument', 'AAPL')
    .eq('item_type', 'ranked')
    .order('opened_at', { ascending: false })
    .limit(1)
    .single()

  if (error || !round) {
    console.error('No AAPL round:', error?.message)
    process.exit(1)
  }

  const scoutIds = getRoster(['scout']).map((e) => e.model_id)
  console.log(`Round: ${round.id}`)
  console.log(`Running Scout tier (${scoutIds.length} models)...\n`)

  const started = Date.now()
  const result = await generatePredictions({ round: { roundId: round.id }, tiers: ['scout'], concurrency: 3 })
  const elapsed = ((Date.now() - started) / 1000).toFixed(1)

  const { data: rows } = await supabaseAdmin
    .from('model_predictions')
    .select('model_id, predicted_direction, predicted_value, reasoning_snippet, cost_usd')
    .eq('round_id', round.id)
    .in('model_id', scoutIds)

  console.log(`== SCOUT RESULTS (${elapsed}s, total cost $${result.total_cost_usd.toFixed(4)}) ==\n`)
  console.log('| model | run status | DB direction | confidence | snippet | cost |')
  console.log('|-------|------------|--------------|------------|---------|------|')

  let answered = 0
  let abstained = 0
  let errored = 0
  let scoutCost = 0

  for (const r of result.results) {
    scoutCost += r.cost_usd
    const db = rows?.find((row) => row.model_id === r.model_id)
    const dbDir = db?.predicted_direction ?? '—'
    const conf = db?.predicted_value != null ? `${db.predicted_value}%` : '—'
    const snippet = (db?.reasoning_snippet ?? '').slice(0, 60).replace(/\|/g, '/')
    if (r.status === 'ok') answered++
    else if (r.status === 'abstain') abstained++
    else errored++
    console.log(
      `| ${r.model_id.padEnd(24)} | ${r.status.padEnd(10)} | ${String(dbDir).padEnd(12)} | ${conf.padEnd(10)} | ${snippet}${snippet.length >= 60 ? '…' : ''} | $${(db?.cost_usd ?? 0).toFixed(4)} |`,
    )
    if (dbDir === '—' || dbDir === null) {
      console.log(`  WARNING: DB direction still null for ${r.model_id} despite run status ${r.status}`)
    }
  }

  console.log(`\n== SUMMARY ==`)
  console.log(`  answered: ${answered}/${scoutIds.length}  abstained: ${abstained}  errored/timeout: ${errored}`)
  console.log(`  scout tier cost: $${scoutCost.toFixed(4)}`)
}

main()
