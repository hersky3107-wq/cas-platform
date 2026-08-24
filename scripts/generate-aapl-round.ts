/**
 * One-off admin script: create the FIRST (or a fresh) ranked AAPL round and
 * run the full 40-model roster against it — the exact same logic
 * `POST /api/admin/league/generate` uses (this script calls the identical
 * `generatePredictions` orchestrator with a `RoundInput` object, not a
 * `{ roundId }`, so it can create the round itself on an empty DB, unlike
 * `run-league-full-40.ts` which requires a round to already exist).
 *
 * Idempotent on cache_key like the cron opener: if today's `daily|AAPL|1d|<date>`
 * round already exists, this reuses it instead of trying (and failing) to
 * insert a duplicate.
 *
 * Run:
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/generate-aapl-round.ts
 */
import { supabaseAdmin } from '../lib/supabase/server'
import { generatePredictions, type RoundInput } from '../lib/league/orchestrator'
import { LEAGUE_ROSTER } from '../lib/league/roster'

const TIER_ORDER = ['premier', 'challenger', 'world', 'scout'] as const

async function findRoundByCacheKey(cacheKey: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('prediction_rounds').select('id').eq('cache_key', cacheKey).maybeSingle()
  return data?.id ?? null
}

async function main() {
  const utcDay = new Date().toISOString().slice(0, 10)
  const cacheKey = `daily|AAPL|1d|${utcDay}`
  const resolvesAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  const existingId = await findRoundByCacheKey(cacheKey)
  const round: RoundInput = existingId
    ? { roundId: existingId }
    : {
        proposition_text: 'Will Apple (AAPL) close higher 24h from now than its last close?',
        category: 'stock',
        instrument: 'AAPL',
        horizon: '1d',
        resolution_rule: 'NASDAQ regular-session close price vs prior close',
        resolves_at: resolvesAt,
        item_type: 'ranked',
        cache_key: cacheKey,
      }

  if (existingId) {
    console.log(`Reusing existing round for cache_key "${cacheKey}": ${existingId}`)
  } else {
    console.log(`Creating fresh round for cache_key "${cacheKey}" (resolves_at ${resolvesAt})`)
  }

  console.log(`\nRunning full roster (${LEAGUE_ROSTER.length} models: Premier/Challenger/World/Scout)...`)
  const started = Date.now()
  const result = await generatePredictions({ round })
  const elapsed = ((Date.now() - started) / 1000).toFixed(1)

  console.log(`\n== ROUND ==`)
  console.log(`  round_id: ${result.round_id}`)
  console.log(`  created: ${result.created}`)
  console.log(`  data packet: ${result.data_packet.available ? `available (${result.data_packet.symbol} @ ${result.data_packet.latestClose})` : `UNAVAILABLE (${result.data_packet.error})`}`)
  console.log(`  research: available=${result.research.available} cached=${result.research.cached} cost=$${result.research.costUsd.toFixed(4)} queries=${result.research.queries.length}`)
  if (result.research.error) console.log(`  research error: ${result.research.error}`)

  console.log(`\n== PER-MODEL STATUS (${result.results.length}/${LEAGUE_ROSTER.length} attempted, ${elapsed}s) ==`)
  const sorted = [...result.results].sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier))
  for (const r of sorted) {
    const status =
      r.status === 'ok' ? 'answered ' : r.status === 'abstain' ? 'abstained' : r.status === 'timeout' ? 'TIMEOUT  ' : 'ERROR    '
    const dir = r.direction ? `${r.direction} ${r.probability ?? '?'}%` : '—'
    console.log(
      `  ${r.tier.padEnd(10)} ${r.model_id.padEnd(28)} ${status} ${dir.padEnd(12)} $${r.cost_usd.toFixed(4)} (${r.cost_source})${r.error ? `  err: ${r.error.slice(0, 120)}` : ''}`
    )
  }

  console.log(`\n== PER-TIER BREAKDOWN ==`)
  for (const tier of TIER_ORDER) {
    const tierResults = result.results.filter((r) => r.tier === tier)
    const answered = tierResults.filter((r) => r.status === 'ok').length
    const abstained = tierResults.filter((r) => r.status === 'abstain').length
    const errored = tierResults.filter((r) => r.status === 'error' || r.status === 'timeout').length
    console.log(`  ${tier.padEnd(11)} answered=${answered} abstained=${abstained} errored=${errored} (of ${tierResults.length})`)
  }

  const scoutResults = result.results.filter((r) => r.tier === 'scout')
  const scoutDirectional = scoutResults.filter((r) => r.direction === 'up' || r.direction === 'down' || r.direction === 'flat')
  console.log(`\n== SCOUT CHECK ==`)
  console.log(`  ${scoutDirectional.length}/${scoutResults.length} scout models returned a real direction (not abstain/error)`)
  for (const r of scoutResults) {
    console.log(`    ${r.model_id.padEnd(28)} direction=${r.direction ?? 'null'} probability=${r.probability ?? 'null'} status=${r.status}`)
  }

  const probs = result.results.filter((r) => r.status === 'ok' && r.probability != null).map((r) => r.probability as number)
  const uniqueProbs = new Set(probs)
  const minP = probs.length ? Math.min(...probs) : null
  const maxP = probs.length ? Math.max(...probs) : null
  console.log(`\n== CONFIDENCE VARIANCE ==`)
  console.log(`  ${probs.length} answered models with a probability; ${uniqueProbs.size} distinct value(s); range ${minP}%–${maxP}%`)
  if (uniqueProbs.size <= 2 && probs.length > 5) {
    console.log(`  WARNING: confidences look clustered/flat — check for a hardcoded fallback probability.`)
  } else {
    console.log(`  Confidences vary across models (not all ~55%).`)
  }

  const counts = { answered: 0, abstained: 0, errored: 0, timeout: 0 }
  for (const r of result.results) {
    if (r.status === 'ok') counts.answered++
    else if (r.status === 'abstain') counts.abstained++
    else if (r.status === 'timeout') counts.timeout++
    else counts.errored++
  }
  console.log(`\n== OVERALL SUMMARY ==`)
  console.log(`  answered: ${counts.answered}  abstained: ${counts.abstained}  errored: ${counts.errored}  timeout: ${counts.timeout}`)
  console.log(`  total cost: $${result.total_cost_usd.toFixed(4)} (cap $${result.cost_cap_usd}, capped=${result.capped})`)

  const { data: roundRow } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id, instrument, item_type, category, opened_at, resolves_at, cache_key')
    .eq('id', result.round_id)
    .single()
  const { count: rowCount } = await supabaseAdmin
    .from('model_predictions')
    .select('model_id', { count: 'exact', head: true })
    .eq('round_id', result.round_id)

  console.log(`\n== DB VERIFICATION ==`)
  console.log(`  prediction_rounds row: ${roundRow ? JSON.stringify(roundRow) : 'NOT FOUND'}`)
  console.log(`  model_predictions rows persisted: ${rowCount}`)
  if (roundRow && roundRow.instrument === 'AAPL' && roundRow.item_type === 'ranked' && (rowCount ?? 0) > 0) {
    console.log(`\n✅ Round is in the DB and ranked for AAPL — /league → Stocks → AAPL should now show the division board.`)
  } else {
    console.log(`\n❌ Something is off — round or predictions did not persist as expected. Check the log above.`)
  }
}

main().catch((e) => {
  console.error('Script failed:', e instanceof Error ? e.stack ?? e.message : e)
  process.exit(1)
})
