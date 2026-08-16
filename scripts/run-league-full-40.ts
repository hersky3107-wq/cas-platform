/**
 * PART 2/3 verification: full-league generation run against the latest ranked
 * AAPL round.
 *
 * Steps:
 *   1. Find the latest ranked AAPL round (the one /league Cards shows).
 *   2. Delete its existing model_predictions rows — they were written by the
 *      obsolete 21-model roster under provider-reported model ids
 *      ('qwen/qwen3.8-max', 'gpt-4o', ...); the new roster persists canonical
 *      per-slot ids, so stale rows would double-render on the card.
 *   3. Run generatePredictions over the full 40-model roster.
 *   4. Print per-model status (answered / abstained / errored), the research
 *      packet summary (Part 3), and total cost.
 *
 * Run:
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/run-league-full-40.ts
 */
import { supabaseAdmin } from '../lib/supabase/server'
import { generatePredictions } from '../lib/league/orchestrator'
import { getResearchPacket } from '../lib/league/research'
import { LEAGUE_ROSTER } from '../lib/league/roster'

async function main() {
  const { data: round, error: roundErr } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id, instrument, proposition_text, category, horizon, resolution_rule, resolves_at, resolved_at, opened_at')
    .eq('instrument', 'AAPL')
    .eq('item_type', 'ranked')
    .order('opened_at', { ascending: false })
    .limit(1)
    .single()

  if (roundErr || !round) {
    console.error('No ranked AAPL round found:', roundErr?.message)
    process.exit(1)
  }
  console.log(`Round: ${round.id}`)
  console.log(`  proposition: ${round.proposition_text}`)
  console.log(`  resolves_at: ${round.resolves_at}  resolved_at: ${round.resolved_at ?? '(unresolved)'}`)

  if (process.argv.includes('--clear-predictions')) {
    const { error: delErr, count: delCount } = await supabaseAdmin
      .from('model_predictions')
      .delete({ count: 'exact' })
      .eq('round_id', round.id)
    if (delErr) {
      console.error('Failed to clear stale predictions:', delErr.message)
      process.exit(1)
    }
    console.log(`Cleared ${delCount ?? '?'} stale prediction rows (obsolete 21-model roster).`)
  }

  // CACHE PROOF (Part 3): fetch the packet once in this process (miss → paid),
  // then generatePredictions' internal fetch must be a cache HIT ($0).
  console.log('\nPre-fetching research packet (expect MISS, paid)...')
  const pre = await getResearchPacket({ round, budgetRemainingUsd: 20 })
  console.log(`  pre-fetch: available=${pre.available} cached=${pre.cached} cost=$${pre.costUsd.toFixed(4)} queries=${pre.queries.length}`)

  console.log(`\nRunning full roster (${LEAGUE_ROSTER.length} models)...`)
  const started = Date.now()
  const result = await generatePredictions({ round: { roundId: round.id } })
  const elapsed = ((Date.now() - started) / 1000).toFixed(1)

  console.log(`\n== RESEARCH PACKET (Part 3) ==`)
  console.log(`  available: ${result.research.available}  cached: ${result.research.cached}  cost: $${result.research.costUsd.toFixed(4)}`)
  if (result.research.error) console.log(`  error: ${result.research.error}`)
  for (const q of result.research.queries) console.log(`  query: ${q}`)

  console.log(`\n== PER-MODEL STATUS (${result.results.length}/${LEAGUE_ROSTER.length} attempted, ${elapsed}s) ==`)
  const tierOrder = ['premier', 'challenger', 'world', 'scout']
  const sorted = [...result.results].sort((a, b) => tierOrder.indexOf(a.tier) - tierOrder.indexOf(b.tier))
  for (const r of sorted) {
    const status =
      r.status === 'ok' ? 'answered ' : r.status === 'abstain' ? 'abstained' : r.status === 'timeout' ? 'TIMEOUT  ' : 'ERROR    '
    const dir = r.direction ? `${r.direction} ${r.probability ?? '?'}%` : '—'
    console.log(
      `  ${r.tier.padEnd(10)} ${r.model_id.padEnd(28)} ${status} ${dir.padEnd(12)} $${r.cost_usd.toFixed(4)} (${r.cost_source})${r.error ? `  err: ${r.error.slice(0, 100)}` : ''}`,
    )
  }

  const counts = { answered: 0, abstained: 0, errored: 0, timeout: 0 }
  for (const r of result.results) {
    if (r.status === 'ok') counts.answered++
    else if (r.status === 'abstain') counts.abstained++
    else if (r.status === 'timeout') counts.timeout++
    else counts.errored++
  }
  console.log(`\n== SUMMARY ==`)
  console.log(`  answered: ${counts.answered}  abstained: ${counts.abstained}  errored: ${counts.errored}  timeout: ${counts.timeout}`)
  console.log(`  data packet: ${result.data_packet.available ? `available (${result.data_packet.symbol} @ ${result.data_packet.latestClose})` : `UNAVAILABLE (${result.data_packet.error})`}`)
  console.log(`  total cost: $${result.total_cost_usd.toFixed(4)} (cap $${result.cost_cap_usd}, capped=${result.capped})`)

  const { count: rowCount } = await supabaseAdmin
    .from('model_predictions')
    .select('model_id', { count: 'exact', head: true })
    .eq('round_id', round.id)
  console.log(`  rows persisted for round: ${rowCount}`)
}

main()
