import type { NatalChart } from '../engines/astro'
import type { FourPillars, NineStarResult, YinYang } from '../engines/calendar'
import type { FiveElement } from '../engines/calendar/types'
import type { IchingDrawResult, RuneDrawResult, TarotDrawResult } from '../engines/draw'
import type { SixRelative } from '../engines/draw/tables'
import type { LEAGUE_VOTE_WEIGHTS } from './conventions'

/**
 * League chips. Duplicated here on purpose — oracle must not import lib/league.
 * Keep in lockstep with PUBLIC_CATEGORY_IDS (12 public chips as of this pass).
 */
export const LEAGUE_ORACLE_CATEGORY_IDS = [
  'sports',
  'crypto',
  'stocks',
  'fx',
  'gold_metals',
  'index_etf',
  'commodities_energy',
  'politics_election',
  'entertainment',
  'memecoin',
  'real_estate',
  'macro_econ',
] as const

export type LeagueOracleCategoryId = (typeof LEAGUE_ORACLE_CATEGORY_IDS)[number]

/** Parallel to PhaseAxis. No hold, no abstain. */
export type LeagueBinaryVote = 'up' | 'down' | 'a' | 'b'

export type LeagueBallotAxis = 'direction' | 'pick_one'

export type LeagueVoteSystem = 'iching' | 'tarot' | 'runes' | 'taeil'
export type LeagueVoteCamp = 'draw' | 'timing'

export type LeaguePolarity = 'plus' | 'minus'

export type LeagueTaeilYongshen = {
  element: FiveElement
  yinYang: YinYang
  /** Display name of the 10 천간 buckets; not a 십신 vote. */
  stemHanja: '甲' | '乙' | '丙' | '丁' | '戊' | '己' | '庚' | '辛' | '壬' | '癸'
}

export type LeagueSystemVote = {
  system: LeagueVoteSystem
  camp: LeagueVoteCamp
  weight: (typeof LEAGUE_VOTE_WEIGHTS)[LeagueVoteSystem]
  vote: LeagueBinaryVote
  /**
   * True when the system's own table said `hold` (or 택일 일진/월건 split)
   * and the ballot was filled from 육효 용신 왕쇠. PRODUCT rule, not doctrine.
   */
  collapsedFromHold: boolean
  source: string
}

export type LeagueAggregate = {
  vote: LeagueBinaryVote
  axis: LeagueBallotAxis
  confidence: number
  plusWeight: number
  minusWeight: number
  totalWeight: number
  drawCamp: LeagueBinaryVote
  timingCamp: LeagueBinaryVote
  usedYongshenTiebreak: boolean
}

export type LeagueIchingPack = {
  draw: IchingDrawResult
  relative: SixRelative
  yongshenSource: 'yongshen' | 'bokjang_shi'
  yongshenPosition: number
}

export type LeagueTaeilPack = {
  /** Always 택일. Never 명리 — no 대운, no day-master 십신 vote. */
  label: '택일'
  pillars: FourPillars
  yongshen: LeagueTaeilYongshen
  dayBranchElement: FiveElement
  monthBranchElement: FiveElement
  /**
   * 23:xx Seoul is rewritten to 22:xx so 일진 never takes the 자시 fork.
   * The UI can say the round used the previous hour's pillars when applied.
   */
  hourPin: LeagueHourPin
}

export type LeagueHourPin = {
  applied: boolean
  /** Civil HH:mm in Seoul before the 23→22 rewrite. */
  originalTime: string
  /** Civil HH:mm actually fed to fourPillars / 구성 / astro. */
  usedTime: string
  reason: 'zi_start_fork_avoided' | null
}

export type LeagueAstroPack = {
  ballot: null
  /** Horary judgment (ruler of the quesited, reception, etc.) is not implemented. */
  reason: 'horary_judgment_not_implemented'
  chart: NatalChart
  location: { lat: number; lng: number; tz: string }
}

export type LeagueNineStarPack = {
  ballot: null
  /**
   * 오황살 / 길방 are not computed. 방위 taboos are not price direction,
   * so this pack is display-only even if those tables land later.
   */
  reason: 'five_yellow_and_auspicious_direction_not_implemented'
  result: NineStarResult
}

/**
 * Chart pack the later adapter will carry. Voting systems include their
 * native draw; astro / 구성기학 have no ballot.
 */
export type LeagueDivinationChartPack = {
  iching: LeagueIchingPack
  tarot: TarotDrawResult
  runes: RuneDrawResult
  taeil: LeagueTaeilPack
  astro: LeagueAstroPack
  ninestar: LeagueNineStarPack
}

export type LeagueDivinationInput = {
  roundId: string
  /** Absolute instant, identical for every viewer of the round. */
  firstViewIso: string
  categoryId: LeagueOracleCategoryId
  axis: LeagueBallotAxis
}

export type LeagueDivinationResult = {
  version: string
  axis: LeagueBallotAxis
  categoryId: LeagueOracleCategoryId
  votes: {
    iching: LeagueSystemVote
    tarot: LeagueSystemVote
    runes: LeagueSystemVote
    taeil: LeagueSystemVote
  }
  aggregate: LeagueAggregate
  charts: LeagueDivinationChartPack
  seoul: {
    date: string
    time: string
    tz: string
    hourPin: LeagueHourPin
  }
}
