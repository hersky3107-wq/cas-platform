import { describe, expect, it } from 'vitest'
import { uniqueOppositionPairs } from '../opposition-pairs'

describe('uniqueOppositionPairs', () => {
  it('drops a second pair that repeats the same system or the same quote', () => {
    const quotes = new Map([
      ['runes', '룬은 나아가라'],
      ['numerology', '수는 정리하라'],
      ['tarot', '타로는 접어라'],
    ])
    const out = uniqueOppositionPairs(
      [
        { a: 'runes', b: 'numerology', gap: 70 },
        { a: 'runes', b: 'tarot', gap: 65 },
      ],
      quotes,
    )
    expect(out).toEqual([{ a: 'runes', b: 'numerology', gap: 70 }])
  })

  it('keeps two pairs when all four systems and quotes are new', () => {
    const quotes = new Map([
      ['runes', '룬은 나아가라'],
      ['numerology', '수는 정리하라'],
      ['tarot', '타로는 접어라'],
      ['sukuyou', '숙요는 기다리라'],
    ])
    const out = uniqueOppositionPairs(
      [
        { a: 'runes', b: 'numerology', gap: 70 },
        { a: 'tarot', b: 'sukuyou', gap: 62 },
      ],
      quotes,
    )
    expect(out).toHaveLength(2)
  })
})
