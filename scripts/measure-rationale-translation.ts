/**
 * One-shot cost/latency measurement: translate every non-null rationale on
 * the AAPL round into Korean. Does NOT wire the card — run this first.
 *
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/measure-rationale-translation.ts
 */
import { supabaseAdmin } from '../lib/supabase/server'
import { translateRoundRationales } from '../lib/league/rationale-i18n'

const ROUND = 'fffc1716-cd3d-45f2-883f-1242a373febc'

async function main() {
  const { data, error } = await supabaseAdmin
    .from('model_predictions')
    .select('id, model_id, reasoning_snippet')
    .eq('round_id', ROUND)
  if (error) throw new Error(error.message)

  const items = (data ?? [])
    .filter((row) => typeof row.reasoning_snippet === 'string' && row.reasoning_snippet.trim())
    .map((row) => ({ predictionId: row.id as string, text: (row.reasoning_snippet as string).trim() }))

  console.log(`source rows: ${data?.length ?? 0}, with rationale: ${items.length}`)
  const result = await translateRoundRationales(items, 'ko')
  console.log(JSON.stringify(result, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
