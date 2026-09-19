/**
 * Hold-collapse census. Does not change the vote rule — it only counts how
 * often 타로 / 룬 / 택일 copy 육효 because their own table said hold.
 */
import { computeLeagueDivination } from './compute'
import { LEAGUE_ORACLE_CATEGORY_IDS } from './types'
import { isPlusVote } from './yongshen'

export const HOLD_CENSUS_N = 504

export type HoldCensus = {
  n: number
  tarotHold: number
  runeHold: number
  taeilHold: number
  allFourIdentical: number
  confidence1: number
  up: number
  down: number
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
    allFourIdentical: 0,
    confidence1: 0,
    up: 0,
    down: 0,
  }
  for (let i = 0; i < n; i += 1) {
    const categoryId = LEAGUE_ORACLE_CATEGORY_IDS[i % LEAGUE_ORACLE_CATEGORY_IDS.length]!
    const computed = computeLeagueDivination({
      roundId: `hold-census-${i}`,
      firstViewIso: censusFirstViewIso(i),
      categoryId,
      axis: i % 5 === 0 ? 'pick_one' : 'direction',
    })
    if (computed.votes.tarot.collapsedFromHold) out.tarotHold += 1
    if (computed.votes.runes.collapsedFromHold) out.runeHold += 1
    if (computed.votes.taeil.collapsedFromHold) out.taeilHold += 1
    const pluses = [
      isPlusVote(computed.votes.iching.vote),
      isPlusVote(computed.votes.tarot.vote),
      isPlusVote(computed.votes.runes.vote),
      isPlusVote(computed.votes.taeil.vote),
    ]
    if (pluses.every((p) => p === pluses[0])) out.allFourIdentical += 1
    if (computed.aggregate.confidence === 1) out.confidence1 += 1
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
    allFourIdenticalPct: pct(c.allFourIdentical),
    confidence1Pct: pct(c.confidence1),
    up: c.up,
    down: c.down,
  }
}
