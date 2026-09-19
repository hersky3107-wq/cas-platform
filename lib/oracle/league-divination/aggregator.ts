/**
 * Binary aggregator. Straight weighted sum across all four ballots
 * (육효 3 + 타로 2 + 룬 2 + 택일 2 = 9). DRAW still dominates when it is
 * united (7 vs 2), but when DRAW splits internally (육효 3 against 타로+룬 4)
 * 택일 is the casting vote. Residual numeric tie → 육효 용신 왕쇠.
 *
 * Confidence is |plus−minus| / totalWeight (0..1).
 *
 * v1.0.0 used "DRAW wins disagreement", which made TIMING inert. v1.1.0
 * replaced that PRODUCT hierarchy with this sum.
 */
import { LEAGUE_VOTE_WEIGHTS } from './conventions'
import type {
  LeagueAggregate,
  LeagueBallotAxis,
  LeagueBinaryVote,
  LeagueSystemVote,
} from './types'
import { isPlusVote } from './yongshen'

const TOTAL_WEIGHT =
  LEAGUE_VOTE_WEIGHTS.iching + LEAGUE_VOTE_WEIGHTS.tarot + LEAGUE_VOTE_WEIGHTS.runes + LEAGUE_VOTE_WEIGHTS.taeil

function campVote(votes: readonly LeagueSystemVote[], fallback: LeagueBinaryVote): { vote: LeagueBinaryVote; tied: boolean } {
  let plus = 0
  let minus = 0
  for (const item of votes) {
    if (isPlusVote(item.vote)) plus += item.weight
    else minus += item.weight
  }
  if (plus > minus) return { vote: plusVoteOf(fallback), tied: false }
  if (minus > plus) return { vote: minusVoteOf(fallback), tied: false }
  return { vote: fallback, tied: true }
}

function plusVoteOf(sample: LeagueBinaryVote): LeagueBinaryVote {
  return sample === 'a' || sample === 'b' ? 'a' : 'up'
}

function minusVoteOf(sample: LeagueBinaryVote): LeagueBinaryVote {
  return sample === 'a' || sample === 'b' ? 'b' : 'down'
}

export function aggregateLeagueVotes(input: {
  axis: LeagueBallotAxis
  iching: LeagueSystemVote
  tarot: LeagueSystemVote
  runes: LeagueSystemVote
  taeil: LeagueSystemVote
  /** 육효 용신 왕쇠 — residual numeric tie. Hold-collapse already applied upstream. */
  yongshenVote: LeagueBinaryVote
}): LeagueAggregate {
  const draw = campVote([input.iching, input.tarot, input.runes], input.yongshenVote)
  const timing = campVote([input.taeil], input.yongshenVote)

  let plusWeight = 0
  let minusWeight = 0
  for (const item of [input.iching, input.tarot, input.runes, input.taeil]) {
    if (isPlusVote(item.vote)) plusWeight += item.weight
    else minusWeight += item.weight
  }

  let vote: LeagueBinaryVote
  let usedYongshenTiebreak = false
  if (plusWeight > minusWeight) {
    vote = plusVoteOf(input.yongshenVote)
  } else if (minusWeight > plusWeight) {
    vote = minusVoteOf(input.yongshenVote)
  } else {
    vote = input.yongshenVote
    usedYongshenTiebreak = true
  }

  return {
    vote,
    axis: input.axis,
    confidence: Math.abs(plusWeight - minusWeight) / TOTAL_WEIGHT,
    plusWeight,
    minusWeight,
    totalWeight: TOTAL_WEIGHT,
    drawCamp: draw.vote,
    timingCamp: timing.vote,
    usedYongshenTiebreak,
  }
}

/**
 * v1.0.0 camp rule, kept for the change-rate simulation only.
 * DRAW internal majority; TIMING never flips the ballot.
 */
export function aggregateLeagueVotesDrawWinsDisagreement(input: {
  axis: LeagueBallotAxis
  iching: LeagueSystemVote
  tarot: LeagueSystemVote
  runes: LeagueSystemVote
  taeil: LeagueSystemVote
  yongshenVote: LeagueBinaryVote
}): LeagueBinaryVote {
  const draw = campVote([input.iching, input.tarot, input.runes], input.yongshenVote)
  return draw.tied ? input.yongshenVote : draw.vote
}
