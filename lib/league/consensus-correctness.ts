import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import { isBrandTableInstrument } from '@/lib/league/ai-ranking/brand-table'
import { consensusIsCorrect } from '@/lib/league/consensus-snapshot'
import { persistLeagueConsensusFromDb } from '@/lib/league/orchestrator'

function isMissingColumnError(message: string, column: string): boolean {
  return message.toLowerCase().includes(column) && /does not exist|schema cache/i.test(message)
}

/**
 * Stamp `consensus_is_correct` for a graded round. Recomputes the persisted
 * aggregate first when it is missing so a late finalize still has a pick.
 * Missing-column (SQL not applied yet) is a no-op so grading cannot stall.
 */
export async function stampConsensusIsCorrect(roundId: string): Promise<boolean | null> {
  const { data, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id, instrument, actual_outcome, grading_status, consensus_aggregate_direction')
    .eq('id', roundId)
    .maybeSingle()
  if (error || !data) return null
  if (data.grading_status === 'voided') return null
  if (data.actual_outcome == null || String(data.actual_outcome).trim() === '') return null

  let pick = typeof data.consensus_aggregate_direction === 'string' ? data.consensus_aggregate_direction : null
  if (!pick) {
    await persistLeagueConsensusFromDb(roundId)
    const { data: again } = await supabaseAdmin
      .from('prediction_rounds')
      .select('consensus_aggregate_direction')
      .eq('id', roundId)
      .maybeSingle()
    pick = typeof again?.consensus_aggregate_direction === 'string' ? again.consensus_aggregate_direction : null
  }

  const mode = isBrandTableInstrument(String(data.instrument)) ? 'brand_table' : 'binary'
  const correct = consensusIsCorrect({
    aggregateDirection: pick,
    actualOutcome: String(data.actual_outcome),
    mode,
  })

  const { error: writeError } = await supabaseAdmin
    .from('prediction_rounds')
    .update({ consensus_is_correct: correct })
    .eq('id', roundId)
  if (writeError) {
    if (isMissingColumnError(writeError.message, 'consensus_is_correct')) return correct
    throw new Error(`stampConsensusIsCorrect: ${writeError.message}`)
  }
  return correct
}
