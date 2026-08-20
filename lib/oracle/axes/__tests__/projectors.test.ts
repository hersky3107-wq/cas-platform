import { describe, expect, it } from 'vitest'
import { computeConsensus } from '../consensus'
import { ELEMENT_AXES, PHASE_AXES } from '../types'
import { sumValues } from '../math'
import { validateAxisVote } from '../validate'
import { projectAstro } from '../projectors/astro'
import { projectPrism } from '../projectors/prism'
import { projectSaju } from '../projectors/saju'

const SAJU_BIRTH = {
  date: '1988-03-15',
  time: '04:30',
  timezone: 'Asia/Seoul',
  sex: 'male' as const,
  asOfDate: '2026-08-20',
}

const ASTRO_BIRTH = {
  date: '1988-03-15',
  time: '04:30',
  tz: 'Asia/Seoul',
  lat: 37.5665,
  lng: 126.978,
  timeKnown: true,
  asOf: { date: '2026-08-20', time: '12:00', tz: 'Asia/Seoul' },
}

const PRISM_BIRTH = {
  birthDate: '1988-03-15',
  mbti: 'INFJ',
  colors: { impulse: 'crimson' as const, need: 'sage' as const, identity: 'indigo' as const },
  microCheck: [3, 3, 3, 3] as const,
  atDate: '2026-08-20',
}

describe('projector contract', () => {
  it('saju / astro / prism each validate and keep elements+phase summing to 100', () => {
    const votes = [projectSaju(SAJU_BIRTH), projectAstro(ASTRO_BIRTH), projectPrism(PRISM_BIRTH)]
    for (const vote of votes) {
      expect(validateAxisVote(vote), JSON.stringify(validateAxisVote(vote))).toEqual([])
      if (vote.elements) {
        expect(sumValues(ELEMENT_AXES.map((axis) => vote.elements![axis]))).toBeCloseTo(100, 5)
      }
      if (vote.phase) {
        expect(sumValues(PHASE_AXES.map((axis) => vote.phase![axis]))).toBeCloseTo(100, 5)
      }
    }
  })

  it('saju marks hour-unknown as degraded, not dropped', () => {
    const vote = projectSaju({ ...SAJU_BIRTH, time: null })
    expect(validateAxisVote(vote)).toEqual([])
    expect(vote.traits).not.toBeNull()
    expect(vote.elements).not.toBeNull()
    expect(vote.confidence.traits).toEqual({ weight: 0.5, basis: 'degraded' })
    expect(vote.confidence.elements).toEqual({ weight: 0.5, basis: 'degraded' })
    expect(vote.reasons.traits).toContain('saju.hour_unknown')
    expect(vote.unreadable.some((entry) => entry.space === 'traits')).toBe(false)
  })

  it('astro without birth time degrades traits and keeps elements derived', () => {
    const vote = projectAstro({ ...ASTRO_BIRTH, time: null, timeKnown: false })
    expect(validateAxisVote(vote)).toEqual([])
    expect(vote.confidence.traits).toEqual({ weight: 0.5, basis: 'degraded' })
    expect(vote.confidence.elements).toEqual({ weight: 0.5, basis: 'derived' })
    expect(vote.reasons.elements).toContain('astro.elements.classical_to_oheng')
  })

  it('astro with known time still marks elements derived, never direct', () => {
    const vote = projectAstro(ASTRO_BIRTH)
    expect(vote.confidence.elements?.basis).toBe('derived')
    expect(vote.confidence.elements?.weight).toBe(0.5)
    expect(vote.confidence.traits?.basis).toBe('direct')
  })

  it('prism traits are the coreMatrix 1:1', () => {
    const vote = projectPrism(PRISM_BIRTH)
    expect(vote.system).toBe('prism')
    expect(vote.confidence.traits?.basis).toBe('direct')
    expect(vote.traits).not.toBeNull()
    expect(vote.reasons.traits).toContain('prism.traits.core_matrix')
  })

  it('three real votes produce a well-formed consensus object', () => {
    const consensus = computeConsensus([
      projectSaju(SAJU_BIRTH),
      projectAstro(ASTRO_BIRTH),
      projectPrism(PRISM_BIRTH),
    ])
    expect(consensus.systemCount.total).toBe(3)
    expect(consensus.systemCount.participating).toBe(3)
    expect(sumValues(ELEMENT_AXES.map((axis) => consensus.elements.total[axis]))).toBeCloseTo(100, 5)
    expect(sumValues(PHASE_AXES.map((axis) => consensus.phase.tally[axis]))).toBeCloseTo(100, 5)
    expect(['consensus', 'split', 'clash']).toContain(consensus.phase.verdict)
  })
})
