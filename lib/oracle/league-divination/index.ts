/**
 * League-facing divination calculation. Parallel binary surface — does not
 * extend PHASE_AXES. Adapter / AI prompt land in a later pass.
 */
export { LEAGUE_DIVINATION_VERSION, LEAGUE_SEOUL, LEAGUE_VOTE_WEIGHTS } from './conventions'
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

export type {
  LeagueBinaryVote,
  LeagueBallotAxis,
  LeagueDivinationInput,
  LeagueDivinationResult,
  LeagueDivinationChartPack,
  LeagueOracleCategoryId,
  LeagueSystemVote,
  LeagueAggregate,
} from './types'
export { LEAGUE_ORACLE_CATEGORY_IDS } from './types'
