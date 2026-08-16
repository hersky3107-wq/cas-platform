/**
 * Targeted re-run of ONLY premier+challenger for the two slots that were
 * budget-capped at 3000 (deepseek-v4-pro, kimi-k2.6 — now 6000). World/scout
 * rows from the previous full run are left untouched (canonical-id upserts).
 *
 * Run:
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/rerun-pc-tiers.ts
 */
import { supabaseAdmin } from '../lib/supabase/server'
import { generatePredictions } from '../lib/league/orchestrator'

async function main() {
  const { data: round } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id')
    .eq('instrument', 'AAPL')
    .eq('item_type', 'ranked')
    .order('opened_at', { ascending: false })
    .limit(1)
    .single()
  if (!round) throw new Error('no AAPL round')

  const result = await generatePredictions({ round: { roundId: round.id }, tiers: ['premier'] })
  for (const r of result.results) {
    console.log(
      `  ${r.tier.padEnd(10)} ${r.model_id.padEnd(26)} ${r.status.padEnd(8)} ${r.direction ?? '—'} ${r.probability ?? ''}  $${r.cost_usd.toFixed(4)}${r.error ? `  err: ${r.error.slice(0, 120)}` : ''}`,
    )
  }
  const bad = result.results.filter((r) => r.status === 'error' || r.status === 'timeout')
  console.log(`\n${result.results.length - bad.length}/${result.results.length} answered-or-abstained; research cached=${result.research.cached} cost=$${result.research.costUsd}; total $${result.total_cost_usd.toFixed(4)}`)
}

main()
