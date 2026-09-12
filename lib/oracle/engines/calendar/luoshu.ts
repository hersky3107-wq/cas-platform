/**
 * 낙서 구궁 (Luoshu nine-palace) — the spatial frame of 구성기학.
 *
 * Direction ↔ palace mapping (後天八卦 on the Luoshu), south at the top
 * as the square is written 4 9 2 / 3 5 7 / 8 1 6:
 *
 *   4 巽 남동 | 9 离 남 | 2 坤 남서
 *   3 震 동   | 5 中 중앙 | 7 兑 서
 *   8 艮 북동 | 1 坎 북 | 6 乾 북서
 *
 * Trigrams match TRIGRAM_KO (simplified 离/兑). Palaces are identified by
 * their HOME Luoshu number; stars FLY through those palaces.
 * Cited: 낙서 마방진 + 후천팔괘 구궁도 / uic.jp 1988 年盤.
 *
 * 비성: 陽遁 順飛 star(P) = P + C − 5; 陰遁 逆飛 star(P) = C − P + 5
 * (mod 9, 0→9). C is the 중궁 star of that 盤.
 *
 * 年·月·日 LAYOUT is 順飛 (陽遁 비성). The 중궁 number still counts
 * 陰遁 through time (year down at 입춘, day down after 夏至 甲子).
 * Verified: 1988 입춘 전 四緑중궁 → 오황 북서; 입춘 후 三碧중궁 → 오황
 * 서 (uic.jp / uic.io 九星気学 年盤). 奇門 陰遁 逆飛 is implemented on
 * `flyBoard(..., 'yin')` and tested, but 気学 日盤 does not use it —
 * a 二黒 day is the 二黒 中宮図 (오황 북동), not the 逆飛 board.
 *
 * 흉방: 오황/암검/본명/본명적/세파/월파. 오황 in 중궁 → 오황살 and 암검살
 * are null (not “every direction”). 소아살·토용살 and 24-mountain 세파
 * are not implemented. 길방 is 오행 상생 minus those 흉 — no 生氣/死気
 * grade scale (uic.jp prints those; we do not).
 */
import { ELEMENT_GENERATES } from './relations'
import { NINE_STARS } from './tables'
import type { FiveElement, NineStarValue } from './types'

export type PalaceNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
export type CompassDirection =
  | 'north'
  | 'northeast'
  | 'east'
  | 'southeast'
  | 'south'
  | 'southwest'
  | 'west'
  | 'northwest'
  | 'center'
export type Dun = 'yang' | 'yin'

export type LuoshuPalace = {
  palace: PalaceNumber
  direction: CompassDirection
  trigram: string
}

/**
 * Home Luoshu, south-up reading order (row-major: SE S SW / E C W / NE N NW).
 * Trigrams are 後天八卦.
 */
export const LUOSHU_PALACES: readonly LuoshuPalace[] = [
  { palace: 4, direction: 'southeast', trigram: '巽' },
  { palace: 9, direction: 'south', trigram: '离' },
  { palace: 2, direction: 'southwest', trigram: '坤' },
  { palace: 3, direction: 'east', trigram: '震' },
  { palace: 5, direction: 'center', trigram: '中' },
  { palace: 7, direction: 'west', trigram: '兑' },
  { palace: 8, direction: 'northeast', trigram: '艮' },
  { palace: 1, direction: 'north', trigram: '坎' },
  { palace: 6, direction: 'northwest', trigram: '乾' },
]

/** 対冲 of the eight palaces. Center has no opposite. */
export const PALACE_OPPOSITE: Record<PalaceNumber, PalaceNumber | null> = {
  1: 9,
  2: 8,
  3: 7,
  4: 6,
  5: null,
  6: 4,
  7: 3,
  8: 2,
  9: 1,
}

/**
 * 十二支 → 구궁. 艮=丑寅, 巽=辰巳, 坤=未申, 乾=戌亥; cardinals 子卯午酉.
 * 24-mountain schools keep 寅/申 at 30° — we stay on the eight palaces.
 */
export const BRANCH_PALACE: Record<number, PalaceNumber> = {
  0: 1, // 子 북
  1: 8, // 丑 북동
  2: 8, // 寅 북동
  3: 3, // 卯 동
  4: 4, // 辰 남동
  5: 4, // 巳 남동
  6: 9, // 午 남
  7: 2, // 未 남서
  8: 2, // 申 남서
  9: 7, // 酉 서
  10: 6, // 戌 북서
  11: 6, // 亥 북서
}

export type LuoshuCell = LuoshuPalace & { star: NineStarValue }

export type LuoshuBoard = {
  center: number
  dun: Dun
  cells: LuoshuCell[]
}

function normalizeStar(raw: number): number {
  let n = raw
  while (n <= 0) n += 9
  while (n > 9) n -= 9
  return n
}

function starValue(number: number): NineStarValue {
  const found = NINE_STARS.find((s) => s.number === number)!
  return { number: found.number, element: found.element, hangul: found.hangul }
}

/** Star sitting in palace P when 중궁 is C, under 陽遁 順飛 or 陰遁 逆飛. */
export function starInPalace(palace: PalaceNumber, center: number, dun: Dun): number {
  const c = normalizeStar(center)
  return dun === 'yang' ? normalizeStar(palace + c - 5) : normalizeStar(c - palace + 5)
}

export function flyBoard(center: number, dun: Dun): LuoshuBoard {
  const c = normalizeStar(center)
  return {
    center: c,
    dun,
    cells: LUOSHU_PALACES.map((palace) => ({
      ...palace,
      star: starValue(starInPalace(palace.palace, c, dun)),
    })),
  }
}

export function cellByDirection(board: LuoshuBoard, direction: CompassDirection): LuoshuCell | undefined {
  return board.cells.find((cell) => cell.direction === direction)
}

export function palaceHoldingStar(board: LuoshuBoard, starNumber: number): LuoshuCell | undefined {
  return board.cells.find((cell) => cell.star.number === starNumber)
}

export function oppositeDirection(direction: CompassDirection): CompassDirection | null {
  const palace = LUOSHU_PALACES.find((p) => p.direction === direction)
  if (!palace) return null
  const opp = PALACE_OPPOSITE[palace.palace]
  if (opp == null) return null
  return LUOSHU_PALACES.find((p) => p.palace === opp)?.direction ?? null
}

export function branchDirection(branchIndex: number): CompassDirection {
  const palace = BRANCH_PALACE[((branchIndex % 12) + 12) % 12]!
  return LUOSHU_PALACES.find((p) => p.palace === palace)!.direction
}

export function sepaDirection(yearBranchIndex: number): CompassDirection {
  return branchDirection(yearBranchIndex + 6)
}

export type ElementSitRelation = '비화' | '상생' | '상극'

export function sitRelation(honmei: FiveElement, sitting: FiveElement): ElementSitRelation {
  if (honmei === sitting) return '비화'
  if (ELEMENT_GENERATES[honmei] === sitting || ELEMENT_GENERATES[sitting] === honmei) return '상생'
  return '상극'
}

export type NineStarKillings = {
  /** 五黄殺 — 연반 palace holding 五黄土星. Null when 五黄 is 중궁. */
  ohwang: CompassDirection | null
  /** 暗剣殺 — opposite 오황살. Null when 오황 is 중궁. */
  amgeom: CompassDirection | null
  /** 本命殺 — 연반 palace holding the subject's 본명성 (중궁 allowed). */
  honmei: CompassDirection
  /** 本命的殺 — opposite 본명살. Null when 본명성 is 중궁. */
  honmeiOpposite: CompassDirection | null
  /** 歳破 — opposite the 구성 year's 지지. */
  sepa: CompassDirection
  /** 月破 — opposite the 절월 지지. */
  wolpa: CompassDirection
}

export type NineStarDirections = {
  killings: NineStarKillings
  /**
   * Palaces that are 오행 상생 with 본명성 on the 年盤 and carry none of
   * 오황/암검/본명/본명적/세파. Empty means no travel 길방 this year —
   * we do not invent a consolation grade.
   */
  gilbangYear: CompassDirection[]
  /** Same filter on the 月盤 (월 오황/암검/월파). */
  gilbangMonth: CompassDirection[]
  /** 연반 길 ∩ 월반 길 — the direction you can actually walk. */
  gilbang: CompassDirection[]
}

function killingOnYear(cell: LuoshuCell, killings: NineStarKillings): boolean {
  const dir = cell.direction
  if (dir === 'center') return false
  return (
    dir === killings.ohwang ||
    dir === killings.amgeom ||
    dir === killings.honmei ||
    dir === killings.honmeiOpposite ||
    dir === killings.sepa
  )
}

function killingOnMonth(cell: LuoshuCell, monthOhwang: CompassDirection | null, wolpa: CompassDirection): boolean {
  if (cell.direction === 'center') return false
  const amgeom = monthOhwang ? oppositeDirection(monthOhwang) : null
  return cell.direction === monthOhwang || cell.direction === amgeom || cell.direction === wolpa
}

export function nineStarDirections(
  yearBoard: LuoshuBoard,
  monthBoard: LuoshuBoard,
  honmeiNumber: number,
  yearBranchIndex: number,
  monthBranchIndex: number,
): NineStarDirections {
  const ohwangCell = palaceHoldingStar(yearBoard, 5)!
  const ohwang = ohwangCell.direction === 'center' ? null : ohwangCell.direction
  const honmeiCell = palaceHoldingStar(yearBoard, honmeiNumber)!
  const honmei = honmeiCell.direction
  const killings: NineStarKillings = {
    ohwang,
    amgeom: ohwang ? oppositeDirection(ohwang) : null,
    honmei,
    honmeiOpposite: oppositeDirection(honmei),
    sepa: sepaDirection(yearBranchIndex),
    wolpa: sepaDirection(monthBranchIndex),
  }

  const honmeiElement = starValue(honmeiNumber).element
  const monthFive = palaceHoldingStar(monthBoard, 5)!
  const monthOhwang = monthFive.direction === 'center' ? null : monthFive.direction

  const gilbangYear = yearBoard.cells
    .filter(
      (cell) =>
        cell.direction !== 'center' &&
        sitRelation(honmeiElement, cell.star.element) === '상생' &&
        !killingOnYear(cell, killings),
    )
    .map((cell) => cell.direction)

  const gilbangMonth = monthBoard.cells
    .filter(
      (cell) =>
        cell.direction !== 'center' &&
        sitRelation(honmeiElement, cell.star.element) === '상생' &&
        !killingOnMonth(cell, monthOhwang, killings.wolpa),
    )
    .map((cell) => cell.direction)

  const monthSet = new Set(gilbangMonth)
  const gilbang = gilbangYear.filter((dir) => monthSet.has(dir))

  return { killings, gilbangYear, gilbangMonth, gilbang }
}

/** South-up 3×3 of a board (낙서 표기 순서). */
export function boardRows(board: LuoshuBoard): [LuoshuCell[], LuoshuCell[], LuoshuCell[]] {
  const at = (n: PalaceNumber) => board.cells.find((c) => c.palace === n)!
  return [
    [at(4), at(9), at(2)],
    [at(3), at(5), at(7)],
    [at(8), at(1), at(6)],
  ]
}
