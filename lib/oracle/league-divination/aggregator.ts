/**
 * Binary aggregator. Straight weighted sum across ballots that actually
 * voted (육효 3 + 타로 2 + 룬 2 + 택일 2). A 결번 seat is removed from the
 * denominator (9 → 7 if tarot abstains, etc.). DRAW still dominates when it
 * is united, but when DRAW splits internally 택일 is the casting vote.
 * Residual numeric tie → 육효 용신 왕쇠. 육효 never abstains.
 *
 * Confidence is |plus−minus| / remainingWeight (0..1). 1.000 means the
 * remaining voters are unanimous — not that four hats agreed.
 *
 * v1.0.0 used "DRAW wins disagreement". v1.1.0 replaced that with the sum.
 * v1.2.0: hold is 결번, not a copy of 육효.
 */
import { hasBallot } from './status'
import type {
  LeagueAggregate,
  LeagueBallotAxis,
  LeagueBinaryVote,
  LeagueSystemVote,
} from './types'
import { isPlusVote } from './yongshen'

function campVote(
  votes: readonly LeagueSystemVote[],
  fallback: LeagueBinaryVote,
): { vote: LeagueBinaryVote | null; tied: boolean } {
  const active = votes.filter(hasBallot)
  if (active.length === 0) return { vote: null, tied: false }
  let plus = 0
  let minus = 0
  for (const item of active) {
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
  /** 육효 용신 왕쇠 — residual numeric tie. 결번 seats are already dropped. */
  yongshenVote: LeagueBinaryVote
}): LeagueAggregate {
  const all = [input.iching, input.tarot, input.runes, input.taeil]
  const voters = all.filter(hasBallot)
  const draw = campVote([input.iching, input.tarot, input.runes], input.yongshenVote)
  const timing = campVote([input.taeil], input.yongshenVote)

  let plusWeight = 0
  let minusWeight = 0
  for (const item of voters) {
    if (isPlusVote(item.vote)) plusWeight += item.weight
    else minusWeight += item.weight
  }
  const totalWeight = plusWeight + minusWeight
  const votedCount = voters.length as 1 | 2 | 3 | 4
  const ichingAlone = votedCount === 1 && voters[0]?.system === 'iching'
  const allVotersAgree = plusWeight === 0 || minusWeight === 0

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
    confidence: totalWeight === 0 ? 1 : Math.abs(plusWeight - minusWeight) / totalWeight,
    plusWeight,
    minusWeight,
    totalWeight,
    votedCount,
    ichingAlone,
    allVotersAgree,
    drawCamp: draw.vote ?? input.yongshenVote,
    timingCamp: timing.vote,
    usedYongshenTiebreak,
  }
}

/**
 * v1.0.0 camp rule, kept for the change-rate simulation only.
 * DRAW internal majority; TIMING never flips the ballot.
 * 결번 seats are skipped; 육효 still sits in DRAW.
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
  return draw.vote ?? input.yongshenVote
}
