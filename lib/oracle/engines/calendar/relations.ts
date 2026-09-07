/**
 * Canonical 간지 pair relations for 궁합 (two-person) readings.
 *
 * PURE TABLES ONLY — these are the textbook 명리 relations, not invented
 * compatibility scores:
 *
 *   천간합 (five stem combinations): 甲己→土, 乙庚→金, 丙辛→水, 丁壬→木,
 *   戊癸→火. Two stems combine iff their indices differ by exactly 5.
 *
 *   지지 육합: 子丑, 寅亥, 卯戌, 辰酉, 巳申, 午未 — (a+b) ≡ 1 (mod 12).
 *   지지 삼합: 申子辰(水), 寅午戌(火), 巳酉丑(金), 亥卯未(木) — same trine iff
 *   a ≡ b (mod 4); the trine element follows the group.
 *   지지 충: opposite branches, |a−b| = 6.
 *   지지 원진: 子未, 丑午, 寅酉, 卯申, 辰亥, 巳戌 — explicit pair set (no
 *   single arithmetic rule).
 *
 *   오행 상생: 木→火→土→金→水→木. 오행 상극: 木→土→水→火→金→木.
 *
 * Indices use the calendar engine's own frame: stems 0=甲…9=癸, branches
 * 0=子…11=亥 (StemInfo.index / BranchInfo.index).
 */
import { CalendarInputError } from './errors'
import type { FiveElement } from './types'

/** 상생 cycle: the key element PRODUCES the value element. */
export const ELEMENT_GENERATES: Record<FiveElement, FiveElement> = {
  wood: 'fire',
  fire: 'earth',
  earth: 'metal',
  metal: 'water',
  water: 'wood',
}

/** 상극 cycle: the key element OVERCOMES the value element. */
export const ELEMENT_OVERCOMES: Record<FiveElement, FiveElement> = {
  wood: 'earth',
  earth: 'water',
  water: 'fire',
  fire: 'metal',
  metal: 'wood',
}

/**
 * Directional pair relation between two elements, read from A's side:
 * 비화(same) / A생B / B생A / A극B / B극A.
 */
export type PairElementRelation =
  | 'same'
  | 'a_generates_b'
  | 'b_generates_a'
  | 'a_overcomes_b'
  | 'b_overcomes_a'

export function elementPairRelation(a: FiveElement, b: FiveElement): PairElementRelation {
  if (a === b) return 'same'
  if (ELEMENT_GENERATES[a] === b) return 'a_generates_b'
  if (ELEMENT_GENERATES[b] === a) return 'b_generates_a'
  if (ELEMENT_OVERCOMES[a] === b) return 'a_overcomes_b'
  return 'b_overcomes_a'
}

/** 천간합 result element per combining pair, keyed by min(index a, index b). */
const STEM_COMBINATION_ELEMENT: Record<number, FiveElement> = {
  0: 'earth', // 甲(0) + 己(5)
  1: 'metal', // 乙(1) + 庚(6)
  2: 'water', // 丙(2) + 辛(7)
  3: 'wood', // 丁(3) + 壬(8)
  4: 'fire', // 戊(4) + 癸(9)
}

function assertStemIndex(index: number, label: string): void {
  if (!Number.isInteger(index) || index < 0 || index > 9) {
    throw new CalendarInputError(`${label} must be a stem index 0–9, got ${index}`)
  }
}

function assertBranchIndex(index: number, label: string): void {
  if (!Number.isInteger(index) || index < 0 || index > 11) {
    throw new CalendarInputError(`${label} must be a branch index 0–11, got ${index}`)
  }
}

/** 천간합: the combined element when the two stems form one, else null. */
export function stemCombination(a: number, b: number): FiveElement | null {
  assertStemIndex(a, 'stem a')
  assertStemIndex(b, 'stem b')
  if (Math.abs(a - b) !== 5) return null
  return STEM_COMBINATION_ELEMENT[Math.min(a, b)] ?? null
}

/** 삼합 trine element by (index mod 4) group. */
const SAMHAP_ELEMENT_BY_GROUP: Record<number, FiveElement> = {
  0: 'water', // 申子辰
  1: 'metal', // 巳酉丑
  2: 'fire', // 寅午戌
  3: 'wood', // 亥卯未
}

/** 원진 pairs, stored with the smaller index first. */
const WONJIN_PAIRS: ReadonlySet<string> = new Set(['0-7', '1-6', '2-9', '3-8', '4-11', '5-10'])

export type BranchPairRelation = {
  /** 육합 — the six harmonies. */
  yukhap: boolean
  /** Same 삼합 trine → the trine's element; null otherwise or when a === b. */
  samhap: FiveElement | null
  /** 충 — direct opposition. */
  chung: boolean
  /** 원진 — the resentment pairs. */
  wonjin: boolean
}

export function branchPairRelation(a: number, b: number): BranchPairRelation {
  assertBranchIndex(a, 'branch a')
  assertBranchIndex(b, 'branch b')
  const key = `${Math.min(a, b)}-${Math.max(a, b)}`
  return {
    yukhap: (a + b) % 12 === 1,
    samhap: a !== b && a % 4 === b % 4 ? (SAMHAP_ELEMENT_BY_GROUP[a % 4] ?? null) : null,
    chung: Math.abs(a - b) === 6,
    wonjin: WONJIN_PAIRS.has(key),
  }
}
