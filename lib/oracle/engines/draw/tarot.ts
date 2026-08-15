import { TAROT_POSITION_BASE, TAROT_SPREADS, type TarotSpreadSize } from './conventions'
import { createRng, shuffleWithRng } from './rng'
import { TAROT_DECK, TAROT_SPREAD_LABELS } from './tables'
import type { TarotDrawResult } from './types'

function isSpreadSize(value: number): value is TarotSpreadSize {
  return (TAROT_SPREADS as readonly number[]).includes(value)
}

export function tarotDraw(input: {
  seed: string
  spread: TarotSpreadSize
  pickedPositions: number[]
}): TarotDrawResult {
  if (!isSpreadSize(input.spread)) {
    throw new RangeError(`draw engine: spread must be 1, 3, 5, or 10`)
  }
  const labels = TAROT_SPREAD_LABELS[input.spread]
  if (input.pickedPositions.length !== input.spread) {
    throw new RangeError(`draw engine: expected ${input.spread} pickedPositions, got ${input.pickedPositions.length}`)
  }

  const seen = new Set<number>()
  for (const pos of input.pickedPositions) {
    if (!Number.isInteger(pos) || pos < TAROT_POSITION_BASE || pos > TAROT_DECK.length) {
      throw new RangeError(`draw engine: picked position ${pos} is outside 1..${TAROT_DECK.length}`)
    }
    if (seen.has(pos)) throw new RangeError(`draw engine: duplicate picked position ${pos}`)
    seen.add(pos)
  }

  const rng = createRng(input.seed)
  const shuffled = shuffleWithRng(rng, TAROT_DECK)
  const reversedFlags = shuffled.map(() => rng.nextBool())

  const cards = input.pickedPositions.map((pos, index) => {
    const card = shuffled[pos - TAROT_POSITION_BASE]!
    return {
      id: card.id,
      name: card.name,
      arcana: card.arcana,
      suit: card.suit,
      number: card.number,
      reversed: reversedFlags[pos - TAROT_POSITION_BASE]!,
      positionLabel: labels[index]!,
      pickedPosition: pos,
    }
  })

  return { seed: input.seed, spread: input.spread, cards }
}
