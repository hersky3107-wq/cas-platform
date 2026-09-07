import { buildCatalogRankedRoundInput, catalogById } from '../../catalog'
import { isUiHorizon, UI_HORIZONS } from '../../horizon'
import { refusalMessageKey } from '../refusal-copy'
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
 * STOCKS adapter — the first of the 12 `CategoryAdapter`s and the template
 * for the price-series family (crypto/fx/gold/index/commodities/memecoin/
 * real-estate ETFs will differ in entity world and jurisdiction overlays,
 * not in shape).
 *
 * Everything category-shaped lives HERE: which tickers exist, the Korean
 * synonym map, which slots make a proposition decidable, the clarifying
 * questions, the refusal taxonomy, the server proposition template
 * (delegated to `buildCatalogRankedRoundInput` — the SAME function the chip
 * path has always used, so gateway-composed and chip-composed rounds are
 * identical by construction), the 3-tier grading ladder, and packet v2
 * assembly via `buildPriceSeriesPacket`.
 */

/**
 * Freeform mention → catalog ticker. Keys are lowercase (Latin) or exact
 * Hangul. SERVER-SIDE resolver table: the normalizer's `entity_id_hint` is
 * only ever a lookup key into this map + the catalog — a hostile prompt can
 * at worst produce a wrong lookup key, never an out-of-catalog entity.
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

/** Every refusal code this adapter may emit — each has Korean copy in `refusal-copy.ts`. */
const STOCKS_REFUSALS: readonly RefusalCode[] = [
  'unsupported_entity',
  'ambiguous_entity',
  'missing_slot',
  'horizon_incompatible',
  'jurisdiction_blocked',
  'low_confidence',
]

function refuse(code: RefusalCode, safe_facts?: Record<string, string>): Refusal {
  return { code, message_i18n_key: refusalMessageKey(code), ...(safe_facts ? { safe_facts } : {}) }
}

function stockInstruments(): readonly string[] {
  return (catalogById('stocks')?.instruments ?? []).map((i) => i.instrument)
}

function normalizeMention(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '')
}

function isDecidableSlots(slots: NormalizeSlots): boolean {
  return stockInstruments().includes(slots.entity_id) && isUiHorizon(slots.horizon)
}

export function createStocksAdapter(io: PriceSeriesIo): CategoryAdapter {
  return {
    category_id: 'stocks',
    ledger_category: 'stock',
    entity_kinds: ['ticker'],

    async resolveEntity(raw: string, _locale: string): Promise<EntityResolution> {
      const catalog = stockInstruments()
      const needle = normalizeMention(raw)
      if (!needle) return { ok: false, refuse: refuse('unsupported_entity', { supported: catalog.join(', ') }) }

      // Exact hit: ticker or synonym.
      const exact = STOCK_SYNONYMS[needle] ?? (catalog.includes(needle.toUpperCase()) ? needle.toUpperCase() : null)
      if (exact && catalog.includes(exact)) {
        return { ok: true, entity_id: exact, entity_kind: 'ticker', label: exact }
      }

      // Partial hit(s): a mention that PREFIXES a known name ('테슬' → 테슬라,
      // 'nvid' → nvidia). One candidate still asks (confirm-by-chip), several
      // ask which one — never silently resolve a fuzzy match into a paid round.
      const candidates = [
        ...new Set(
          Object.entries(STOCK_SYNONYMS)
            .filter(([key]) => key.startsWith(needle) && key !== needle)
            .map(([, ticker]) => ticker)
            .filter((t) => catalog.includes(t)),
        ),
      ]
      if (candidates.length > 0) {
        return {
          ok: false,
          need: {
            slot: 'entity_id',
            prompt_i18n_key: 'league.gateway.clarify.entity',
            options: candidates.map((t) => ({ id: t, label_i18n_key: `league.catalog.instruments.${t}` })),
          },
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
        questions.push({
          slot: 'entity_id',
          prompt_i18n_key: 'league.gateway.clarify.entity',
          options: stockInstruments().map((t) => ({ id: t, label_i18n_key: `league.catalog.instruments.${t}` })),
        })
      }
      if (!partial.horizon) questions.push(HORIZON_QUESTION)
      return questions
    },

    jurisdictionGate(_viewer: GatewayViewer, _now: Date): Refusal | null {
      // Stocks carry no category overlay: the shell's global matrix
      // (`isCategoryAllowed('stock', …)`) is the whole rule. Contrast:
      // real-estate adds specific_property/brokerage_advice, sports adds
      // betting_framing, politics adds blackout windows.
      return null
    },

    refusalTaxonomy() {
      return STOCKS_REFUSALS.map((code) => ({ code, message_i18n_key: refusalMessageKey(code) }))
    },

    composeProposition(slots: NormalizeSlots, now: Date = new Date()): ComposedRound {
      if (!isDecidableSlots(slots)) {
        throw new Error('stocks.composeProposition called with undecidable slots — shell must gate on isDecidable')
      }
      // THE server template — the same function the catalog chip path has
      // always used. No user substring can appear: inputs are a catalog
      // ticker and one of 4 fixed horizon codes.
      const round = buildCatalogRankedRoundInput(slots.entity_id, slots.horizon!, now)
      if (!round) {
        throw new Error(`stocks.composeProposition: ${slots.entity_id} vanished from the catalog`)
      }
      return round
    },

    gradeSources(slots: NormalizeSlots): readonly [GradeSource, GradeSource, GradeSource] {
      return [
        {
          tier: 1,
          kind: 'twelve_data',
          endpoint: `/time_series?symbol=${slots.entity_id}&interval=1day (regular-session close vs anchor close)`,
        },
        { tier: 2, kind: 'perplexity_sourced', require_url: true },
        { tier: 3, kind: 'operator_manual', require_url: true },
      ]
    },

    isDecidable(slots: NormalizeSlots): boolean {
      return isDecidableSlots(slots)
    },

    slotsForRound(round: PacketRound): NormalizeSlots {
      return {
        category_id: 'stocks',
        entity_id: round.instrument,
        entity_kind: 'ticker',
        entity_label: round.instrument,
        horizon: isUiHorizon(round.horizon) ? round.horizon : null,
        resolve_by: round.resolves_at || null,
        proposition_kind: 'binary_close_higher',
        slots: {},
        confidence: 1,
      }
    },

    async buildPacket(_slots: NormalizeSlots, ctx: PacketBuildContext): Promise<CategoryPacket> {
      return buildPriceSeriesPacket(ctx, io)
    },
  }
}
