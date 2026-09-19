/**
 * League-facing divination calculation + adapter. Parallel binary surface —
 * does not extend PHASE_AXES. Live supabase wiring lives in ./live so tests
 * never load server-only.
 */
export { LEAGUE_DIVINATION_VERSION, LEAGUE_SEOUL, LEAGUE_VOTE_WEIGHTS, LEAGUE_READER_BRAND } from './conventions'
export { computeLeagueDivination } from './compute'
export { aggregateLeagueVotes } from './aggregator'
export {
  CATEGORY_TO_LIUQIN,
  CATEGORY_TO_TAEIL_YONGSHEN,
  liuqinForCategory,
  taeilYongshenForCategory,
} from './category-tables'
export { leagueDrawSeed, seoulClockFromFirstView } from './seed'
export { voteIching, yongshenPolarity, compareShiYing, pickYongshenLine, polarityFromLine } from './yongshen'
export { voteTarotOutcome, voteRuneFuture, voteTaeil } from './votes'
export { computeAstroChartPack, computeNineStarChartPack } from './charts'
export { readLeagueDivination, systemsFromCompute } from './adapter'
export { createMemoryLeagueDivinationCache, createSupabaseLeagueDivinationCache } from './cache'
export { parseLeagueReaderRationale, MARKET_LANGUAGE_BAN } from './parse-reader'
export { compactReaderPack } from './compact-pack'
export { fallbackRationale } from './fallback'
export { tarotNameKo, runeNameKo } from './names'
export {
  runHoldCensus,
  holdCensusRates,
  HOLD_CENSUS_N,
  HOLD_CENSUS_ALL_FOUR_IDENTICAL_BEFORE,
} from './hold-census'
export {
  LEAGUE_GYEOLBEON,
  LEAGUE_ABSTAIN_LABEL,
  LEAGUE_VOTED_LABEL,
  presenceFromVote,
} from './status'

export type {
  LeagueBinaryVote,
  LeagueBallotAxis,
  LeagueDivinationInput,
  LeagueDivinationResult,
  LeagueDivinationChartPack,
  LeagueOracleCategoryId,
  LeagueSystemVote,
  LeagueAggregate,
  LeagueHourPin,
} from './types'
export type { LeagueSystemPresence } from './status'
export { LEAGUE_ORACLE_CATEGORY_IDS } from './types'
export type {
  LeagueDivinationAdapterInput,
  LeagueDivinationAdapterOutput,
  LeagueAdapterSystemEntry,
} from './adapter-types'
export { LEAGUE_DIVINATION_ADAPTER_INPUT_KEYS } from './adapter-types'
export type { LeagueDivinationCache } from './cache'
