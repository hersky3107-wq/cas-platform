/**
 * Live measured round: packet v2 + the mandatory visible reasoning block.
 *
 * Creates ONE fresh AAPL 1d round (item_type 'on_demand' — provenance only;
 * it enters the track record irrevocably once graded, per league policy),
 * runs the full 40-model roster with the new CLOSED_BOOK_SYSTEM_PROMPT, then
 * prints:
 *   - full verbatim reasoning from 5 showcase models across tiers
 *   - the probability distribution (does it still cluster at 53-56%?)
 *   - the direction split
 *   - total measured cost vs the $0.6517 v1 baseline, plus the pre-run
 *     static estimate of the reasoning surcharge at 34x
 *   - a DB readback proving reasoning_text persisted
 *
 * Run:
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/run-reasoning-live-round.ts
 */
import { buildCatalogRankedRoundInput } from '../lib/league/catalog'
import { generatePredictions } from '../lib/league/orchestrator'
import { LEAGUE_ROSTER } from '../lib/league/roster'
import { supabaseAdmin } from '../lib/supabase/server'

/** v1 JSON-only full-40 baseline measured 2026-08-16. */
const V1_BASELINE_USD = 0.6517
/** Prompt asks for ~150 words → ~250 output tokens including labels. */
const EST_REASONING_TOKENS = 250

const SHOWCASE = [
  'gpt-5.6-sol', // premier, hidden reasoner (OpenAI)
  'deepseek-v4-pro', // premier, heaviest hidden reasoner (7500 budget)
  'claude-sonnet-5', // challenger, NO hidden reasoning — visible CoT is all it gets
  'hcx-007', // world, Korean, non-reasoning
  'phi-4', // world, smallest US non-reasoner
]

function printReasoningSurchargeEstimate(): void {
  const closedBook = LEAGUE_ROSTER.filter((e) => e.league_tier !== 'scout')
  const outSumPerM = closedBook.reduce((s, e) => s + e.price.outputPerMTokens, 0)
  const delta = (EST_REASONING_TOKENS * outSumPerM) / 1_000_000
  console.log('== COST ESTIMATE (static, before run) ==')
  console.log(`  closed-book models: ${closedBook.length}  Σ output price: $${outSumPerM.toFixed(2)}/M tokens`)
  console.log(`  estimated visible-reasoning surcharge @ ~${EST_REASONING_TOKENS} tokens/model: +$${delta.toFixed(4)}/round`)
  console.log(`  v1 JSON-only baseline: $${V1_BASELINE_USD}  →  estimated with reasoning: ~$${(V1_BASELINE_USD + delta).toFixed(4)} (+ packet v2 research delta, tier-dependent)`)
}

async function main() {
  printReasoningSurchargeEstimate()

  const base = buildCatalogRankedRoundInput('AAPL', '1d')
  if (!base) throw new Error('AAPL not in catalog')
  // on_demand provenance, no cache_key: this is a deliberate fresh measurement
  // round, not the daily ranked bucket.
  const roundInput = { ...base, item_type: 'on_demand' as const, cache_key: null }
  console.log(`\nProposition: ${roundInput.proposition_text}`)
  console.log(`resolves_at: ${roundInput.resolves_at}`)

  const started = Date.now()
  const result = await generatePredictions({ round: roundInput })
  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`\nRound created: ${result.round_id} (${elapsed}s)`)
  console.log(`research: tier=${result.research.tier} (${result.research.tierSignal}) cached=${result.research.cached} cost=$${result.research.costUsd.toFixed(4)}`)
  console.log(`related credits spent: ${result.related_credits_spent}`)

  // ── Per-model table ────────────────────────────────────────────────────
  const tierOrder = ['premier', 'challenger', 'world', 'scout']
  const sorted = [...result.results].sort((a, b) => tierOrder.indexOf(a.tier) - tierOrder.indexOf(b.tier))
  console.log(`\n== PER-MODEL (${result.results.length} attempted) ==`)
  for (const r of sorted) {
    const status = r.status === 'ok' ? 'ok      ' : r.status.padEnd(8)
    const dir = r.direction ? `${r.direction.padEnd(4)} ${String(r.probability ?? '?').padStart(3)}%` : '—       '
    const mag = r.magnitude != null ? `${r.magnitude > 0 ? '+' : ''}${r.magnitude}%` : ''
    const rlen = r.reasoning_text ? `${r.reasoning_text.length}ch reasoning` : 'no reasoning'
    console.log(`  ${r.tier.padEnd(10)} ${r.model_id.padEnd(26)} ${status} ${dir} ${mag.padEnd(7)} $${r.cost_usd.toFixed(4)}  ${rlen}${r.error ? `  err: ${r.error.slice(0, 80)}` : ''}`)
  }

  // ── Showcase: full reasoning verbatim from 5 models across tiers ──────
  console.log('\n== SHOWCASE REASONING (verbatim) ==')
  const byId = new Map(result.results.map((r) => [r.model_id, r]))
  const shown = new Set<string>()
  for (const id of SHOWCASE) {
    const r = byId.get(id)
    if (r?.reasoning_text) {
      shown.add(id)
      console.log(`\n───── ${id} (${r.tier}) → ${r.direction} ${r.probability}% ${r.magnitude != null ? `${r.magnitude}%` : ''} ─────`)
      console.log(r.reasoning_text)
    } else {
      console.log(`\n───── ${id}: NO REASONING (status=${r?.status ?? 'missing'}${r?.error ? `, ${r.error.slice(0, 60)}` : ''}) — substituting below ─────`)
    }
  }
  // Substitute for any showcase model that failed, keeping tier diversity.
  const missing = SHOWCASE.length - shown.size
  if (missing > 0) {
    const subs = sorted.filter((r) => r.reasoning_text && !shown.has(r.model_id)).slice(0, missing)
    for (const r of subs) {
      console.log(`\n───── [substitute] ${r.model_id} (${r.tier}) → ${r.direction} ${r.probability}% ─────`)
      console.log(r.reasoning_text)
    }
  }

  // ── Probability distribution ──────────────────────────────────────────
  const answered = result.results.filter((r) => r.status === 'ok' && r.probability != null && r.tier !== 'scout')
  const probs = answered.map((r) => r.probability!)
  const buckets: [string, (p: number) => boolean][] = [
    ['≤50', (p) => p <= 50],
    ['51-52', (p) => p >= 51 && p <= 52],
    ['53-56', (p) => p >= 53 && p <= 56],
    ['57-60', (p) => p >= 57 && p <= 60],
    ['61-70', (p) => p >= 61 && p <= 70],
    ['71-80', (p) => p >= 71 && p <= 80],
    ['>80', (p) => p > 80],
  ]
  console.log('\n== PROBABILITY DISTRIBUTION (closed-book, answered) ==')
  for (const [label, test] of buckets) {
    const n = probs.filter(test).length
    console.log(`  ${label.padEnd(6)} ${'█'.repeat(n)} ${n}`)
  }
  const mean = probs.reduce((s, p) => s + p, 0) / Math.max(1, probs.length)
  const sd = Math.sqrt(probs.reduce((s, p) => s + (p - mean) ** 2, 0) / Math.max(1, probs.length))
  const in5356 = probs.filter((p) => p >= 53 && p <= 56).length
  console.log(`  n=${probs.length} mean=${mean.toFixed(1)} sd=${sd.toFixed(1)} min=${Math.min(...probs)} max=${Math.max(...probs)}  |  in 53-56: ${in5356}/${probs.length} (${((100 * in5356) / Math.max(1, probs.length)).toFixed(0)}%)`)

  // ── Direction split ────────────────────────────────────────────────────
  const all = result.results.filter((r) => r.status === 'ok' && r.direction)
  const up = all.filter((r) => r.direction === 'up').length
  const cbUp = answered.filter((r) => r.direction === 'up').length
  console.log(`\n== DIRECTION SPLIT ==`)
  console.log(`  all answered:  ${up} up / ${all.length - up} down (n=${all.length})`)
  console.log(`  closed-book:   ${cbUp} up / ${answered.length - cbUp} down (n=${answered.length})`)

  // ── Cost ───────────────────────────────────────────────────────────────
  console.log(`\n== COST (measured) ==`)
  console.log(`  total: $${result.total_cost_usd.toFixed(4)} (cap $${result.cost_cap_usd}, capped=${result.capped})`)
  console.log(`  vs v1 JSON-only baseline $${V1_BASELINE_USD}: ${result.total_cost_usd >= V1_BASELINE_USD ? '+' : ''}$${(result.total_cost_usd - V1_BASELINE_USD).toFixed(4)}`)

  // ── Persistence proof ──────────────────────────────────────────────────
  const { data: rows, error } = await supabaseAdmin
    .from('model_predictions')
    .select('model_id, reasoning_text, reasoning_snippet')
    .eq('round_id', result.round_id)
  if (error) throw new Error(`readback failed: ${error.message}`)
  const withReasoning = (rows ?? []).filter((r) => typeof r.reasoning_text === 'string' && r.reasoning_text.length > 0)
  const withSnippet = (rows ?? []).filter((r) => typeof r.reasoning_snippet === 'string' && r.reasoning_snippet.length > 0)
  console.log(`\n== PERSISTENCE (DB readback) ==`)
  console.log(`  rows: ${rows?.length ?? 0}  reasoning_text non-null: ${withReasoning.length}  reasoning_snippet non-null: ${withSnippet.length}`)
  const sample = withReasoning.find((r) => r.model_id === SHOWCASE[0]) ?? withReasoning[0]
  if (sample) console.log(`  sample (${sample.model_id}): ${sample.reasoning_text!.slice(0, 120).replace(/\n/g, ' / ')}...`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
