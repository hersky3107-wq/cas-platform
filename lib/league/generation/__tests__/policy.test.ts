import { describe, expect, it } from 'vitest'
import {
  decideGeneratePress,
  decisionCharges,
  decisionNeedsNewJob,
  GENERATION_STAGES,
  nextGenerationStage,
  tierForStage,
} from '../policy'

describe('league generation press policy (paid view, 2026-09-14)', () => {
  it('a user who already paid for a round is NEVER charged again', () => {
    // Complete round: replay for free.
    expect(decideGeneratePress({ hasPaidAccess: true, roundComplete: true, hasActiveJob: false })).toBe('free_view')
    // Job in flight: attach for free.
    expect(decideGeneratePress({ hasPaidAccess: true, roundComplete: false, hasActiveJob: true })).toBe('free_watch')
    // Dead/incomplete round: the retry is free — this is the "retry must not
    // double-charge a user who already paid" rule.
    expect(decideGeneratePress({ hasPaidAccess: true, roundComplete: false, hasActiveJob: false })).toBe('free_new_job')
    for (const decision of ['free_view', 'free_watch', 'free_new_job'] as const) {
      expect(decisionCharges(decision)).toBe(false)
    }
  })

  it('every unpaid press charges the same price, existing round or not', () => {
    expect(decideGeneratePress({ hasPaidAccess: false, roundComplete: true, hasActiveJob: false })).toBe('charge_view')
    expect(decideGeneratePress({ hasPaidAccess: false, roundComplete: false, hasActiveJob: true })).toBe('charge_attach')
    expect(decideGeneratePress({ hasPaidAccess: false, roundComplete: false, hasActiveJob: false })).toBe('charge_new_job')
    for (const decision of ['charge_view', 'charge_attach', 'charge_new_job'] as const) {
      expect(decisionCharges(decision)).toBe(true)
    }
  })

  it('a press while a job is live NEVER enqueues a second job for the round', () => {
    expect(decisionNeedsNewJob(decideGeneratePress({ hasPaidAccess: false, roundComplete: false, hasActiveJob: true }))).toBe(false)
    expect(decisionNeedsNewJob(decideGeneratePress({ hasPaidAccess: true, roundComplete: false, hasActiveJob: true }))).toBe(false)
    // Only the two "round incomplete, nothing running" decisions start work.
    expect(decisionNeedsNewJob('charge_new_job')).toBe(true)
    expect(decisionNeedsNewJob('free_new_job')).toBe(true)
    expect(decisionNeedsNewJob('charge_view')).toBe(false)
    expect(decisionNeedsNewJob('free_view')).toBe(false)
  })
})

describe('league generation stage machine', () => {
  it('walks packet → premier(within packet) → challenger → world → scout → finalize', () => {
    expect(GENERATION_STAGES).toEqual(['packet', 'premier', 'challenger', 'world', 'scout', 'finalize'])
    // 'packet' RUNS the premier tier (packet assembly happens inside that
    // first orchestrator call), so its successor skips 'premier'.
    expect(tierForStage('packet')).toBe('premier')
    expect(nextGenerationStage('packet')).toBe('challenger')
    expect(nextGenerationStage('premier')).toBe('challenger')
    expect(nextGenerationStage('challenger')).toBe('world')
    expect(nextGenerationStage('world')).toBe('scout')
    expect(nextGenerationStage('scout')).toBe('finalize')
    expect(nextGenerationStage('finalize')).toBe(null)
  })

  it('finalize and unknown stages run no tier', () => {
    expect(tierForStage('finalize')).toBe(null)
    expect(tierForStage('view')).toBe(null)
    expect(tierForStage('nonsense')).toBe(null)
  })
})
