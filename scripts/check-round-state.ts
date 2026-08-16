/**
 * Read-only: dump the current model_predictions state for the latest ranked
 * AAPL round (row count, per-tier direction tally, grading status).
 *
 * Run: npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/check-round-state.ts
 */
import { supabaseAdmin } from '../lib/supabase/server'

async function main() {
  const { data: round } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id, actual_outcome, resolved_at')
    .eq('instrument', 'AAPL')
    .eq('item_type', 'ranked')
    .order('opened_at', { ascending: false })
    .limit(1)
    .single()
  if (!round) throw new Error('no AAPL round')
  console.log('round:', round.id, ' outcome:', round.actual_outcome, ' resolved_at:', round.resolved_at)

  const { data: rows } = await supabaseAdmin
    .from('model_predictions')
    .select('model_id, league_tier, predicted_direction, predicted_value, is_correct')
    .eq('round_id', round.id)
    .order('league_tier')
    .order('model_id')
  console.log('rows:', rows?.length)
  for (const r of rows ?? []) {
    console.log(
      `  ${r.league_tier.padEnd(10)} ${r.model_id.padEnd(28)} dir=${(r.predicted_direction ?? '—').padEnd(5)} conf=${r.predicted_value ?? '—'} correct=${r.is_correct ?? '—'}`,
    )
  }
}

main()
