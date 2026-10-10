import { describe, expect, it } from 'vitest'
import {
  coreTokens,
  entityEvidencePrecise,
  entityMatchContext,
  entityNamedInEvidence,
  hedgeStaleStatusText,
  headlineRootKey,
  pickDiverseHeadlines,
  staleStatusFacts,
} from '../fact-precision'
import type { EngineCard, Hypothesis } from '../schema'

const NOW = new Date('2026-10-10T12:00:00Z')

function ctx(extra: Partial<EngineCard> = {}) {
  const card: EngineCard = {
    region_id: 7,
    name: 'Badulla',
    country: 'Sri Lanka',
    iso3: 'LKA',
    lat: 6.99,
    lon: 81.06,
    level: 1,
    horizon: '30d',
    components: [],
    fragility: [{ kind: 'dam', name: 'Victoria Dam' }, { kind: 'dam', name: 'Randenigala Dam' }],
    cascades: [],
    context: [],
    urban: [],
    ...extra,
  }
  return entityMatchContext(card, [
    {
      title: 'Victoria reservoir level high',
      url: 'https://news.example/victoria-reservoir',
      published: '2026-10-08',
      past: false,
      source: 'search',
      snippet: 'Operators watch Victoria reservoir inflows.',
    },
  ])
}

describe('entity alias matching', () => {
  it('matches verbatim, core aliases, and search title/snippet by url', () => {
    const evidence = [{ type: 'news', ref: 'Spring Valley Regional Hospital closed for inspection', url: 'https://x.lk/a' }]
    const spring = ctx()
    expect(entityNamedInEvidence('Spring Valley Regional Hospital', evidence, spring)).toBe(true)
    expect(entityNamedInEvidence('Badulla referral hospital', evidence, spring)).toBe(false)
    expect(entityNamedInEvidence('the hospital', evidence, spring)).toBe(false)

    const victoriaCtx = ctx()
    expect(entityNamedInEvidence('Victoria Dam', [{ ref: 'Victoria reservoir level rising' }], victoriaCtx)).toBe(true)
    expect(entityNamedInEvidence('Victoria Dam', [{ ref: 'levels', url: 'https://news.example/victoria-reservoir' }], victoriaCtx)).toBe(true)
    expect(coreTokens('Victoria Dam')).toEqual(['victoria'])
  })

  it('accepts atlas fragility names without a text hit', () => {
    const atlas = ctx()
    expect(entityNamedInEvidence('Victoria Dam', [], atlas)).toBe(true)
    expect(entityNamedInEvidence('Victoria', [], atlas)).toBe(true)
    expect(entityEvidencePrecise({ entities: ['Randenigala Dam'], evidence: [] }, atlas)).toBe(true)
    expect(entityNamedInEvidence('Ulhitiya Dam', [], atlas)).toBe(false)
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
