import { describe, expect, it } from 'vitest'
import { buildCatalogRankedRoundInput } from '../../catalog'
import { assertApprovedCopy } from '../../compliance'
import { createStocksAdapter } from '../adapters/stocks'
import type { PriceSeriesIo } from '../adapters/price-series-packet'
import { refusalMessageForKey } from '../refusal-copy'
import type { NormalizeSlots } from '../types'

/** io that must never be touched — these tests exercise pure judgment only. */
const DEAD_IO: PriceSeriesIo = {
  fetchDataPacket: async () => {
    throw new Error('io must not be called')
  },
  fetchMarketConsensus: async () => {
    throw new Error('io must not be called')
  },
  fetchCryptoContext: async () => {
    throw new Error('io must not be called')
  },
  getResearchPacket: async () => {
    throw new Error('io must not be called')
  },
  fetchRelatedInstruments: async () => {
    throw new Error('io must not be called')
  },
  fetchSlowData: async () => {
    throw new Error('io must not be called')
  },
}

const adapter = createStocksAdapter(DEAD_IO)

function slots(over: Partial<NormalizeSlots> = {}): NormalizeSlots {
  return {
    category_id: 'stocks',
    entity_id: 'AAPL',
    entity_kind: 'ticker',
    entity_label: 'AAPL',
    horizon: '1d',
    resolve_by: null,
    proposition_kind: 'binary_close_higher',
    slots: {},
    confidence: 0.95,
    ...over,
  }
}

describe('stocks adapter — entity resolution', () => {
  it('resolves the Korean synonym 애플 → AAPL', async () => {
    const r = await adapter.resolveEntity('애플', 'ko')
    expect(r).toEqual({ ok: true, entity_id: 'AAPL', entity_kind: 'ticker', label: 'AAPL' })
  })

  it('resolves english names and tickers case-insensitively', async () => {
    expect(await adapter.resolveEntity('nvidia', 'en')).toMatchObject({ ok: true, entity_id: 'NVDA' })
    expect(await adapter.resolveEntity(' tsla ', 'en')).toMatchObject({ ok: true, entity_id: 'TSLA' })
    expect(await adapter.resolveEntity('테슬라', 'ko')).toMatchObject({ ok: true, entity_id: 'TSLA' })
  })

  it('a prefix mention clarifies with candidate chips instead of silently resolving', async () => {
    const r = await adapter.resolveEntity('테슬', 'ko')
    expect(r.ok).toBe(false)
    if (!r.ok && 'need' in r) {
      expect(r.need.slot).toBe('entity_id')
      expect(r.need.options?.map((o) => o.id)).toEqual(['TSLA'])
    } else {
      throw new Error('expected a clarifying question')
    }
  })

  it('an unknown instrument refuses with unsupported_entity and lists the supported set as safe facts', async () => {
    const r = await adapter.resolveEntity('삼성전자', 'ko')
    expect(r.ok).toBe(false)
    if (!r.ok && 'refuse' in r) {
      expect(r.refuse.code).toBe('unsupported_entity')
      expect(r.refuse.safe_facts?.supported).toContain('AAPL')
    } else {
      throw new Error('expected a refusal')
    }
  })
})

describe('stocks adapter — slots, decidability, clarifying questions', () => {
  it('requires exactly the horizon slot', () => {
    expect(adapter.requiredSlots({ entity_id: 'AAPL', entity_kind: 'ticker' })).toEqual(['horizon'])
  })

  it('is decidable only with a catalog ticker AND a valid horizon', () => {
    expect(adapter.isDecidable(slots())).toBe(true)
    expect(adapter.isDecidable(slots({ horizon: null }))).toBe(false)
    expect(adapter.isDecidable(slots({ entity_id: 'MSFT' }))).toBe(false)
  })

  it('asks for the horizon with the four fixed chips when missing', () => {
    const qs = adapter.clarifyingQuestions(slots({ horizon: null }))
    expect(qs).toHaveLength(1)
    expect(qs[0].slot).toBe('horizon')
    expect(qs[0].options?.map((o) => o.id)).toEqual(['1d', '1w', '1m', '3m'])
  })

  it('asks for the entity first when it is missing too', () => {
    const qs = adapter.clarifyingQuestions({ horizon: null })
    expect(qs.map((q) => q.slot)).toEqual(['entity_id', 'horizon'])
  })
})

describe('stocks adapter — server-composed proposition', () => {
  const NOW = new Date('2026-08-28T09:00:00.000Z')

  it('delegates to the catalog template — identical to the chip path, no user substring possible', () => {
    const composed = adapter.composeProposition(slots(), NOW)
    expect(composed).toEqual(buildCatalogRankedRoundInput('AAPL', '1d', NOW))
    expect(composed.proposition_text).toMatch(/^Will AAPL close higher by \d{4}-\d{2}-\d{2} than its last close\?/)
  })

  it('throws on undecidable slots — the shell must gate on isDecidable first', () => {
    expect(() => adapter.composeProposition(slots({ horizon: null }), NOW)).toThrow(/isDecidable/)
  })
})

describe('stocks adapter — jurisdiction, refusal taxonomy, grade sources', () => {
  it('has no category jurisdiction overlay (global matrix only)', () => {
    expect(
      adapter.jurisdictionGate(
        { userId: 'u1', isAdmin: false, jurisdiction: { declaredCountry: 'KR', ipCountry: 'KR' } },
        new Date(),
      ),
    ).toBeNull()
  })

  it('every declared refusal code has Korean copy that passes compliance', () => {
    const taxonomy = adapter.refusalTaxonomy()
    expect(taxonomy.map((t) => t.code)).toEqual([
      'unsupported_entity',
      'ambiguous_entity',
      'missing_slot',
      'horizon_incompatible',
      'jurisdiction_blocked',
      'low_confidence',
    ])
    for (const entry of taxonomy) {
      const ko = refusalMessageForKey(entry.message_i18n_key, 'ko')
      const en = refusalMessageForKey(entry.message_i18n_key, 'en')
      expect(ko.length).toBeGreaterThan(0)
      expect(en.length).toBeGreaterThan(0)
      expect(ko).toMatch(/[\uAC00-\uD7A3]/) // actually Korean, not a fallback
      assertApprovedCopy(ko)
      assertApprovedCopy(en)
    }
  })

  it('grades through the 3-tier ladder: Twelve Data → sourced Perplexity → operator manual', () => {
    const [t1, t2, t3] = adapter.gradeSources(slots())
    expect(t1).toMatchObject({ tier: 1, kind: 'twelve_data' })
    expect(t1.tier === 1 && t1.endpoint).toContain('AAPL')
    expect(t2).toEqual({ tier: 2, kind: 'perplexity_sourced', require_url: true })
    expect(t3).toEqual({ tier: 3, kind: 'operator_manual', require_url: true })
  })
})

describe('stocks adapter — slots from a persisted round (orchestrator re-runs)', () => {
  it('rebuilds minimal decidable slots from round facts', () => {
    const round = { ...buildCatalogRankedRoundInput('NVDA', '1w', new Date('2026-08-28T09:00:00.000Z'))!, id: 'r1' }
    const s = adapter.slotsForRound(round)
    expect(s.entity_id).toBe('NVDA')
    expect(s.horizon).toBe('1w')
    expect(s.category_id).toBe('stocks')
    expect(adapter.isDecidable(s)).toBe(true)
  })
})
