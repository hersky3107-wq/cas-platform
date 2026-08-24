/**
 * Backfill consensus dual-store + open_phase for the two AAPL 1d rounds,
 * print side-by-side majority vs log-odds, and run the convergence citation scan.
 *
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/_backfill-consensus-open-phase.ts
 */
import { writeFileSync } from 'node:fs'
import { supabaseAdmin } from '../lib/supabase/server'
import { binaryCallsFromModels, dualConsensus } from '../lib/league/log-odds-consensus'
import { resolveOpenPhase } from '../lib/league/open-phase'

const ROUND_IDS = [
  'f3752ddd-a0ca-44ab-9a38-3ae0d590d512',
  'fffc1716-cd3d-45f2-883f-1242a373febc',
]

async function main() {
  const report: unknown[] = []

  for (const id of ROUND_IDS) {
    const { data: round, error: rErr } = await supabaseAdmin
      .from('prediction_rounds')
      .select('id, instrument, horizon, opened_at, created_at, closed_book_packet_text')
      .eq('id', id)
      .single()
    if (rErr || !round) throw new Error(rErr?.message ?? `missing ${id}`)

    const { data: preds, error: pErr } = await supabaseAdmin
      .from('model_predictions')
      .select('model_id, predicted_direction, predicted_value, reasoning_snippet')
      .eq('round_id', id)
    if (pErr) throw pErr

    const models = (preds ?? []).map((p) => ({
      model_id: p.model_id as string,
      direction: p.predicted_direction as string | null,
      probability: p.predicted_value as number | null,
      rationale: (p.reasoning_snippet as string | null) ?? '',
    }))

    const dual = dualConsensus(binaryCallsFromModels(models))
    const openedAt = new Date((round.opened_at as string) || (round.created_at as string))
    const openPhase = resolveOpenPhase(round.instrument as string, openedAt)

    const { error: uErr } = await supabaseAdmin
      .from('prediction_rounds')
      .update({
        open_phase: openPhase,
        consensus_majority_direction: dual.majority.direction,
        consensus_majority_probability: dual.majority.probability,
        consensus_aggregate_direction: dual.aggregate.direction,
        consensus_aggregate_probability: dual.aggregate.probability,
      })
      .eq('id', id)
    if (uErr) throw uErr

    const sma = models.filter((m) => /\bSMA\b|sma\s*20|sma\s*50|moving average/i.test(m.rationale))
    const w52 = models.filter((m) => /52[- ]?w|52-week|fifty[- ]two|year high|year low|from (the )?high|from (the )?low/i.test(m.rationale))
    const pullback = models.filter((m) => /pullback|rebound|oversold|mean reversion|bounce|retrac/i.test(m.rationale))
    const downs = models.filter((m) => m.direction === 'down').map((m) => m.model_id)

    report.push({
      id,
      open_phase: openPhase,
      opened_at: openedAt.toISOString(),
      majority: dual.majority,
      aggregate: {
        direction: dual.aggregate.direction,
        probability: dual.aggregate.probability,
        n: dual.aggregate.n,
      },
      cites: {
        sma: sma.length,
        sma_models: sma.map((m) => m.model_id),
        w52: w52.length,
        w52_models: w52.map((m) => m.model_id),
        pullback: pullback.length,
        pullback_models: pullback.map((m) => m.model_id),
      },
      down_callers: downs,
      packet_has_base_rate: /BASE RATE/.test((round.closed_book_packet_text as string) || ''),
    })
  }

  const a = report[0] as { down_callers: string[]; cites: Record<string, unknown> }
  const b = report[1] as { down_callers: string[]; cites: Record<string, unknown> }
  const overlap = a.down_callers.filter((m) => b.down_callers.includes(m))
  const onlyA = a.down_callers.filter((m) => !b.down_callers.includes(m))
  const onlyB = b.down_callers.filter((m) => !a.down_callers.includes(m))

  const out = {
    rounds: report,
    down_caller_overlap: { overlap, only_f3752ddd: onlyA, only_fffc1716: onlyB },
  }
  writeFileSync('docs/_consensus-backfill.json', JSON.stringify(out, null, 2), 'utf8')
  console.log(JSON.stringify(out, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
