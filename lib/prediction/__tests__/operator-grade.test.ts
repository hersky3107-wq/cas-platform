import { describe, expect, it } from 'vitest'
import {
  gradeFromOperatorEvidence,
  type OperatorEvidenceRow,
  type OperatorGradeDeps,
  type OperatorRoundRow,
} from '../operator-grade'

const DUE_SPORTS: OperatorRoundRow = {
  id: 'round-op-1',
  instrument: 'MATCH:MUN-LIV-20260901',
  category: 'sports',
  proposition_kind: 'binary_subject_outcome',
  subject_label: 'Manchester United',
  actual_outcome: null,
  resolved_at: null,
  resolves_at: '2026-09-01T21:00:00.000Z',
}

function memoryDeps(seed: OperatorRoundRow = DUE_SPORTS): OperatorGradeDeps & {
  evidence: Map<string, OperatorEvidenceRow>
  outcomes: Map<string, string>
  children: { roundId: string; direction: string }[]
  order: string[]
} {
  const rounds = new Map<string, OperatorRoundRow>([[seed.id, { ...seed }]])
  const evidence = new Map<string, OperatorEvidenceRow>()
  const outcomes = new Map<string, string>()
  const children: { roundId: string; direction: string }[] = []
  const order: string[] = []

  return {
    evidence,
    outcomes,
    children,
    order,
    resolvePlan: () => ({ source: 'operator_manual' }),
    async loadRound(id) {
      return rounds.get(id) ?? null
    },
    async insertEvidence(row) {
      order.push('insertEvidence')
      if (evidence.has(row.roundId)) return { ok: false, unique: true, error: 'duplicate key' }
      evidence.set(row.roundId, {
        source_url: row.sourceUrl,
        observed_fact: row.observedFact,
        derived_side: row.derivedSide,
      })
      return { ok: true }
    },
    async loadEvidence(id) {
      return evidence.get(id) ?? null
    },
    async saveOutcome(id, actualOutcome) {
      order.push('saveOutcome')
      if (outcomes.has(id) || rounds.get(id)?.actual_outcome != null) return false
      outcomes.set(id, actualOutcome)
      const round = rounds.get(id)
      if (round) round.actual_outcome = actualOutcome
      return true
    },
    async gradeChildren(id, direction) {
      order.push('gradeChildren')
      children.push({ roundId: id, direction })
      return 4
    },
  }
}

const INPUT = {
  roundId: DUE_SPORTS.id,
  sourceUrl: 'https://www.premierleague.com/match/123',
  observedFact: 'Manchester United',
  gradedBy: 'admin-user-id',
}

describe('gradeFromOperatorEvidence — write path', () => {
  it('maps the fact, writes evidence then outcome then children, and speaks yes/no', async () => {
    const deps = memoryDeps()
    const result = await gradeFromOperatorEvidence(INPUT, deps)
    expect(result).toMatchObject({
      ok: true,
      derived_side: 'yes',
      children_graded: 4,
      resumed: false,
    })
    if (!result.ok) throw new Error('expected ok')
    expect(result.actual_outcome).toBe('yes (observed Manchester United)')
    expect(result.actual_outcome).not.toMatch(/close|anchor|resolution_price/)
    expect(deps.evidence.get(DUE_SPORTS.id)).toEqual({
      source_url: INPUT.sourceUrl,
      observed_fact: INPUT.observedFact,
      derived_side: 'yes',
    })
    expect(deps.outcomes.get(DUE_SPORTS.id)).toBe(result.actual_outcome)
    expect(deps.children).toEqual([{ roundId: DUE_SPORTS.id, direction: 'up' }])
    expect(deps.order).toEqual(['insertEvidence', 'saveOutcome', 'gradeChildren'])
  })

  it('write-once: a second submission fails on the PK and does not overwrite', async () => {
    const deps = memoryDeps()
    deps.evidence.set(DUE_SPORTS.id, {
      source_url: INPUT.sourceUrl,
      observed_fact: INPUT.observedFact,
      derived_side: 'yes',
    })

    const second = await gradeFromOperatorEvidence(
      { ...INPUT, observedFact: 'Liverpool', sourceUrl: 'https://www.premierleague.com/match/999' },
      deps
    )
    expect(second.ok).toBe(false)
    if (second.ok) throw new Error('expected fail')
    expect(second.status).toBe(409)
    expect(second.error).toMatch(/already has operator evidence/)
    expect(deps.evidence.get(DUE_SPORTS.id)?.observed_fact).toBe('Manchester United')
    expect(deps.evidence.get(DUE_SPORTS.id)?.source_url).toBe(INPUT.sourceUrl)
    expect(deps.outcomes.size).toBe(0)
    expect(deps.children).toHaveLength(0)
    expect(deps.order).toEqual(['insertEvidence'])
  })

  it('write-once: a duplicate of the same URL+fact after outcome landed still refuses', async () => {
    const deps = memoryDeps()
    await gradeFromOperatorEvidence(INPUT, deps)
    const again = await gradeFromOperatorEvidence(INPUT, deps)
    expect(again.ok).toBe(false)
    if (again.ok) throw new Error('expected fail')
    expect(again.status).toBe(409)
    expect(deps.children).toHaveLength(1)
  })

  it('resumes a crashed first attempt: PK hit, same evidence, outcome still null', async () => {
    const deps = memoryDeps()
    deps.evidence.set(DUE_SPORTS.id, {
      source_url: INPUT.sourceUrl,
      observed_fact: INPUT.observedFact,
      derived_side: 'yes',
    })
    const result = await gradeFromOperatorEvidence(INPUT, deps)
    expect(result).toMatchObject({ ok: true, resumed: true, derived_side: 'yes', children_graded: 4 })
    expect(deps.order).toEqual(['insertEvidence', 'saveOutcome', 'gradeChildren'])
    expect(deps.outcomes.get(DUE_SPORTS.id)).toBe('yes (observed Manchester United)')
  })

  it('does not invent a resolutionPrice and refuses a price-plan round', async () => {
    const deps = memoryDeps({ ...DUE_SPORTS, category: 'stock', instrument: 'AAPL', proposition_kind: 'binary_close_higher' })
    deps.resolvePlan = () => ({ source: 'price_series' })
    const result = await gradeFromOperatorEvidence(INPUT, deps)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected fail')
    expect(result.error).toMatch(/operator-manual/)
    expect(deps.evidence.size).toBe(0)
    expect(deps.outcomes.size).toBe(0)
    expect(deps.children).toHaveLength(0)
  })
})
