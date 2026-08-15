/**
 * Lookup tables for Zi Wei star placement. Logic stays in index.ts.
 */
import type { PalaceName, StarBrightness, StarCategory, WuXingJuName } from './types'

export const BRANCH_HANJA = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'] as const
export const STEM_HANJA = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'] as const

/** From 命宮, decreasing 地支 (counterclockwise on the standard chart). */
export const PALACE_NAMES: readonly PalaceName[] = [
  '命',
  '兄弟',
  '夫妻',
  '子女',
  '財帛',
  '疾厄',
  '遷移',
  '交友',
  '官祿',
  '田宅',
  '福德',
  '父母',
]

export const WU_XING_JU: Record<string, { name: WuXingJuName; number: 2 | 3 | 4 | 5 | 6 }> = {
  water: { name: '水二局', number: 2 },
  wood: { name: '木三局', number: 3 },
  metal: { name: '金四局', number: 4 },
  earth: { name: '土五局', number: 5 },
  fire: { name: '火六局', number: 6 },
}

/**
 * 纳音 element for each of the 60 甲子, index = the 60-cycle position
 * (甲子=0 … 癸亥=59). Pairs share one 纳音.
 */
const NAYIN_ELEMENTS: Array<'metal' | 'fire' | 'wood' | 'earth' | 'water'> = [
  'metal',
  'metal', // 甲子乙丑 海中金
  'fire',
  'fire', // 丙寅丁卯 炉中火
  'wood',
  'wood', // 戊辰己巳 大林木
  'earth',
  'earth', // 庚午辛未 路旁土
  'metal',
  'metal', // 壬申癸酉 剑锋金
  'fire',
  'fire', // 甲戌乙亥 山头火
  'water',
  'water', // 丙子丁丑 涧下水
  'earth',
  'earth', // 戊寅己卯 城头土
  'metal',
  'metal', // 庚辰辛巳 白蜡金
  'wood',
  'wood', // 壬午癸未 杨柳木
  'water',
  'water', // 甲申乙酉 泉中水
  'earth',
  'earth', // 丙戌丁亥 屋上土
  'fire',
  'fire', // 戊子己丑 霹雳火
  'wood',
  'wood', // 庚寅辛卯 松柏木
  'water',
  'water', // 壬辰癸巳 长流水
  'metal',
  'metal', // 甲午乙未 沙中金
  'fire',
  'fire', // 丙申丁酉 山下火
  'wood',
  'wood', // 戊戌己亥 平地木
  'earth',
  'earth', // 庚子辛丑 壁上土
  'metal',
  'metal', // 壬寅癸卯 金箔金
  'fire',
  'fire', // 甲辰乙巳 覆灯火
  'water',
  'water', // 丙午丁未 天河水
  'earth',
  'earth', // 戊申己酉 大驿土
  'metal',
  'metal', // 庚戌辛亥 钗钏金
  'wood',
  'wood', // 壬子癸丑 桑柘木
  'water',
  'water', // 甲寅乙卯 大溪水
  'earth',
  'earth', // 丙辰丁巳 沙中土
  'fire',
  'fire', // 戊午己未 天上火
  'wood',
  'wood', // 庚申辛酉 石榴木
  'water',
  'water', // 壬戌癸亥 大海水
]

export function nayinElement(stemIndex: number, branchIndex: number): 'metal' | 'fire' | 'wood' | 'earth' | 'water' {
  for (let i = 0; i < 60; i++) {
    if (i % 10 === stemIndex && i % 12 === branchIndex) return NAYIN_ELEMENTS[i]!
  }
  throw new RangeError(`ziwei engine: no 纳音 for stem ${stemIndex} branch ${branchIndex}`)
}

/**
 * 紫微系: from 紫微, decreasing 地支.
 * 口诀: 紫微逆去天机星，隔一太阳武曲辰，连接天同空二宫，廉贞居处方是真。
 */
export const ZIWEI_SERIES: ReadonlyArray<{ name: string; offset: number }> = [
  { name: '紫微', offset: 0 },
  { name: '天机', offset: 1 },
  { name: '太阳', offset: 3 },
  { name: '武曲', offset: 4 },
  { name: '天同', offset: 5 },
  { name: '廉贞', offset: 8 },
]

/**
 * 天府系: from 天府, increasing 地支.
 * 口诀: 天府顺行有太阴，贪狼而后巨门临，随来天相天梁继，七杀空三是破军。
 */
export const TIANFU_SERIES: ReadonlyArray<{ name: string; offset: number }> = [
  { name: '天府', offset: 0 },
  { name: '太阴', offset: 1 },
  { name: '贪狼', offset: 2 },
  { name: '巨门', offset: 3 },
  { name: '天相', offset: 4 },
  { name: '天梁', offset: 5 },
  { name: '七杀', offset: 6 },
  { name: '破军', offset: 10 },
]

export const MAJOR_STAR_NAMES = [
  '紫微',
  '天机',
  '太阳',
  '武曲',
  '天同',
  '廉贞',
  '天府',
  '太阴',
  '贪狼',
  '巨门',
  '天相',
  '天梁',
  '七杀',
  '破军',
] as const

/** 甲禄寅, 乙禄卯, 丙戊禄巳, 丁己禄午, 庚禄申, 辛禄酉, 壬禄亥, 癸禄子 */
export const LU_CUN_BY_YEAR_STEM: readonly number[] = [2, 3, 5, 6, 5, 6, 8, 9, 11, 0]

/** 甲戊庚丑未, 乙己子申, 丙丁亥酉, 壬癸卯巳, 辛午寅 */
export const KUI_YUE_BY_YEAR_STEM: ReadonlyArray<{ kui: number; yue: number }> = [
  { kui: 1, yue: 7 }, // 甲
  { kui: 0, yue: 8 }, // 乙
  { kui: 11, yue: 9 }, // 丙
  { kui: 11, yue: 9 }, // 丁
  { kui: 1, yue: 7 }, // 戊
  { kui: 0, yue: 8 }, // 己
  { kui: 1, yue: 7 }, // 庚
  { kui: 6, yue: 2 }, // 辛
  { kui: 3, yue: 5 }, // 壬
  { kui: 3, yue: 5 }, // 癸
]

/**
 * 火星/铃星 起子时宫, keyed by year-branch group.
 * 寅午戌: 火丑铃卯 / 申子辰: 火寅铃戌 / 巳酉丑: 火卯铃戌 / 亥卯未: 火酉铃戌
 */
export const HUO_LING_START: Record<number, { huo: number; ling: number }> = {
  2: { huo: 1, ling: 3 }, // 寅
  6: { huo: 1, ling: 3 }, // 午
  10: { huo: 1, ling: 3 }, // 戌
  8: { huo: 2, ling: 10 }, // 申
  0: { huo: 2, ling: 10 }, // 子
  4: { huo: 2, ling: 10 }, // 辰
  5: { huo: 3, ling: 10 }, // 巳
  9: { huo: 3, ling: 10 }, // 酉
  1: { huo: 3, ling: 10 }, // 丑
  11: { huo: 9, ling: 10 }, // 亥
  3: { huo: 9, ling: 10 }, // 卯
  7: { huo: 9, ling: 10 }, // 未
}

/** 申子辰马寅, 寅午戌马申, 巳酉丑马亥, 亥卯未马巳 */
export const TIAN_MA_BY_YEAR_BRANCH: readonly number[] = [
  2, // 子 → 寅
  11, // 丑 → 亥
  8, // 寅 → 申
  5, // 卯 → 巳
  2, // 辰 → 寅
  11, // 巳 → 亥
  8, // 午 → 申
  5, // 未 → 巳
  2, // 申 → 寅
  11, // 酉 → 亥
  8, // 戌 → 申
  5, // 亥 → 巳
]

export type StarDef = {
  name: string
  category: StarCategory
  /** Brightness by palace 地支, index 0=子. Empty string = no brightness. */
  brightness: readonly (StarBrightness | '')[]
}

/** iztro 三合 brightness, rotated from 寅-first to 子-first. */
function fromYinFirst(yinFirst: readonly (StarBrightness | '')[]): (StarBrightness | '')[] {
  return Array.from({ length: 12 }, (_, zi) => yinFirst[(zi - 2 + 12) % 12]!)
}

export const STAR_DEFS: Record<string, StarDef> = {
  紫微: { name: '紫微', category: 'major', brightness: fromYinFirst(['旺', '旺', '得', '旺', '庙', '庙', '旺', '旺', '得', '旺', '平', '庙']) },
  天机: { name: '天机', category: 'major', brightness: fromYinFirst(['得', '旺', '利', '平', '庙', '陷', '得', '旺', '利', '平', '庙', '陷']) },
  太阳: { name: '太阳', category: 'major', brightness: fromYinFirst(['旺', '庙', '旺', '旺', '旺', '得', '得', '陷', '不', '陷', '陷', '不']) },
  武曲: { name: '武曲', category: 'major', brightness: fromYinFirst(['得', '利', '庙', '平', '旺', '庙', '得', '利', '庙', '平', '旺', '庙']) },
  天同: { name: '天同', category: 'major', brightness: fromYinFirst(['利', '平', '平', '庙', '陷', '不', '旺', '平', '平', '庙', '旺', '不']) },
  廉贞: { name: '廉贞', category: 'major', brightness: fromYinFirst(['庙', '平', '利', '陷', '平', '利', '庙', '平', '利', '陷', '平', '利']) },
  天府: { name: '天府', category: 'major', brightness: fromYinFirst(['庙', '得', '庙', '得', '旺', '庙', '得', '旺', '庙', '得', '庙', '庙']) },
  太阴: { name: '太阴', category: 'major', brightness: fromYinFirst(['旺', '陷', '陷', '陷', '不', '不', '利', '不', '旺', '庙', '庙', '庙']) },
  贪狼: { name: '贪狼', category: 'major', brightness: fromYinFirst(['平', '利', '庙', '陷', '旺', '庙', '平', '利', '庙', '陷', '旺', '庙']) },
  巨门: { name: '巨门', category: 'major', brightness: fromYinFirst(['庙', '庙', '陷', '旺', '旺', '不', '庙', '庙', '陷', '旺', '旺', '不']) },
  天相: { name: '天相', category: 'major', brightness: fromYinFirst(['庙', '陷', '得', '得', '庙', '得', '庙', '陷', '得', '得', '庙', '庙']) },
  天梁: { name: '天梁', category: 'major', brightness: fromYinFirst(['庙', '庙', '庙', '陷', '庙', '旺', '陷', '得', '庙', '陷', '庙', '旺']) },
  七杀: { name: '七杀', category: 'major', brightness: fromYinFirst(['庙', '旺', '庙', '平', '旺', '庙', '庙', '庙', '庙', '平', '旺', '庙']) },
  破军: { name: '破军', category: 'major', brightness: fromYinFirst(['得', '陷', '旺', '平', '庙', '旺', '得', '陷', '旺', '平', '庙', '旺']) },
  文昌: { name: '文昌', category: 'lucky', brightness: fromYinFirst(['陷', '利', '得', '庙', '陷', '利', '得', '庙', '陷', '利', '得', '庙']) },
  文曲: { name: '文曲', category: 'lucky', brightness: fromYinFirst(['平', '旺', '得', '庙', '陷', '旺', '得', '庙', '陷', '旺', '得', '庙']) },
  左辅: { name: '左辅', category: 'lucky', brightness: fromYinFirst(['', '', '', '', '', '', '', '', '', '', '', '']) },
  右弼: { name: '右弼', category: 'lucky', brightness: fromYinFirst(['', '', '', '', '', '', '', '', '', '', '', '']) },
  天魁: { name: '天魁', category: 'lucky', brightness: fromYinFirst(['', '', '', '', '', '', '', '', '', '', '', '']) },
  天钺: { name: '天钺', category: 'lucky', brightness: fromYinFirst(['', '', '', '', '', '', '', '', '', '', '', '']) },
  擎羊: { name: '擎羊', category: 'malefic', brightness: fromYinFirst(['', '陷', '庙', '', '陷', '庙', '', '陷', '庙', '', '陷', '庙']) },
  陀罗: { name: '陀罗', category: 'malefic', brightness: fromYinFirst(['陷', '', '庙', '陷', '', '庙', '陷', '', '庙', '陷', '', '庙']) },
  火星: { name: '火星', category: 'malefic', brightness: fromYinFirst(['庙', '利', '陷', '得', '庙', '利', '陷', '得', '庙', '利', '陷', '得']) },
  铃星: { name: '铃星', category: 'malefic', brightness: fromYinFirst(['庙', '利', '陷', '得', '庙', '利', '陷', '得', '庙', '利', '陷', '得']) },
  地空: { name: '地空', category: 'malefic', brightness: fromYinFirst(['', '', '', '', '', '', '', '', '', '', '', '']) },
  地劫: { name: '地劫', category: 'malefic', brightness: fromYinFirst(['', '', '', '', '', '', '', '', '', '', '', '']) },
  禄存: { name: '禄存', category: 'minor', brightness: fromYinFirst(['', '', '', '', '', '', '', '', '', '', '', '']) },
  天马: { name: '天马', category: 'minor', brightness: fromYinFirst(['', '', '', '', '', '', '', '', '', '', '', '']) },
  红鸾: { name: '红鸾', category: 'minor', brightness: fromYinFirst(['', '', '', '', '', '', '', '', '', '', '', '']) },
  天喜: { name: '天喜', category: 'minor', brightness: fromYinFirst(['', '', '', '', '', '', '', '', '', '', '', '']) },
}

export function wrap12(n: number): number {
  return ((n % 12) + 12) % 12
}
