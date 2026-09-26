import { TALISMAN_GLYPHS, type TalismanGlyphPath } from './glyphs.generated'

export {
  TALISMAN_GLYPHS,
  TALISMAN_GLYPH_FONT,
  TALISMAN_GLYPH_VERSION,
  TALISMAN_GLYPH_LICENCE,
  TALISMAN_GLYPH_UNITS,
} from './glyphs.generated'
export type { TalismanGlyphPath }

export const TALISMAN_HANJA = [
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
] as const

export function talismanGlyph(ch: string): TalismanGlyphPath {
  const glyph = TALISMAN_GLYPHS[ch]
  if (!glyph) throw new Error(`missing talisman glyph: ${ch}`)
  return glyph
}
