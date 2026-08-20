import { ELEMENT_AXES, PHASE_AXES, TRAIT_AXES, type ElementVector, type PhaseVector, type TraitVector } from './types'

export function clamp100(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, Math.round(n * 10) / 10))
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export function sumValues(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

/**
 * Renormalize non-negative shares so they sum to exactly 100 (one decimal).
 * Returns null when every input is zero or negative — the caller treats that
 * as an unreadable space rather than inventing a flat distribution.
 */
export function normalizeTo100<K extends string>(raw: Record<K, number>, keys: readonly K[]): Record<K, number> | null {
  const clipped = keys.map((key) => Math.max(0, raw[key] ?? 0))
  const total = sumValues(clipped)
  if (total <= 0) return null

  const exact = clipped.map((value) => (value / total) * 100)
  const tenths = exact.map((value) => Math.floor(value * 10 + 1e-9))
  const leftover = 1000 - sumValues(tenths)
  const order = exact
    .map((value, index) => ({ index, frac: value * 10 - tenths[index]! }))
    .sort((a, b) => b.frac - a.frac)

  for (let n = 0; n < leftover; n += 1) {
    tenths[order[n]!.index]! += 1
  }

  const out = {} as Record<K, number>
  keys.forEach((key, index) => {
    out[key] = tenths[index]! / 10
  })
  return out
}

export function emptyTraits(fill = 0): TraitVector {
  return {
    drive: fill,
    stability: fill,
    relation: fill,
    control: fill,
    exploration: fill,
    reflection: fill,
  }
}

export function emptyElements(fill = 0): ElementVector {
  return { wood: fill, fire: fill, earth: fill, metal: fill, water: fill }
}

export function emptyPhase(fill = 0): PhaseVector {
  return { advance: fill, hold: fill, release: fill }
}

export function clampTraits(raw: TraitVector): TraitVector {
  const out = emptyTraits()
  for (const axis of TRAIT_AXES) out[axis] = clamp100(raw[axis])
  return out
}

export function normalizeElements(raw: { wood: number; fire: number; earth: number; metal: number; water: number }): ElementVector | null {
  return normalizeTo100(raw, ELEMENT_AXES)
}

export function normalizePhase(raw: Record<string, number>): PhaseVector | null {
  return normalizeTo100(raw as PhaseVector, PHASE_AXES)
}

/**
 * Subtract a vote's OWN mean (across its 6 trait axes) from each axis.
 * What survives is the SHAPE of that vote — which axes it emphasizes
 * relative to itself — with the absolute level (scale/offset) removed.
 * Used by the aggregator so systems on different absolute scales (e.g.
 * prism's mean-50/SD-12 normalization vs saju/astro's raw 0-100 shares)
 * are compared on shape, not level.
 */
export function centeredTraits(traits: TraitVector): TraitVector {
  const ownMean = TRAIT_AXES.reduce((sum, axis) => sum + traits[axis], 0) / TRAIT_AXES.length
  const out = emptyTraits()
  for (const axis of TRAIT_AXES) out[axis] = traits[axis] - ownMean
  return out
}

/**
 * Reflect a trait mix (values in [0,1] summing to 1) around its OWN
 * min/max range, then renormalize back to sum 1. Whichever axes a mix
 * emphasizes become the axes it de-emphasizes, and vice versa — a
 * symmetric flip, not "zero out the top axis." Used for divinatory
 * REVERSALS (tarot's reversed cards); nothing else in the aggregator
 * needs it, which is why it lives here as a general vector op rather
 * than a tarot-specific one.
 */
export function reflectTraitMix(mix: TraitVector): TraitVector {
  const values = TRAIT_AXES.map((axis) => mix[axis])
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const reflected = emptyTraits()
  for (const axis of TRAIT_AXES) reflected[axis] = hi + lo - mix[axis]
  const total = TRAIT_AXES.reduce((sum, axis) => sum + reflected[axis], 0)
  if (total <= 0) return emptyTraits(1 / TRAIT_AXES.length)
  for (const axis of TRAIT_AXES) reflected[axis] = reflected[axis] / total
  return reflected
}

export function weightedMean(values: { x: number; w: number }[]): number {
  const totalWeight = values.reduce((sum, row) => sum + row.w, 0)
  if (totalWeight <= 0) return 0
  return values.reduce((sum, row) => sum + row.x * row.w, 0) / totalWeight
}

export function weightedSd(values: { x: number; w: number }[], mean: number): number {
  const totalWeight = values.reduce((sum, row) => sum + row.w, 0)
  if (totalWeight <= 0 || values.length < 2) return 0
  const variance = values.reduce((sum, row) => sum + row.w * (row.x - mean) ** 2, 0) / totalWeight
  return Math.sqrt(variance)
}
