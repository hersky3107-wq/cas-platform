import { describe, expect, it } from 'vitest'
import { buriedWarningCaption, buriedWarningLine } from '../../i18n/outcomes'
import {
  attachBuriedEvidence,
  buriedNonObviousness,
  buriedTargets,
  cheapSearchSlot,
  collectBuriedWarnings,
  ensureBuriedQueries,
  entityNamed,
  warningDocument,
} from '../buried-warning'
import type { RosterSlot } from '../roster'
import type { Draft } from '../hunter-rules'
import type { EngineCard } from '../schema'
import type { SearchItem } from '../search-items'

const NOW = new Date('2026-10-09T00:00:00Z')

function card(): EngineCard {
  return {
    region_id: 1,
    name: 'Istanbul',
    country: 'Turkey',
    iso3: 'TUR',
    lat: 41,
    lon: 29,
    level: 1,
    horizon: '30d',
    components: [
      { key: 'quake', value: 0.2, raw: {} },
      { key: 'rain', value: 0.9, raw: {} },
    ],
    fragility: [
      { kind: 'hospital', name: 'Okmeydanı' },
      { kind: 'dam', name: 'Oymapinar Dam' },
      { kind: 'nuclear', name: 'Not a plant alias' },
      { kind: 'bridge', name: 'Bosphorus Bridge' },
      { kind: 'camp', name: 'Camp A' },
      { kind: 'levee', name: 'Golden Horn Levee' },
    ],
    cascades: [],
    context: [],
    urban: [],
  }
}

function item(partial: Partial<SearchItem> & Pick<SearchItem, 'title' | 'url' | 'published'>): SearchItem {
  return {
    past: true,
    source: 'search',
    ...partial,
  }
}

function draft(entity: string): Draft {
  return {
    id: 'h0',
    title: `${entity} spill`,
    chain: [{ step: 'spill', cascade_id: null }],
    why_humans_miss: 'desks do not share the audit',
    evidence: [{ type: 'dam', ref: entity }],
    what_to_do: ['Move uphill.'],
    official_links: [],
    proposed_by: ['model'],
    weakness_notes: [],
    weakness: 'low',
    hazards: ['dam'],
    departments: ['natural-hydro', 'health'],
    entities: [entity],
    mechanism: 'a controlled spill is not classed as failure',
    lead_time_days: { min: 3, max: 7 },
    early_indicators: ['gates open'],
    falsifier: 'reservoir stays low',
  }
}

describe('buried-warning hunt', () => {
  it('picks named fragility of the hunted kinds, dams first, and the top hazard', () => {
    const picked = buriedTargets(card())
    expect(picked.hazard).toBe('rain')
    expect(picked.entities.map((entity) => entity.name)).toEqual([
      'Oymapinar Dam',
      'Golden Horn Levee',
      'Camp A',
      'Bosphorus Bridge',
    ])
    expect(picked.entities.some((entity) => entity.name === 'Not a plant alias')).toBe(false)
  })

  it('writes two local-language queries and one English query', () => {
    const queries = ensureBuriedQueries([{ name: 'Oymapinar Dam', kind: 'dam' }], 'rain', ['en', 'tr'], [], NOW)
    expect(queries).toHaveLength(3)
    expect(queries.filter((query) => query.language === 'tr')).toHaveLength(2)
    expect(queries.filter((query) => query.language === 'en')).toHaveLength(1)
    expect(queries.every((query) => query.query.includes('Oymapinar Dam'))).toBe(true)
    expect(queries.every((query) => query.query.includes('2021..2026'))).toBe(true)
  })

  it('keeps a dated warning that names the entity and drops the rest', () => {
    const queries = ensureBuriedQueries([{ name: 'Oymapinar Dam', kind: 'dam' }], 'rain', ['en', 'tr'], [], NOW)
    const kept = collectBuriedWarnings(
      [
        item({
          title: 'Oymapinar Dam denetim raporu çatlak risk',
          url: 'https://example.com/2023/06/01/oymapinar-audit',
          published: '2023-06-01',
          snippet: 'Bakım gecikmesi ve yapısal kusur.',
        }),
        item({
          title: 'Oymapinar Dam rain forecast',
          url: 'https://example.com/2024/01/01/forecast',
          published: '2024-01-01',
          snippet: 'Weekly rain totals.',
        }),
        item({
          title: 'Another dam safety audit finds cracks',
          url: 'https://example.com/2023/06/02/other',
          published: '2023-06-02',
        }),
        item({
          title: 'Oymapinar Dam inspection warned of failure',
          url: 'https://example.com/2018/01/01/old',
          published: '2018-01-01',
        }),
        item({
          title: 'Oymapinar Dam audit risk',
          url: 'https://example.com/nodate',
          published: '2026-10-09',
          undated: true,
        }),
      ],
      queries,
      ['Oymapinar Dam'],
      NOW,
    )
    expect(kept).toHaveLength(1)
    expect(kept[0]).toMatchObject({
      type: 'buried_warning',
      entity: 'Oymapinar Dam',
      date: '2023-06-01',
      language: 'tr',
      document: '감사 보고서',
    })
    expect(kept[0]?.line).toBe('묻힌 경고 · 2023년 감사 보고서 · 2023-06-01')
    expect(entityNamed('weekly rain', 'Oymapinar Dam')).toBe(false)
  })

  it('adds 0.15 non_obviousness and caps at 1', () => {
    const row = draft('Oymapinar Dam')
    const warning = collectBuriedWarnings(
      [
        item({
          title: 'Oymapinar Dam safety audit',
          url: 'https://example.com/2023/04/02/audit',
          published: '2023-04-02',
          snippet: 'Inspection report warns of structural risk.',
        }),
      ],
      [],
      ['Oymapinar Dam'],
      NOW,
    )[0]
    expect(warning).toBeTruthy()
    attachBuriedEvidence(row, [warning!])
    expect(row.evidence.some((item) => item.type === 'buried_warning' && item.date === '2023-04-02')).toBe(true)
    expect(buriedNonObviousness(0, row)).toBe(0.15)
    expect(buriedNonObviousness(0.9, row)).toBe(1)
    const other = draft('Somewhere Else')
    attachBuriedEvidence(other, [warning!])
    expect(other.evidence.some((item) => item.type === 'buried_warning')).toBe(false)
    expect(buriedNonObviousness(0.4, other)).toBe(0.4)
  })

  it('keeps grok reasoning on the lowest effort that model accepts', () => {
    const slot = {
      role: 'search',
      slot: 'grok-live',
      model: 'grok-4.6',
      provider: 'xai',
      brand: 'xAI',
      search: true,
      reasoning: true,
      extraBody: { reasoning_effort: 'low' },
    } satisfies RosterSlot
    expect(cheapSearchSlot(slot)).toMatchObject({ reasoning: false, extraBody: { reasoning_effort: 'low' } })
  })

  it('does not read sorumlu as a parliamentary question', () => {
    expect(warningDocument('SORUMLU KURUMLAR İzleme ve Denetim')).toBe('감사 보고서')
    expect(warningDocument('meclis soru önergesi risk')).toBe('의회 질문')
  })

  it('builds the card line', () => {
    expect(buriedWarningLine(2023, '감사 보고서')).toBe('묻힌 경고 · 2023년 감사 보고서')
    expect(buriedWarningCaption(2023, '감사 보고서', '2023-06-01')).toBe('묻힌 경고 · 2023년 감사 보고서 · 2023-06-01')
  })
})
