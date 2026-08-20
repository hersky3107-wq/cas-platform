import { describe, expect, it } from 'vitest'
import { sumValues } from '../math'
import { ELEMENT_AXES, PHASE_AXES } from '../types'
import { validateAxisVote } from '../validate'
import { projectZiwei } from '../projectors/ziwei'
import { projectNineStar } from '../projectors/nine-star'
import { projectSukuyou } from '../projectors/sukuyou'
import { projectMaya } from '../projectors/maya'

const BIRTH_DATE = '1988-03-15'
const BIRTH_TIME = '04:30'
const TZ = 'Asia/Seoul'
const AT_DATE = '2026-08-20'

function expectSumsTo100OrNull(vote: ReturnType<typeof projectZiwei>): void {
  if (vote.elements) {
    expect(sumValues(ELEMENT_AXES.map((axis) => vote.elements![axis]))).toBeCloseTo(100, 5)
  }
  if (vote.phase) {
    expect(sumValues(PHASE_AXES.map((axis) => vote.phase![axis]))).toBeCloseTo(100, 5)
  }
}

function nextDates(start: string, count: number): string[] {
  const [y, m, d] = start.split('-').map(Number) as [number, number, number]
  const base = Date.UTC(y, m - 1, d)
  return Array.from({ length: count }, (_, i) => new Date(base + i * 86_400_000).toISOString().slice(0, 10))
}

describe('projectZiwei', () => {
  const KNOWN = { birthDate: BIRTH_DATE, birthTime: BIRTH_TIME, tz: TZ, sex: 'male' as const, atDate: AT_DATE }

  it('validates and sums correctly with a known birth time', () => {
    const vote = projectZiwei(KNOWN)
    expect(validateAxisVote(vote), JSON.stringify(validateAxisVote(vote))).toEqual([])
    expect(vote.system).toBe('ziwei')
    expect(vote.traits).not.toBeNull()
    expect(vote.confidence.traits).toEqual({ weight: 0.5, basis: 'derived' })
    expect(vote.confidence.elements).toEqual({ weight: 1, basis: 'direct' })
    expectSumsTo100OrNull(vote)
  })

  it('unknown birth time: traits and phase unreadable, elements degrade to year-stem-only', () => {
    const vote = projectZiwei({ ...KNOWN, birthTime: null })
    expect(validateAxisVote(vote), JSON.stringify(validateAxisVote(vote))).toEqual([])
    expect(vote.traits).toBeNull()
    expect(vote.phase).toBeNull()
    expect(vote.unreadable).toContainEqual({ space: 'traits', code: 'ziwei.no_birth_time' })
    expect(vote.unreadable).toContainEqual({ space: 'phase', code: 'ziwei.no_birth_time' })
    expect(vote.elements).not.toBeNull()
    expect(vote.confidence.elements).toEqual({ weight: 0.5, basis: 'degraded' })
    expectSumsTo100OrNull(vote)
  })
})

describe('projectNineStar', () => {
  it('validates, sums correctly, and has no unreadable spaces', () => {
    const vote = projectNineStar({ date: BIRTH_DATE, time: BIRTH_TIME, timezone: TZ, atDate: AT_DATE })
    expect(validateAxisVote(vote), JSON.stringify(validateAxisVote(vote))).toEqual([])
    expect(vote.system).toBe('ninestar')
    expect(vote.traits).not.toBeNull()
    expect(vote.confidence.elements).toEqual({ weight: 1, basis: 'direct' })
    expect(vote.confidence.phase).toEqual({ weight: 1, basis: 'direct', timescale: 'daily' })
    expect(vote.unreadable).toEqual([])
    expectSumsTo100OrNull(vote)
  })
})

describe('projectSukuyou', () => {
  it('validates and sums correctly for the worked-example birth', () => {
    const vote = projectSukuyou({ birthDate: BIRTH_DATE, birthTime: BIRTH_TIME, tz: TZ, atDate: AT_DATE })
    expect(validateAxisVote(vote), JSON.stringify(validateAxisVote(vote))).toEqual([])
    expect(vote.system).toBe('sukuyou')
    expect(vote.traits).not.toBeNull()
    expect(vote.confidence.phase).toEqual({ weight: 1, basis: 'direct', timescale: 'daily' })
    expectSumsTo100OrNull(vote)
  })

  it('marks elements unreadable exactly when the natal mansion pairs with Sun/Moon, never inventing a number', () => {
    let sawReadable = false
    let sawUnreadable = false
    for (const birthDate of nextDates('2026-01-01', 30)) {
      const vote = projectSukuyou({ birthDate, birthTime: null, tz: TZ, atDate: AT_DATE })
      expect(validateAxisVote(vote), JSON.stringify(validateAxisVote(vote))).toEqual([])
      expectSumsTo100OrNull(vote)
      if (vote.elements === null) {
        sawUnreadable = true
        expect(vote.unreadable).toContainEqual({ space: 'elements', code: 'sukuyou.no_wuxing_for_luminary' })
        expect(vote.confidence.elements).toBeNull()
      } else {
        sawReadable = true
        expect(vote.confidence.elements).toEqual({ weight: 0.5, basis: 'derived' })
      }
    }
    expect(sawReadable).toBe(true)
    expect(sawUnreadable).toBe(true)
  })
})

describe('projectMaya', () => {
  it('validates, sums correctly, and always marks elements unreadable (never forces a 오행 mapping)', () => {
    const vote = projectMaya({ birthDate: BIRTH_DATE, atDate: AT_DATE })
    expect(validateAxisVote(vote), JSON.stringify(validateAxisVote(vote))).toEqual([])
    expect(vote.system).toBe('tzolkin')
    expect(vote.traits).not.toBeNull()
    expect(vote.elements).toBeNull()
    expect(vote.confidence.elements).toBeNull()
    expect(vote.unreadable).toContainEqual({ space: 'elements', code: 'maya.no_wuxing_mapping' })
    expect(vote.confidence.phase).toEqual({ weight: 1, basis: 'direct', timescale: 'daily' })
    expectSumsTo100OrNull(vote)
  })
})

