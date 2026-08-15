/**
 * Seeded PRNG. No Math.random(). Same seed always yields the same stream.
 * xmur3 string hash + mulberry32, both public-domain constructions.
 */

export type SeededRng = {
  /** Uniform float in [0, 1). */
  next: () => number
  /** Uniform integer in [0, max). */
  nextInt: (max: number) => number
  nextBool: () => boolean
}

function xmur3(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return (h ^= h >>> 16) >>> 0
  }
}

function mulberry32(state: number): () => number {
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function createRng(seed: string): SeededRng {
  if (seed.length === 0) throw new RangeError('draw engine: seed must be a non-empty string')
  const next = mulberry32(xmur3(seed)())
  return {
    next,
    nextInt(max: number) {
      if (!Number.isInteger(max) || max <= 0) throw new RangeError(`draw engine: nextInt max must be a positive integer, got ${max}`)
      return Math.floor(next() * max)
    },
    nextBool() {
      return next() < 0.5
    },
  }
}

/** Fisher–Yates. Same seed + same deck always yields the same order. */
export function seededShuffle<T>(seed: string, deck: readonly T[]): T[] {
  const rng = createRng(seed)
  const out = deck.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1)
    const tmp = out[i]!
    out[i] = out[j]!
    out[j] = tmp
  }
  return out
}
