/**
 * All lookup tables for the calendar engine, separate from logic (per spec).
 * Pure data only — no functions that read the clock or touch I/O.
 */
import type { BranchInfo, FiveElement, StemInfo, SukuyouRelationName, SukuyouRelationPair, YinYang } from './types'

const ELEMENT_CYCLE: FiveElement[] = ['wood', 'fire', 'earth', 'metal', 'water']

/** 상생 (production): wood->fire->earth->metal->water->wood. */
export function producedBy(element: FiveElement): FiveElement {
  const i = ELEMENT_CYCLE.indexOf(element)
  return ELEMENT_CYCLE[(i + 1) % 5]!
}

/** 상극 (domination): wood->earth->water->fire->metal->wood. */
export function overcomes(element: FiveElement): FiveElement {
  const i = ELEMENT_CYCLE.indexOf(element)
  return ELEMENT_CYCLE[(i + 2) % 5]!
}

interface StemSeed {
  hanja: string
  hangul: string
  element: FiveElement
  yinYang: YinYang
}

/** 십천간 (Ten Heavenly Stems), index 0 = 甲. */
export const STEM_SEEDS: readonly StemSeed[] = [
  { hanja: '甲', hangul: '갑', element: 'wood', yinYang: 'yang' },
  { hanja: '乙', hangul: '을', element: 'wood', yinYang: 'yin' },
  { hanja: '丙', hangul: '병', element: 'fire', yinYang: 'yang' },
  { hanja: '丁', hangul: '정', element: 'fire', yinYang: 'yin' },
  { hanja: '戊', hangul: '무', element: 'earth', yinYang: 'yang' },
  { hanja: '己', hangul: '기', element: 'earth', yinYang: 'yin' },
  { hanja: '庚', hangul: '경', element: 'metal', yinYang: 'yang' },
  { hanja: '辛', hangul: '신', element: 'metal', yinYang: 'yin' },
  { hanja: '壬', hangul: '임', element: 'water', yinYang: 'yang' },
  { hanja: '癸', hangul: '계', element: 'water', yinYang: 'yin' },
] as const

export const STEMS: readonly StemInfo[] = STEM_SEEDS.map((s, index) => ({ index, ...s }))

interface BranchSeed {
  hanja: string
  hangul: string
  element: FiveElement
  yinYang: YinYang
  animal: string
}

/** 십이지지 (Twelve Earthly Branches), index 0 = 子. */
export const BRANCH_SEEDS: readonly BranchSeed[] = [
  { hanja: '子', hangul: '자', element: 'water', yinYang: 'yang', animal: '쥐' },
  { hanja: '丑', hangul: '축', element: 'earth', yinYang: 'yin', animal: '소' },
  { hanja: '寅', hangul: '인', element: 'wood', yinYang: 'yang', animal: '호랑이' },
  { hanja: '卯', hangul: '묘', element: 'wood', yinYang: 'yin', animal: '토끼' },
  { hanja: '辰', hangul: '진', element: 'earth', yinYang: 'yang', animal: '용' },
  { hanja: '巳', hangul: '사', element: 'fire', yinYang: 'yin', animal: '뱀' },
  { hanja: '午', hangul: '오', element: 'fire', yinYang: 'yang', animal: '말' },
  { hanja: '未', hangul: '미', element: 'earth', yinYang: 'yin', animal: '양' },
  { hanja: '申', hangul: '신', element: 'metal', yinYang: 'yang', animal: '원숭이' },
  { hanja: '酉', hangul: '유', element: 'metal', yinYang: 'yin', animal: '닭' },
  { hanja: '戌', hangul: '술', element: 'earth', yinYang: 'yang', animal: '개' },
  { hanja: '亥', hangul: '해', element: 'water', yinYang: 'yin', animal: '돼지' },
] as const

export const BRANCHES: readonly BranchInfo[] = BRANCH_SEEDS.map((b, index) => ({ index, ...b }))

export function stemByHanja(hanja: string): StemInfo {
  const found = STEMS.find((s) => s.hanja === hanja)
  if (!found) throw new Error(`calendar engine: unknown stem hanja "${hanja}"`)
  return found
}

export function branchByHanja(hanja: string): BranchInfo {
  const found = BRANCHES.find((b) => b.hanja === hanja)
  if (!found) throw new Error(`calendar engine: unknown branch hanja "${hanja}"`)
  return found
}

/**
 * The 24 solar terms (절기), in calendar-year order starting at 소한 (the order a
 * chronological walk within a single Gregorian year naturally produces). `isJie`
 * marks the 12 "節" terms that begin a ganzhi month; the other 12 "氣" mid-terms do
 * not start a new month pillar. `branchIndexIfJie` is the month-branch (0-11, 0=子)
 * that jie starts.
 *
 * NOTE: hanja here is our own canonical (traditional-character) spelling, used for
 * display. It is intentionally NOT used to identify which term lunar-javascript
 * returned — that library's `.toString()`/table keys mix simplified Chinese (惊蛰,
 * 谷雨, 小满, 芒种, 处暑, ...) with occasional pinyin fallback keys for terms that
 * repeat across its internal ~13-month window, so string-matching against it is
 * unreliable. Instead, `solarTerms()` walks chronologically within a single
 * Gregorian year and assigns this table's metadata *by position* (always exactly
 * 24 entries, always in this fixed cyclical order), never by name lookup.
 */
export const SOLAR_TERMS_CALENDAR_YEAR_ORDER: readonly {
  hanja: string
  hangul: string
  isJie: boolean
  branchIndexIfJie: number | null
}[] = [
  { hanja: '小寒', hangul: '소한', isJie: true, branchIndexIfJie: 1 }, // 丑
  { hanja: '大寒', hangul: '대한', isJie: false, branchIndexIfJie: null },
  { hanja: '立春', hangul: '입춘', isJie: true, branchIndexIfJie: 2 }, // 寅
  { hanja: '雨水', hangul: '우수', isJie: false, branchIndexIfJie: null },
  { hanja: '驚蟄', hangul: '경칩', isJie: true, branchIndexIfJie: 3 }, // 卯
  { hanja: '春分', hangul: '춘분', isJie: false, branchIndexIfJie: null },
  { hanja: '清明', hangul: '청명', isJie: true, branchIndexIfJie: 4 }, // 辰
  { hanja: '穀雨', hangul: '곡우', isJie: false, branchIndexIfJie: null },
  { hanja: '立夏', hangul: '입하', isJie: true, branchIndexIfJie: 5 }, // 巳
  { hanja: '小滿', hangul: '소만', isJie: false, branchIndexIfJie: null },
  { hanja: '芒種', hangul: '망종', isJie: true, branchIndexIfJie: 6 }, // 午
  { hanja: '夏至', hangul: '하지', isJie: false, branchIndexIfJie: null },
  { hanja: '小暑', hangul: '소서', isJie: true, branchIndexIfJie: 7 }, // 未
  { hanja: '大暑', hangul: '대서', isJie: false, branchIndexIfJie: null },
  { hanja: '立秋', hangul: '입추', isJie: true, branchIndexIfJie: 8 }, // 申
  { hanja: '處暑', hangul: '처서', isJie: false, branchIndexIfJie: null },
  { hanja: '白露', hangul: '백로', isJie: true, branchIndexIfJie: 9 }, // 酉
  { hanja: '秋分', hangul: '추분', isJie: false, branchIndexIfJie: null },
  { hanja: '寒露', hangul: '한로', isJie: true, branchIndexIfJie: 10 }, // 戌
  { hanja: '霜降', hangul: '상강', isJie: false, branchIndexIfJie: null },
  { hanja: '立冬', hangul: '입동', isJie: true, branchIndexIfJie: 11 }, // 亥
  { hanja: '小雪', hangul: '소설', isJie: false, branchIndexIfJie: null },
  { hanja: '大雪', hangul: '대설', isJie: true, branchIndexIfJie: 0 }, // 子
  { hanja: '冬至', hangul: '동지', isJie: false, branchIndexIfJie: null },
] as const

/** The 4 "사립" (season-opening) jie used by seasonElement's ~18-day Earth-buffer rule. */
export const FOUR_LI_SEASON_ELEMENT: Record<number, 'WOOD' | 'FIRE' | 'METAL' | 'WATER'> = {
  2: 'WOOD', // 立春 -> 寅
  5: 'FIRE', // 立夏 -> 巳
  8: 'METAL', // 立秋 -> 申
  11: 'WATER', // 立冬 -> 亥
}

/** 십신 (Ten Gods) label matrix, keyed by [relationship][sameYinYang]. */
export const TEN_GOD_MATRIX = {
  same: { same: '비견', diff: '겁재' },
  produces: { same: '식신', diff: '상관' },
  dominates: { same: '편재', diff: '정재' },
  dominatedBy: { same: '편관', diff: '정관' },
  producedBy: { same: '편인', diff: '정인' },
} as const

/** 구성 (Nine Stars): number 1-9. */
export const NINE_STARS: readonly { number: number; element: FiveElement; hangul: string }[] = [
  { number: 1, element: 'water', hangul: '일백수성' },
  { number: 2, element: 'earth', hangul: '이흑토성' },
  { number: 3, element: 'wood', hangul: '삼벽목성' },
  { number: 4, element: 'wood', hangul: '사록목성' },
  { number: 5, element: 'earth', hangul: '오황토성' },
  { number: 6, element: 'metal', hangul: '육백금성' },
  { number: 7, element: 'metal', hangul: '칠적금성' },
  { number: 8, element: 'earth', hangul: '팔백토성' },
  { number: 9, element: 'fire', hangul: '구자화성' },
] as const

/**
 * 27수 (宿曜経), 昴-first, 牛宿 omitted. Index 0 = 昴宿 = public index 1.
 * 朔日宿 table: 国立天文台 暦Wiki「二十七宿」/ 月宿傍通暦
 * (正月室 二月奎 三月胃 四月畢 五月参 六月鬼 七月張 八月角 九月氐 十月心 十一月斗 十二月虚).
 */
export const SUKUYOU_MANSIONS: readonly { hanja: string; hangul: string }[] = [
  { hanja: '昴宿', hangul: '묘수' },
  { hanja: '畢宿', hangul: '필수' },
  { hanja: '觜宿', hangul: '자수' },
  { hanja: '參宿', hangul: '삼수' },
  { hanja: '井宿', hangul: '정수' },
  { hanja: '鬼宿', hangul: '귀수' },
  { hanja: '柳宿', hangul: '류수' },
  { hanja: '星宿', hangul: '성수' },
  { hanja: '張宿', hangul: '장수' },
  { hanja: '翼宿', hangul: '익수' },
  { hanja: '軫宿', hangul: '진수' },
  { hanja: '角宿', hangul: '각수' },
  { hanja: '亢宿', hangul: '항수' },
  { hanja: '氐宿', hangul: '저수' },
  { hanja: '房宿', hangul: '방수' },
  { hanja: '心宿', hangul: '심수' },
  { hanja: '尾宿', hangul: '미수' },
  { hanja: '箕宿', hangul: '기수' },
  { hanja: '斗宿', hangul: '두수' },
  { hanja: '女宿', hangul: '여수' },
  { hanja: '虛宿', hangul: '허수' },
  { hanja: '危宿', hangul: '위수' },
  { hanja: '室宿', hangul: '실수' },
  { hanja: '壁宿', hangul: '벽수' },
  { hanja: '奎宿', hangul: '규수' },
  { hanja: '婁宿', hangul: '루수' },
  { hanja: '胃宿', hangul: '위수(胃)' },
] as const

/** 朔日宿, keyed by lunar month 1–12. Values are 0-based indices into SUKUYOU_MANSIONS. */
export const SUKUYOU_SAKUJITSU_INDEX: readonly number[] = [
  22, // 1 室
  24, // 2 奎
  26, // 3 胃
  1, // 4 畢
  3, // 5 参
  5, // 6 鬼
  8, // 7 張
  11, // 8 角
  13, // 9 氐
  15, // 10 心
  18, // 11 斗
  20, // 12 虚
]

/**
 * 三九の秘法, offset 0–26 from 命 along the 昴-order cycle
 * (逆時計 = advancing mansion index). Unambiguous across
 * uranai.blog / uranai-starfortune / 大久保占い研究室.
 */
export const SUKUYOU_SAN_KU: readonly SukuyouRelationName[] = [
  '命',
  '栄',
  '衰',
  '安',
  '危',
  '成',
  '壊',
  '友',
  '親',
  '業',
  '栄',
  '衰',
  '安',
  '危',
  '成',
  '壊',
  '友',
  '親',
  '胎',
  '栄',
  '衰',
  '安',
  '危',
  '成',
  '壊',
  '友',
  '親',
]

export const SUKUYOU_RELATION_PAIR: Record<SukuyouRelationName, SukuyouRelationPair> = {
  命: '命',
  業: '業胎',
  胎: '業胎',
  栄: '栄親',
  親: '栄親',
  友: '友衰',
  衰: '友衰',
  安: '安壊',
  壊: '安壊',
  危: '危成',
  成: '危成',
}

/** 20 나왈 (Maya Tzolk'in day signs), index 0 = Imix, in the standard GMT-correlation order. */
export const TZOLKIN_NAWAL: readonly { name: string }[] = [
  { name: 'Imix' },
  { name: "Ik'" },
  { name: "Ak'b'al" },
  { name: "K'an" },
  { name: 'Chikchan' },
  { name: 'Kimi' },
  { name: "Manik'" },
  { name: 'Lamat' },
  { name: 'Muluk' },
  { name: 'Ok' },
  { name: 'Chuwen' },
  { name: "Eb'" },
  { name: 'Ben' },
  { name: 'Ix' },
  { name: 'Men' },
  { name: "K'ib'" },
  { name: 'Kaban' },
  { name: "Etz'nab'" },
  { name: 'Kawak' },
  { name: 'Ajaw' },
] as const
