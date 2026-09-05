/**
 * Pure draw engine — seeded Tarot, Elder Futhark, and 육효.
 * No DB, network, LLM, or Math.random().
 */
export {
  DRAW_ENGINE_VERSION,
  RUNE_POSITION_BASE,
  RUNE_SPREADS,
  TAROT_SPREADS,
  TAROT_POSITION_BASE,
} from './conventions'
export type { RuneSpreadSize, TarotSpreadSize, PalaceGeneration } from './conventions'

export { seededShuffle, createRng } from './rng'
export { tarotDraw } from './tarot'
export { runeDraw } from './runes'
export { ichingDraw, buildLiuyao, hexagramFromYangFlags } from './iching'

export {
  TAROT_DECK,
  TAROT_SPREAD_LABELS,
  ELDER_FUTHARK,
  IRREVERSIBLE_RUNE_NAMES,
  RUNE_SPREAD_LABELS,
  HEXAGRAM_NAMES,
  PALACE_BY_KING_WEN,
  NAJIA_BRANCHES,
  SIX_BEASTS,
} from './tables'
export type { LineValue, RuneDef } from './tables'

export type {
  TarotDrawResult,
  TarotDrawnCard,
  RuneDrawResult,
  RuneDrawn,
  IchingDrawResult,
  IchingLine,
  HexagramInfo,
  DayStemInput,
} from './types'
