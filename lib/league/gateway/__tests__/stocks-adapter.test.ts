import { describe, expect, it, vi } from 'vitest'
import { buildCatalogRankedRoundInput } from '../../catalog'
import { assertApprovedCopy } from '../../compliance'
import { consensusMoneySearchHints } from '../../extra/consensus'
import { createStocksAdapter } from '../adapters/stocks'
import { parseStockHorizonFromQuery } from '../adapters/stock-catalog'
import type { PriceSeriesIo } from '../adapters/price-series-packet'
import type { GatewayDeps, GatewayRequest, GatewayViewer, PacketBuildContext, PacketRound } from '../types'
import { clarifyCopyForKey, refusalMessageForKey } from '../refusal-copy'
import type { NormalizeSlots } from '../types'
import { runLeagueGateway } from '../shell'
import { LEAGUE_GENERATE_CREDITS } from '../../credits'

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
    expect(r).toEqual({ ok: true, entity_id: 'AAPL', entity_kind: 'ticker', label: 'AAPL', skip_confirm: true })
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

describe('stocks adapter — query horizon parser (KO / EN)', () => {
  it('parses 1d phrases correctly', () => {
    for (const phrase of ['내일', '오늘', '하루', '1일', '익일', '당일', 'tomorrow', 'today', '1d', '1 day', '24h']) {
      expect(parseStockHorizonFromQuery(`엔비디아 ${phrase}`), `testing "${phrase}"`).toBe('1d')
    }
  })

  it('parses 1w phrases correctly', () => {
    for (const phrase of ['다음주', '다음 주', '일주일', '1주일', '1주', '이번주', '이번 주', '한주', '한 주', 'next week', 'this week', '1w', '1 week', '7d']) {
      expect(parseStockHorizonFromQuery(`엔비디아 ${phrase}`), `testing "${phrase}"`).toBe('1w')
    }
  })

  it('parses 1m phrases correctly', () => {
    for (const phrase of ['한달', '한 달', '1달', '1개월', '일개월', '다음달', '다음 달', '이번달', '이번 달', 'next month', 'this month', '1m', '1 month', '30d']) {
      expect(parseStockHorizonFromQuery(`엔비디아 ${phrase}`), `testing "${phrase}"`).toBe('1m')
    }
  })

  it('parses 3m phrases correctly', () => {
    for (const phrase of ['3개월', '삼개월', '3달', '세달', '세 달', '석달', '석 달', '분기', '이번 분기', '다음 분기', '1분기', '3m', '3 months', '3 month', 'quarter', '1 quarter', '90d']) {
      expect(parseStockHorizonFromQuery(`엔비디아 ${phrase}`), `testing "${phrase}"`).toBe('3m')
    }
  })

  it('returns null when no horizon is present', () => {
    expect(parseStockHorizonFromQuery('엔비디아')).toBeNull()
    expect(parseStockHorizonFromQuery('엔비디아 오를까')).toBeNull()
    expect(parseStockHorizonFromQuery('Tesla')).toBeNull()
    expect(parseStockHorizonFromQuery('Apple stock price')).toBeNull()
  })

  it('protects against edge cases (company 3M, calendar dates, turning points)', () => {
    expect(parseStockHorizonFromQuery('3M')).toBeNull()
    expect(parseStockHorizonFromQuery('mmm')).toBeNull()
    expect(parseStockHorizonFromQuery('엔비디아 10월 1일')).toBeNull()
    expect(parseStockHorizonFromQuery('분기점')).toBeNull()
    expect(parseStockHorizonFromQuery('하루종일')).toBeNull()
  })
})

describe('stocks adapter — Flow A, Flow C, and ambiguous ticker flows', () => {
  const US_VIEWER: GatewayViewer = {
    userId: 'u_stock_flow',
    isAdmin: false,
    jurisdiction: { declaredCountry: 'US', ipCountry: 'US' },
  }
  const NOW = new Date('2026-08-28T09:00:00.000Z')

  function gatewayHarness() {
    const chargeSpy = vi.fn(async () => ({ ok: true }))
    const deps: GatewayDeps = {
      adapterFor: (id) => (id === 'stocks' ? adapter : null),
      normalizer: {
        normalize: async (req) => {
          // Emulate a standard LLM normalizer or return null (slate-fallback handles it)
          const horizon = parseStockHorizonFromQuery(req.raw_text)
          return {
            category_id: 'stocks',
            entity_mention: '',
            entity_id_hint: null,
            horizon,
            proposition_kind: 'binary_close_higher',
            slots: {},
            confidence: 0.9,
            needs_slot: null,
          }
        },
      },
      deductCredits: chargeSpy,
      now: () => NOW,
    }
    return { deps, chargeSpy }
  }

  it('Flow A (default): no horizon upfront → ticker confirms → clarify horizon step → pick → generate', async () => {
    const { deps, chargeSpy } = gatewayHarness()

    // Step 1: User types "엔비디아" (no horizon)
    const turn1 = await runLeagueGateway(
      {
        viewer: US_VIEWER,
        category_id: 'stocks',
        raw_text: '엔비디아 오를까',
        locale: 'ko',
      },
      deps,
    )

    // Shell resolves ticker to NVDA, sees missing horizon, returns clarify question
    expect(turn1.status).toBe('clarify')
    if (turn1.status !== 'clarify') throw new Error('expected clarify')
    expect(turn1.questions).toHaveLength(1)
    expect(turn1.questions[0]!.slot).toBe('horizon')
    expect(turn1.questions[0]!.prompt_i18n_key).toBe('league.gateway.clarify.horizon.stocks')
    expect(clarifyCopyForKey(turn1.questions[0]!.prompt_i18n_key, 'ko')).toBe('기간 선택')
    expect(turn1.questions[0]!.options.map((o) => o.id)).toEqual(['1d', '1w', '1m', '3m'])
    expect(turn1.questions[0]!.options.map((o) => clarifyCopyForKey(o.label_i18n_key!, 'ko'))).toEqual([
      '1일',
      '1주',
      '1개월',
      '3개월',
    ])
    expect(chargeSpy).not.toHaveBeenCalled()

    // Step 2: User picks "1주" (1w)
    const turn2 = await runLeagueGateway(
      {
        viewer: US_VIEWER,
        category_id: 'stocks',
        raw_text: '엔비디아 오를까',
        answered_slots: { horizon: '1w' },
        clarify_round: 1,
        locale: 'ko',
      },
      deps,
    )

    // Goes straight to ready / generate without extra confirm step!
    expect(turn2.status).toBe('ready')
    if (turn2.status !== 'ready') throw new Error('expected ready')
    expect(turn2.round.instrument).toBe('NVDA')
    expect(turn2.round.horizon).toBe('1w')
    expect(turn2.charged_credits).toBe(LEAGUE_GENERATE_CREDITS)
    expect(chargeSpy).toHaveBeenCalledTimes(1)
  })

  it('Flow C (skip step): query already contains horizon → straight to generate without clarify', async () => {
    const cases = [
      { text: '엔비디아 3개월', expectedTicker: 'NVDA', expectedHorizon: '3m' },
      { text: '엔비디아 내일', expectedTicker: 'NVDA', expectedHorizon: '1d' },
      { text: '엔비디아 다음주', expectedTicker: 'NVDA', expectedHorizon: '1w' },
      { text: '엔비디아 한달', expectedTicker: 'NVDA', expectedHorizon: '1m' },
      { text: 'Tesla 3 months', expectedTicker: 'TSLA', expectedHorizon: '3m' },
    ]

    for (const c of cases) {
      const { deps, chargeSpy } = gatewayHarness()
      const res = await runLeagueGateway(
        {
          viewer: US_VIEWER,
          category_id: 'stocks',
          raw_text: c.text,
          locale: 'ko',
        },
        deps,
      )

      expect(res.status, `failed on ${c.text}`).toBe('ready')
      if (res.status !== 'ready') throw new Error(`expected ready for ${c.text}`)
      expect(res.round.instrument).toBe(c.expectedTicker)
      expect(res.round.horizon).toBe(c.expectedHorizon)
      expect(chargeSpy).toHaveBeenCalledTimes(1)
    }
  })

  it('Ambiguous ticker without horizon: pick-a-chip first, then horizon clarify', async () => {
    const { deps, chargeSpy } = gatewayHarness()

    // Step 1: User types "테슬" (prefix match, no horizon)
    const turn1 = await runLeagueGateway(
      {
        viewer: US_VIEWER,
        category_id: 'stocks',
        raw_text: '테슬',
        locale: 'ko',
      },
      deps,
    )

    expect(turn1.status).toBe('clarify')
    if (turn1.status !== 'clarify') throw new Error('expected clarify')
    expect(turn1.questions[0]!.slot).toBe('entity_id')
    expect(turn1.questions[0]!.options.map((o) => o.id)).toEqual(['TSLA'])
    expect(chargeSpy).not.toHaveBeenCalled()

    // Step 2: User picks TSLA chip
    const turn2 = await runLeagueGateway(
      {
        viewer: US_VIEWER,
        category_id: 'stocks',
        raw_text: '테슬',
        answered_slots: { entity_id: 'TSLA' },
        clarify_round: 1,
        locale: 'ko',
      },
      deps,
    )

    // Now entity is confirmed, but horizon is still needed → horizon clarify
    expect(turn2.status).toBe('clarify')
    if (turn2.status !== 'clarify') throw new Error('expected clarify')
    expect(turn2.questions[0]!.slot).toBe('horizon')
    expect(turn2.questions[0]!.prompt_i18n_key).toBe('league.gateway.clarify.horizon.stocks')
    expect(clarifyCopyForKey(turn2.questions[0]!.prompt_i18n_key, 'ko')).toBe('기간 선택')
    expect(chargeSpy).not.toHaveBeenCalled()

    // Step 3: User picks 1개월 (1m)
    const turn3 = await runLeagueGateway(
      {
        viewer: US_VIEWER,
        category_id: 'stocks',
        raw_text: '테슬',
        answered_slots: { entity_id: 'TSLA', horizon: '1m' },
        clarify_round: 2,
        locale: 'ko',
      },
      deps,
    )

    expect(turn3.status).toBe('ready')
    if (turn3.status !== 'ready') throw new Error('expected ready')
    expect(turn3.round.instrument).toBe('TSLA')
    expect(turn3.round.horizon).toBe('1m')
    expect(chargeSpy).toHaveBeenCalledTimes(1)
  })

  it('Ambiguous ticker with horizon: pick-a-chip first, then straight to generate', async () => {
    const { deps, chargeSpy } = gatewayHarness()

    // Step 1: User types "테슬 3개월" (prefix match + horizon)
    const turn1 = await runLeagueGateway(
      {
        viewer: US_VIEWER,
        category_id: 'stocks',
        raw_text: '테슬 3개월',
        locale: 'ko',
      },
      deps,
    )

    expect(turn1.status).toBe('clarify')
    if (turn1.status !== 'clarify') throw new Error('expected clarify')
    expect(turn1.questions[0]!.slot).toBe('entity_id')
    expect(turn1.questions[0]!.options.map((o) => o.id)).toEqual(['TSLA'])

    // Step 2: User picks TSLA chip → horizon was already in query text → straight to ready!
    const turn2 = await runLeagueGateway(
      {
        viewer: US_VIEWER,
        category_id: 'stocks',
        raw_text: '테슬 3개월',
        answered_slots: { entity_id: 'TSLA' },
        clarify_round: 1,
        locale: 'ko',
      },
      deps,
    )

    expect(turn2.status).toBe('ready')
    if (turn2.status !== 'ready') throw new Error('expected ready')
    expect(turn2.round.instrument).toBe('TSLA')
    expect(turn2.round.horizon).toBe('3m')
    expect(chargeSpy).toHaveBeenCalledTimes(1)
  })
})
