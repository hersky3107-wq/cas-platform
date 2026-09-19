/**
 * Straight weighted sum and 택일 as casting vote — product rules.
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
    abstained: ballot === null,
    unreadableCode: ballot === null ? `${system}.hold_no_direction` : null,
    source: 'test',
    ...extra,
  }
}

describe('binary aggregator', () => {
  it('united DRAW still beats 택일 (7 vs 2)', () => {
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

  it('타로+룬 can split DRAW, and 택일 is then the casting vote', () => {
    const split = {
      axis: 'direction' as const,
      iching: vote('iching', 'up'),
      tarot: vote('tarot', 'down'),
      runes: vote('runes', 'down'),
      yongshenVote: 'up' as const,
    }
    const withTaeilUp = aggregateLeagueVotes({ ...split, taeil: vote('taeil', 'up') })
    expect(withTaeilUp.drawCamp).toBe('down')
    expect(withTaeilUp.timingCamp).toBe('up')
    // 육효 3 + 택일 2 = 5 vs 타로+룬 4 → 택일 casts UP
    expect(withTaeilUp.vote).toBe('up')
    expect(withTaeilUp.plusWeight).toBe(5)
    expect(withTaeilUp.minusWeight).toBe(4)
    expect(withTaeilUp.confidence).toBeCloseTo(1 / 9, 10)

    const withTaeilDown = aggregateLeagueVotes({ ...split, taeil: vote('taeil', 'down') })
    expect(withTaeilDown.vote).toBe('down')
    expect(withTaeilDown.plusWeight).toBe(3)
    expect(withTaeilDown.minusWeight).toBe(6)
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
    expect(result.votedCount).toBe(4)
    expect(result.allVotersAgree).toBe(true)
    expect(result.ichingAlone).toBe(false)
  })

  it('residual numeric tie uses 육효 용신 왕쇠 — PRODUCT, not doctrine', () => {
    const iching: LeagueSystemVote = { ...vote('iching', 'up'), weight: 2 as 3 }
    const result = aggregateLeagueVotes({
      axis: 'direction',
      iching,
      tarot: vote('tarot', 'down'),
      runes: vote('runes', 'down'),
      taeil: vote('taeil', 'up'),
      yongshenVote: 'up',
    })
    // 2+2 vs 2+2 — PRODUCT residual → 용신 up
    expect(result.usedYongshenTiebreak).toBe(true)
    expect(result.vote).toBe('up')
    expect(result.plusWeight).toBe(result.minusWeight)
  })

  it('removes a 결번 seat from the denominator (9 → 7 if tarot abstains)', () => {
    const result = aggregateLeagueVotes({
      axis: 'direction',
      iching: vote('iching', 'up'),
      tarot: vote('tarot', null),
      runes: vote('runes', 'up'),
      taeil: vote('taeil', 'down'),
      yongshenVote: 'up',
    })
    expect(result.totalWeight).toBe(7)
    expect(result.votedCount).toBe(3)
    expect(result.plusWeight).toBe(5)
    expect(result.minusWeight).toBe(2)
    expect(result.confidence).toBeCloseTo(3 / 7, 10)
    expect(result.vote).toBe('up')
    expect(result.timingCamp).toBe('down')
  })

  it('육효 alone when the other three 결번 — verdict is 육효 and the pack must say so', () => {
    const result = aggregateLeagueVotes({
      axis: 'direction',
      iching: vote('iching', 'down'),
      tarot: vote('tarot', null),
      runes: vote('runes', null),
      taeil: vote('taeil', null),
      yongshenVote: 'down',
    })
    expect(result.vote).toBe('down')
    expect(result.ichingAlone).toBe(true)
    expect(result.votedCount).toBe(1)
    expect(result.totalWeight).toBe(3)
    expect(result.confidence).toBe(1)
    expect(result.allVotersAgree).toBe(true)
    expect(result.timingCamp).toBeNull()
  })

  it('택일 결번 does not inherit 육효 — timingCamp is null', () => {
    const result = aggregateLeagueVotes({
      axis: 'direction',
      iching: vote('iching', 'up'),
      tarot: vote('tarot', 'down'),
      runes: vote('runes', 'down'),
      taeil: vote('taeil', null),
      yongshenVote: 'up',
    })
    expect(result.timingCamp).toBeNull()
    expect(result.totalWeight).toBe(7)
    expect(result.vote).toBe('down')
  })
})
