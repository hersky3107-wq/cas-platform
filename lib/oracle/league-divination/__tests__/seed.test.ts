import { describe, expect, it } from 'vitest'
import { fourPillars } from '../../engines/calendar'
import { LEAGUE_SEOUL } from '../conventions'
import { leagueDrawSeed, seoulClockFromFirstView } from '../seed'

describe('deterministic draw seed', () => {
  it('is roundId:firstViewIso:system', () => {
    expect(leagueDrawSeed('r1', '2026-09-19T08:00:00.000Z', 'iching')).toBe('r1:2026-09-19T08:00:00.000Z:iching')
    expect(leagueDrawSeed('r1', '2026-09-19T08:00:00.000Z', 'tarot')).not.toBe(
      leagueDrawSeed('r1', '2026-09-19T08:00:00.000Z', 'runes'),
    )
  })
})

describe('Seoul pin + 23:xx 자시 fork', () => {
  it('pins location to Seoul', () => {
    const clock = seoulClockFromFirstView('2026-09-19T03:00:00.000Z')
    expect(clock.tz).toBe(LEAGUE_SEOUL.tz)
    expect(clock.lat).toBe(37.5665)
    expect(clock.lng).toBe(126.978)
    expect(clock.date).toBe('2026-09-19')
    expect(clock.time).toBe('12:00')
    expect(clock.hourPinned).toBe(false)
  })

  it('rewrites 23:xx Seoul to 22:xx so 택일 does not fork', () => {
    const late = seoulClockFromFirstView('1988-03-15T14:30:00.000Z')
    expect(late.originalTime).toBe('23:30')
    expect(late.time).toBe('22:30')
    expect(late.hourPinned).toBe(true)

    const pinned = fourPillars({ date: late.date, time: late.time, timezone: late.tz })
    const unpinned = fourPillars({ date: '1988-03-15', time: '23:30', timezone: 'Asia/Seoul' })
    expect(pinned.alternate).toBeNull()
    expect(unpinned.alternate).not.toBeNull()
    expect(pinned.day.ganzhi).not.toBe(unpinned.day.ganzhi)
  })
})
