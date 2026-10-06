import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import { officialRowsForConsensus } from '@/lib/league/extra/seats'
import { selectGradedConsensusTrackRounds } from '@/lib/league/graded-consensus-rounds'

export type TrackRecordCell = {
  category: string
  horizon: string
  consensusHitRatePct: number | null
  consensusN: number
  pooledModelHitRatePct: number | null
  pooledModelN: number
}

function pct(correct: number, n: number): number | null {
  if (n <= 0) return null
  return Math.round((1000 * correct) / n) / 10
}

/**
 * Admin-only AI 종합 vs pooled official-seat hit rates, by category × horizon.
 */
export async function loadConsensusTrackRecord(): Promise<TrackRecordCell[]> {
  const { data: rounds, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id, category, horizon, actual_outcome, grading_status, consensus_is_correct')
    .eq('is_test', false)
    .not('actual_outcome', 'is', null)
  if (error) {
    if (/consensus_is_correct/i.test(error.message) && /does not exist|schema cache/i.test(error.message)) {
      throw new Error('apply supabase/migrations/20261005000001_prediction_rounds_consensus_is_correct.sql')
    }
    throw new Error(error.message)
  }

  const graded = selectGradedConsensusTrackRounds(rounds ?? [])
  const ids = graded.map((r) => r.id as string)
  const preds: { round_id: string; model_id: string; league_tier: string | null; is_correct: boolean | null }[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    const { data, error: predErr } = await supabaseAdmin
      .from('model_predictions')
      .select('round_id, model_id, league_tier, is_correct')
      .in('round_id', chunk)
    if (predErr) throw new Error(predErr.message)
    preds.push(...((data ?? []) as typeof preds))
  }
  const official = officialRowsForConsensus(preds).filter((p) => p.is_correct !== null)

  const keys = new Map<string, { category: string; horizon: string }>()
  for (const r of graded) keys.set(`${r.category}\t${r.horizon}`, { category: r.category, horizon: r.horizon })

  const cells: TrackRecordCell[] = []
  for (const [key, { category, horizon }] of [...keys.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const rs = graded.filter((r) => r.category === category && r.horizon === horizon)
    const idSet = new Set(rs.map((r) => r.id))
    let cHit = 0
    let cN = rs.length
    for (const r of rs) {
      if (r.consensus_is_correct) cHit += 1
    }
    const modelRows = official.filter((p) => idSet.has(p.round_id))
    let mHit = 0
    for (const p of modelRows) if (p.is_correct) mHit += 1
    cells.push({
      category,
      horizon,
      consensusHitRatePct: pct(cHit, cN),
      consensusN: cN,
      pooledModelHitRatePct: pct(mHit, modelRows.length),
      pooledModelN: modelRows.length,
    })
  }
  return cells
}
