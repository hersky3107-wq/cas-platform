import 'server-only'

import { addCreditsBalance } from '@/lib/credits-server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { generatePredictions, persistLeagueConsensusFromDb } from '@/lib/league/orchestrator'
import { getRoster, type LeagueTier } from '@/lib/league/roster'
import {
  claimGenerationJobLease,
  countRunningGenerationJobs,
  getGenerationJob,
  listChargedUnrefundedForRound,
  listClaimableGenerationJobs,
  listRoundModelRows,
  markJobRefundedOnce,
  touchGenerationJobHeartbeat,
  updateGenerationJob,
} from './job-store'
import type { LeagueRunnerDeps } from './runner'
import { runnerPriceAnchorGate } from '@/lib/league/price-anchor'

/**
 * Live bindings for the league generation runner. Kept out of runner.ts on
 * purpose (oracle's store/credits split): importing THIS module constructs
 * the Supabase client and pulls `server-only` code, which unit tests must
 * not need — tests hand the runner fakes instead.
 *
 * The tier chunk binds `generatePredictions` UNCHANGED apart from the
 * additive knobs (excludeModelIds resume filter, deadlineAtMs launch gate,
 * tickBudgetMs fresh-chunk solo): same concurrency 6, same per-model
 * timeouts and one-retry, same kill-switch, same per-model row upserts.
 * Refunds move credits with
 * `addCreditsBalance` — the exact primitive the deep-analysis `refundDeep`
 * path uses.
 */
export function createLeagueRunnerDeps(schedule: (task: () => Promise<void>) => void): LeagueRunnerDeps {
  return {
    store: {
      getJob: getGenerationJob,
      claimLease: claimGenerationJobLease,
      updateJob: updateGenerationJob,
      touchHeartbeat: touchGenerationJobHeartbeat,
      listRoundModelRows,
      listChargedUnrefundedForRound,
      markJobRefundedOnce,
      listClaimableJobs: listClaimableGenerationJobs,
      countRunningJobs: countRunningGenerationJobs,
    },
    generate: async ({ roundId, tier, excludeModelIds, deadlineAtMs, tickBudgetMs, onModelResult }) => {
      // Cost cap is per ROUND, not per tick: subtract what previous ticks
      // already spent so a resumed job cannot spend the full cap again.
      const remainingCap = await remainingRoundCostCapUsd(roundId)
      await generatePredictions({
        round: { roundId },
        tiers: [tier],
        excludeModelIds,
        deadlineAtMs,
        tickBudgetMs,
        costCapUsd: remainingCap,
        onModelResult: (result) => onModelResult(result.model_id),
      })
    },
    finalizeConsensus: persistLeagueConsensusFromDb,
    refundCredits: async (userId, amount) => {
      if (amount <= 0) return
      await addCreditsBalance(supabaseAdmin, userId, amount)
    },
    tierModelIds: (tier: LeagueTier) => getRoster([tier]).map((entry) => entry.model_id),
    priceAnchorGate: runnerPriceAnchorGate,
    schedule,
  }
}

/** Kill-switch default when LEAGUE_RUN_COST_CAP_USD is unset/invalid (mirrors orchestrator). */
const FALLBACK_COST_CAP_USD = 20

async function remainingRoundCostCapUsd(roundId: string): Promise<number> {
  const raw = Number(process.env.LEAGUE_RUN_COST_CAP_USD)
  const cap = Number.isFinite(raw) && raw > 0 ? raw : FALLBACK_COST_CAP_USD
  const { data, error } = await supabaseAdmin
    .from('model_predictions')
    .select('cost_usd')
    .eq('round_id', roundId)
  if (error) throw new Error(`remainingRoundCostCapUsd: ${error.message}`)
  const spent = (data ?? []).reduce(
    (sum, row) => sum + (typeof (row as { cost_usd: number | null }).cost_usd === 'number' ? (row as { cost_usd: number }).cost_usd : 0),
    0
  )
  // Never hand the orchestrator a zero/negative cap (it would treat the run
  // as already capped and do nothing forever) — leave a minimal allowance and
  // let the kill-switch stop launches after the next model at worst.
  return Math.max(0.5, cap - spent)
}
