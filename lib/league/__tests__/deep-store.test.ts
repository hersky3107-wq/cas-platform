import { describe, expect, it } from 'vitest'
import { decideDeepRunAction, runIsBusy } from '../deep-run-policy'

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
