import { RUNE_POSITION_BASE } from './conventions'
import { createRng, shuffleWithRng } from './rng'
import { ELDER_FUTHARK, RUNE_SPREAD_LABELS } from './tables'
import type { RuneDrawResult } from './types'

/**
 * Seeded Elder Futhark draw.
 *
 * The seed shuffles all 24 stones once (the face-down cloth) and fixes each
 * stone's orientation up front — exactly the tarot pattern — so WHICH stones
 * the user picks decides the reading, while the cloth itself is reproducible
 * from the seed. `pickedPositions` are 1-based indexes into that shuffle;
 * omitted picks fall back to the first `count` stones (legacy behaviour).
 *
 * Reversal audit (2026-09-05): the nine vertically-symmetric runes (Gebo,
 * Hagalaz, Nauthiz, Isa, Jera, Eihwaz, Sowilo, Ingwaz, Dagaz) CANNOT land
 * reversed — and a random "merkstave" flag is the same judgement renamed, so
 * the engine no longer assigns one. Orientation exists only for the 15
 * asymmetric runes.
 */
export function runeDraw(input: {
  seed: string
  count: number
  pickedPositions?: readonly number[]
}): RuneDrawResult {
  const { seed, count } = input
  if (!Number.isInteger(count) || count < 1 || count > ELDER_FUTHARK.length) {
    throw new RangeError(`draw engine: rune count must be 1..${ELDER_FUTHARK.length}`)
  }

  const positions =
    input.pickedPositions ?? Array.from({ length: count }, (_, i) => i + RUNE_POSITION_BASE)
  if (positions.length !== count) {
    throw new RangeError(`draw engine: expected ${count} pickedPositions, got ${positions.length}`)
  }
  const seen = new Set<number>()
  for (const pos of positions) {
    if (!Number.isInteger(pos) || pos < RUNE_POSITION_BASE || pos > ELDER_FUTHARK.length) {
      throw new RangeError(`draw engine: picked position ${pos} is outside 1..${ELDER_FUTHARK.length}`)
    }
    if (seen.has(pos)) throw new RangeError(`draw engine: duplicate picked position ${pos}`)
    seen.add(pos)
  }

  const rng = createRng(seed)
  const shuffled = shuffleWithRng(rng, ELDER_FUTHARK)
  // Orientation is fixed per cloth position BEFORE any pick, like tarot's
  // reversedFlags — picking order cannot change a stone's face.
  const reversedFlags = shuffled.map(() => rng.nextBool())

  const labels = RUNE_SPREAD_LABELS[count] ?? null
  const runes = positions.map((pos, index) => {
    const stone = shuffled[pos - RUNE_POSITION_BASE]!
    return {
      id: stone.id,
      name: stone.name,
      transliteration: stone.transliteration,
      glyph: stone.glyph,
      reversed: stone.irreversible ? false : reversedFlags[pos - RUNE_POSITION_BASE]!,
      positionLabel: labels?.[index] ?? `Rune ${index + 1}`,
      pickedPosition: pos,
    }
  })

  return { seed, count, runes }
}
