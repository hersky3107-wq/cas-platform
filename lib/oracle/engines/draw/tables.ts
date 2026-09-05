/**
 * All lookup tables for the draw engine. Logic stays out of this file.
 *
 * 육효 convention (explicit, one school):
 *   Jing Fang 京房 / Wen Wang Gua 文王卦 as taught in standard 六爻 textbooks.
 *   Flagged alternatives are documented next to the table they would change.
 */
import { SHI_YING_BY_GENERATION, type PalaceGeneration } from './conventions'

export type { PalaceGeneration }
import type { TarotSpreadSize } from './conventions'

export type FiveElement = 'wood' | 'fire' | 'earth' | 'metal' | 'water'
export type PalaceName = '乾' | '兑' | '离' | '震' | '巽' | '坎' | '艮' | '坤'
export type SixRelative = '兄弟' | '子孙' | '妻财' | '官鬼' | '父母'
export type SixBeast = '青龙' | '朱雀' | '勾陈' | '螣蛇' | '白虎' | '玄武'
export type TrigramName = '乾' | '兑' | '离' | '震' | '巽' | '坎' | '艮' | '坤'
export type LineValue = 6 | 7 | 8 | 9

export type TarotArcana = 'major' | 'minor'
export type TarotSuit = 'wands' | 'cups' | 'swords' | 'pentacles' | null

export type TarotCardDef = {
  id: number
  name: string
  arcana: TarotArcana
  suit: TarotSuit
  number: number
}

const MAJOR_NAMES = [
  'The Fool',
  'The Magician',
  'The High Priestess',
  'The Empress',
  'The Emperor',
  'The Hierophant',
  'The Lovers',
  'The Chariot',
  'Strength',
  'The Hermit',
  'Wheel of Fortune',
  'Justice',
  'The Hanged Man',
  'Death',
  'Temperance',
  'The Devil',
  'The Tower',
  'The Star',
  'The Moon',
  'The Sun',
  'Judgement',
  'The World',
] as const

const RANK_NAMES = [
  'Ace',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Page',
  'Knight',
  'Queen',
  'King',
] as const

/** Matches public/tarot/deck.json id order: majors, cups, swords, wands, pentacles. */
function buildTarotDeck(): TarotCardDef[] {
  const deck: TarotCardDef[] = MAJOR_NAMES.map((name, id) => ({
    id,
    name,
    arcana: 'major',
    suit: null,
    number: id,
  }))
  const suits: { suit: Exclude<TarotSuit, null>; label: string }[] = [
    { suit: 'cups', label: 'Cups' },
    { suit: 'swords', label: 'Swords' },
    { suit: 'wands', label: 'Wands' },
    { suit: 'pentacles', label: 'Pentacles' },
  ]
  for (const { suit, label } of suits) {
    for (let rank = 0; rank < 14; rank++) {
      deck.push({
        id: deck.length,
        name: `${RANK_NAMES[rank]} of ${label}`,
        arcana: 'minor',
        suit,
        number: rank + 1,
      })
    }
  }
  return deck
}

export const TAROT_DECK: readonly TarotCardDef[] = buildTarotDeck()

export const TAROT_SPREAD_LABELS: Record<TarotSpreadSize, readonly string[]> = {
  1: ["Today's message"],
  3: ['Past', 'Present', 'Future'],
  5: ['Situation', 'Obstacle', 'Advice', 'External', 'Outcome'],
  10: [
    'The Present',
    'The Challenge',
    'The Past',
    'The Future',
    'Above (Conscious)',
    'Below (Unconscious)',
    'Advice',
    'External Influences',
    'Hopes and Fears',
    'Outcome',
  ],
}

/**
 * Elder Futhark, 24, conventional aett order.
 *
 * Irreversible (no inverted glyph) — verified against the usual contemporary
 * teaching set (Thorsson / most popular rune manuals):
 *   Gebo, Hagalaz, Nauthiz, Isa, Jera, Eihwaz, Sowilo, Ingwaz, Dagaz.
 *
 * Nauthiz ᚾ is visually chiral under a 180° rotation (the cross-stroke flips).
 * Schools that treat "reversed" as a literal inversion therefore reverse it.
 * Schools that treat "no distinct inverted glyph" as the rule do not.
 * CONVENTION: follow the latter (user-specified list). Use merkstave, never
 * fake `reversed:true` for these nine.
 */
export type RuneDef = {
  id: number
  name: string
  transliteration: string
  glyph: string
  irreversible: boolean
}

export const ELDER_FUTHARK: readonly RuneDef[] = [
  { id: 0, name: 'Fehu', transliteration: 'f', glyph: 'ᚠ', irreversible: false },
  { id: 1, name: 'Uruz', transliteration: 'u', glyph: 'ᚢ', irreversible: false },
  { id: 2, name: 'Thurisaz', transliteration: 'þ', glyph: 'ᚦ', irreversible: false },
  { id: 3, name: 'Ansuz', transliteration: 'a', glyph: 'ᚨ', irreversible: false },
  { id: 4, name: 'Raidho', transliteration: 'r', glyph: 'ᚱ', irreversible: false },
  { id: 5, name: 'Kenaz', transliteration: 'k', glyph: 'ᚲ', irreversible: false },
  { id: 6, name: 'Gebo', transliteration: 'g', glyph: 'ᚷ', irreversible: true },
  { id: 7, name: 'Wunjo', transliteration: 'w', glyph: 'ᚹ', irreversible: false },
  { id: 8, name: 'Hagalaz', transliteration: 'h', glyph: 'ᚺ', irreversible: true },
  { id: 9, name: 'Nauthiz', transliteration: 'n', glyph: 'ᚾ', irreversible: true },
  { id: 10, name: 'Isa', transliteration: 'i', glyph: 'ᛁ', irreversible: true },
  { id: 11, name: 'Jera', transliteration: 'j', glyph: 'ᛃ', irreversible: true },
  { id: 12, name: 'Eihwaz', transliteration: 'ï', glyph: 'ᛇ', irreversible: true },
  { id: 13, name: 'Perthro', transliteration: 'p', glyph: 'ᛈ', irreversible: false },
  { id: 14, name: 'Algiz', transliteration: 'z', glyph: 'ᛉ', irreversible: false },
  { id: 15, name: 'Sowilo', transliteration: 's', glyph: 'ᛊ', irreversible: true },
  { id: 16, name: 'Tiwaz', transliteration: 't', glyph: 'ᛏ', irreversible: false },
  { id: 17, name: 'Berkano', transliteration: 'b', glyph: 'ᛒ', irreversible: false },
  { id: 18, name: 'Ehwaz', transliteration: 'e', glyph: 'ᛖ', irreversible: false },
  { id: 19, name: 'Mannaz', transliteration: 'm', glyph: 'ᛗ', irreversible: false },
  { id: 20, name: 'Laguz', transliteration: 'l', glyph: 'ᛚ', irreversible: false },
  { id: 21, name: 'Ingwaz', transliteration: 'ŋ', glyph: 'ᛜ', irreversible: true },
  { id: 22, name: 'Dagaz', transliteration: 'd', glyph: 'ᛞ', irreversible: true },
  { id: 23, name: 'Othala', transliteration: 'o', glyph: 'ᛟ', irreversible: false },
]

export const IRREVERSIBLE_RUNE_NAMES = ELDER_FUTHARK.filter((r) => r.irreversible).map((r) => r.name)

/**
 * Rune spread position labels, same convention as TAROT_SPREAD_LABELS:
 * 1 = today's rune, 3 = the Norns (past/present/future), 5 = cross.
 * Korean display strings live in lib/oracle/display-copy.ts.
 */
export const RUNE_SPREAD_LABELS: Record<number, readonly string[]> = {
  1: ["Today's rune"],
  3: ['Past', 'Present', 'Future'],
  5: ['Situation', 'Obstacle', 'Advice', 'External', 'Outcome'],
}

export const HEXAGRAM_NAMES: readonly { kingWen: number; hanja: string; hangul: string; english: string }[] = [
  { kingWen: 1, hanja: '乾', hangul: '건', english: 'The Creative' },
  { kingWen: 2, hanja: '坤', hangul: '곤', english: 'The Receptive' },
  { kingWen: 3, hanja: '屯', hangul: '둔', english: 'Difficulty at the Beginning' },
  { kingWen: 4, hanja: '蒙', hangul: '몽', english: 'Youthful Folly' },
  { kingWen: 5, hanja: '需', hangul: '수', english: 'Waiting' },
  { kingWen: 6, hanja: '訟', hangul: '송', english: 'Conflict' },
  { kingWen: 7, hanja: '師', hangul: '사', english: 'The Army' },
  { kingWen: 8, hanja: '比', hangul: '비', english: 'Holding Together' },
  { kingWen: 9, hanja: '小畜', hangul: '소축', english: 'Small Taming' },
  { kingWen: 10, hanja: '履', hangul: '리', english: 'Treading' },
  { kingWen: 11, hanja: '泰', hangul: '태', english: 'Peace' },
  { kingWen: 12, hanja: '否', hangul: '비', english: 'Standstill' },
  { kingWen: 13, hanja: '同人', hangul: '동인', english: 'Fellowship' },
  { kingWen: 14, hanja: '大有', hangul: '대유', english: 'Great Possession' },
  { kingWen: 15, hanja: '謙', hangul: '겸', english: 'Modesty' },
  { kingWen: 16, hanja: '豫', hangul: '예', english: 'Enthusiasm' },
  { kingWen: 17, hanja: '隨', hangul: '수', english: 'Following' },
  { kingWen: 18, hanja: '蠱', hangul: '고', english: 'Work on the Decayed' },
  { kingWen: 19, hanja: '臨', hangul: '임', english: 'Approach' },
  { kingWen: 20, hanja: '觀', hangul: '관', english: 'Contemplation' },
  { kingWen: 21, hanja: '噬嗑', hangul: '서합', english: 'Biting Through' },
  { kingWen: 22, hanja: '賁', hangul: '분', english: 'Grace' },
  { kingWen: 23, hanja: '剝', hangul: '박', english: 'Splitting Apart' },
  { kingWen: 24, hanja: '復', hangul: '복', english: 'Return' },
  { kingWen: 25, hanja: '無妄', hangul: '무망', english: 'Innocence' },
  { kingWen: 26, hanja: '大畜', hangul: '대축', english: 'Great Taming' },
  { kingWen: 27, hanja: '頤', hangul: '이', english: 'Nourishment' },
  { kingWen: 28, hanja: '大過', hangul: '대과', english: 'Great Exceeding' },
  { kingWen: 29, hanja: '坎', hangul: '감', english: 'The Abysmal' },
  { kingWen: 30, hanja: '離', hangul: '리', english: 'The Clinging' },
  { kingWen: 31, hanja: '咸', hangul: '함', english: 'Influence' },
  { kingWen: 32, hanja: '恆', hangul: '항', english: 'Duration' },
  { kingWen: 33, hanja: '遯', hangul: '둔', english: 'Retreat' },
  { kingWen: 34, hanja: '大壯', hangul: '대장', english: 'Great Power' },
  { kingWen: 35, hanja: '晉', hangul: '진', english: 'Progress' },
  { kingWen: 36, hanja: '明夷', hangul: '명이', english: 'Darkening of the Light' },
  { kingWen: 37, hanja: '家人', hangul: '가인', english: 'The Family' },
  { kingWen: 38, hanja: '睽', hangul: '규', english: 'Opposition' },
  { kingWen: 39, hanja: '蹇', hangul: '건', english: 'Obstruction' },
  { kingWen: 40, hanja: '解', hangul: '해', english: 'Deliverance' },
  { kingWen: 41, hanja: '損', hangul: '손', english: 'Decrease' },
  { kingWen: 42, hanja: '益', hangul: '익', english: 'Increase' },
  { kingWen: 43, hanja: '夬', hangul: '쾌', english: 'Breakthrough' },
  { kingWen: 44, hanja: '姤', hangul: '구', english: 'Coming to Meet' },
  { kingWen: 45, hanja: '萃', hangul: '췌', english: 'Gathering' },
  { kingWen: 46, hanja: '升', hangul: '승', english: 'Pushing Upward' },
  { kingWen: 47, hanja: '困', hangul: '곤', english: 'Oppression' },
  { kingWen: 48, hanja: '井', hangul: '정', english: 'The Well' },
  { kingWen: 49, hanja: '革', hangul: '혁', english: 'Revolution' },
  { kingWen: 50, hanja: '鼎', hangul: '정', english: 'The Cauldron' },
  { kingWen: 51, hanja: '震', hangul: '진', english: 'The Arousing' },
  { kingWen: 52, hanja: '艮', hangul: '간', english: 'Keeping Still' },
  { kingWen: 53, hanja: '漸', hangul: '점', english: 'Development' },
  { kingWen: 54, hanja: '歸妹', hangul: '귀매', english: 'The Marrying Maiden' },
  { kingWen: 55, hanja: '豐', hangul: '풍', english: 'Abundance' },
  { kingWen: 56, hanja: '旅', hangul: '려', english: 'The Wanderer' },
  { kingWen: 57, hanja: '巽', hangul: '손', english: 'The Gentle' },
  { kingWen: 58, hanja: '兌', hangul: '태', english: 'The Joyous' },
  { kingWen: 59, hanja: '渙', hangul: '환', english: 'Dispersion' },
  { kingWen: 60, hanja: '節', hangul: '절', english: 'Limitation' },
  { kingWen: 61, hanja: '中孚', hangul: '중부', english: 'Inner Truth' },
  { kingWen: 62, hanja: '小過', hangul: '소과', english: 'Small Exceeding' },
  { kingWen: 63, hanja: '既濟', hangul: '기제', english: 'After Completion' },
  { kingWen: 64, hanja: '未濟', hangul: '미제', english: 'Before Completion' },
]

/**
 * bits = line1 + 2*line2 + … + 32*line6, yang=1, yin=0, line1 is the bottom.
 * Index 0 = 坤, index 63 = 乾.
 */
export const KING_WEN_BY_BITS: readonly number[] = [
  2, 24, 7, 19, 15, 36, 46, 11, 16, 51, 40, 54, 62, 55, 32, 34, 8, 3, 29, 60, 39, 63, 48, 5, 45, 17, 47, 58, 31, 49,
  28, 43, 23, 27, 4, 41, 52, 22, 18, 26, 35, 21, 64, 38, 56, 30, 50, 14, 20, 42, 59, 61, 53, 37, 57, 9, 12, 25, 6, 10,
  33, 13, 44, 1,
]

/**
 * Jing Fang eight palaces. Order inside each palace:
 * 본궁, 一世, 二世, 三世, 四世, 五世, 游魂, 归魂.
 */
export const PALACE_HEXAGRAMS: readonly {
  palace: PalaceName
  element: FiveElement
  kingWen: readonly [number, number, number, number, number, number, number, number]
}[] = [
  { palace: '乾', element: 'metal', kingWen: [1, 44, 33, 12, 20, 23, 35, 14] },
  { palace: '兑', element: 'metal', kingWen: [58, 47, 45, 31, 39, 15, 62, 54] },
  { palace: '离', element: 'fire', kingWen: [30, 56, 50, 64, 4, 59, 6, 13] },
  { palace: '震', element: 'wood', kingWen: [51, 16, 40, 32, 46, 48, 28, 17] },
  { palace: '巽', element: 'wood', kingWen: [57, 9, 37, 42, 25, 21, 27, 18] },
  { palace: '坎', element: 'water', kingWen: [29, 60, 3, 63, 49, 55, 36, 7] },
  { palace: '艮', element: 'earth', kingWen: [52, 22, 26, 41, 38, 10, 61, 53] },
  { palace: '坤', element: 'earth', kingWen: [2, 24, 19, 11, 34, 43, 5, 8] },
]

const GENERATION_ORDER: readonly PalaceGeneration[] = [
  '본궁',
  '一世',
  '二世',
  '三世',
  '四世',
  '五世',
  '游魂',
  '归魂',
]

export type PalaceInfo = {
  palace: PalaceName
  element: FiveElement
  generation: PalaceGeneration
  shi: number
  ying: number
}

export const PALACE_BY_KING_WEN: Record<number, PalaceInfo> = Object.fromEntries(
  PALACE_HEXAGRAMS.flatMap((entry) =>
    entry.kingWen.map((kw, index) => {
      const generation = GENERATION_ORDER[index]!
      const { shi, ying } = SHI_YING_BY_GENERATION[generation]
      return [kw, { palace: entry.palace, element: entry.element, generation, shi, ying }]
    }),
  ),
)

/** Trigram bits: bottom, middle, top. yang=1. */
export const TRIGRAM_BY_BITS: readonly TrigramName[] = ['坤', '震', '坎', '兑', '艮', '离', '巽', '乾']

/**
 * 납갑 地支 for each trigram.
 * Inner = lower trigram (lines 1–3). Outer = upper trigram (lines 4–6).
 * 乾/震 share the same 地支 sequence (school difference vs. some 梅花 charts
 * that start 震 at 寅). CONVENTION: classic 京房纳甲, 乾=震=子寅辰/午申戌.
 */
export const NAJIA_BRANCHES: Record<TrigramName, { inner: readonly [string, string, string]; outer: readonly [string, string, string] }> =
  {
    乾: { inner: ['子', '寅', '辰'], outer: ['午', '申', '戌'] },
    坤: { inner: ['未', '巳', '卯'], outer: ['丑', '亥', '酉'] },
    震: { inner: ['子', '寅', '辰'], outer: ['午', '申', '戌'] },
    巽: { inner: ['丑', '亥', '酉'], outer: ['未', '巳', '卯'] },
    坎: { inner: ['寅', '辰', '午'], outer: ['申', '戌', '子'] },
    离: { inner: ['卯', '丑', '亥'], outer: ['酉', '未', '巳'] },
    艮: { inner: ['辰', '午', '申'], outer: ['戌', '子', '寅'] },
    兑: { inner: ['巳', '卯', '丑'], outer: ['亥', '酉', '未'] },
  }

export const BRANCH_ELEMENT: Record<string, FiveElement> = {
  子: 'water',
  亥: 'water',
  寅: 'wood',
  卯: 'wood',
  巳: 'fire',
  午: 'fire',
  申: 'metal',
  酉: 'metal',
  辰: 'earth',
  戌: 'earth',
  丑: 'earth',
  未: 'earth',
}

const PRODUCES: Record<FiveElement, FiveElement> = {
  wood: 'fire',
  fire: 'earth',
  earth: 'metal',
  metal: 'water',
  water: 'wood',
}

const OVERCOMES: Record<FiveElement, FiveElement> = {
  wood: 'earth',
  fire: 'metal',
  earth: 'water',
  metal: 'wood',
  water: 'fire',
}

/** 육친 from the palace element (me) toward the line element. */
export function sixRelative(palaceElement: FiveElement, lineElement: FiveElement): SixRelative {
  if (lineElement === palaceElement) return '兄弟'
  if (lineElement === PRODUCES[palaceElement]) return '子孙'
  if (lineElement === OVERCOMES[palaceElement]) return '妻财'
  if (palaceElement === OVERCOMES[lineElement]) return '官鬼'
  return '父母'
}

export const SIX_BEASTS: readonly SixBeast[] = ['青龙', '朱雀', '勾陈', '螣蛇', '白虎', '玄武']

/**
 * 육수 starting index from the day stem.
 * CONVENTION: 甲乙 share 青龙, 丙丁 share 朱雀, 戊 alone 勾陈, 己 alone 螣蛇,
 * 庚辛 share 白虎, 壬癸 share 玄武. Some schools lump 戊己 together on 勾陈;
 * we keep the split 戊/己 start, which is the common 六爻 textbook form.
 */
export const SIX_BEAST_START_BY_STEM: Record<string, number> = {
  甲: 0,
  乙: 0,
  丙: 1,
  丁: 1,
  戊: 2,
  己: 3,
  庚: 4,
  辛: 4,
  壬: 5,
  癸: 5,
  갑: 0,
  을: 0,
  병: 1,
  정: 1,
  무: 2,
  기: 3,
  경: 4,
  신: 4,
  임: 5,
  계: 5,
}

export const STEM_HANJA = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'] as const
