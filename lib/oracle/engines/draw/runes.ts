import { createRng, shuffleWithRng } from './rng'
import { ELDER_FUTHARK } from './tables'
import type { RuneDrawResult } from './types'

export function runeDraw(input: { seed: string; count: number }): RuneDrawResult {
  const { seed, count } = input
  if (!Number.isInteger(count) || count < 1 || count > ELDER_FUTHARK.length) {
    throw new RangeError(`draw engine: rune count must be 1..${ELDER_FUTHARK.length}`)
  }

  const rng = createRng(seed)
  const shuffled = shuffleWithRng(rng, ELDER_FUTHARK)
  const runes = shuffled.slice(0, count).map((rune) => {
    const flag = rng.nextBool()
    if (rune.irreversible) {
      return {
        id: rune.id,
        name: rune.name,
        transliteration: rune.transliteration,
        glyph: rune.glyph,
        reversed: false,
        merkstave: flag,
      }
    }
    return {
      id: rune.id,
      name: rune.name,
      transliteration: rune.transliteration,
      glyph: rune.glyph,
      reversed: flag,
      merkstave: false,
    }
  })

  return { seed, count, runes }
}
