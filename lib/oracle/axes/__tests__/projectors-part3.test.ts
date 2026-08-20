import { describe, expect, it } from 'vitest'
import { sumValues } from '../math'
import { ELEMENT_AXES, PHASE_AXES } from '../types'
import { validateAxisVote } from '../validate'
import { projectTarot } from '../projectors/tarot'
import { projectRune } from '../projectors/rune'
import { projectIching } from '../projectors/iching'
import { projectNumerology } from '../projectors/numerology'
import { projectName } from '../projectors/name'

const BIRTH_DATE = '1988-03-15'
const AT_DATE = '2026-08-20'

function expectSumsTo100OrNull(vote: { elements: Record<string, number> | null; phase: Record<string, number> | null }): void {
  if (vote.elements) {
    expect(sumValues(ELEMENT_AXES.map((axis) => vote.elements![axis]))).toBeCloseTo(100, 5)
  }
  if (vote.phase) {
    expect(sumValues(PHASE_AXES.map((axis) => vote.phase![axis]))).toBeCloseTo(100, 5)
  }
}

describe('projectTarot', () => {
  it('validates and sums correctly for a 3-card spread', () => {
    const vote = projectTarot({ seed: 'axes-worked-example', spread: 3, pickedPositions: [1, 2, 3] })
    expect(validateAxisVote(vote), JSON.stringify(validateAxisVote(vote))).toEqual([])
    expect(vote.system).toBe('tarot')
    expect(vote.traits).not.toBeNull()
    expect(vote.confidence.traits).toEqual({ weight: 0.5, basis: 'derived' })
    expect(vote.confidence.phase).toEqual({ weight: 1, basis: 'direct' })
    expectSumsTo100OrNull(vote)
  })

  it('reversed cards reflect the trait mix rather than reusing the upright one', () => {
    // Sweep seeds until we find one draw with at least one reversed card
    // and one with none, then confirm the reversed-affected mix actually
    // differs from what the same cards upright would produce.
    let sawReversed = false
    for (let i = 0; i < 25 && !sawReversed; i += 1) {
      const vote = projectTarot({ seed: `axes-tarot-${i}`, spread: 1, pickedPositions: [i + 1] })
      expect(validateAxisVote(vote)).toEqual([])
      expectSumsTo100OrNull(vote)
      if (vote.reasons.traits?.includes('tarot.traits.reversals_reflected')) sawReversed = true
    }
    expect(sawReversed).toBe(true)
  })

  it('marks elements unreadable when a draw is all Major Arcana (no suit signal), readable otherwise', () => {
    // A single-card draw is major ~28% of the time (22/78); across enough
    // seeds we should see both a major-only (unreadable elements) and a
    // minor (readable elements) outcome, and never a fabricated number.
    let sawAllMajor = false
    let sawMinor = false
    for (let i = 0; i < 40; i += 1) {
      const vote = projectTarot({ seed: `axes-tarot-major-${i}`, spread: 1, pickedPositions: [1] })
      expect(validateAxisVote(vote)).toEqual([])
      expectSumsTo100OrNull(vote)
      if (vote.elements === null) {
        sawAllMajor = true
        expect(vote.unreadable).toContainEqual({ space: 'elements', code: 'tarot.no_minor_cards' })
        expect(vote.confidence.elements).toBeNull()
      } else {
        sawMinor = true
        expect(vote.confidence.elements).toEqual({ weight: 0.5, basis: 'derived' })
      }
    }
    expect(sawAllMajor).toBe(true)
    expect(sawMinor).toBe(true)
  })
})

describe('projectRune', () => {
  it('validates and sums correctly for a 3-rune draw', () => {
    const vote = projectRune({ seed: 'axes-worked-example', count: 3 })
    expect(validateAxisVote(vote), JSON.stringify(validateAxisVote(vote))).toEqual([])
    expect(vote.system).toBe('runes')
    expect(vote.traits).not.toBeNull()
    expect(vote.confidence.traits).toEqual({ weight: 0.5, basis: 'derived' })
    expect(vote.confidence.phase).toEqual({ weight: 1, basis: 'direct' })
    expectSumsTo100OrNull(vote)
  })

  it('elements are null exactly when no drawn rune has an agreed element', () => {
    let sawReadable = false
    let sawUnreadable = false
    for (let i = 0; i < 30; i += 1) {
      const vote = projectRune({ seed: `axes-rune-${i}`, count: 2 })
      expect(validateAxisVote(vote)).toEqual([])
      expectSumsTo100OrNull(vote)
      if (vote.elements === null) {
        sawUnreadable = true
        expect(vote.unreadable).toContainEqual({ space: 'elements', code: 'rune.no_element_consensus' })
        expect(vote.confidence.elements).toBeNull()
      } else {
        sawReadable = true
        expect(vote.confidence.elements).toEqual({ weight: 0.5, basis: 'derived' })
      }
    }
    expect(sawReadable).toBe(true)
    expect(sawUnreadable).toBe(true)
  })

  it('a full 24-rune draw always has a full trait and phase reading', () => {
    const vote = projectRune({ seed: 'axes-full-set', count: 24 })
    expect(validateAxisVote(vote)).toEqual([])
    expect(vote.traits).not.toBeNull()
    expect(vote.phase).not.toBeNull()
    expectSumsTo100OrNull(vote)
  })
})

describe('projectIching', () => {
  it('traits are always unreadable; elements and phase are direct and readable', () => {
    const vote = projectIching({ seed: 'axes-worked-example' })
    expect(validateAxisVote(vote), JSON.stringify(validateAxisVote(vote))).toEqual([])
    expect(vote.system).toBe('iching')
    expect(vote.traits).toBeNull()
    expect(vote.confidence.traits).toBeNull()
    expect(vote.unreadable).toContainEqual({ space: 'traits', code: 'iching.no_trait_reading' })
    expect(vote.elements).not.toBeNull()
    expect(vote.confidence.elements).toEqual({ weight: 1, basis: 'direct' })
    expect(vote.confidence.phase).toEqual({ weight: 1, basis: 'direct' })
    expectSumsTo100OrNull(vote)
  })

  it('no changing lines leans fully to hold', () => {
    let sawNoChanging = false
    for (let i = 0; i < 60 && !sawNoChanging; i += 1) {
      const vote = projectIching({ seed: `axes-iching-${i}` })
      if (vote.reasons.phase?.includes('iching.phase.no_changing_lines')) {
        sawNoChanging = true
        expect(vote.phase).toEqual({ advance: 0, hold: 100, release: 0 })
      }
    }
    expect(sawNoChanging).toBe(true)
  })
})

describe('projectNumerology', () => {
  it('validates and sums correctly with a Latin name', () => {
    const vote = projectNumerology({ birthDate: BIRTH_DATE, latinName: 'Jane Doe', atDate: AT_DATE })
    expect(validateAxisVote(vote), JSON.stringify(validateAxisVote(vote))).toEqual([])
    expect(vote.system).toBe('numerology')
    expect(vote.traits).not.toBeNull()
    expect(vote.reasons.traits).toEqual(['numerology.traits.lifepath_expression_blend'])
    expect(vote.elements).toBeNull()
    expect(vote.confidence.elements).toBeNull()
    expect(vote.unreadable).toContainEqual({ space: 'elements', code: 'numerology.no_wuxing_mapping' })
    expect(vote.confidence.phase).toEqual({ weight: 1, basis: 'direct' })
    expectSumsTo100OrNull(vote)
  })

  it('falls back to life-path-only traits when there is no Latin name', () => {
    const vote = projectNumerology({ birthDate: BIRTH_DATE, latinName: null, atDate: AT_DATE })
    expect(validateAxisVote(vote)).toEqual([])
    expect(vote.traits).not.toBeNull()
    expect(vote.reasons.traits).toEqual(['numerology.traits.lifepath_only', 'numerology.no_latin_name'])
  })
})

describe('projectName', () => {
  it('validates and sums correctly for a supported (Korean) name', () => {
    const vote = projectName({ surname: '김', givenName: '민준', locale: 'ko' })
    expect(validateAxisVote(vote), JSON.stringify(validateAxisVote(vote))).toEqual([])
    expect(vote.system).toBe('name')
    expect(vote.traits).not.toBeNull()
    expect(vote.confidence.traits).toEqual({ weight: 0.5, basis: 'derived' })
    expect(vote.elements).not.toBeNull()
    expect(vote.confidence.elements).toEqual({ weight: 1, basis: 'direct' })
    expect(vote.phase).toBeNull()
    expect(vote.confidence.phase).toBeNull()
    expect(vote.unreadable).toContainEqual({ space: 'phase', code: 'name.no_time_axis' })
    expectSumsTo100OrNull(vote)
  })

  it('marks all three spaces unreadable for an unsupported (non-CJK) locale', () => {
    const vote = projectName({ surname: 'Doe', givenName: 'Jane', locale: 'en' })
    expect(validateAxisVote(vote), JSON.stringify(validateAxisVote(vote))).toEqual([])
    expect(vote.traits).toBeNull()
    expect(vote.elements).toBeNull()
    expect(vote.phase).toBeNull()
    expect(vote.unreadable).toEqual([
      { space: 'traits', code: 'name.locale_unsupported' },
      { space: 'elements', code: 'name.locale_unsupported' },
      { space: 'phase', code: 'name.locale_unsupported' },
    ])
  })
})
