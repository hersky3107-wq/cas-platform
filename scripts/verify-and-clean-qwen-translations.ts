/**
 * Read-only verification + idempotent translation cleanup for the purged
 * qwen3.5-flash placeholder row.
 *
 * Run: npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/verify-and-clean-qwen-translations.ts
 *   add --apply to actually delete translation rows.
 */
import { supabaseAdmin } from '../lib/supabase/server'

const PURGED_ID = 'f58e1b01-201c-40b4-bf83-43bd4a1fa386'
const APPLY = process.argv.includes('--apply')

async function main() {
  // 1. Confirm the rationale is null and direction/is_correct are untouched.
  const { data: row, error: rowErr } = await supabaseAdmin
    .from('model_predictions')
    .select('id, model_id, league_tier, reasoning_snippet, predicted_direction, is_correct')
    .eq('id', PURGED_ID)
    .maybeSingle()
  if (rowErr) throw new Error(`verify: select failed (${rowErr.message})`)
  if (!row) throw new Error(`verify: row ${PURGED_ID} not found`)
  console.log('post-purge row state:')
  console.log(`  id=${row.id} tier=${row.league_tier} model=${row.model_id}`)
  console.log(`  reasoning_snippet=${JSON.stringify(row.reasoning_snippet)} (expected null)`)
  console.log(`  predicted_direction=${row.predicted_direction}`)
  console.log(`  is_correct=${row.is_correct}`)

  // 2. Count translation cache rows for this prediction_id.
  const { count, error: tErr } = await supabaseAdmin
    .from('prediction_rationale_translations')
    .select('id', { count: 'exact', head: true })
    .eq('prediction_id', PURGED_ID)
  if (tErr) {
    console.log(`translation table check error: ${tErr.message}`)
    console.log('(table may not exist in this env — nothing to delete)')
    return
  }
  console.log(`translation cache rows for purged id: ${count ?? 0}`)

  if (!APPLY) {
    console.log('dry run — re-run with --apply to delete those translation rows.')
    return
  }
  if ((count ?? 0) === 0) {
    console.log('nothing to delete — 0 translation rows for this prediction_id')
    return
  }

  const { count: deleted, error: delErr } = await supabaseAdmin
    .from('prediction_rationale_translations')
    .delete({ count: 'exact' })
    .eq('prediction_id', PURGED_ID)
  if (delErr) throw new Error(`delete failed (${delErr.message})`)
  console.log(`deleted ${deleted ?? 0} prediction_rationale_translations rows`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
