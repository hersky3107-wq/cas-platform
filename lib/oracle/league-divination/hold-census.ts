/**
 * Hold / 결번 census. A system whose table yields hold abstains;
 * it does not copy 육효. This file only counts — it does not change the rule.
 */
import { computeLeagueDivination } from './compute'
import { hasBallot } from './status'
import type { LeagueDivinationResult } from './types'
import { LEAGUE_ORACLE_CATEGORY_IDS } from './types'
import { isPlusVote } from './yongshen'

export const HOLD_CENSUS_N = 504
export const HOLD_CENSUS_ALL_FOUR_IDENTICAL_BEFORE = 0.335

export type HoldCensus = {
  n: number
  tarotHold: number
  runeHold: number
  taeilHold: number
  voted1: number
  voted2: number
  voted3: number
  voted4: number
  allVotersAgree: number
  fourVotedAndAgree: number
  confidence1: number
  confidence1ByVoted: { 1: number; 2: number; 3: number; 4: number }
  confidenceSum: number
  up: number
  down: number
  ichingAlone: number
  drawSplit: number
  taeilCasts: number
}

/** 육효 vs united 타로+룬 (3 vs 4) — the shape where 택일 is the casting vote. */
function isDrawSplit(votes: LeagueDivinationResult['votes']): boolean {
  if (!hasBallot(votes.iching) || !hasBallot(votes.tarot) || !hasBallot(votes.runes)) return false
  if (isPlusVote(votes.tarot.vote) !== isPlusVote(votes.runes.vote)) return false
  return isPlusVote(votes.iching.vote) !== isPlusVote(votes.tarot.vote)
}

/** Walk ~a year in 17-hour steps so 일진 and 월건 actually move. */
export function censusFirstViewIso(i: number): string {
  const start = Date.UTC(2026, 0, 1, 3, 17, 0)
  return new Date(start + i * 17 * 3600 * 1000).toISOString()
}

export function runHoldCensus(n = HOLD_CENSUS_N): HoldCensus {
  const out: HoldCensus = {
    n,
    tarotHold: 0,
    runeHold: 0,
    taeilHold: 0,
    voted1: 0,
    voted2: 0,
    voted3: 0,
    voted4: 0,
    allVotersAgree: 0,
    fourVotedAndAgree: 0,
    confidence1: 0,
    confidence1ByVoted: { 1: 0, 2: 0, 3: 0, 4: 0 },
    confidenceSum: 0,
    up: 0,
    down: 0,
    ichingAlone: 0,
    drawSplit: 0,
    taeilCasts: 0,
  }
  for (let i = 0; i < n; i += 1) {
    const categoryId = LEAGUE_ORACLE_CATEGORY_IDS[i % LEAGUE_ORACLE_CATEGORY_IDS.length]!
    const computed = computeLeagueDivination({
      roundId: `hold-census-${i}`,
      firstViewIso: censusFirstViewIso(i),
      categoryId,
      axis: i % 5 === 0 ? 'pick_one' : 'direction',
    })
    if (computed.votes.tarot.abstained) out.tarotHold += 1
    if (computed.votes.runes.abstained) out.runeHold += 1
    if (computed.votes.taeil.abstained) out.taeilHold += 1
    const voted = [
      computed.votes.iching,
      computed.votes.tarot,
      computed.votes.runes,
      computed.votes.taeil,
    ].filter(hasBallot)
    const k = voted.length as 1 | 2 | 3 | 4
    if (k === 1) out.voted1 += 1
    else if (k === 2) out.voted2 += 1
    else if (k === 3) out.voted3 += 1
    else out.voted4 += 1
    if (computed.aggregate.allVotersAgree) out.allVotersAgree += 1
    if (k === 4 && computed.aggregate.allVotersAgree) out.fourVotedAndAgree += 1
    out.confidenceSum += computed.aggregate.confidence
    if (computed.aggregate.confidence === 1) {
      out.confidence1 += 1
      out.confidence1ByVoted[k] += 1
    }
    if (computed.aggregate.ichingAlone) out.ichingAlone += 1
    const drawSplit = isDrawSplit(computed.votes)
    if (drawSplit) out.drawSplit += 1
    if (
      drawSplit &&
      hasBallot(computed.votes.taeil) &&
      isPlusVote(computed.aggregate.vote) === isPlusVote(computed.votes.taeil.vote) &&
      isPlusVote(computed.aggregate.vote) !== isPlusVote(computed.aggregate.drawCamp)
    ) {
      out.taeilCasts += 1
    }
    if (isPlusVote(computed.aggregate.vote)) out.up += 1
    else out.down += 1
  }
  return out
}

export function holdCensusRates(c: HoldCensus) {
  const pct = (k: number) => Number(((k / c.n) * 100).toFixed(1))
  return {
    n: c.n,
    tarotHoldPct: pct(c.tarotHold),
    runeHoldPct: pct(c.runeHold),
    taeilHoldPct: pct(c.taeilHold),
    voted1Pct: pct(c.voted1),
    voted2Pct: pct(c.voted2),
    voted3Pct: pct(c.voted3),
    voted4Pct: pct(c.voted4),
    allVotersAgreePct: pct(c.allVotersAgree),
    fourVotedAndAgreePct: pct(c.fourVotedAndAgree),
    confidence1Pct: pct(c.confidence1),
    confidenceMean: Number((c.confidenceSum / c.n).toFixed(3)),
    ichingAlonePct: pct(c.ichingAlone),
    drawSplitPct: pct(c.drawSplit),
    taeilCastsPct: pct(c.taeilCasts),
    taeilCastsGivenDrawSplitPct:
      c.drawSplit === 0 ? 0 : Number(((c.taeilCasts / c.drawSplit) * 100).toFixed(1)),
    up: c.up,
    down: c.down,
    allFourIdenticalBeforePct: HOLD_CENSUS_ALL_FOUR_IDENTICAL_BEFORE * 100,
  }
}
