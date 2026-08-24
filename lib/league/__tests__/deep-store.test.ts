import { describe, expect, it } from 'vitest'
import {
  decideDeepRunAction,
  isUnseededState,
  MAX_SEED_ATTEMPTS,
  nextUnseededState,
  placeholderUnseededState,
  runIsBusy,
} from '../deep-run-policy'

describe('decideDeepRunAction', () => {
  it('starts when there is no row', () => {
    expect(decideDeepRunAction(null)).toBe('start')
  })

  it('replays a completed result without treating it as a new run', () => {
    expect(
      decideDeepRunAction({ status: 'done', result: { kind: 'open' }, refunded: false })
    ).toBe('replay')
  })

  it('resumes an in-progress run', () => {
    expect(decideDeepRunAction({ status: 'running', result: null, refunded: false })).toBe('resume')
  })

  it('refunds a terminal error that was never refunded', () => {
    expect(decideDeepRunAction({ status: 'error', result: { ok: false }, refunded: false })).toBe(
      'finish_refund'
    )
  })

  it('allows a new paid attempt after a refunded error', () => {
    expect(decideDeepRunAction({ status: 'error', result: { ok: false }, refunded: true })).toBe(
      'restart'
    )
  })
})

describe('runIsBusy', () => {
  it('is free when busy_until is null or past', () => {
    expect(runIsBusy({ busy_until: null })).toBe(false)
    expect(runIsBusy({ busy_until: new Date(Date.now() - 1000).toISOString() })).toBe(false)
  })

  it('is busy while the lease is in the future', () => {
    expect(runIsBusy({ busy_until: new Date(Date.now() + 60_000).toISOString() })).toBe(true)
  })
})

describe('unseeded-state helpers (claim -> charge -> build-context reorder)', () => {
  it('placeholder starts at zero attempts and is recognized as unseeded', () => {
    const placeholder = placeholderUnseededState()
    expect(placeholder).toEqual({ __unseeded: true, seedAttempts: 0 })
    expect(isUnseededState(placeholder)).toBe(true)
  })

  it('does not treat a real seeded pipeline state as unseeded', () => {
    expect(isUnseededState({ instrument: 'AAPL', category: 'stock' })).toBe(false)
    expect(isUnseededState(null)).toBe(false)
    expect(isUnseededState(undefined)).toBe(false)
    expect(isUnseededState({ __unseeded: true })).toBe(false) // missing seedAttempts
  })

  it('increments attempts and records the latest error, starting from zero when absent', () => {
    const first = nextUnseededState({ instrument: 'AAPL' }, 'boom')
    expect(first).toEqual({ __unseeded: true, seedAttempts: 1, lastSeedError: 'boom' })

    const second = nextUnseededState(first, 'boom again')
    expect(second).toEqual({ __unseeded: true, seedAttempts: 2, lastSeedError: 'boom again' })
  })

  it('MAX_SEED_ATTEMPTS caps retries at 3', () => {
    expect(MAX_SEED_ATTEMPTS).toBe(3)
  })
})
