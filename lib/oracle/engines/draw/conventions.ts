/** Fixed, versioned conventions for the pure draw engine. */

/**
 * 1.1.0: rune draw became pick-based (24-stone cloth, orientation fixed per
 * shuffle position) and the nine symmetric runes lost their random merkstave
 * flag — same seed, different rune output than 1.0.0.
 */
export const DRAW_ENGINE_VERSION = '1.1.0'

/**
 * User-picked fan positions are 1-based ("the 14th card" = 14).
 * The seed shuffles the 78-card deck; positions index that shuffled order.
 */
export const TAROT_POSITION_BASE = 1 as const

export const TAROT_SPREADS = [1, 3, 5, 10] as const
export type TarotSpreadSize = (typeof TAROT_SPREADS)[number]

/** Rune cloth picks are 1-based indexes into the seeded 24-stone shuffle. */
export const RUNE_POSITION_BASE = 1 as const

export const RUNE_SPREADS = [1, 3, 5] as const
export type RuneSpreadSize = (typeof RUNE_SPREADS)[number]

/**
 * 3-coin 육효 probabilities (classic Chinese coin method):
 * heads = 3 (yang), tails = 2 (yin).
 * 6 old yin 1/8, 7 young yang 3/8, 8 young yin 3/8, 9 old yang 1/8.
 */
export const COIN_YANG = 3
export const COIN_YIN = 2

/**
 * 세효/응효: Jing Fang 京房 eight-palace generation.
 * 본궁 世6/应3, 一世 世1/应4, … 游魂 世4/应1, 归魂 世3/应6.
 * Some 梅花/ monistic schools ignore 世应; this engine is 육효, so Jing Fang wins.
 */
export const SHI_YING_BY_GENERATION = {
  본궁: { shi: 6, ying: 3 },
  一世: { shi: 1, ying: 4 },
  二世: { shi: 2, ying: 5 },
  三世: { shi: 3, ying: 6 },
  四世: { shi: 4, ying: 1 },
  五世: { shi: 5, ying: 2 },
  游魂: { shi: 4, ying: 1 },
  归魂: { shi: 3, ying: 6 },
} as const

export type PalaceGeneration = keyof typeof SHI_YING_BY_GENERATION
