import { describe, expect, it } from 'vitest'
import {
  entityNamedInEvidence,
  hedgeStaleStatusText,
  headlineRootKey,
  pickDiverseHeadlines,
  staleStatusFacts,
} from '../fact-precision'
import type { Hypothesis } from '../schema'

const NOW = new Date('2026-10-10T12:00:00Z')

describe('entity precision', () => {
  it('requires the entity phrase to appear in evidence ref or url', () => {
    const evidence = [{ type: 'news', ref: 'Spring Valley Regional Hospital closed for inspection', url: 'https://x.lk/a' }]
    expect(entityNamedInEvidence('Spring Valley Regional Hospital', evidence)).toBe(true)
    expect(entityNamedInEvidence('Badulla referral hospital', evidence)).toBe(false)
    expect(entityNamedInEvidence('the hospital', evidence)).toBe(false)
  })
})

describe('staleness', () => {
  it('hedges status language when evidence is older than 60 days', () => {
    const facts = staleStatusFacts(
      { evidence: [{ type: 'news', ref: 'Badulla hospital closed for landslide risk', url: 'https://adaderana.lk/2025/12/18/hospital-closed' }] },
      new Map(),
      NOW,
    )
    expect(facts[0]?.date).toBe('2025-12-18')
    const out = hedgeStaleStatusText('Badulla hospital is already closed for landslide risk', facts)
    expect(out).toContain('reported closed on 2025-12-18')
    expect(out).toContain('current status unverified')
  })
})

describe('headline diversity', () => {
  const hypo = (entities: string[], hazards: string[]): Hypothesis =>
    ({
      entities,
      hazards,
      title: entities[0] ?? 'x',
      chain: [{ step: 'x', cascade_id: null }],
      horizon: '30d',
      possibility: 'medium',
      why_humans_miss: 'x',
      evidence: [{ type: 'x', ref: entities[0] ?? 'x' }],
      what_to_do: ['x'],
      official_links: [],
      proposed_by: ['m'],
      weakness_notes: [],
      novelty: 'only_us',
      stage: 4,
      confidence: 'medium',
      outsider: false,
    }) as Hypothesis

  it('skips a lower-ranked row when it shares the same root entity and hazard', () => {
    const rows = [
      { score: 3, h: hypo(['Victoria Dam'], ['dam']) },
      { score: 2.8, h: hypo(['Victoria Dam'], ['dam']) },
      { score: 2.5, h: hypo(['Randenigala Dam'], ['dam']) },
    ]
    const picked = pickDiverseHeadlines(
      rows,
      (row) => row.score,
      (row) => headlineRootKey(row.h),
      3,
    )
    expect(picked.map((row) => row.h.entities?.[0])).toEqual(['Victoria Dam', 'Randenigala Dam'])
    expect(picked).toHaveLength(2)
  })
})
