import { describe, expect, it } from 'vitest'
import { buildDeepSnapshot, deepBrandLabel } from '../deep-snapshot'

const CONTEXT = 'SECRET-PACKET-CONTEXT do not leak'

function openState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    instrument: 'BTC/USD',
    category: 'crypto',
    proposition: 'Bitcoin closes higher this week',
    question: 'Q. Write in English.',
    context: CONTEXT,
    availableDataSummary: 'summary internals',
    snapshot: { ok: true, sources: [{ id: 's', label: 'l', ok: true, text: 'raw source text' }] },
    outputLanguage: 'en',
    ...overrides,
  }
}

const openPlan = {
  ok: true,
  roles: [
    { roleId: 'price', roleLabel: 'Price analyst', mandate: 'm1', provider: 'openai', subQuestion: 'What moved?' },
    { roleId: 'risk', roleLabel: 'Risk analyst', mandate: 'm2', provider: 'deepseek', subQuestion: 'What breaks?' },
  ],
}

describe('buildDeepSnapshot — open product', () => {
  it('returns null for the pre-seed placeholder', () => {
    expect(buildDeepSnapshot('open', { __unseeded: true })).toBeNull()
    expect(buildDeepSnapshot('open', null)).toBeNull()
  })

  it('streams the plan and briefing before any analysis lands', () => {
    const snap = buildDeepSnapshot('open', openState({ plan: openPlan, report: 'shared briefing' }))
    expect(snap).not.toBeNull()
    if (snap?.kind !== 'open') throw new Error('expected open snapshot')
    expect(snap.plan).toEqual([
      {
        roleId: 'price',
        roleLabel: 'Price analyst',
        provider: 'openai',
        brand: 'ChatGPT',
        subQuestion: 'What moved?',
      },
      {
        roleId: 'risk',
        roleLabel: 'Risk analyst',
        provider: 'deepseek',
        brand: 'DeepSeek',
        subQuestion: 'What breaks?',
      },
    ])
    expect(snap.briefing).toBe('shared briefing')
    expect(snap.analyses).toEqual([])
    expect(snap.synthesis).toBeNull()
  })

  it('fills analyses in arrival order and the synthesis from the terminal result', () => {
    const snap = buildDeepSnapshot(
      'open',
      openState({
        plan: openPlan,
        report: 'shared briefing',
        analyses: [
          {
            roleId: 'risk',
            roleLabel: 'Risk analyst',
            provider: 'deepseek',
            subQuestion: 'What breaks?',
            isDoubledAngle: false,
            ok: true,
            analysis: 'risk brief text',
          },
          {
            roleId: 'price',
            roleLabel: 'Price analyst',
            provider: 'openai',
            subQuestion: 'What moved?',
            isDoubledAngle: false,
            ok: false,
            analysis: null,
            error: 'empty model response',
          },
        ],
        result: { ok: true, synthesis: 'final merged report' },
      })
    )
    if (snap?.kind !== 'open') throw new Error('expected open snapshot')
    expect(snap.analyses.map((a) => a.roleId)).toEqual(['risk', 'price'])
    expect(snap.analyses[0]).toMatchObject({ brand: 'DeepSeek', content: 'risk brief text', ok: true })
    expect(snap.analyses[1]).toMatchObject({ ok: false, content: null, error: 'empty model response' })
    expect(snap.synthesis).toBe('final merged report')
  })

  it('never leaks the packet context, data summary, or research sources', () => {
    const snap = buildDeepSnapshot(
      'open',
      openState({ plan: openPlan, report: 'briefing', analyses: [], result: { synthesis: 'done' } })
    )
    const json = JSON.stringify(snap)
    expect(json).not.toContain(CONTEXT)
    expect(json).not.toContain('summary internals')
    expect(json).not.toContain('raw source text')
  })
})

describe('buildDeepSnapshot — debate product', () => {
  const debatePlan = {
    ok: true,
    roles: [
      { roleId: 'pro-1', roleLabel: 'Pro lead', mandate: 'argue for', provider: 'anthropic' },
      { roleId: 'con-1', roleLabel: 'Con lead', mandate: 'argue against', provider: 'xai', isRedTeam: true },
    ],
  }
  const round1 = {
    roundNumber: 1,
    consensusScore: 55,
    summary: 'split on momentum',
    agreedPoints: [],
    contestedPoints: [],
    ok: true,
    turns: [
      {
        roleId: 'pro-1',
        roleLabel: 'Pro lead',
        provider: 'anthropic',
        isRedTeam: false,
        ok: true,
        position: 'The uptrend holds.',
        concedes: 'volume is thin',
        holds: 'trend intact',
      },
      {
        roleId: 'con-1',
        roleLabel: 'Con lead',
        provider: 'xai',
        isRedTeam: true,
        ok: false,
        position: null,
        concedes: null,
        holds: null,
        error: 'timeout',
      },
    ],
  }

  it('streams accumulated rounds from the per-hop pipeline field', () => {
    const snap = buildDeepSnapshot('debate', openState({ plan: debatePlan, report: 'briefing', rounds: [round1] }))
    if (snap?.kind !== 'debate') throw new Error('expected debate snapshot')
    expect(snap.plan?.[0]).toMatchObject({ brand: 'Claude', mandate: 'argue for' })
    expect(snap.rounds).toHaveLength(1)
    expect(snap.rounds[0]).toMatchObject({ roundNumber: 1, consensusScore: 55, summary: 'split on momentum' })
    expect(snap.rounds[0]!.turns[0]).toMatchObject({
      brand: 'Claude',
      position: 'The uptrend holds.',
      concedes: 'volume is thin',
      holds: 'trend intact',
      ok: true,
    })
    expect(snap.rounds[0]!.turns[1]!.ok).toBe(false)
    expect(snap.vote).toBeNull()
    expect(snap.verdict).toBeNull()
  })

  it('carries the full per-voter ballot from the vote hop', () => {
    const snap = buildDeepSnapshot(
      'debate',
      openState({
        plan: debatePlan,
        report: 'briefing',
        rounds: [round1],
        deliberation: { rounds: [round1], finalScore: 55, ok: true },
        vote: {
          votes: [
            { provider: 'anthropic', ok: true, choice: 'approve', reason: 'trend holds' },
            { provider: 'xai', ok: true, choice: 'oppose', reason: 'macro risk' },
            { provider: 'glm-5.2', ok: true, choice: 'conditional', reason: 'if volume returns' },
          ],
          approveCount: 1,
          conditionalCount: 1,
          opposeCount: 1,
          abstainCount: 0,
          summary: '1:1:1',
          ok: true,
        },
      })
    )
    if (snap?.kind !== 'debate') throw new Error('expected debate snapshot')
    expect(snap.vote).toMatchObject({ approve: 1, conditional: 1, oppose: 1, abstain: 0, summary: '1:1:1' })
    expect(snap.vote?.votes.map((v) => v.brand)).toEqual(['Claude', 'Grok', 'GLM'])
    expect(snap.vote?.votes[2]).toMatchObject({ choice: 'conditional', reason: 'if volume returns' })
  })

  it('falls back to pre-split rows: deliberation rounds + counts-only result vote', () => {
    const snap = buildDeepSnapshot(
      'debate',
      openState({
        plan: debatePlan,
        report: 'briefing',
        deliberation: { rounds: [round1], finalScore: 55, ok: true },
        result: {
          ok: true,
          consensusScore: 55,
          vote: { approve: 5, oppose: 3, conditional: 1, abstain: 0, summary: 'carried' },
          verdict: { judgment: 'The motion carries.', keyIssues: 'volume', minorityReport: 'macro risk remains' },
        },
      })
    )
    if (snap?.kind !== 'debate') throw new Error('expected debate snapshot')
    expect(snap.rounds).toHaveLength(1)
    expect(snap.vote).toMatchObject({ approve: 5, oppose: 3, conditional: 1, abstain: 0, votes: [] })
    expect(snap.verdict).toEqual({
      judgment: 'The motion carries.',
      keyIssues: 'volume',
      minorityReport: 'macro risk remains',
      consensusScore: 55,
    })
  })
})

describe('deepBrandLabel', () => {
  it('maps every deep seat provider to a product name and passes unknowns through', () => {
    expect(deepBrandLabel('openai')).toBe('ChatGPT')
    expect(deepBrandLabel('glm-5.2')).toBe('GLM')
    expect(deepBrandLabel('meta')).toBe('Llama')
    expect(deepBrandLabel('mystery')).toBe('mystery')
  })
})
