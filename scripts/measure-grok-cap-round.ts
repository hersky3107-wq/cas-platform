/**
 * One live AAPL 1d measurement after the xAI ledger fix + max_turns: 3 cap.
 *
 * Fresh on_demand round (no daily cache_key) so it does not collide with
 * today's ranked bucket. Prints grok billed telemetry, all 6 scouts, actual
 * vs the old $3/$15 estimate, and a quality compare vs round 71aedfd3.
 *
 * Run:
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/measure-grok-cap-round.ts
 */
import { buildCatalogRankedRoundInput } from '../lib/league/catalog'
import { generatePredictions } from '../lib/league/orchestrator'
import { computeLegacyGrokListPriceUsd, lookupRosterEntry } from '../lib/league/roster'
import { supabaseAdmin } from '../lib/supabase/server'

const PREV_ROUND_PREFIX = '71aedfd3'
const SCOUTS = [
  'gpt-5-search-api',
  'gemini-3.6-flash-grounded',
  'grok-4.6-livesearch',
  'claude-sonnet-5-websearch',
  'sonar-reasoning-pro',
  'youcom-research',
] as const

const CREDIT_USD = 0.05 // Light $10 / 200 credits
const REV_30 = 30 * CREDIT_USD
const REV_40 = 40 * CREDIT_USD

function money(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  return `$${n.toFixed(4)}`
}

async function fetchPrevGrok() {
  const { data: round } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id')
    .like('id', `${PREV_ROUND_PREFIX}%`)
    .maybeSingle()
  if (!round?.id) return null
  const { data } = await supabaseAdmin
    .from('model_predictions')
    .select(
      'round_id, model_id, prompt_tokens, completion_tokens, cost_usd, estimated_cost_usd, server_side_tools_used, reasoning_snippet, reasoning_text, predicted_direction, predicted_value, predicted_magnitude_pct',
    )
    .eq('round_id', round.id)
    .eq('model_id', 'grok-4.6-livesearch')
    .maybeSingle()
  return data
}

async function main() {
  const caller = lookupRosterEntry('grok-4.6-livesearch')?.caller
  console.log('== PREFLIGHT ==')
  console.log(`  grok caller maxTurns: ${caller && caller.kind === 'core' ? caller.maxTurns : 'MISSING'}`)
  console.log(`  domain filters: none (turn cap only)`)

  const prev = await fetchPrevGrok()
  if (!prev) {
    console.log(`  previous grok row ${PREV_ROUND_PREFIX}…: not found — will skip quality compare`)
  } else {
    console.log(
      `  previous grok ${prev.round_id}: tokens ${prev.prompt_tokens}/${prev.completion_tokens} ledger ${money(prev.cost_usd)}`,
    )
  }

  const base = buildCatalogRankedRoundInput('AAPL', '1d')
  if (!base) throw new Error('AAPL not in catalog')
  const roundInput = { ...base, item_type: 'on_demand' as const, cache_key: null }
  console.log(`\nProposition: ${roundInput.proposition_text}`)
  console.log(`resolves_at: ${roundInput.resolves_at}`)

  const started = Date.now()
  const result = await generatePredictions({ round: roundInput })
  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`\nRound created: ${result.round_id} (${elapsed}s)`)
  console.log(
    `research: tier=${result.research.tier} (${result.research.tierSignal}) cached=${result.research.cached} cost=${money(result.research.costUsd)}`,
  )
  console.log(`capped=${result.capped} cap=${money(result.cost_cap_usd)}`)

  const byId = new Map(result.results.map((r) => [r.model_id, r]))
  const grok = byId.get('grok-4.6-livesearch')
  if (!grok) throw new Error('grok-4.6-livesearch missing from results')

  console.log('\n== GROK TELEMETRY ==')
  console.log(`  status: ${grok.status}${grok.error ? `  err: ${grok.error.slice(0, 120)}` : ''}`)
  console.log(`  prompt_tokens: ${grok.prompt_tokens ?? '—'}`)
  console.log(`  completion_tokens: ${grok.completion_tokens ?? '—'}`)
  console.log(`  num_server_side_tools_used: ${grok.server_side_tools_used ?? '—'}`)
  console.log(`  cost_in_usd_ticks: ${grok.cost_in_usd_ticks ?? '—'}`)
  console.log(`  cost_usd (billed if reported): ${money(grok.cost_usd)}  source=${grok.cost_source}`)
  console.log(`  estimated_cost_usd (new $2/$6 or $4/$12): ${money(grok.estimated_cost_usd)}`)
  console.log(
    `  old $3/$15 estimate: ${money(computeLegacyGrokListPriceUsd(grok.prompt_tokens, grok.completion_tokens))}`,
  )

  console.log('\n== SCOUT SIDE-BY-SIDE ==')
  console.log(
    [
      'model_id'.padEnd(28),
      'src'.padEnd(10),
      'prompt'.padStart(8),
      'compl'.padStart(7),
      'tools'.padStart(6),
      'ticks'.padStart(14),
      'billed'.padStart(10),
      'estimate'.padStart(10),
    ].join(' '),
  )
  for (const id of SCOUTS) {
    const r = byId.get(id)
    if (!r) {
      console.log(`  ${id.padEnd(28)} MISSING`)
      continue
    }
    console.log(
      [
        id.padEnd(28),
        r.cost_source.padEnd(10),
        String(r.prompt_tokens ?? '—').padStart(8),
        String(r.completion_tokens ?? '—').padStart(7),
        String(r.server_side_tools_used ?? '—').padStart(6),
        String(r.cost_in_usd_ticks ?? '—').padStart(14),
        money(r.cost_usd).padStart(10),
        money(r.estimated_cost_usd).padStart(10),
      ].join(' '),
    )
  }

  let oldEstimateRound = 0
  let newEstimateRound = 0
  let billedRound = 0
  for (const r of result.results) {
    billedRound += r.cost_usd
    newEstimateRound += r.estimated_cost_usd
    if (r.model_id === 'grok-4.6-livesearch') {
      oldEstimateRound += computeLegacyGrokListPriceUsd(r.prompt_tokens, r.completion_tokens)
    } else {
      oldEstimateRound += r.estimated_cost_usd
    }
  }
  const research = result.research.costUsd
  console.log('\n== ROUND COST ==')
  console.log(`  models billed/ledger (cost_usd sum): ${money(billedRound)}`)
  console.log(`  models new estimate (estimated_cost_usd): ${money(newEstimateRound)}`)
  console.log(`  models OLD estimate (grok at $3/$15, others unchanged): ${money(oldEstimateRound)}`)
  console.log(`  research packet: ${money(research)}`)
  console.log(`  total actual (models + research): ${money(billedRound + research)}`)
  console.log(`  total old-method (models old + research): ${money(oldEstimateRound + research)}`)
  console.log(`  orchestrator total_cost_usd: ${money(result.total_cost_usd)}`)

  console.log('\n== GROK QUALITY vs PREVIOUS (uncapped) ==')
  console.log(
    `  this: ${grok.direction ?? '—'} ${grok.probability ?? '?'}% mag=${grok.magnitude ?? '—'}`,
  )
  if (prev) {
    console.log(
      `  prev: ${(prev.predicted_direction as string | null) ?? '—'} ${prev.predicted_value ?? '?'}% mag=${prev.predicted_magnitude_pct ?? '—'}`,
    )
  }
  console.log('\n-- this rationale --')
  console.log(grok.reasoning_snippet ?? '(none)')
  console.log('\n-- this reasoning_text --')
  console.log(grok.reasoning_text ?? '(none)')
  if (prev) {
    console.log('\n-- prev rationale --')
    console.log((prev.reasoning_snippet as string | null) ?? '(none)')
    console.log('\n-- prev reasoning_text --')
    console.log((prev.reasoning_text as string | null) ?? '(none)')
  }

  const cogs = billedRound + research
  const margin30 = REV_30 - cogs
  const margin40 = REV_40 - cogs
  console.log('\n== MARGIN (this round, real ledger) ==')
  console.log(`  COGS: ${money(cogs)}`)
  console.log(`  30 credits ($${REV_30.toFixed(2)}): margin ${money(margin30)}  (${((margin30 / REV_30) * 100).toFixed(1)}%)`)
  console.log(`  40 credits ($${REV_40.toFixed(2)}): margin ${money(margin40)}  (${((margin40 / REV_40) * 100).toFixed(1)}%)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
