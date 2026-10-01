import { buildCatalogRankedRoundInput, catalogById, visibleChipEntries } from '../../catalog'
import { isPoisonTicker } from '../../instrument-identity'
import { isUiHorizon, UI_HORIZONS } from '../../horizon'
import { refusalMessageKey } from '../refusal-copy'
import {
  buildStockRankedRoundInput,
  decodeStockInstrument,
  encodeStockInstrument,
  mentionsKoreaListing,
  stockQuoteSymbol,
} from './stock-catalog'
import { searchUsListings, stockUniverseDataEnabled, type UsListingSearchResult } from './stock-search'
import { buildPriceSeriesPacket, type PriceSeriesIo } from './price-series-packet'
import type {
  CategoryAdapter,
  CategoryPacket,
  ClarifyingQuestion,
  ComposedRound,
  EntityResolution,
  GatewayViewer,
  GradeSource,
  NormalizeSlots,
  PacketBuildContext,
  PacketRound,
  Refusal,
  RefusalCode,
} from '../types'

/**
 * STOCKS adapter — global freeform lane.
 *
 * AAPL / NVDA / TSLA still resolve from the synonym table onto the catalog
 * tickers (plain instrument ids, same proposition as the old chips). Any
 * other US listing resolves to STOCK:{exchange}:{symbol} once
 * /symbol_search is switched on. Korean listings are refused toward the
 * Korea lane and are never opened here.
 *
 * Quote + series + analyst stay on the existing price-series packet for
 * catalog tickers. STOCK: rows do not call Twelve Data until
 * TWELVE_DATA_STOCK_UNIVERSE=ultra.
 */

const STOCK_SYNONYMS: Record<string, string> = {
  aapl: 'AAPL',
  apple: 'AAPL',
  애플: 'AAPL',
  애플주식: 'AAPL',
  nvda: 'NVDA',
  nvidia: 'NVDA',
  엔비디아: 'NVDA',
  tsla: 'TSLA',
  tesla: 'TSLA',
  테슬라: 'TSLA',
}

const HORIZON_QUESTION: ClarifyingQuestion = {
  slot: 'horizon',
  prompt_i18n_key: 'league.gateway.clarify.horizon',
  options: UI_HORIZONS.map((h) => ({ id: h, label_i18n_key: `league.gateway.horizon.${h}` })),
}

const STOCKS_REFUSALS: readonly RefusalCode[] = [
  'unsupported_entity',
  'korea_listing',
  'ambiguous_entity',
  'missing_slot',
  'horizon_incompatible',
  'jurisdiction_blocked',
  'low_confidence',
]

const SEARCH_STOP = new Set([
  'will',
  'close',
  'higher',
  'stock',
  'stocks',
  'the',
  'and',
  'tomorrow',
  'today',
  'up',
  'down',
])

function refuse(code: RefusalCode, safe_facts?: Record<string, string>): Refusal {
  return { code, message_i18n_key: refusalMessageKey(code), ...(safe_facts ? { safe_facts } : {}) }
}

function stockInstruments(): readonly string[] {
  return (catalogById('stocks')?.instruments ?? []).map((i) => i.instrument)
}

function stockChipIds(): readonly string[] {
  const cat = catalogById('stocks')
  return cat ? visibleChipEntries(cat).map((i) => i.instrument) : []
}

function normalizeMention(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '')
}

function isDecidableSlots(slots: NormalizeSlots): boolean {
  if (!isUiHorizon(slots.horizon)) return false
  if (stockInstruments().includes(slots.entity_id)) return true
  return decodeStockInstrument(slots.entity_id) !== null
}

function synonymHits(raw: string): string[] {
  const catalog = stockInstruments()
  const needle = normalizeMention(raw)
  if (!needle) return []
  const keys = Object.keys(STOCK_SYNONYMS).sort((a, b) => b.length - a.length)
  const found = new Set<string>()
  for (const key of keys) {
    if (key.length < 2) continue
    if (needle === key || needle.includes(key)) {
      const ticker = STOCK_SYNONYMS[key]
      if (ticker && catalog.includes(ticker)) found.add(ticker)
    }
  }
  const upper = raw.trim().toUpperCase()
  if (catalog.includes(upper)) found.add(upper)
  return [...found]
}

function prefixHits(raw: string): string[] {
  const catalog = stockInstruments()
  const needle = normalizeMention(raw)
  if (needle.length < 2) return []
  return [
    ...new Set(
      Object.entries(STOCK_SYNONYMS)
        .filter(([key]) => key.startsWith(needle) && key !== needle)
        .map(([, ticker]) => ticker)
        .filter((t) => catalog.includes(t)),
    ),
  ]
}

function searchQuery(raw: string): string | null {
  const latin = raw.match(/[A-Za-z][A-Za-z0-9.]{1,20}/g)
  if (!latin) return null
  const ranked = [...latin].sort((a, b) => b.length - a.length)
  for (const token of ranked) {
    if (token.length < 2) continue
    if (SEARCH_STOP.has(token.toLowerCase())) continue
    return token
  }
  return null
}

function chipQuestion(ids: string[]): ClarifyingQuestion {
  return {
    slot: 'entity_id',
    prompt_i18n_key: 'league.gateway.clarify.entity',
    options: ids.map((t) => ({ id: t, label_i18n_key: `league.catalog.instruments.${t}` })),
  }
}

export function createStocksAdapter(
  io: PriceSeriesIo,
  search: (query: string) => Promise<UsListingSearchResult> = searchUsListings,
): CategoryAdapter {
  return {
    category_id: 'stocks',
    ledger_category: 'stock',
    entity_kinds: ['ticker'],
    observation_shape: null,

    async resolveEntity(raw: string, _locale: string, _viewer?: GatewayViewer): Promise<EntityResolution> {
      const catalog = stockInstruments()
      const needle = normalizeMention(raw)
      if (!needle) return { ok: false, refuse: refuse('unsupported_entity', { supported: catalog.join(', ') }) }

      if (mentionsKoreaListing(raw)) {
        return { ok: false, refuse: refuse('korea_listing') }
      }

      const exact = synonymHits(raw)
      if (exact.length === 1) {
        return { ok: true, entity_id: exact[0]!, entity_kind: 'ticker', label: exact[0]! }
      }
      if (exact.length > 1) {
        return { ok: false, need: chipQuestion(exact) }
      }

      const prefixes = prefixHits(raw)
      if (prefixes.length > 0) {
        return { ok: false, need: chipQuestion(prefixes) }
      }

      const query = searchQuery(raw)
      if (query) {
        const found = await search(query)
        if (found.koreaOnly) return { ok: false, refuse: refuse('korea_listing') }
        const us = found.hits.filter((hit) => !isPoisonTicker(hit.symbol))
        if (us.length === 1) {
          const hit = us[0]!
          if (catalog.includes(hit.symbol)) {
            return { ok: true, entity_id: hit.symbol, entity_kind: 'ticker', label: hit.symbol }
          }
          const id = encodeStockInstrument(hit)
          if (id) {
            return { ok: true, entity_id: id, entity_kind: 'ticker', label: hit.name }
          }
        }
        if (us.length > 1) {
          const options = us.flatMap((hit) => {
            const id = catalog.includes(hit.symbol) ? hit.symbol : encodeStockInstrument(hit)
            if (!id) return []
            return [
              {
                id,
                label_i18n_key: 'league.gateway.clarify.entity',
                label: `${hit.name} (${hit.symbol} · ${hit.exchange})`,
              },
            ]
          })
          if (options.length > 0) {
            return {
              ok: false,
              need: {
                slot: 'entity_id',
                prompt_i18n_key: 'league.gateway.clarify.entity',
                options,
              },
            }
          }
        }
      }

      return { ok: false, refuse: refuse('unsupported_entity', { supported: catalog.join(', ') }) }
    },

    requiredSlots(_entity): readonly string[] {
      return ['horizon']
    },

    clarifyingQuestions(partial: Partial<NormalizeSlots>): ClarifyingQuestion[] {
      const questions: ClarifyingQuestion[] = []
      if (!partial.entity_id) {
        questions.push(chipQuestion([...stockChipIds()]))
      }
      if (!partial.horizon) questions.push(HORIZON_QUESTION)
      return questions
    },

    jurisdictionGate(_viewer: GatewayViewer, _now: Date): Refusal | null {
      return null
    },

    refusalTaxonomy() {
      return STOCKS_REFUSALS.map((code) => ({ code, message_i18n_key: refusalMessageKey(code) }))
    },

    composeProposition(slots: NormalizeSlots, now: Date = new Date()): ComposedRound {
      if (!isDecidableSlots(slots)) {
        throw new Error('stocks.composeProposition called with undecidable slots — shell must gate on isDecidable')
      }
      if (decodeStockInstrument(slots.entity_id)) {
        const round = buildStockRankedRoundInput(slots.entity_id, slots.horizon!, now, slots.entity_label)
        if (!round) {
          throw new Error(`stocks.composeProposition: ${slots.entity_id} is not a US listing`)
        }
        return round
      }
      const round = buildCatalogRankedRoundInput(slots.entity_id, slots.horizon!, now)
      if (!round) {
        throw new Error(`stocks.composeProposition: ${slots.entity_id} vanished from the catalog`)
      }
      return round
    },

    gradeSources(slots: NormalizeSlots): readonly [GradeSource, GradeSource, GradeSource] {
      const symbol = stockQuoteSymbol(slots.entity_id)
      return [
        {
          tier: 1,
          kind: 'twelve_data',
          endpoint: `/time_series?symbol=${symbol}&interval=1day (regular-session close vs anchor close)`,
        },
        { tier: 2, kind: 'perplexity_sourced', require_url: true },
        { tier: 3, kind: 'operator_manual', require_url: true },
      ]
    },

    isDecidable(slots: NormalizeSlots): boolean {
      return isDecidableSlots(slots)
    },

    slotsForRound(round: PacketRound): NormalizeSlots {
      const symbol = stockQuoteSymbol(round.instrument)
      return {
        category_id: 'stocks',
        entity_id: round.instrument,
        entity_kind: 'ticker',
        entity_label: symbol,
        horizon: isUiHorizon(round.horizon) ? round.horizon : null,
        resolve_by: round.resolves_at || null,
        proposition_kind: 'binary_close_higher',
        slots: {},
        confidence: 1,
      }
    },

    async buildPacket(_slots: NormalizeSlots, ctx: PacketBuildContext): Promise<CategoryPacket> {
      const listing = decodeStockInstrument(ctx.round.instrument)
      if (!listing) return buildPriceSeriesPacket(ctx, io)
      if (!stockUniverseDataEnabled()) {
        return {
          injection: null,
          researchCacheKey: `stock-universe-off|${ctx.round.instrument}`,
          researchCostUsd: 0,
          dataPacket: {
            available: false,
            symbol: listing.symbol,
            error: 'twelve_data_ultra_not_connected',
          },
          research: {
            available: false,
            cached: false,
            costUsd: 0,
            queries: [],
            tier: 'off',
            tierSignal: 'universe_data_disabled',
          },
          relatedCreditsSpent: 0,
        }
      }
      return buildPriceSeriesPacket(
        { ...ctx, round: { ...ctx.round, instrument: listing.symbol } },
        io,
      )
    },
  }
}
