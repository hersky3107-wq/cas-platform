/**
 * ONE real AAPL 1d closed-book packet validation round (on_demand, unique
 * cache_key so it never becomes the public ranked card).
 *
 * Run: npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/_validate-closed-book-round.ts
 */
import { supabaseAdmin } from '../lib/supabase/server'
import { generatePredictions } from '../lib/league/orchestrator'
import { buildCatalogRankedRoundInput } from '../lib/league/catalog'
import { LEAGUE_ROSTER } from '../lib/league/roster'

async function main() {
  // Wait so Twelve Data minute budget recovers after the print script.
  console.log('Waiting 65s for Twelve Data credit reset...')
  await new Promise((r) => setTimeout(r, 65_000))

  const seed = buildCatalogRankedRoundInput('AAPL', '1d')
  if (!seed) throw new Error('AAPL not in catalog')

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const roundInput = {
    ...seed,
    item_type: 'on_demand' as const,
    cache_key: `validate|AAPL|1d|${stamp}`,
    proposition_text: seed.proposition_text,
  }

  console.log('Creating on_demand validation round…')
  console.log(JSON.stringify({ instrument: roundInput.instrument, horizon: roundInput.horizon, cache_key: roundInput.cache_key }))

  const started = Date.now()
  const result = await generatePredictions({
    round: roundInput,
    // Full roster — 40 models (34 closed-book + 6 scout)
  })
  const elapsed = ((Date.now() - started) / 1000).toFixed(1)

  const { data: row, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id, closed_book_packet_cache_key, closed_book_packet_text, anchor_price, horizon, item_type')
    .eq('id', result.round_id)
    .single()
  if (error || !row) throw new Error(`failed to read round: ${error?.message}`)

  const persisted = row.closed_book_packet_text as string | null
  console.log('\n===== PERSISTED closed_book_packet_text — START =====')
  console.log(persisted ?? '(NULL — WRITE FAILED)')
  console.log('===== PERSISTED closed_book_packet_text — END =====')

  console.log('\n===== COST / COUNTS =====')
  console.log(
    JSON.stringify(
      {
        round_id: result.round_id,
        created: result.created,
        elapsed_s: elapsed,
        total_cost_usd: result.total_cost_usd,
        research_cost_usd: result.research.costUsd,
        research_cached: result.research.cached,
        data_packet: result.data_packet,
        capped: result.capped,
        roster_size: LEAGUE_ROSTER.length,
        predictions: result.results.length,
        answered: result.results.filter((r) => r.status === 'ok').length,
        abstained: result.results.filter((r) => r.status === 'abstain').length,
        errored: result.results.filter((r) => r.status === 'error' || r.status === 'timeout').length,
        snapshot_chars: persisted?.length ?? 0,
        snapshot_cache_key: row.closed_book_packet_cache_key,
        anchor_price: row.anchor_price,
      },
      null,
      2,
    ),
  )

  console.log('\n===== 40 PREDICTIONS =====')
  for (const r of result.results) {
    console.log(
      `${r.tier.padEnd(11)} ${r.model_id.padEnd(28)} ${r.status.padEnd(8)} dir=${String(r.direction ?? '—').padEnd(5)} p=${String(r.probability ?? '—').padEnd(4)} $${r.cost_usd.toFixed(4)}`,
    )
  }

  // Byte-identity: re-read is the source of truth for "what models got".
  // The assemble path is deterministic given the same inputs; we assert the
  // snapshot is non-null and that a second DB read returns identical bytes.
  const { data: again } = await supabaseAdmin
    .from('prediction_rounds')
    .select('closed_book_packet_text')
    .eq('id', result.round_id)
    .single()
  const identical = again?.closed_book_packet_text === persisted && !!persisted
  console.log('\n===== SNAPSHOT BYTE-IDENTITY =====')
  console.log(JSON.stringify({ persisted_non_null: !!persisted, second_read_identical: identical }))
  if (!identical) process.exit(2)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
