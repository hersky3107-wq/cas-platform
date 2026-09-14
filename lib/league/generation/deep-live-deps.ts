import 'server-only'

import { persistOneDeepHop, seedDeepRun } from '@/lib/league/deep-advance'
import { refundDeep } from '@/lib/league/deep-charge'
import {
  claimDeepRunLease,
  countRunningDeepRuns,
  loadDeepRunById,
  listClaimableDeepRuns,
  markDeepRunRefundedOnce,
  touchDeepRunHeartbeat,
  updateDeepRun,
} from '@/lib/league/deep-store'
import type { DeepRunnerDeps } from './deep-runner'

export function createDeepRunnerDeps(schedule: (task: () => Promise<void>) => void): DeepRunnerDeps {
  return {
    store: {
      getRun: loadDeepRunById,
      claimLease: claimDeepRunLease,
      updateRun: updateDeepRun,
      touchHeartbeat: touchDeepRunHeartbeat,
      markRefundedOnce: markDeepRunRefundedOnce,
      listClaimable: listClaimableDeepRuns,
      countRunning: countRunningDeepRuns,
    },
    seed: seedDeepRun,
    advanceHop: persistOneDeepHop,
    refundCredits: async (userId, amount, deductSkipped) => {
      if (amount <= 0) return
      await refundDeep(userId, amount, deductSkipped ? { ok: true, balance: null, skipped: true } : { ok: true, balance: null })
    },
    schedule,
  }
}
