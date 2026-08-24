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

  /**
   * Binary rule: flat / abstain / timeout / error rows stay is_correct=null
   * (reconciliation never grades them). They must never inflate the hit
   * denominator as a "silent null" counted as graded.
   */
  it('flat/abstain/null-direction rows never enter the hit denominator as silent null', () => {
    // Mimic a 40-row round: 38 binary up/down graded, 1 flat (stored historically),
    // 1 timeout — both non-binary paths leave is_correct null.
    const payload = [
      ...Array.from({ length: 20 }, () => ({
        predicted_direction: 'up' as const,
        is_correct: true as boolean | null,
      })),
      ...Array.from({ length: 18 }, () => ({
        predicted_direction: 'down' as const,
        is_correct: false as boolean | null,
      })),
      { predicted_direction: 'flat' as const, is_correct: null },
      { predicted_direction: null, is_correct: null },
    ]
    expect(payload).toHaveLength(40)
    const hit = roundHitRecord(payload)
    expect(hit).toEqual({ correct: 20, graded: 38 })
    expect(hit.graded + payload.filter((r) => r.is_correct === null).length).toBe(40)
    // Non-binary rows are present in the payload but contribute zero to graded.
    const nonBinary = payload.filter((r) => r.predicted_direction === 'flat' || r.predicted_direction === null)
    expect(nonBinary).toHaveLength(2)
    expect(nonBinary.every((r) => r.is_correct === null)).toBe(true)
  })
})
