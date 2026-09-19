/**
 * Binary aggregator. DRAW (육효 3, 타로 2, 룬 2) vs TIMING (사주 택일 2).
 *
 * Each camp votes by weighted majority. When camps disagree, DRAW wins.
 * Residual DRAW-internal tie → 육효 용신 왕쇠. Output is never null.
 *
 * Confidence is |plus−minus| / totalWeight over all four ballots (0..1).
 * 택일 dissent therefore lowers confidence without flipping a DRAW win.
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
  /** 육효 용신 왕쇠 — residual DRAW tie AND the hold-collapse already applied upstream. */
  yongshenVote: LeagueBinaryVote
}): LeagueAggregate {
  const draw = campVote([input.iching, input.tarot, input.runes], input.yongshenVote)
  const timing = campVote([input.taeil], input.yongshenVote)

  // Camps disagree → DRAW wins. PRODUCT hierarchy, not a 육효-over-만세력
  // doctrine. TIMING therefore never flips the v1 ballot; it only moves
  // confidence. Residual DRAW-internal tie → 육효 용신 왕쇠.
  const vote = draw.tied ? input.yongshenVote : draw.vote
  const usedYongshenTiebreak = draw.tied

  let plusWeight = 0
  let minusWeight = 0
  for (const item of [input.iching, input.tarot, input.runes, input.taeil]) {
    if (isPlusVote(item.vote)) plusWeight += item.weight
    else minusWeight += item.weight
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
