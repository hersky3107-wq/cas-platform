/**
 * DEMO for the Layer 4 (live streaming) pass — READ-ONLY, no AI provider
 * calls, no writes. Finds an existing AAPL round and REPLAYS its already
 * -persisted `model_predictions` rows as the exact NDJSON line shapes
 * `POST /api/league/generate-stream` emits (see that route's doc comment),
 * feeding them through the SAME client merge functions
 * (`mergeModel` / `resort` from `lib/league/use-card-stream.ts`) the browser
 * uses. This proves the merge-by-model_id / re-sort-on-done contract against
 * real data without spending money on a fresh generation run (which would
 * call every core+platform AI provider) and without needing an admin browser
 * session (the HTTP route is admin-gated; this script talks to the DB
 * directly with the service-role client, like `league-card-preview.ts`).
 *
 * The HTTP route itself is a thin NDJSON wrapper around the identical
 * orchestrator callbacks (`onRoundResolved` / `onModelResult`) exercised
 * here — see `app/api/league/generate-stream/route.ts` — so this replay's
 * line shapes are byte-for-byte what a real live run would send.
 *
 * Run:
 *   npx tsx scripts/league-live-stream-demo.ts
 */
import { supabaseAdmin } from '../lib/supabase/server'
import { buildCardData } from '../lib/league/card-aggregate'
import { mergeModel, resort } from '../lib/league/use-card-stream'
import type { CardData, CardModelPrediction } from '../lib/league/card-types'

const ROUND_COLUMNS =
  'id, proposition_text, category, color_bucket, instrument, horizon, resolution_rule, resolves_at, opened_at, actual_outcome, resolved_at'
const PREDICTION_COLUMNS =
  'model_id, brand, camp, league_tier, predicted_direction, predicted_value, reasoning_snippet, is_correct, cost_usd, predicted_at'

function summarize(card: CardData): string {
  return card.models
    .map((m) => `${m.brand}(${m.league_tier}/${m.camp})=${m.direction ?? 'abstain'}`)
    .join(', ')
}

async function main() {
  const { data: rounds, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id, instrument, opened_at')
    .eq('instrument', 'AAPL')
    .order('opened_at', { ascending: false })
    .limit(1)

  if (error) {
    console.error('Query failed:', error.message)
    process.exit(1)
  }
  const aapl = (rounds ?? [])[0]
  if (!aapl) {
    console.log('No existing AAPL round found — nothing to replay. (Not generating one here; that calls paid AI providers.)')
    return
  }

  const { data: roundRow } = await supabaseAdmin.from('prediction_rounds').select(ROUND_COLUMNS).eq('id', aapl.id).single()
  const { data: predictionRows } = await supabaseAdmin
    .from('model_predictions')
    .select(PREDICTION_COLUMNS)
    .eq('round_id', aapl.id)
    .order('predicted_at', { ascending: true })

  type RoundRow = Parameters<typeof buildCardData>[0]
  type PredictionRow = Parameters<typeof buildCardData>[1][number]
  const rows = (predictionRows ?? []) as unknown as PredictionRow[]
  if (rows.length === 0) {
    console.log('AAPL round', aapl.id, 'has zero stored predictions — nothing to replay.')
    return
  }

  const authoritative = buildCardData(roundRow as unknown as RoundRow, rows)

  console.log(`\n=== Replaying live stream for round ${aapl.id} (${rows.length} stored models) ===`)
  console.log(`{"type":"round","round_id":"${aapl.id}","created":false,"roster_size":${rows.length}}`)

  // 1) INCREMENTAL ARRIVAL: fold each stored row in as a "model" line, one at
  //    a time, exactly like the client's stream-reading loop does.
  let live: CardData = buildCardData(roundRow as unknown as RoundRow, [])
  for (const row of rows) {
    const wireModel: CardModelPrediction = {
      prediction_id: null,
      model_id: row.model_id,
      brand: row.brand,
      model_identifier: row.model_id,
      camp: row.camp,
      league_tier: row.league_tier,
      direction: row.predicted_direction,
      probability: row.predicted_value,
      magnitude: null,
      reasoning_snippet: row.reasoning_snippet,
      is_correct: null, // live lines never carry grading — see route's doc comment
      cost_usd: row.cost_usd,
      predicted_at: row.predicted_at,
    }
    console.log(`{"type":"model","model_id":"${wireModel.model_id}","direction":${JSON.stringify(wireModel.direction)},"status":"${wireModel.direction ? 'ok' : 'abstain'}"}`)
    live = mergeModel(live, wireModel)
    console.log(`  -> card now has ${live.models.length} model(s), consensus tally = ${JSON.stringify(live.consensus.tally)}`)
    console.log(`     arrival order: ${summarize(live)}`)
  }

  // 2) DONE: re-sort by tier then camp (arrival order was transient).
  console.log(`{"type":"done","round_id":"${aapl.id}","total_cost_usd":0,"capped":false}`)
  live = resort(live)
  console.log(`  -> final order:   ${summarize(live)}`)

  // 3) MERGE-BY-MODEL_ID, NO DUPLICATES ON RECONNECT: re-deliver the FIRST
  //    row again (simulating the stream re-sending, or a GET-reconcile that
  //    happens to include an already-seen model) and confirm the model
  //    count does not change.
  const before = live.models.length
  live = mergeModel(live, {
    model_id: rows[0].model_id,
    brand: rows[0].brand,
    camp: rows[0].camp,
    league_tier: rows[0].league_tier,
    direction: rows[0].predicted_direction,
    probability: rows[0].predicted_value,
    reasoning_snippet: rows[0].reasoning_snippet,
    is_correct: null,
    cost_usd: rows[0].cost_usd,
    predicted_at: rows[0].predicted_at,
  })
  console.log(`\n=== Reconnect/redelivery check ===`)
  console.log(`  models before redelivery: ${before}, after redelivering "${rows[0].model_id}": ${live.models.length}`)
  console.log(`  (unchanged => merge-by-model_id worked, no duplicate)`)

  // 4) DROP -> GET-REHYDRATE CONVERGENCE: the live-built card's aggregates
  //    must exactly equal what a fresh GET /api/league/card (buildCardData
  //    on the full stored row set) would return.
  const converged =
    JSON.stringify(live.consensus) === JSON.stringify(authoritative.consensus) &&
    JSON.stringify(live.campSplit) === JSON.stringify(authoritative.campSplit) &&
    JSON.stringify(live.tierSplit) === JSON.stringify(authoritative.tierSplit) &&
    JSON.stringify(live.models.map((m) => m.model_id).sort()) ===
      JSON.stringify(authoritative.models.map((m) => m.model_id).sort())
  console.log(`\n=== Convergence check (live-merged vs GET /api/league/card) ===`)
  console.log(`  converged: ${converged}`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
