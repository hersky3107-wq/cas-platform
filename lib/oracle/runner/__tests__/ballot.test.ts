/**
 * The layer-2 tally is computed in CODE from seer ballots — never by an AI.
 * These tests pin the counting rules: direction votes, focus votes, domain
 * means, minority seats, abstentions, and the legacy stub `phase` fallback.
 */
import { describe, expect, it } from 'vitest'
import type { OracleVerdict } from '../../schema'
import { ballotTallyJson, tallyBallots } from '../ballot'

function verdict(overrides: Partial<OracleVerdict>): OracleVerdict {
  return {
    id: 'v-1',
    session_id: 's-1',
    reader_slug: 'reader',
    brand: 'Moonshot AI',
    model: 'server-only',
    verdict_line: '전진.',
    ballot: null,
    dissent: null,
    full_text: null,
    status: 'done',
    latency_ms: 10,
    tokens_in: 1,
    tokens_out: 1,
    ...overrides,
  }
}

function ballot(direction: string, focus = 'work', base = 50) {
  return {
    direction,
    focus,
    domains: { work: base + 10, money: base, love: base - 10, social: base, energy: base },
  }
}

describe('tallyBallots', () => {
  it('counts directions, focus votes, and averages domains across counted ballots', () => {
    const tally = tallyBallots([
      verdict({ reader_slug: 'reader', ballot: ballot('advance', 'work', 60) }),
      verdict({ reader_slug: 'seer', ballot: ballot('advance', 'work', 40) }),
      verdict({ reader_slug: 'guide', ballot: ballot('hold', 'money', 50) }),
    ])
    expect(tally.counts).toEqual({ advance: 2, hold: 1, release: 0 })
    expect(tally.leader).toBe('advance')
    expect(tally.leaderCount).toBe(2)
    expect(tally.participantCount).toBe(3)
    expect(tally.unanimous).toBe(false)
    expect(tally.focusCounts).toMatchObject({ work: 2, money: 1, love: 0 })
    expect(tally.domainMeans.work).toBe(60) // (70+50+60)/3
    expect(tally.minoritySlugs).toEqual(['guide'])
  })

  it('treats errored seers and unreadable ballots as abstentions', () => {
    const tally = tallyBallots([
      verdict({ reader_slug: 'reader', ballot: ballot('release') }),
      verdict({ reader_slug: 'seer', status: 'timeout', ballot: ballot('advance') }),
      verdict({ reader_slug: 'guide', ballot: { direction: 'sideways' } }),
    ])
    expect(tally.participantCount).toBe(1)
    expect(tally.abstained).toEqual(['seer', 'guide'])
    expect(tally.unanimous).toBe(false) // one vote is not unanimity
  })

  it('reads the legacy stub `phase` key so old stub sessions still tally', () => {
    const tally = tallyBallots([
      verdict({ reader_slug: 'reader', ballot: { phase: 'hold', confidence: 55 } }),
      verdict({ reader_slug: 'seer', ballot: { phase: 'hold', confidence: 60 } }),
    ])
    expect(tally.counts.hold).toBe(2)
    expect(tally.unanimous).toBe(true)
    // Legacy ballots carry no focus/domains — means stay null, counts stay 0.
    expect(tally.domainMeans.work).toBeNull()
    expect(tally.focusCounts.work).toBe(0)
  })

  it('serializes every published field', () => {
    const json = ballotTallyJson(
      tallyBallots([verdict({ ballot: ballot('advance') }), verdict({ reader_slug: 'seer', ballot: ballot('release') })]),
    )
    for (const key of [
      'counts',
      'leader',
      'leaderCount',
      'participantCount',
      'abstained',
      'unanimous',
      'focusCounts',
      'domainMeans',
      'minoritySlugs',
    ]) {
      expect(json, key).toHaveProperty(key)
    }
  })
})
