/**
 * ONE-OFF: wipe all rows from the league prediction ledger
 * (model_predictions + prediction_rounds) so the product starts clean.
 *
 * Deliberate DATA wipe only — does NOT touch schema, roster, orchestrator,
 * or any other table (league_research_packets, credit_logs, users, etc. are
 * untouched).
 *
 * Deletion order respects the FK: model_predictions.round_id -> 
 * prediction_rounds.id, so child rows go first.
 *
 * Run:
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/wipe-league-data.ts
 *
 * Add --confirm to actually delete; without it, this only reports counts
 * (dry run).
 */
import { supabaseAdmin } from '../lib/supabase/server'

async function countRows(table: string): Promise<number> {
  const { count, error } = await supabaseAdmin.from(table).select('*', { count: 'exact', head: true })
  if (error) {
    console.error(`Failed to count ${table}:`, error.message)
    process.exit(1)
  }
  return count ?? 0
}

async function main() {
  const confirm = process.argv.includes('--confirm')

  const predictionsBefore = await countRows('model_predictions')
  const roundsBefore = await countRows('prediction_rounds')

  console.log('=== BEFORE ===')
  console.log(`  model_predictions: ${predictionsBefore}`)
  console.log(`  prediction_rounds: ${roundsBefore}`)

  if (!confirm) {
    console.log('\nDRY RUN — no rows deleted. Re-run with --confirm to actually wipe.')
    return
  }

  console.log('\nDeleting model_predictions (all rows)...')
  const { error: predErr, count: predDeleted } = await supabaseAdmin
    .from('model_predictions')
    .delete({ count: 'exact' })
    .not('round_id', 'is', null)
  if (predErr) {
    console.error('Failed to delete model_predictions:', predErr.message)
    process.exit(1)
  }
  console.log(`  deleted ${predDeleted ?? '?'} rows`)

  console.log('Deleting prediction_rounds (all rows)...')
  const { error: roundErr, count: roundDeleted } = await supabaseAdmin
    .from('prediction_rounds')
    .delete({ count: 'exact' })
    .not('id', 'is', null)
  if (roundErr) {
    console.error('Failed to delete prediction_rounds:', roundErr.message)
    process.exit(1)
  }
  console.log(`  deleted ${roundDeleted ?? '?'} rows`)

  const predictionsAfter = await countRows('model_predictions')
  const roundsAfter = await countRows('prediction_rounds')

  console.log('\n=== AFTER ===')
  console.log(`  model_predictions: ${predictionsAfter}`)
  console.log(`  prediction_rounds: ${roundsAfter}`)
}

main()
