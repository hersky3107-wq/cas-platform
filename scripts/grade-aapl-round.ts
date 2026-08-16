/**
 * DEV ONE-OFF backfill: the latest ranked AAPL round was already RESOLVED
 * (actual_outcome set) before the 40-model re-run overwrote its predictions,
 * so reconcileDuePredictionRounds (which only touches unresolved rounds) never
 * graded the new rows. This mirrors reconciliation.ts gradeChildren() exactly
 * — non-scout, non-null-direction rows get is_correct = (direction ===
 * actualDirection), with the direction derived from the stored outcome string
 * using the same FLAT_THRESHOLD_PCT rule — but scoped to this one round.
 *
 * Run: npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/grade-aapl-round.ts
 */
import { supabaseAdmin } from '../lib/supabase/server'

const FLAT_THRESHOLD_PCT = 0.1

async function main() {
  const { data: round } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id, actual_outcome')
    .eq('instrument', 'AAPL')
    .eq('item_type', 'ranked')
    .order('opened_at', { ascending: false })
    .limit(1)
    .single()
  if (!round?.actual_outcome) throw new Error('round not resolved')

  const m = String(round.actual_outcome).match(/\((-?\d+(?:\.\d+)?)%\)/)
  if (!m) throw new Error(`cannot parse pct from outcome: ${round.actual_outcome}`)
  const pct = Number(m[1])
  const actual = Math.abs(pct) < FLAT_THRESHOLD_PCT ? 'flat' : pct > 0 ? 'up' : 'down'
  console.log(`outcome="${round.actual_outcome}" -> actual direction: ${actual}`)

  const { data: children } = await supabaseAdmin
    .from('model_predictions')
    .select('id, model_id, predicted_direction, league_tier')
    .eq('round_id', round.id)

  let graded = 0
  for (const c of children ?? []) {
    if (c.league_tier === 'scout' || c.predicted_direction == null) continue
    const { error } = await supabaseAdmin
      .from('model_predictions')
      .update({ is_correct: c.predicted_direction === actual })
      .eq('id', c.id)
    if (!error) graded++
  }
  console.log(`graded ${graded} rows`)
}

main()
