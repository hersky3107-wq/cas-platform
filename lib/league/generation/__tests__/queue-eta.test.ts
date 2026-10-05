import { describe, expect, it } from 'vitest'
import { getLeagueUiPack } from '../../i18n/dictionary'
import { LEAGUE_LOCALES } from '../../i18n/locales'
import { refundLeagueRoundPurchases } from '../runner'
import type { LeagueRunnerDeps } from '../runner'
import {
  createProviderCallGate,
  resetSharedProviderCallGateForTests,
  sharedProviderCallGate,
} from '../provider-gate'
import { leagueJobMaxRunning, queueWaitEstimate } from '../policy'

describe('queue wait', () => {
  it('estimates about 170 minutes for the 100th job when 3 are already running', () => {
    const wait = queueWaitEstimate({ queuedAhead: 99, running: 3, maxRunning: 3 })
    expect(wait.position).toBe(100)
    expect(wait.etaMinutes).toBe(170)
  })

  it('keeps the default running cap at 3 unless the env override is set', () => {
    const previous = process.env.LEAGUE_JOB_MAX_RUNNING
    delete process.env.LEAGUE_JOB_MAX_RUNNING
    expect(leagueJobMaxRunning()).toBe(3)
    process.env.LEAGUE_JOB_MAX_RUNNING = '4'
    expect(leagueJobMaxRunning()).toBe(4)
    if (previous == null) delete process.env.LEAGUE_JOB_MAX_RUNNING
    else process.env.LEAGUE_JOB_MAX_RUNNING = previous
  })

  it('shows a queue line in every locale', () => {
    expect(getLeagueUiPack('ko').hub.queueLine(2, 10)).toBe('대기 2번째 · 약 10분')
    for (const locale of LEAGUE_LOCALES) {
      expect(getLeagueUiPack(locale).hub.queueLine(1, 5).length).toBeGreaterThan(3)
    }
  })
})

describe('shared provider gate', () => {
  it('holds a route at its process-wide cap', async () => {
    resetSharedProviderCallGateForTests()
    const gate = createProviderCallGate({ maxInFlight: 8, routeCaps: { google: 2 } })
    await gate.acquire('google')
    await gate.acquire('google')
    let third = false
    const pending = gate.acquire('google').then(() => {
      third = true
    })
    await Promise.resolve()
    expect(third).toBe(false)
    gate.release('google')
    await pending
    expect(third).toBe(true)
    expect(sharedProviderCallGate()).toBe(sharedProviderCallGate())
  })
})

describe('charge safety', () => {
  it('refunds a purchase once even if close-out runs twice', async () => {
    let marks = 0
    let credits = 0
    const deps = {
      store: {
        listChargedUnrefundedForRound: async () => [
          { id: 'purchase-1', deduct_skipped: false, charged_cost: 12, user_id: 'user-1' },
        ],
        markJobRefundedOnce: async () => {
          marks += 1
          return marks === 1
        },
      },
      refundCredits: async (_userId: string, amount: number) => {
        credits += amount
      },
    } as unknown as LeagueRunnerDeps
    expect(await refundLeagueRoundPurchases('round-1', deps)).toBe(1)
    expect(await refundLeagueRoundPurchases('round-1', deps)).toBe(0)
    expect(credits).toBe(12)
  })
})
