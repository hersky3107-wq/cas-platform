import { describe, expect, it } from 'vitest'
import {
  DRAW_ENGINE_VERSION,
  IRREVERSIBLE_RUNE_NAMES,
  buildLiuyao,
  hexagramFromYangFlags,
  ichingDraw,
  runeDraw,
  seededShuffle,
  tarotDraw,
} from '..'

describe('draw engine version', () => {
  it('exports DRAW_ENGINE_VERSION', () => {
    // 1.1.0: rune picks from the 24-stone cloth + merkstave removed — a given
    // seed's rune draw changed, which is exactly what this bump signals.
    expect(DRAW_ENGINE_VERSION).toBe('1.1.0')
  })
})

describe('seededShuffle', () => {
  it('yields the identical order 1000 times for the same seed and deck', () => {
    const deck = Array.from({ length: 78 }, (_, i) => i)
    const first = seededShuffle('determinism-seed', deck)
    for (let i = 0; i < 1000; i++) {
      expect(seededShuffle('determinism-seed', deck)).toEqual(first)
    }
  })

  it('changes order when the seed changes', () => {
    const deck = Array.from({ length: 24 }, (_, i) => i)
    expect(seededShuffle('alpha', deck)).not.toEqual(seededShuffle('beta', deck))
  })
})

describe('tarotDraw', () => {
  it('is deterministic for the same seed, spread, and picked positions', () => {
    const input = { seed: 'tarot-seed', spread: 3 as const, pickedPositions: [14, 3, 71] }
    const first = tarotDraw(input)
    for (let i = 0; i < 50; i++) {
      expect(tarotDraw(input)).toEqual(first)
    }
    expect(first.cards).toHaveLength(3)
    expect(first.cards.map((c) => c.positionLabel)).toEqual(['Past', 'Present', 'Future'])
    expect(first.cards.every((c) => typeof c.reversed === 'boolean')).toBe(true)
  })

  it('maps 1-based fan positions into the seeded shuffle', () => {
    const seed = 'fan-map'
    const shuffled = seededShuffle(seed, Array.from({ length: 78 }, (_, i) => i))
    const drawn = tarotDraw({ seed, spread: 1, pickedPositions: [14] })
    expect(drawn.cards[0]!.id).toBe(shuffled[13])
    expect(drawn.cards[0]!.pickedPosition).toBe(14)
  })
})

describe('runeDraw', () => {
  it('never marks a symmetrical rune as reversed — and assigns no merkstave in its place', () => {
    const irreversible = new Set(IRREVERSIBLE_RUNE_NAMES)
    expect(irreversible).toEqual(
      new Set(['Gebo', 'Hagalaz', 'Nauthiz', 'Isa', 'Jera', 'Eihwaz', 'Sowilo', 'Ingwaz', 'Dagaz']),
    )

    for (let i = 0; i < 200; i++) {
      const result = runeDraw({ seed: `rune-${i}`, count: 24 })
      for (const rune of result.runes) {
        if (irreversible.has(rune.name)) {
          expect(rune.reversed).toBe(false)
        }
        expect('merkstave' in rune, 'merkstave was removed with 1.1.0').toBe(false)
      }
    }
  })

  it('is deterministic for the same seed and count', () => {
    const first = runeDraw({ seed: 'rune-det', count: 5 })
    expect(runeDraw({ seed: 'rune-det', count: 5 })).toEqual(first)
  })

  it('maps 1-based cloth positions into the seeded shuffle, like tarot', () => {
    const seed = 'cloth-map'
    const full = runeDraw({ seed, count: 24 })
    const picked = runeDraw({ seed, count: 3, pickedPositions: [24, 1, 12] })
    expect(picked.runes).toHaveLength(3)
    expect(picked.runes[0]!.id).toBe(full.runes[23]!.id)
    expect(picked.runes[1]!.id).toBe(full.runes[0]!.id)
    expect(picked.runes[2]!.id).toBe(full.runes[11]!.id)
    expect(picked.runes[0]!.pickedPosition).toBe(24)
    // Reversal is decided per stone on the cloth at shuffle time, so the same
    // stone shows the same face regardless of which pick order found it.
    expect(picked.runes[0]!.reversed).toBe(full.runes[23]!.reversed)
    expect(picked.runes.map((rune) => rune.positionLabel)).toEqual(['Past', 'Present', 'Future'])
  })
})

describe('ichingDraw / 육효', () => {
  it('derives 지괘 by flipping changing lines — 乾 with old-yang first line becomes 姤', () => {
    const reading = buildLiuyao({
      seed: 'manual',
      values: [9, 7, 7, 7, 7, 7],
    })
    expect(reading.primary.kingWen).toBe(1)
    expect(reading.primary.hanja).toBe('乾')
    expect(reading.resulting.kingWen).toBe(44)
    expect(reading.resulting.hanja).toBe('姤')
    expect(reading.changingPositions).toEqual([1])
  })

  it('assigns 세효 6 to 乾 (본궁) and 세효 1 to 姤 (一世)', () => {
    const qian = hexagramFromYangFlags([true, true, true, true, true, true])
    expect(qian.kingWen).toBe(1)
    const qianReading = buildLiuyao({ seed: 'qian', values: [7, 7, 7, 7, 7, 7] })
    expect(qianReading.shi).toBe(6)
    expect(qianReading.ying).toBe(3)
    expect(qianReading.palace).toBe('乾')
    expect(qianReading.generation).toBe('본궁')

    const gou = buildLiuyao({ seed: 'gou', values: [8, 7, 7, 7, 7, 7] })
    expect(gou.primary.kingWen).toBe(44)
    expect(gou.shi).toBe(1)
    expect(gou.ying).toBe(4)
    expect(gou.generation).toBe('一世')
  })

  it('is deterministic for the same seed', () => {
    const first = ichingDraw({ seed: 'iching-det', dayStem: '甲' })
    for (let i = 0; i < 50; i++) {
      expect(ichingDraw({ seed: 'iching-det', dayStem: '甲' })).toEqual(first)
    }
    expect(first.lines).toHaveLength(6)
    expect(first.lines[0]!.beast).toBe('青龙')
    expect(first.limitations).toEqual([])
  })

  it('flags missing day stem instead of inventing 육수', () => {
    const reading = ichingDraw({ seed: 'no-stem' })
    expect(reading.limitations).toEqual(['no_day_stem'])
    expect(reading.lines.every((line) => line.beast === null)).toBe(true)
  })
})
