import type { PalaceGeneration, TarotSpreadSize } from './conventions'
import type {
  FiveElement,
  LineValue,
  PalaceName,
  SixBeast,
  SixRelative,
  TarotArcana,
  TarotSuit,
} from './tables'

export type DayStemInput = string | number | { hanja: string; index?: number }

export type TarotDrawnCard = {
  id: number
  name: string
  arcana: TarotArcana
  suit: TarotSuit
  number: number
  reversed: boolean
  positionLabel: string
  /** 1-based index into the seeded shuffle. */
  pickedPosition: number
}

export type TarotDrawResult = {
  seed: string
  spread: TarotSpreadSize
  cards: TarotDrawnCard[]
}

export type RuneDrawn = {
  id: number
  name: string
  transliteration: string
  glyph: string
  /**
   * Always false for the nine vertically-symmetric runes (they have no
   * inverted glyph, so they cannot land reversed — and no random "dark side"
   * is assigned in its place either; see the audit note in runes.ts).
   */
  reversed: boolean
  /** Spread position label (e.g. "Past"); Korean mapping lives in display-copy. */
  positionLabel: string
  /** 1-based index into the seeded shuffle (the face-down cloth). */
  pickedPosition: number
}

export type RuneDrawResult = {
  seed: string
  count: number
  runes: RuneDrawn[]
}

/** 월령 왕상휴수사 — classical five-phase label of a line vs the month. */
export type MonthPhase = '旺' | '相' | '休' | '囚' | '死'

/**
 * 일건 생/극/비화 vs the day's earthly branch (日建, parallel to 월건).
 * `actor` says who does the generating/overcoming; 비화 is `same`.
 */
export type DayLineRelation = {
  kind: '생' | '극' | '비화'
  actor: 'day' | 'line' | 'same'
}

/** One changing line's 생 or 극 of another line (outgoing from the 동효). */
export type ChangingLineAction = {
  from: number
  to: number
  action: '생' | '극'
}

export type IchingLimitation = 'no_day_stem' | 'no_month_element' | 'no_day_element'

export type IchingLine = {
  /** 1 = bottom, 6 = top. */
  position: number
  value: LineValue
  changing: boolean
  yang: boolean
  branch: string
  element: FiveElement
  relative: SixRelative
  beast: SixBeast | null
  /** 월령 왕상휴수사. Null when month element was not supplied. */
  monthPhase: MonthPhase | null
  /** 일건 vs 일진 지지. Null when day element was not supplied. */
  dayRelation: DayLineRelation | null
  /** Changing lines that 생 or 극 this line. */
  fromChanging: Array<{ position: number; action: '생' | '극' }>
}

export type HexagramInfo = {
  kingWen: number
  hanja: string
  hangul: string
  english: string
  /** Bottom-to-top, true = yang. */
  lines: readonly boolean[]
}

export type IchingDrawResult = {
  seed: string
  primary: HexagramInfo
  resulting: HexagramInfo
  palace: PalaceName
  palaceElement: FiveElement
  generation: PalaceGeneration
  /** 세효, 1–6. */
  shi: number
  /** 응효, 1–6. */
  ying: number
  lines: IchingLine[]
  changingPositions: number[]
  /**
   * 복장: 육친 names absent from the six lines. This is the inventory scan
   * (which relatives are missing), not Jing Fang 伏神 placement under a line.
   */
  hiddenRelatives: SixRelative[]
  /** All 동효 → other-line 생극 pairs. Empty when there is no 변효. */
  changingActions: ChangingLineAction[]
  /** 월건 오행 used for 월령; null when not supplied. */
  monthElement: FiveElement | null
  /** 일진 지지 오행 used for 일건; null when not supplied. */
  dayElement: FiveElement | null
  limitations: IchingLimitation[]
}
