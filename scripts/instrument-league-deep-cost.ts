/**
 * Instruments the REAL upstream USD cost of one open-ended and one pro/con
 * league deep-analysis run against the latest ranked AAPL round.
 *
 * Does not change credit prices. Admin/service-role path — no user credits.
 *
 * Run:
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/instrument-league-deep-cost.ts
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/instrument-league-deep-cost.ts --open-only
 */
import { supabaseAdmin } from '../lib/supabase/server'
import { buildLeagueDeepContext } from '../lib/league/deep-context'
import { runDeepOpen } from '../lib/league/deep-open-run'
import { runDeepDebate } from '../lib/league/deep-debate-run'
import { combinedCostUsd, withCostSpan } from '../lib/ai/cost-span'

async function latestAaplRoundId(): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id')
    .eq('instrument', 'AAPL')
    .eq('item_type', 'ranked')
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) throw new Error(`No ranked AAPL round: ${error?.message ?? 'empty'}`)
  return data.id as string
}

async function main() {
  const openOnly = process.argv.includes('--open-only')
  const debateOnly = process.argv.includes('--debate-only')
  const roundId = await latestAaplRoundId()
  console.log(`Round: ${roundId}`)

  const ctx = await buildLeagueDeepContext(roundId, 'en')
  if (!ctx) throw new Error('Failed to build league deep context')
  console.log(`Instrument: ${ctx.instrument}`)
  console.log(`Proposition: ${ctx.proposition}`)

  if (!debateOnly) {
    console.log('\n== OPEN-ENDED ==')
    const started = Date.now()
    const span = await withCostSpan(() => runDeepOpen(ctx))
    const elapsed = ((Date.now() - started) / 1000).toFixed(1)
    console.log(`  ok=${span.result.ok}  ${elapsed}s  calls=${span.calls}`)
    console.log(`  billed_usd=$${span.billedUsd.toFixed(4)}  estimated_usd=$${span.estimatedUsd.toFixed(4)}`)
    console.log(`  combined_usd=$${combinedCostUsd(span).toFixed(4)}`)
    if (span.result.error) console.log(`  error: ${span.result.error}`)
  }

  if (!openOnly) {
    console.log('\n== PRO/CON DEBATE ==')
    const started = Date.now()
    const span = await withCostSpan(() => runDeepDebate(ctx))
    const elapsed = ((Date.now() - started) / 1000).toFixed(1)
    console.log(`  ok=${span.result.ok}  ${elapsed}s  calls=${span.calls}`)
    console.log(`  billed_usd=$${span.billedUsd.toFixed(4)}  estimated_usd=$${span.estimatedUsd.toFixed(4)}`)
    console.log(`  combined_usd=$${combinedCostUsd(span).toFixed(4)}`)
    if (span.result.error) console.log(`  error: ${span.result.error}`)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : e)
  process.exit(1)
})
