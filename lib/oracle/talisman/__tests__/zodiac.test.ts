import { describe, expect, it } from 'vitest'
import { TALISMAN_ZODIAC, TALISMAN_ZODIAC_IDS } from '../zodiac'

describe('talisman OFL zodiac', () => {
  it('stores a closed path and the Unicode codepoint for each sign', () => {
    expect(TALISMAN_ZODIAC_IDS).toHaveLength(12)
    const first = 0x2648
    TALISMAN_ZODIAC_IDS.forEach((id, i) => {
      const glyph = TALISMAN_ZODIAC[id]
      expect(glyph.codepoint).toBe(first + i)
      expect(glyph.d.startsWith('M')).toBe(true)
      expect(glyph.d.includes('Z')).toBe(true)
      expect(glyph.bbox.h).toBeGreaterThan(100)
    })
  })
})
