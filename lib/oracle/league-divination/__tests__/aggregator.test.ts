/**
 * DRAW vs TIMING hierarchy and weighted-margin confidence — product rules.
 */
import { describe, expect, it } from 'vitest'
import { aggregateLeagueVotes } from '../aggregator'
import { LEAGUE_VOTE_WEIGHTS } from '../conventions'
import type { LeagueSystemVote } from '../types'

function vote(
  system: LeagueSystemVote['system'],
  ballot: LeagueSystemVote['vote'],
  extra?: Partial<LeagueSystemVote>,
): LeagueSystemVote {
  const camp = system === 'taeil' ? 'timing' : 'draw'
  return {
    system,
    camp,
    weight: LEAGUE_VOTE_WEIGHTS[system],
    vote: ballot,
    collapsedFromHold: false,
    source: 'test',
    ...extra,
  }
}

describe('binary aggregator', () => {
  it('DRAW wins when camps disagree', () => {
    const result = aggregateLeagueVotes({
      axis: 'direction',
      iching: vote('iching', 'up'),
      tarot: vote('tarot', 'up'),
      runes: vote('runes', 'up'),
      taeil: vote('taeil', 'down'),
      yongshenVote: 'up',
    })
    expect(result.vote).toBe('up')
    expect(result.drawCamp).toBe('up')
    expect(result.timingCamp).toBe('down')
    expect(result.usedYongshenTiebreak).toBe(false)
    // 7 vs 2
    expect(result.plusWeight).toBe(7)
    expect(result.minusWeight).toBe(2)
    expect(result.confidence).toBeCloseTo(5 / 9, 10)
  })

  it('타로+룬 can outvote 육효 inside DRAW (2+2 > 3)', () => {
    const result = aggregateLeagueVotes({
      axis: 'direction',
      iching: vote('iching', 'up'),
      tarot: vote('tarot', 'down'),
      runes: vote('runes', 'down'),
      taeil: vote('taeil', 'up'),
      yongshenVote: 'up',
    })
    expect(result.drawCamp).toBe('down')
    expect(result.timingCamp).toBe('up')
    expect(result.vote).toBe('down')
    expect(result.confidence).toBeCloseTo(1 / 9, 10)
  })

  it('unanimous plus is confidence 1 and never null', () => {
    const result = aggregateLeagueVotes({
      axis: 'pick_one',
      iching: vote('iching', 'a'),
      tarot: vote('tarot', 'a'),
      runes: vote('runes', 'a'),
      taeil: vote('taeil', 'a'),
      yongshenVote: 'a',
    })
    expect(result.vote).toBe('a')
    expect(result.confidence).toBe(1)
  })

  it('residual DRAW tie uses 육효 용신 왕쇠 — PRODUCT, not doctrine', () => {
    const iching = vote('iching', 'up')
    const tarot = vote('tarot', 'down')
    const runes: LeagueSystemVote = { ...vote('runes', 'down'), weight: 1 as unknown as 2 }
    const result = aggregateLeagueVotes({
      axis: 'direction',
      iching,
      tarot,
      runes,
      taeil: vote('taeil', 'down'),
      yongshenVote: 'up',
    })
    // DRAW 3 vs 2+1 = 3 — tied; PRODUCT residual → 용신 up
    expect(result.usedYongshenTiebreak).toBe(true)
    expect(result.vote).toBe('up')
  })
})
