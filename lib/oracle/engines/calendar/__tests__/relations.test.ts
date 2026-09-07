/**
 * Canonical 간지 pair-relation tables — the shared substrate of 사주/자미 궁합.
 *
 * Fixtures are the textbook pairs, not derived values: 甲己合土 is a fact of
 * the tradition, and a broken table must fail against the book.
 */
import { describe, expect, it } from 'vitest'
import {
  branchPairRelation,
  elementPairRelation,
  stemCombination,
} from '../relations'

describe('stemCombination (천간합)', () => {
  it('maps the five classical combinations to their resulting element', () => {
    // indexes: 갑0 을1 병2 정3 무4 기5 경6 신7 임8 계9
    expect(stemCombination(0, 5)).toBe('earth') // 甲己合土
    expect(stemCombination(1, 6)).toBe('metal') // 乙庚合金
    expect(stemCombination(2, 7)).toBe('water') // 丙辛合水
    expect(stemCombination(3, 8)).toBe('wood') // 丁壬合木
    expect(stemCombination(4, 9)).toBe('fire') // 戊癸合火
  })

  it('is symmetric', () => {
    expect(stemCombination(5, 0)).toBe('earth')
    expect(stemCombination(9, 4)).toBe('fire')
  })

  it('returns null when the stems do not combine', () => {
    expect(stemCombination(0, 1)).toBeNull()
    expect(stemCombination(0, 0)).toBeNull()
    expect(stemCombination(2, 9)).toBeNull()
  })
})

describe('branchPairRelation (지지 육합·삼합·충·원진)', () => {
  // indexes: 자0 축1 인2 묘3 진4 사5 오6 미7 신8 유9 술10 해11
  it('finds 육합 pairs', () => {
    expect(branchPairRelation(0, 1).yukhap).toBe(true) // 子丑
    expect(branchPairRelation(2, 11).yukhap).toBe(true) // 寅亥
    expect(branchPairRelation(3, 10).yukhap).toBe(true) // 卯戌
    expect(branchPairRelation(0, 6).yukhap).toBe(false)
  })

  it('finds 삼합 pairs with their element', () => {
    expect(branchPairRelation(8, 0).samhap).toBe('water') // 申子(辰)
    expect(branchPairRelation(2, 6).samhap).toBe('fire') // 寅午(戌)
    expect(branchPairRelation(11, 3).samhap).toBe('wood') // 亥卯(未)
    expect(branchPairRelation(5, 9).samhap).toBe('metal') // 巳酉(丑)
    expect(branchPairRelation(0, 3).samhap).toBeNull()
  })

  it('finds 충 (opposition) pairs', () => {
    expect(branchPairRelation(0, 6).chung).toBe(true) // 子午
    expect(branchPairRelation(3, 9).chung).toBe(true) // 卯酉
    expect(branchPairRelation(0, 1).chung).toBe(false)
  })

  it('finds 원진 pairs', () => {
    expect(branchPairRelation(0, 7).wonjin).toBe(true) // 子未
    expect(branchPairRelation(1, 6).wonjin).toBe(true) // 丑午
    expect(branchPairRelation(0, 6).wonjin).toBe(false)
  })

  it('is symmetric in every flag', () => {
    for (const [a, b] of [
      [0, 1],
      [8, 0],
      [0, 6],
      [0, 7],
    ] as const) {
      expect(branchPairRelation(a, b)).toEqual(branchPairRelation(b, a))
    }
  })
})

describe('elementPairRelation (오행 상생·상극, directional)', () => {
  it('reads 비화 / 상생 / 상극 with direction preserved', () => {
    expect(elementPairRelation('wood', 'wood')).toBe('same')
    expect(elementPairRelation('wood', 'fire')).toBe('a_generates_b') // 木生火
    expect(elementPairRelation('fire', 'wood')).toBe('b_generates_a')
    expect(elementPairRelation('wood', 'earth')).toBe('a_overcomes_b') // 木剋土
    expect(elementPairRelation('earth', 'wood')).toBe('b_overcomes_a')
  })

  it('covers the full 생 cycle', () => {
    expect(elementPairRelation('fire', 'earth')).toBe('a_generates_b')
    expect(elementPairRelation('earth', 'metal')).toBe('a_generates_b')
    expect(elementPairRelation('metal', 'water')).toBe('a_generates_b')
    expect(elementPairRelation('water', 'wood')).toBe('a_generates_b')
  })
})
