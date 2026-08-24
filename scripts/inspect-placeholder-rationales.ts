/**
 * Read-only: list model_predictions rows whose reasoning_snippet is a
 * placeholder, and report whether isPlaceholderRationale catches each.
 *
 * Run: npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/inspect-placeholder-rationales.ts
 */
import { supabaseAdmin } from '../lib/supabase/server'
import { isPlaceholderRationale } from '../lib/league/prediction-parse'

async function main() {
  const { data, error } = await supabaseAdmin
    .from('model_predictions')
    .select('id, model_id, round_id, league_tier, reasoning_snippet, predicted_direction, predicted_value, is_correct')
    .not('reasoning_snippet', 'is', null)

  if (error) throw new Error(`inspect: select failed (${error.message})`)

  const rows = data ?? []
  const flagged = rows.filter((r) => isPlaceholderRationale(typeof r.reasoning_snippet === 'string' ? r.reasoning_snippet : ''))

  console.log(`total non-null reasoning_snippet rows: ${rows.length}`)
  console.log(`flagged as placeholder by isPlaceholderRationale: ${flagged.length}`)
  for (const r of flagged) {
    console.log(
      `  id=${r.id} tier=${r.league_tier} model=${r.model_id} round=${r.round_id} dir=${r.predicted_direction} correct=${r.is_correct} rationale=${JSON.stringify(r.reasoning_snippet)}`,
    )
  }

  // Also count existing translation cache rows for the flagged ids (read-only).
  if (flagged.length > 0) {
    const ids = flagged.map((r) => r.id).filter((id): id is string => typeof id === 'string')
    const { count, error: tErr } = await supabaseAdmin
      .from('prediction_rationale_translations')
      .select('id', { count: 'exact', head: true })
      .in('prediction_id', ids)
    if (tErr) throw new Error(`inspect: translation count failed (${tErr.message})`)
    console.log(`translation cache rows that would be deleted: ${count ?? 0}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
