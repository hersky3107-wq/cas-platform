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
  limitations: Array<'no_day_stem'>
}
