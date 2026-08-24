import { describe, expect, it } from 'vitest'
import { resolveOpenPhase } from '../open-phase'

describe('resolveOpenPhase', () => {
  it('tags US equity weekend as weekend (America/New_York)', () => {
    // Saturday 2026-08-22 15:00 UTC = Saturday morning ET
    expect(resolveOpenPhase('AAPL', new Date('2026-08-22T15:00:00.000Z'))).toBe('weekend')
  })

  it('tags US equity before 09:30 ET as pre_open', () => {
    // Monday 2026-08-24 12:00 UTC = 08:00 ET (EDT)
    expect(resolveOpenPhase('AAPL', new Date('2026-08-24T12:00:00.000Z'))).toBe('pre_open')
  })

  it('tags US equity during regular session as intraday', () => {
    // Monday 2026-08-24 15:00 UTC = 11:00 ET
    expect(resolveOpenPhase('AAPL', new Date('2026-08-24T15:00:00.000Z'))).toBe('intraday')
  })

  it('tags US equity after 16:00 ET as after_close', () => {
    // Monday 2026-08-24 21:00 UTC = 17:00 ET
    expect(resolveOpenPhase('AAPL', new Date('2026-08-24T21:00:00.000Z'))).toBe('after_close')
  })

  it('tags crypto as always intraday (24/7)', () => {
    expect(resolveOpenPhase('BTC-USD', new Date('2026-08-22T15:00:00.000Z'))).toBe('intraday')
    expect(resolveOpenPhase('BTC-USD', new Date('2026-08-24T12:00:00.000Z'))).toBe('intraday')
  })
})
