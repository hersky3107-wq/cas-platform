import { describe, expect, it } from 'vitest'
import { roundHitRecord } from '../round-hit'

describe('roundHitRecord — only graded rows enter the denominator', () => {
  it('ignores null is_correct even when a direction exists', () => {
    const hit = roundHitRecord([
      { is_correct: true },
      { is_correct: true },
      { is_correct: false },
      { is_correct: null },
      { is_correct: null },
      { is_correct: null },
    ])
    expect(hit).toEqual({ correct: 2, graded: 3 })
  })

  it('does not treat roster size as a sample', () => {
    const forty = Array.from({ length: 40 }, (_, i) => ({
      is_correct: (i < 37 ? i < 27 : null) as boolean | null,
    }))
    expect(roundHitRecord(forty)).toEqual({ correct: 27, graded: 37 })
  })
})
