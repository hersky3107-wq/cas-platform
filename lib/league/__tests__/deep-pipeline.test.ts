import { describe, expect, it } from 'vitest'
import {
  LEAGUE_DEBATE_MAX_ROUNDS,
  OPEN_ANALYSES_BATCH_SIZE,
  debateStageFor,
  decideDeliberationStop,
  openAnalysesComplete,
  openStageFor,
  pendingOpenAnalysisRoles,
} from '../deep-pipeline'
import type { LeagueDeepRole, LeagueOpenAnalysis, LeagueRoundResult } from '../deep-types'

function mkRole(i: number): LeagueDeepRole {
  return {
    roleId: `seat-${i}`,
    roleLabel: `Analyst ${i}`,
    mandate: `mandate ${i}`,
    provider: i % 2 === 0 ? 'openai' : 'anthropic',
  }
}

function mkAnalysis(roleId: string, ok = true): LeagueOpenAnalysis {
  return {
    roleId,
    roleLabel: roleId,
    provider: 'openai',
    subQuestion: 'q',
    isDoubledAngle: false,
    ok,
    analysis: ok ? 'text' : null,
  }
}

function mkRound(roundNumber: number, consensusScore: number, ok = true): LeagueRoundResult {
  return {
    roundNumber,
    turns: [],
    consensusScore,
    agreedPoints: [],
    contestedPoints: [],
    summary: `round ${roundNumber}`,
    ok,
    ...(ok ? {} : { error: 'no live turns' }),
  }
}

describe('open analyses batching (resume-safe hops)', () => {
  const roles = Array.from({ length: 8 }, (_, i) => mkRole(i))

  it('first hop takes the first batch, second hop the rest', () => {
    const first = pendingOpenAnalysisRoles(roles, [])
    expect(first.map((r) => r.roleId)).toEqual(['seat-0', 'seat-1', 'seat-2', 'seat-3'])
    expect(first).toHaveLength(OPEN_ANALYSES_BATCH_SIZE)

    const afterFirst = first.map((r) => mkAnalysis(r.roleId))
    expect(openAnalysesComplete(roles, afterFirst)).toBe(false)
    const second = pendingOpenAnalysisRoles(roles, afterFirst)
    expect(second.map((r) => r.roleId)).toEqual(['seat-4', 'seat-5', 'seat-6', 'seat-7'])
  })

  it('a killed hop resumes with only the missing seats (no repeats)', () => {
    // Worker died after 6 of 8 landed and were persisted.
    const landed = roles.slice(0, 6).map((r) => mkAnalysis(r.roleId))
    const resume = pendingOpenAnalysisRoles(roles, landed)
    expect(resume.map((r) => r.roleId)).toEqual(['seat-6', 'seat-7'])
  })

  it('failed seats count as recorded — completion is coverage, not success', () => {
    const all = roles.map((r, i) => mkAnalysis(r.roleId, i > 0))
    expect(openAnalysesComplete(roles, all)).toBe(true)
    expect(pendingOpenAnalysisRoles(roles, all)).toEqual([])
  })

  it('never reports complete for an empty plan', () => {
    expect(openAnalysesComplete([], [])).toBe(false)
  })
})

describe('deliberation stop rule (one round per hop)', () => {
  it('continues after a healthy first round (min rounds not reached)', () => {
    expect(decideDeliberationStop([mkRound(1, 40)], LEAGUE_DEBATE_MAX_ROUNDS)).toEqual({
      stop: false,
      reason: 'max_rounds',
    })
  })

  it('stops with error when the round has no live turns', () => {
    const d = decideDeliberationStop([mkRound(1, 40, false)], LEAGUE_DEBATE_MAX_ROUNDS)
    expect(d).toEqual({ stop: true, reason: 'error' })
  })

  it('stops with error when consensus is unmeasurable', () => {
    const d = decideDeliberationStop([mkRound(1, -1)], LEAGUE_DEBATE_MAX_ROUNDS)
    expect(d).toEqual({ stop: true, reason: 'error' })
  })

  it('stops on target once the score clears 85', () => {
    const d = decideDeliberationStop([mkRound(1, 60), mkRound(2, 90)], LEAGUE_DEBATE_MAX_ROUNDS)
    expect(d).toEqual({ stop: true, reason: 'target_reached' })
  })

  it('stops as stalled when the delta shrinks below the threshold', () => {
    const d = decideDeliberationStop([mkRound(1, 40), mkRound(2, 42)], LEAGUE_DEBATE_MAX_ROUNDS)
    expect(d).toEqual({ stop: true, reason: 'stalled' })
  })

  it('stops at max rounds when still moving but below target', () => {
    const d = decideDeliberationStop([mkRound(1, 40), mkRound(2, 50)], LEAGUE_DEBATE_MAX_ROUNDS)
    expect(d).toEqual({ stop: true, reason: 'max_rounds' })
  })
})

describe('stage progression (poll-visible hop names)', () => {
  const roles = Array.from({ length: 8 }, (_, i) => mkRole(i))
  const plan = { roles }

  it('open: plan → report → analyses (until every seat lands) → synthesis', () => {
    expect(openStageFor({})).toBe('plan')
    expect(openStageFor({ plan })).toBe('report')
    expect(openStageFor({ plan, report: 'briefing' })).toBe('analyses')
    const half = roles.slice(0, 4).map((r) => mkAnalysis(r.roleId))
    expect(openStageFor({ plan, report: 'briefing', analyses: half })).toBe('analyses')
    const full = roles.map((r) => mkAnalysis(r.roleId))
    expect(openStageFor({ plan, report: 'briefing', analyses: full })).toBe('synthesis')
  })

  it('debate: plan → report → deliberate → vote → verdict as separate hops', () => {
    expect(debateStageFor({})).toBe('plan')
    expect(debateStageFor({ plan })).toBe('report')
    expect(debateStageFor({ plan, report: 'briefing' })).toBe('deliberate')
    expect(debateStageFor({ plan, report: 'briefing', deliberation: {} })).toBe('vote')
    expect(debateStageFor({ plan, report: 'briefing', deliberation: {}, vote: {} })).toBe('verdict')
  })
})
