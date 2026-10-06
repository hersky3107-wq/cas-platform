/**
 * Leaderboard boards — shared shapes (pure, client-safe).
 *
 * Every figure is a `BoardRate`. `pct` is null below the minimum sample, so a
 * payload cannot carry a low-sample percentage for any surface to render.
 * Pooled groups (camps, tiers, lenses, companies) gate on distinct ROUNDS,
 * not on calls: twenty seats agreeing on one round is still one round.
 */

export type BoardDoor = 'finance' | 'world' | 'all'
export type BoardHorizon = '1d' | '1w' | '1m' | '3m' | 'all'
export type BoardPeriod = 'week' | 'month' | '90d' | 'all'

export const BOARD_DOORS: readonly BoardDoor[] = ['finance', 'world', 'all']
export const BOARD_HORIZONS: readonly BoardHorizon[] = ['all', '1d', '1w', '1m', '3m']
export const BOARD_PERIODS: readonly BoardPeriod[] = ['week', 'month', '90d', 'all']

export type BoardFilters = {
  door: BoardDoor
  category: string | null
  horizon: BoardHorizon
  period: BoardPeriod
}

/** One graded, public round. */
export type BoardRound = {
  id: string
  category: string
  horizon: string
  /** subject_label, else instrument. Display only. */
  label: string
  /** ISO. Period windows and streak order read this. */
  resolvesAt: string
  /** AI 종합 (persisted log-odds aggregate) was right; null when it had no pick. */
  consensusCorrect: boolean | null
  /** AI 종합 confidence in its pick, 0–100. */
  consensusProbability: number | null
}

/** One graded prediction (is_correct not null). */
export type BoardPrediction = {
  roundId: string
  modelId: string
  tier: string
  camp: string
  brand: string
  /** Side token (up/down/yes/no/above/below) or null. */
  side: string | null
  /** Stated confidence in its own pick, 0–100. */
  probability: number | null
  correct: boolean
  lens: string | null
}

export type BoardRate = {
  correct: number
  /** Graded calls. */
  n: number
  /** Distinct rounds behind `n`. Equal to `n` for a single model. */
  rounds: number
  /** Truncated percentage, or null below the minimum sample. */
  pct: number | null
}

export type BoardRow = {
  key: string
  rate: BoardRate
  /** Null below the minimum sample: no rank without a percentage. */
  rank: number | null
}

export type ModelRow = BoardRow & {
  modelId: string
  company: string
  tier: string
  camp: string
}

export type BannerBoard = {
  overall: BoardRate
  byCategory: BoardRow[]
  byHorizon: BoardRow[]
  coinFlipPct: number
}

export type HighlightId = 'camp' | 'divination' | 'siblings' | 'method'

export type HighlightSide = { key: string; rate: BoardRate }

export type HighlightCard = {
  id: HighlightId
  /** Company key for the sibling card. */
  company?: string
  sides: HighlightSide[]
}

export type GroupsBoard = {
  camp: BoardRow[]
  tier: BoardRow[]
  book: BoardRow[]
  weights: BoardRow[]
}

export type AgreementBoard = {
  byMajorityShare: BoardRow[]
  byConfidence: BoardRow[]
}

export type ModelsBoard = {
  official: ModelRow[]
  extras: ModelRow[]
}

export type CategoryRanking = {
  key: string
  top: ModelRow[]
  bottom: ModelRow[]
  all: ModelRow[]
  ranked: number
}

export type CategoriesBoard = { categories: CategoryRanking[] }

export type SiblingMember = BoardRow & { modelIds: string[] }

export type SiblingBattle = { company: string; members: SiblingMember[] }

export type CompaniesBoard = {
  companies: (BoardRow & { models: number })[]
  siblings: SiblingBattle[]
}

export type LensesBoard = {
  rows: BoardRow[]
  /** Graded official/scout calls stored before lenses existed. */
  withoutLens: number
}

export type ExtraHeadToHead = {
  key: string
  own: BoardRate
  /** Rounds where this seat answered and AI 종합 had a pick. */
  rounds: number
  extra: BoardRate
  ai: BoardRate
}

export type ExtrasBoard = {
  /** Same rounds: every graded extra call vs every graded 40-AI call. */
  pooled: { extras: BoardRate; ai40: BoardRate }
  seats: ExtraHeadToHead[]
  crow: { answered: number; contrarian: number; contrarianRight: number }
  replayCurve: { month: string; rate: BoardRate }[]
}

export type StreakRow = { modelId: string; length: number }

export type LoneWolfRound = { id: string; label: string; category: string; resolvesAt: string }

export type LoneWolfRow = { modelId: string; count: number; rounds: LoneWolfRound[] }

export type ConfidenceRow = {
  modelId: string
  /** Wrong (bluff) or right (humble) calls in the confidence band. */
  hits: number
  /** Calls in the band. */
  band: BoardRate
  rank: number | null
}

export type FameBoard = {
  currentStreaks: StreakRow[]
  longestStreaks: StreakRow[]
  loneWolves: LoneWolfRow[]
  bluff: ConfidenceRow[]
  humble: ConfidenceRow[]
}

export type BoardSet = {
  banner: BannerBoard
  highlights: HighlightCard[]
  groups: GroupsBoard
  agreement: AgreementBoard
  models: ModelsBoard
  categories: CategoriesBoard
  companies: CompaniesBoard
  lenses: LensesBoard
  extras: ExtrasBoard
  fame: FameBoard
}

export type BoardKey = keyof BoardSet

export const BOARD_KEYS: readonly BoardKey[] = [
  'banner',
  'highlights',
  'groups',
  'agreement',
  'models',
  'categories',
  'companies',
  'lenses',
  'extras',
  'fame',
]

export type BoardsMeta = {
  generatedAt: string | null
  /** Categories that have at least one public graded round (filter chips). */
  categories: string[]
  minSample: number
  /** Graded rounds behind this signature. */
  rounds: number
}

export type BoardsResponse = {
  kind: 'boards'
  signature: string
  filters: BoardFilters
  /** True until the cache has been built once. */
  pending: boolean
  meta: BoardsMeta
  boards: BoardSet
}
