import { describe, expect, it } from 'vitest'
import { buildCatalogRankedRoundInput } from '../../catalog'
import { assertApprovedCopy } from '../../compliance'
import { consensusMoneySearchHints } from '../../extra/consensus'
import { createStocksAdapter } from '../adapters/stocks'
import type { PriceSeriesIo } from '../adapters/price-series-packet'
import type { PacketBuildContext, PacketRound } from '../types'
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

  it('삼성전자 and 005930 point at the Korea lane and do not open a global ticker', async () => {
    for (const raw of ['삼성전자', '005930', 'Samsung', '005930.KS']) {
      const r = await adapter.resolveEntity(raw, 'ko')
      expect(r.ok, raw).toBe(false)
      if (!r.ok && 'refuse' in r) {
        expect(r.refuse.code, raw).toBe('korea_listing')
      } else {
        throw new Error(`expected a refusal for ${raw}`)
      }
    }
  })

  it('resolves a full sentence the way the slate fallback sends it', async () => {
    expect(await adapter.resolveEntity('애플 내일 오를까?', 'ko')).toMatchObject({ ok: true, entity_id: 'AAPL' })
    expect(await adapter.resolveEntity('엔비디아', 'ko')).toMatchObject({ ok: true, entity_id: 'NVDA' })
    expect(await adapter.resolveEntity('Tesla', 'en')).toMatchObject({ ok: true, entity_id: 'TSLA' })
  })
})

describe('stocks adapter — slots, decidability, clarifying questions', () => {
  it('requires exactly the horizon slot', () => {
    expect(adapter.requiredSlots({ entity_id: 'AAPL', entity_kind: 'ticker' })).toEqual(['horizon'])
  })

  it('is decidable for a catalog ticker or a resolved US listing, not a bare unknown symbol', () => {
    expect(adapter.isDecidable(slots())).toBe(true)
    expect(adapter.isDecidable(slots({ horizon: null }))).toBe(false)
    expect(adapter.isDecidable(slots({ entity_id: 'MSFT' }))).toBe(false)
    expect(adapter.isDecidable(slots({ entity_id: 'STOCK:NASDAQ:MSFT', entity_label: 'Microsoft' }))).toBe(true)
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
      'korea_listing',
      'non_us_listing',
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
    expect(t1.tier === 1 && t1.kind === 'twelve_data' && t1.endpoint).toContain('AAPL')
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

  it('keeps the stock ledger for a freeform listing so extra seats still key off stock', () => {
    const round = adapter.composeProposition(
      slots({ entity_id: 'STOCK:NASDAQ:MSFT', entity_label: 'Microsoft' }),
      new Date('2026-08-28T09:00:00.000Z'),
    )
    expect(round.category).toBe('stock')
    expect(round.instrument).toBe('STOCK:NASDAQ:MSFT')
    expect(round.proposition_text).toMatch(/^Will MSFT close higher by \d{4}-\d{2}-\d{2}/)
    expect(round.resolution_rule).toContain('Identity: Microsoft')
    const rebuilt = adapter.slotsForRound(round)
    expect(rebuilt.category_id).toBe('stocks')
    expect(adapter.isDecidable(rebuilt)).toBe(true)
    expect(consensusMoneySearchHints('stock')).toMatch(/price target|options|목표가/)
  })
})

describe('stocks adapter — symbol search (Ultra, on by default)', () => {
  it('asks the caller to pick when search returns more than one US listing', async () => {
    const searching = createStocksAdapter(DEAD_IO, async () => ({
      koreaOnly: false,
      hits: [
        { symbol: 'MSFT', exchange: 'NASDAQ', name: 'Microsoft', instrumentType: 'Common Stock' },
        { symbol: 'MS', exchange: 'NYSE', name: 'Morgan Stanley', instrumentType: 'Common Stock' },
      ],
    }))
    const r = await searching.resolveEntity('Microsoft', 'en')
    expect(r.ok).toBe(false)
    if (!r.ok && 'need' in r) {
      expect(r.need.options?.map((o) => o.id)).toEqual(['STOCK:NASDAQ:MSFT', 'STOCK:NYSE:MS'])
      expect(r.need.options?.[0]?.label).toContain('Microsoft')
    } else {
      throw new Error('expected chips')
    }
  })

  it('does not call Twelve Data for a STOCK: packet when the universe flag is off', async () => {
    const prev = process.env.TWELVE_DATA_STOCK_UNIVERSE
    process.env.TWELVE_DATA_STOCK_UNIVERSE = 'off'
    const round = adapter.composeProposition(
      slots({ entity_id: 'STOCK:NASDAQ:MSFT', entity_label: 'Microsoft' }),
      new Date('2026-08-28T09:00:00.000Z'),
    )
    const ctx: PacketBuildContext = { round: round as PacketRound, costCapUsd: 1 }
    const packet = await adapter.buildPacket(slots({ entity_id: 'STOCK:NASDAQ:MSFT' }), ctx)
    expect(packet.dataPacket.available).toBe(false)
    expect(packet.dataPacket.error).toBe('twelve_data_ultra_not_connected')
    expect(packet.injection).toBeNull()
    if (prev === undefined) delete process.env.TWELVE_DATA_STOCK_UNIVERSE
    else process.env.TWELVE_DATA_STOCK_UNIVERSE = prev
  })

  it('sends a Korea-only search result back to the Korea lane', async () => {
    const searching = createStocksAdapter(DEAD_IO, async () => ({ koreaOnly: true, hits: [] }))
    const r = await searching.resolveEntity('Hyundai Motor', 'en')
    expect(r.ok).toBe(false)
    if (!r.ok && 'refuse' in r) expect(r.refuse.code).toBe('korea_listing')
  })

  it('opens a single US-tape ADR hit as STOCK:{exchange}:{symbol}', async () => {
    const searching = createStocksAdapter(DEAD_IO, async (q) => {
      expect(q).toBe('TSM')
      return {
        koreaOnly: false,
        hits: [
          { symbol: 'TSM', exchange: 'NYSE', name: 'Taiwan Semiconductor Manufacturing Company Limited', instrumentType: 'American Depositary Receipt' },
          { symbol: 'TSMX', exchange: 'NASDAQ', name: 'Other', instrumentType: 'Common Stock' },
        ],
      }
    })
    expect(await searching.resolveEntity('대만반도체 다음주 오를까', 'ko')).toMatchObject({
      ok: true,
      entity_id: 'STOCK:NYSE:TSM',
    })
  })

  it('refuses local non-US listings toward the ADR (typed code or search-only-local)', async () => {
    for (const raw of ['7203', '2330.TW', '0700.HK', '2330']) {
      const r = await adapter.resolveEntity(raw, 'en')
      expect(r.ok, raw).toBe(false)
      if (!r.ok && 'refuse' in r) expect(r.refuse.code, raw).toBe('non_us_listing')
      else throw new Error(`expected refusal for ${raw}`)
    }
    const localOnly = createStocksAdapter(DEAD_IO, async () => ({ koreaOnly: false, hits: [], nonUsOnly: true }))
    const r = await localOnly.resolveEntity('Hon Hai Precision', 'en')
    expect(r.ok).toBe(false)
    if (!r.ok && 'refuse' in r) expect(r.refuse.code).toBe('non_us_listing')
    expect(refusalMessageForKey('league.gateway.refusal.non_us_listing', 'ko')).toContain('ADR')
  })
})

describe('stocks adapter — Ultra packet (catalog + STOCK: share one path)', () => {
  type ResearchArgs = Parameters<PriceSeriesIo['getResearchPacket']>[0]

  function recordingIo(log: { data: string[]; consensus: Array<[string, string | undefined]>; research: ResearchArgs[] }): PriceSeriesIo {
    return {
      fetchDataPacket: async (instrument) => {
        log.data.push(instrument)
        const exchange = instrument.startsWith('STOCK:') ? instrument.split(':')[1] : undefined
        const symbol = instrument.startsWith('STOCK:') ? instrument.split(':')[2]! : instrument
        const series = Array.from({ length: 60 }, (_, i) => ({
          date: `2026-07-${String((i % 28) + 1).padStart(2, '0')}`,
          close: 100 + i,
          volume: 1_000_000 + i * 1000,
        }))
        return { available: true, instrument, symbol, ...(exchange ? { exchange } : {}), latestClose: 159, asOf: '2026-08-27', series }
      },
      fetchMarketConsensus: async (symbol, exchange) => {
        log.consensus.push([symbol, exchange])
        return {
          fetchedAt: '2026-08-28T00:00:00.000Z',
          priceTarget: { high: 250, median: 200, low: 150, average: 201, current: 159, currency: 'USD' },
          recommendations: { strongBuy: 10, buy: 20, hold: 5, sell: 1, strongSell: 0 },
          lastEarnings: { date: '2026-07-30', actual: 1.2, estimate: 1.1, surprisePct: 9.1 },
          latestRating: { date: '2026-08-10', firm: 'Firm', rating: 'Buy' },
          epsTrend: { period: 'current_quarter', currentEstimate: 1.3 },
          statistics: { pe: 45.2, pb: 30.1, revenueTtm: 130_000_000_000, marketCap: 4_000_000_000_000 },
        }
      },
      fetchCryptoContext: async () => {
        throw new Error('no crypto for stocks')
      },
      getResearchPacket: async (args) => {
        log.research.push(args)
        return {
          available: false,
          cached: false,
          cacheKey: 'k',
          directorModel: null,
          queries: [],
          findings: [],
          promptBlock: '',
          costUsd: 0,
          tier: args.tier ?? 'normal',
          synthesis: null,
        }
      },
      fetchRelatedInstruments: async () => null,
      fetchSlowData: async () => null,
    }
  }

  it('NVDA (catalog) gets quote/series/volume + the analyst pack + statistics + Perplexity seeds', async () => {
    const log = { data: [] as string[], consensus: [] as Array<[string, string | undefined]>, research: [] as ResearchArgs[] }
    const live = createStocksAdapter(recordingIo(log), async () => ({ hits: [], koreaOnly: false }))
    const round = live.composeProposition(slots({ entity_id: 'NVDA', entity_label: 'NVDA' }), new Date('2026-08-28T09:00:00.000Z'))
    const pkt = await live.buildPacket(slots({ entity_id: 'NVDA' }), { round: round as PacketRound, costCapUsd: 1 })
    expect(log.data).toEqual(['NVDA'])
    expect(log.consensus).toEqual([['NVDA', undefined]])
    const seeds = (log.research[0]?.extraQueries ?? []).map((q) => q.q).join('\n')
    expect(seeds).toMatch(/NVDA stock latest news and catalysts/)
    expect(seeds).toMatch(/earnings call/)
    expect(seeds).toMatch(/overbought or oversold/)
    expect(seeds).toMatch(/upgrades downgrades/)
    expect(seeds).toMatch(/서학개미/)
    expect(pkt.injection).toMatch(/price target: hi 250\.00 \/ median 200\.00 \/ lo 150\.00/)
    expect(pkt.injection).toMatch(/statistics: trailing PE 45\.2 \/ P\/B 30\.1 \/ revenue TTM 130\.00B \/ market cap 4\.00T/)
    expect(pkt.injection).toMatch(/session volume: last 1\.1M/)
    expect(pkt.injection).toMatch(/SMA50/)
    expect(pkt.injection).toMatch(/BASE RATE/)
    expect(pkt.injection).toMatch(/do NOT quote these target/)
  })

  it('STOCK:NYSE:TSM fetches with its exchange preserved through quote and analyst calls', async () => {
    const prev = process.env.TWELVE_DATA_STOCK_UNIVERSE
    process.env.TWELVE_DATA_STOCK_UNIVERSE = 'ultra'
    const log = { data: [] as string[], consensus: [] as Array<[string, string | undefined]>, research: [] as ResearchArgs[] }
    const live = createStocksAdapter(recordingIo(log), async () => ({ hits: [], koreaOnly: false }))
    const round = live.composeProposition(
      slots({ entity_id: 'STOCK:NYSE:TSM', entity_label: 'Taiwan Semiconductor' }),
      new Date('2026-08-28T09:00:00.000Z'),
    )
    const pkt = await live.buildPacket(slots({ entity_id: 'STOCK:NYSE:TSM' }), { round: round as PacketRound, costCapUsd: 1 })
    expect(log.data).toEqual(['STOCK:NYSE:TSM'])
    expect(log.consensus).toEqual([['TSM', 'NYSE']])
    expect(log.research[0]?.round.instrument).toBe('STOCK:NYSE:TSM')
    expect((log.research[0]?.extraQueries ?? [])[0]?.q).toMatch(/^TSM stock latest news/)
    expect(pkt.dataPacket.available).toBe(true)
    expect(pkt.injection).toMatch(/CONSENSUS/)
    if (prev === undefined) delete process.env.TWELVE_DATA_STOCK_UNIVERSE
    else process.env.TWELVE_DATA_STOCK_UNIVERSE = prev
  })
})
