/**
 * Combinatorial + empirical change rate: weighted-sum vs DRAW-wins-disagreement.
 */
import { describe, expect, it } from 'vitest'
import {
  aggregateLeagueVotes,
  aggregateLeagueVotesDrawWinsDisagreement,
} from '../aggregator'
import { LEAGUE_VOTE_WEIGHTS } from '../conventions'
import { computeLeagueDivination } from '../compute'
import { LEAGUE_ORACLE_CATEGORY_IDS } from '../types'
import type { LeagueBinaryVote, LeagueOracleCategoryId, LeagueSystemVote } from '../types'

function vote(system: LeagueSystemVote['system'], ballot: LeagueBinaryVote): LeagueSystemVote {
  return {
    system,
    camp: system === 'taeil' ? 'timing' : 'draw',
    weight: LEAGUE_VOTE_WEIGHTS[system],
    vote: ballot,
    collapsedFromHold: false,
    source: 'sim',
  }
}

const SIDES: LeagueBinaryVote[] = ['up', 'down']

describe('verdict change vs DRAW-wins-disagreement', () => {
  it('changes only when DRAW splits 3 vs 4 and 택일 agrees with 육효', () => {
    let total = 0
    let changed = 0
    const changedPatterns: string[] = []
    for (const iching of SIDES) {
      for (const tarot of SIDES) {
        for (const runes of SIDES) {
          for (const taeil of SIDES) {
            total += 1
            const input = {
              axis: 'direction' as const,
              iching: vote('iching', iching),
              tarot: vote('tarot', tarot),
              runes: vote('runes', runes),
              taeil: vote('taeil', taeil),
              yongshenVote: iching,
            }
            const next = aggregateLeagueVotes(input).vote
            const prev = aggregateLeagueVotesDrawWinsDisagreement(input)
            if (next !== prev) {
              changed += 1
              changedPatterns.push(`${iching[0]}${tarot[0]}${runes[0]}${taeil[0]}`)
            }
          }
        }
      }
    }
    expect(total).toBe(16)
    // 육효 vs 타로+룬 (3 vs 4), 택일 with 육효: two patterns (up-down-down-up, down-up-up-down).
    expect(changed).toBe(2)
    expect(changed / total).toBe(0.125)
    expect(changedPatterns.sort()).toEqual(['duud', 'uddu'])
  })

  it('empirical sample over real draws stays in that band', () => {
    const stamps = [
      '2026-09-19T00:10:00.000Z',
      '2026-09-19T08:52:00.000Z',
      '2026-09-19T14:30:00.000Z',
      '1988-03-15T14:30:00.000Z',
    ]
    let total = 0
    let changed = 0
    for (const firstViewIso of stamps) {
      for (const categoryId of LEAGUE_ORACLE_CATEGORY_IDS) {
        total += 1
        const computed = computeLeagueDivination({
          roundId: `sim-${firstViewIso}-${categoryId}`,
          firstViewIso,
          categoryId: categoryId as LeagueOracleCategoryId,
          axis: 'direction',
        })
        const next = computed.aggregate.vote
        const prev = aggregateLeagueVotesDrawWinsDisagreement({
          axis: 'direction',
          ...computed.votes,
          yongshenVote: computed.votes.iching.vote,
        })
        if (next !== prev) changed += 1
      }
    }
    expect(total).toBe(48)
    // This four-stamp × 12-chip fixture set flips 2/48 (4.2%) — below the
    // independent 12.5% because hold-collapse correlates 타로/룬/택일 with 육효.
    expect(changed).toBe(2)
  })
})
