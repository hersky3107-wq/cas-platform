/**
 * Lookup tables for the name engine. Logic stays in index.ts.
 * See conventions.ts for full sourcing/methodology notes and
 * docs/name-verification.md for the worked verification examples.
 */
import type { FiveElement, SuriEntry, SuriLabel } from './types'

// ───────────────────────────────────────────────────────────────────────
// 한글 원획법 — 훈민정음 원획법 자모 획수표
// Source: https://www.parkhongsam.com/53 (자음/모음 획수), cross-checked
// against https://chaso.tistory.com/39 (ㅃ filled in as 4, matching the
// doubling of ㅂ's group). ㅑ is not listed by either source; it is
// derived by the same additive pattern the source table already follows
// for every other simple/compound vowel pair (ㅓ=2→ㅕ=3, ㅗ=2→ㅛ=3,
// ㅜ=2→ㅠ=3, so ㅏ=2→ㅑ=3).
// ───────────────────────────────────────────────────────────────────────

/** 초성/종성에 쓰이는 19개 기본 자음(홑자음+쌍자음) 원획수. */
export const HANGUL_CONSONANT_STROKES: Record<string, number> = {
  ㄱ: 1,
  ㄴ: 1,
  ㅇ: 1,
  ㄷ: 2,
  ㅅ: 2,
  ㅈ: 2,
  ㅋ: 2,
  ㄲ: 2,
  ㄹ: 3,
  ㅁ: 3,
  ㅊ: 3,
  ㅌ: 3,
  ㅎ: 3,
  ㅂ: 4,
  ㅍ: 4,
  ㄸ: 4,
  ㅆ: 4,
  ㅉ: 4,
  ㅃ: 4,
}

/** 중성 21개 모음(단모음+복합모음) 원획수. */
export const HANGUL_VOWEL_STROKES: Record<string, number> = {
  ㅡ: 1,
  ㅣ: 1,
  ㅏ: 2,
  ㅓ: 2,
  ㅗ: 2,
  ㅜ: 2,
  ㅢ: 2,
  ㅐ: 3,
  ㅔ: 3,
  ㅚ: 3,
  ㅟ: 3,
  ㅕ: 3,
  ㅛ: 3,
  ㅠ: 3,
  ㅑ: 3,
  ㅘ: 4,
  ㅝ: 4,
  ㅒ: 4,
  ㅖ: 4,
  ㅙ: 5,
  ㅞ: 5,
}

/**
 * 겹받침(복합종성) 11개는 두 기본 자음의 원획수를 더한다. 이 가산 방식은
 * 위 모음표가 이미 따르는 규칙(예: ㅘ = ㅗ+ㅏ, ㅢ = ㅡ+ㅣ)을 종성에
 * 그대로 확장한 것이며, 별도의 공개된 겹받침 획수표를 찾지 못해 채택한
 * 가장 보수적인 방법이다.
 */
export const HANGUL_COMPLEX_JONGSEONG: Record<string, [string, string]> = {
  ㄳ: ['ㄱ', 'ㅅ'],
  ㄵ: ['ㄴ', 'ㅈ'],
  ㄶ: ['ㄴ', 'ㅎ'],
  ㄺ: ['ㄹ', 'ㄱ'],
  ㄻ: ['ㄹ', 'ㅁ'],
  ㄼ: ['ㄹ', 'ㅂ'],
  ㄽ: ['ㄹ', 'ㅅ'],
  ㄾ: ['ㄹ', 'ㅌ'],
  ㄿ: ['ㄹ', 'ㅍ'],
  ㅀ: ['ㄹ', 'ㅎ'],
  ㅄ: ['ㅂ', 'ㅅ'],
}

/** Unicode 종성(28, index 0 = 받침 없음) 순서. Standard Hangul jamo decomposition table. */
export const JONGSEONG_TABLE = [
  '',
  'ㄱ',
  'ㄲ',
  'ㄳ',
  'ㄴ',
  'ㄵ',
  'ㄶ',
  'ㄷ',
  'ㄹ',
  'ㄺ',
  'ㄻ',
  'ㄼ',
  'ㄽ',
  'ㄾ',
  'ㄿ',
  'ㅀ',
  'ㅁ',
  'ㅂ',
  'ㅄ',
  'ㅅ',
  'ㅆ',
  'ㅇ',
  'ㅈ',
  'ㅊ',
  'ㅋ',
  'ㅌ',
  'ㅍ',
  'ㅎ',
] as const

/** Unicode 초성(19) 순서. */
export const CHOSEONG_TABLE = [
  'ㄱ',
  'ㄲ',
  'ㄴ',
  'ㄷ',
  'ㄸ',
  'ㄹ',
  'ㅁ',
  'ㅂ',
  'ㅃ',
  'ㅅ',
  'ㅆ',
  'ㅇ',
  'ㅈ',
  'ㅉ',
  'ㅊ',
  'ㅋ',
  'ㅌ',
  'ㅍ',
  'ㅎ',
] as const

/** Unicode 중성(21) 순서. */
export const JUNGSEONG_TABLE = [
  'ㅏ',
  'ㅐ',
  'ㅑ',
  'ㅒ',
  'ㅓ',
  'ㅔ',
  'ㅕ',
  'ㅖ',
  'ㅗ',
  'ㅘ',
  'ㅙ',
  'ㅚ',
  'ㅛ',
  'ㅜ',
  'ㅝ',
  'ㅞ',
  'ㅟ',
  'ㅠ',
  'ㅡ',
  'ㅢ',
  'ㅣ',
] as const

// ───────────────────────────────────────────────────────────────────────
// 한자 획수 — 강희자전(康熙字典) 원획, radical-restored
// ───────────────────────────────────────────────────────────────────────

export type RadicalKey =
  | 'water'
  | 'heart'
  | 'grass'
  | 'hand'
  | 'meat'
  | 'dog'
  | 'clothes'
  | 'spirit'
  | 'hill_left'
  | 'city_right'
  | 'jade'
  | 'walk'

export type RadicalRestoration = {
  name: string
  abbreviated: string
  original: string
  abbreviatedStrokes: number
  originalStrokes: number
}

/**
 * The twelve radical-restoration pairs called out in the spec. Values
 * cross-checked against https://taegeukk.tistory.com/137,
 * https://vip4u.tistory.com/11342127, https://www.parkhongsam.com/53, and
 * https://mojisennin.com/basic/kakusu.html. `spirit` (礻→示) uses 5, the
 * standard Kangxi radical-113 stroke count for 示, even though one source
 * (parkhongsam) prints 4 for it — see docs/name-verification.md for the
 * discrepancy note.
 */
export const RADICAL_RESTORATION: Record<RadicalKey, RadicalRestoration> = {
  water: { name: '삼수변', abbreviated: '氵', original: '水', abbreviatedStrokes: 3, originalStrokes: 4 },
  heart: { name: '심방변', abbreviated: '忄', original: '心', abbreviatedStrokes: 3, originalStrokes: 4 },
  grass: { name: '초두머리', abbreviated: '艹', original: '艸', abbreviatedStrokes: 3, originalStrokes: 6 },
  hand: { name: '손수변', abbreviated: '扌', original: '手', abbreviatedStrokes: 3, originalStrokes: 4 },
  meat: { name: '육달월', abbreviated: '月', original: '肉', abbreviatedStrokes: 4, originalStrokes: 6 },
  dog: { name: '개사슴록변', abbreviated: '犭', original: '犬', abbreviatedStrokes: 3, originalStrokes: 4 },
  clothes: { name: '옷의변', abbreviated: '衤', original: '衣', abbreviatedStrokes: 5, originalStrokes: 6 },
  spirit: { name: '보일시변', abbreviated: '礻', original: '示', abbreviatedStrokes: 4, originalStrokes: 5 },
  hill_left: { name: '좌부방', abbreviated: '阝', original: '阜', abbreviatedStrokes: 3, originalStrokes: 8 },
  city_right: { name: '우부방', abbreviated: '阝', original: '邑', abbreviatedStrokes: 3, originalStrokes: 7 },
  jade: { name: '구슬옥변', abbreviated: '王', original: '玉', abbreviatedStrokes: 4, originalStrokes: 5 },
  walk: { name: '책받침', abbreviated: '辶', original: '辵', abbreviatedStrokes: 4, originalStrokes: 7 },
}

/** restored (원획) total = originalStrokes + phoneticStrokes. */
export function restoreRadicalStrokes(radical: RadicalKey, phoneticStrokes: number): number {
  return RADICAL_RESTORATION[radical].originalStrokes + phoneticStrokes
}

/** modern/필획 total = abbreviatedStrokes + phoneticStrokes (NOT what this engine uses for hanja). */
export function modernRadicalStrokes(radical: RadicalKey, phoneticStrokes: number): number {
  return RADICAL_RESTORATION[radical].abbreviatedStrokes + phoneticStrokes
}

export type RadicalTestCase = {
  char: string
  radical: RadicalKey
  /** Strokes of the phonetic/non-radical remainder, independently well-known. */
  phoneticStrokes: number
  expectedModern: number
  expectedRestored: number
}

/**
 * One worked example per radical, e.g. 洙 = 氵(modern 3) + 朱(6) = 9 (필획)
 * vs 水(원획 4) + 朱(6) = 10 (원획, what this engine reports). 郎's pair is
 * independently confirmed against the Kangxi Dictionary's own listed
 * total (部首 邑=7 + 部外筆畫 7 = 14) — see docs/name-verification.md.
 */
export const RADICAL_TEST_CASES: RadicalTestCase[] = [
  { char: '洙', radical: 'water', phoneticStrokes: 6, expectedModern: 9, expectedRestored: 10 },
  { char: '恒', radical: 'heart', phoneticStrokes: 6, expectedModern: 9, expectedRestored: 10 },
  { char: '英', radical: 'grass', phoneticStrokes: 5, expectedModern: 8, expectedRestored: 11 },
  { char: '拓', radical: 'hand', phoneticStrokes: 5, expectedModern: 8, expectedRestored: 9 },
  { char: '肌', radical: 'meat', phoneticStrokes: 2, expectedModern: 6, expectedRestored: 8 },
  { char: '獨', radical: 'dog', phoneticStrokes: 13, expectedModern: 16, expectedRestored: 17 },
  { char: '裕', radical: 'clothes', phoneticStrokes: 7, expectedModern: 12, expectedRestored: 13 },
  { char: '祐', radical: 'spirit', phoneticStrokes: 5, expectedModern: 9, expectedRestored: 10 },
  { char: '陳', radical: 'hill_left', phoneticStrokes: 8, expectedModern: 11, expectedRestored: 16 },
  { char: '郎', radical: 'city_right', phoneticStrokes: 7, expectedModern: 10, expectedRestored: 14 },
  { char: '珍', radical: 'jade', phoneticStrokes: 5, expectedModern: 9, expectedRestored: 10 },
  { char: '進', radical: 'walk', phoneticStrokes: 8, expectedModern: 12, expectedRestored: 15 },
]

/**
 * Curated hanja source table (원획/강희 total), restricted to hanja
 * actually usable in names: common Korean surnames (including the
 * two-character 남궁/선우/서문/황보/사공/독고/제갈 family), common
 * given-name hanja, and a handful of common Japanese surname/given-name
 * kanji. Deliberately small — see conventions.ts.
 */
const KANGXI_STROKES: Record<string, number> = {
  // Korean surnames (single character)
  金: 8,
  李: 7,
  朴: 6,
  崔: 11,
  鄭: 19,
  姜: 9,
  趙: 14,
  尹: 4,
  林: 8,
  韓: 17,
  吳: 7,
  徐: 10,
  申: 5,
  黃: 12,
  安: 6,
  宋: 7,
  全: 6,
  洪: 10,
  劉: 15,
  高: 10,
  文: 4,
  梁: 11,
  孫: 10,
  裵: 14,
  白: 5,
  許: 11,
  南: 9,
  沈: 8,
  河: 9,
  成: 7,
  車: 7,
  朱: 6,
  禹: 9,
  具: 8,
  池: 7,
  嚴: 20,
  蔡: 17,
  元: 4,
  千: 3,
  方: 4,
  孔: 4,
  玄: 5,
  咸: 9,
  卞: 4,
  廉: 13,
  呂: 7,
  秋: 9,
  宣: 9,
  馬: 10,
  吉: 6,
  延: 7,
  表: 8,
  明: 8,
  奇: 8,
  潘: 16,
  王: 4,
  玉: 5,
  陸: 16,
  印: 6,
  孟: 8,
  皮: 5,
  杜: 7,
  魚: 11,
  殷: 10,
  片: 4,
  龍: 16,
  芮: 11,
  慶: 15,
  奉: 8,
  // Two-character surnames
  宮: 10,
  鮮: 17,
  于: 3,
  西: 6,
  門: 8,
  皇: 9,
  甫: 7,
  司: 5,
  空: 8,
  獨: 17,
  孤: 8,
  諸: 16,
  葛: 13,
  // Common given-name hanja
  敏: 11,
  旼: 8,
  珉: 10,
  俊: 9,
  峻: 10,
  瑞: 14,
  書: 10,
  舒: 12,
  姸: 9,
  演: 15,
  智: 12,
  志: 7,
  芝: 11,
  宇: 6,
  佑: 7,
  祐: 10,
  雨: 8,
  賢: 15,
  炫: 9,
  玹: 10,
  雅: 12,
  娥: 10,
  恩: 10,
  銀: 14,
  垠: 9,
  潤: 16,
  英: 11,
  永: 5,
  瑛: 13,
  秀: 7,
  洙: 10,
  修: 10,
  受: 8,
  守: 6,
  收: 6,
  珍: 10,
  眞: 10,
  振: 11,
  晉: 10,
  喜: 12,
  熙: 13,
  姬: 10,
  媛: 12,
  源: 14,
  惠: 12,
  慧: 15,
  星: 9,
  聖: 13,
  海: 11,
  江: 7,
  裕: 13,
  夏: 10,
  賀: 12,
  美: 9,
  淑: 12,
  敬: 13,
  在: 6,
  材: 7,
  才: 3,
  宰: 10,
  勳: 16,
  薰: 20,
  花: 10,
  // Common Japanese surname/given-name kanji
  山: 3,
  田: 5,
  太: 4,
  郎: 14,
  本: 5,
  中: 4,
  木: 4,
  鈴: 13,
  佐: 7,
  藤: 21,
  子: 3,
  一: 1,
  次: 6,
  咲: 9,
}

export type HanjaStrokeCounts = {
  kangxi: number
  modern: number
}

/**
 * Modern/new-form exceptions. Radical-derived values deliberately call
 * `modernRadicalStrokes` so the modern column cannot drift from the
 * restoration table. 郎 is the documented Japanese-calculator exception:
 * public modern calculators count it as 9, while Kangxi counts it as 14.
 */
const MODERN_STROKE_OVERRIDES: Record<string, number> = {
  鄭: modernRadicalStrokes('city_right', 12),
  洪: modernRadicalStrokes('water', 6),
  沈: modernRadicalStrokes('water', 4),
  河: modernRadicalStrokes('water', 5),
  池: modernRadicalStrokes('water', 3),
  蔡: modernRadicalStrokes('grass', 11),
  芮: modernRadicalStrokes('grass', 4),
  潘: modernRadicalStrokes('water', 12),
  陸: modernRadicalStrokes('hill_left', 8),
  獨: modernRadicalStrokes('dog', 13),
  珉: modernRadicalStrokes('jade', 5),
  瑞: modernRadicalStrokes('jade', 9),
  演: modernRadicalStrokes('water', 11),
  芝: modernRadicalStrokes('grass', 3),
  祐: modernRadicalStrokes('spirit', 5),
  玹: modernRadicalStrokes('jade', 5),
  潤: modernRadicalStrokes('water', 12),
  英: modernRadicalStrokes('grass', 5),
  瑛: modernRadicalStrokes('jade', 8),
  洙: modernRadicalStrokes('water', 6),
  珍: modernRadicalStrokes('jade', 5),
  振: modernRadicalStrokes('hand', 7),
  源: modernRadicalStrokes('water', 10),
  海: modernRadicalStrokes('water', 7),
  江: modernRadicalStrokes('water', 3),
  裕: modernRadicalStrokes('clothes', 7),
  淑: modernRadicalStrokes('water', 8),
  薰: modernRadicalStrokes('grass', 14),
  花: modernRadicalStrokes('grass', 4),
  葛: modernRadicalStrokes('grass', 9),
  藤: modernRadicalStrokes('grass', 15),
  郎: 9,
}

/** Every bundled character carries both selectable convention counts. */
export const HANJA_STROKES: Record<string, HanjaStrokeCounts> = Object.fromEntries(
  Object.entries(KANGXI_STROKES).map(([char, kangxi]) => [
    char,
    { kangxi, modern: MODERN_STROKE_OVERRIDES[char] ?? kangxi },
  ]),
)

// ───────────────────────────────────────────────────────────────────────
// 1–81 수리 길흉표 (熊崎式 계열, 5단계: 대길/길/평/흉/대흉)
// ───────────────────────────────────────────────────────────────────────

const SURI_ROWS: Array<[SuriLabel, string]> = [
  ['대길', '태초'],
  ['흉', '분리'],
  ['대길', '천지인'],
  ['흉', '파멸'],
  ['대길', '복덕'],
  ['대길', '조덕'],
  ['길', '독립'],
  ['길', '근면'],
  ['흉', '대재'],
  ['흉', '공허'],
  ['대길', '양춘'],
  ['흉', '박약'],
  ['대길', '지모'],
  ['흉', '파조'],
  ['대길', '복수'],
  ['대길', '후덕'],
  ['길', '강건'],
  ['길', '철석심'],
  ['흉', '고난'],
  ['흉', '공망'],
  ['대길', '두령'],
  ['흉', '박약중단'],
  ['대길', '장려'],
  ['대길', '금운'],
  ['길', '영민'],
  ['흉', '파란'],
  ['흉', '중절'],
  ['흉', '이별'],
  ['길', '지모수확'],
  ['평', '부침'],
  ['대길', '지인용'],
  ['대길', '행운'],
  ['대길', '왕성'],
  ['대흉', '파멸'],
  ['길', '온화평범'],
  ['흉', '의협'],
  ['대길', '충의'],
  ['평', '박약예술'],
  ['길', '부영'],
  ['흉', '퇴보'],
  ['대길', '순박'],
  ['흉', '고로박약'],
  ['흉', '파산'],
  ['대흉', '폐절'],
  ['대길', '순조'],
  ['흉', '만년쇠퇴'],
  ['대길', '개화'],
  ['대길', '고문'],
  ['흉', '변동'],
  ['흉', '성쇠교호'],
  ['평', '성쇠교호'],
  ['길', '선견'],
  ['흉', '성쇠상반'],
  ['대흉', '재화'],
  ['평', '외길내흉'],
  ['흉', '만년쇠퇴'],
  ['길', '한고후영'],
  ['평', '만성'],
  ['흉', '실의'],
  ['흉', '암흑'],
  ['대길', '번영자립'],
  ['흉', '고립'],
  ['대길', '순조발전'],
  ['대흉', '재화'],
  ['대길', '번영장수'],
  ['흉', '파멸고뇌'],
  ['대길', '자주독립'],
  ['대길', '발명개량'],
  ['흉', '정체'],
  ['흉', '멸망'],
  ['평', '진취퇴수'],
  ['흉', '외성내쇠'],
  ['평', '평범안정'],
  ['흉', '도로무능'],
  ['평', '수성'],
  ['흉', '이산'],
  ['평', '중용'],
  ['평', '만성쇠퇴'],
  ['흉', '불우비판'],
  ['흉', '만년쇠퇴'],
  ['대길', '환원'],
]

/** 1-indexed; SURI81[1] is the entry for 1획. */
export const SURI81: SuriEntry[] = [
  { number: 0, label: '평', keyword: '' }, // unused placeholder for 0-index alignment
  ...SURI_ROWS.map(([label, keyword], i) => ({ number: i + 1, label, keyword })),
]

/**
 * Numbers above 81 cycle: 82 → 1, 85 → 4, etc. (82 画以上は81を引いた余りで判定).
 * A gyeok of exactly 0 can legitimately occur (外格 for a single-character
 * surname paired with a single-character given name); by the same cyclic
 * convention it is treated as 81, matching sources that describe a 0 total
 * as "実質81画扱い" (effectively 81).
 */
export function suriFor(n: number): SuriEntry {
  if (!Number.isFinite(n)) throw new RangeError('name engine: suri number must be finite')
  let reduced = ((n % 81) + 81) % 81
  if (reduced === 0) reduced = 81
  return SURI81[reduced]
}

// ───────────────────────────────────────────────────────────────────────
// 오행 (five elements) via 격 last digit — universal 숫자 오행 convention
// ───────────────────────────────────────────────────────────────────────

const ELEMENT_BY_LAST_DIGIT: Record<number, FiveElement> = {
  1: 'wood',
  2: 'wood',
  3: 'fire',
  4: 'fire',
  5: 'earth',
  6: 'earth',
  7: 'metal',
  8: 'metal',
  9: 'water',
  0: 'water',
}

export function elementForGyeok(n: number): FiveElement {
  const lastDigit = Math.abs(n) % 10
  return ELEMENT_BY_LAST_DIGIT[lastDigit]
}

const GENERATES: Record<FiveElement, FiveElement> = {
  wood: 'fire',
  fire: 'earth',
  earth: 'metal',
  metal: 'water',
  water: 'wood',
}

const OVERCOMES: Record<FiveElement, FiveElement> = {
  wood: 'earth',
  earth: 'water',
  water: 'fire',
  fire: 'metal',
  metal: 'wood',
}

/**
 * Direction-agnostic: either element generating the other counts as
 * 상생, either overcoming the other counts as 상극. More detailed schools
 * distinguish "천격이 인격을 생함" from "인격이 천격을 생함"; this engine
 * does not, per conventions.ts.
 */
export function elementRelation(a: FiveElement, b: FiveElement): 'generating' | 'overcoming' | 'same' {
  if (a === b) return 'same'
  if (GENERATES[a] === b || GENERATES[b] === a) return 'generating'
  if (OVERCOMES[a] === b || OVERCOMES[b] === a) return 'overcoming'
  return 'same'
}
