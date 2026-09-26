import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  TALISMAN_GLYPH_FONT,
  TALISMAN_GLYPH_LICENCE,
  TALISMAN_GLYPH_VERSION,
  TALISMAN_GLYPHS,
  TALISMAN_HANJA,
  talismanGlyph,
} from '../glyphs'

describe('talisman OFL glyphs', () => {
  it('records an OFL Noto / Source Han serif and has a path for every hanja', () => {
    expect(TALISMAN_GLYPH_FONT).toBe('Noto Serif KR Regular')
    expect(TALISMAN_GLYPH_VERSION).toMatch(/2\.003/)
    expect(TALISMAN_GLYPH_LICENCE).toBe('SIL Open Font License, Version 1.1')
    expect(TALISMAN_HANJA).toEqual([
      '木',
      '火',
      '土',
      '金',
      '水',
      '財',
      '和',
      '合',
      '登',
      '科',
      '康',
      '寧',
      '鎭',
      '甲',
      '乙',
      '丙',
      '丁',
      '戊',
      '己',
      '庚',
      '辛',
      '壬',
      '癸',
      '子',
      '丑',
      '寅',
      '卯',
      '辰',
      '巳',
      '午',
      '未',
      '申',
      '酉',
      '戌',
      '亥',
      '空',
    ])
    for (const ch of TALISMAN_HANJA) {
      const glyph = talismanGlyph(ch)
      expect(glyph.d.startsWith('M')).toBe(true)
      expect(glyph.d.includes('Z')).toBe(true)
      expect(glyph.advance).toBeGreaterThan(0)
      expect(glyph.codepoint).toBe(ch.codePointAt(0))
      expect(glyph.bbox.h).toBeGreaterThan(100)
    }
    expect(Object.keys(TALISMAN_GLYPHS)).toEqual([...TALISMAN_HANJA])
    expect(TALISMAN_GLYPHS['土']!.codepoint).toBe(0x571f)
    expect(TALISMAN_GLYPHS['火']!.codepoint).toBe(0x706b)
    expect(TALISMAN_GLYPHS['土']!.codepoint).not.toBe('上'.codePointAt(0))
    expect(TALISMAN_GLYPHS['火']!.codepoint).not.toBe('七'.codePointAt(0))
  })

  it('keeps the OFL header on the generated module', () => {
    const src = readFileSync('lib/oracle/talisman/glyphs.generated.ts', 'utf8')
    expect(src).toContain('Noto Serif KR Regular')
    expect(src).toContain('SIL Open Font License, Version 1.1')
    expect(src).toContain('Version 2.003')
    expect(src).toContain('No commercial or unknown-licence')
  })
})
