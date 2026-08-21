/**
 * Null out stored model_predictions.reasoning_snippet values that the
 * parser now rejects as prompt-schema placeholders (e.g. the literal
 * "<one line, max 200 chars>"). Direction and confidence are left alone.
 *
 * This is NOT a migration. Run it explicitly:
 *
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/purge-placeholder-rationales.ts
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/purge-placeholder-rationales.ts --apply
 *
 * Default is a dry run (prints the count and a sample). `--apply` writes.
 */
import { supabaseAdmin } from '../lib/supabase/server'
import { isPlaceholderRationale } from '../lib/league/prediction-parse'

const APPLY = process.argv.includes('--apply')

async function main() {
  const { data, error } = await supabaseAdmin
    .from('model_predictions')
    .select('id, model_id, round_id, league_tier, reasoning_snippet, predicted_direction, predicted_value')
    .not('reasoning_snippet', 'is', null)

  if (error) throw new Error(`purge-placeholder-rationales: select failed (${error.message})`)

  const hits = (data ?? []).filter((row) => {
    const text = typeof row.reasoning_snippet === 'string' ? row.reasoning_snippet : ''
    return isPlaceholderRationale(text)
  })

  console.log(`placeholder rationales found: ${hits.length}`)
  for (const row of hits.slice(0, 20)) {
    console.log(
      `  ${row.league_tier} ${row.model_id} round=${row.round_id} rationale=${JSON.stringify(row.reasoning_snippet)}`
    )
  }
  if (hits.length > 20) console.log(`  …and ${hits.length - 20} more`)

  if (!APPLY) {
    console.log('dry run — re-run with --apply to null those rationale fields (direction/confidence untouched).')
    return
  }

  if (hits.length === 0) {
    console.log('nothing to apply')
    return
  }

  const ids = hits.map((row) => row.id).filter((id): id is string => typeof id === 'string')
  if (ids.length !== hits.length) {
    throw new Error('purge-placeholder-rationales: some matching rows have no id — refusing to apply')
  }

  const { error: updateError, count } = await supabaseAdmin
    .from('model_predictions')
    .update({ reasoning_snippet: null }, { count: 'exact' })
    .in('id', ids)

  if (updateError) throw new Error(`purge-placeholder-rationales: update failed (${updateError.message})`)
  console.log(`applied: nulled reasoning_snippet on ${count ?? ids.length} rows`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
