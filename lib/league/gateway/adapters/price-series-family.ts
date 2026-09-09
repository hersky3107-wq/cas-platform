import { buildCatalogRankedRoundInput, catalogById, visibleChipEntries } from '../../catalog'
import type { PublicCategoryId } from '../../catalog'
import { isUiHorizon, UI_HORIZONS } from '../../horizon'
import type { PredictionCategory } from '@/lib/prediction/categories'
import { refusalMessageKey } from '../refusal-copy'
import { buildPriceSeriesPacket, type PriceSeriesIo } from './price-series-packet'
import type {
  CategoryAdapter,
  ClarifyingQuestion,
  ComposedRound,
  EntityKind,
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
 * Shared stocks-shaped factory for the remaining price-series chips.
 * Judgment that differs per category (synonyms, entity kind, extra refusals,
 * mention overlays) is config. Packet assembly stays `buildPriceSeriesPacket`.
 * The stocks adapter is NOT rewritten through this factory — its frozen
 * packet-parity fixture pins that file.
 */

const BASE_REFUSALS: readonly RefusalCode[] = [
  'unsupported_entity',
  'ambiguous_entity',
  'missing_slot',
  'horizon_incompatible',
  'jurisdiction_blocked',
  'low_confidence',
]

const HORIZON_QUESTION: ClarifyingQuestion = {
  slot: 'horizon',
  prompt_i18n_key: 'league.gateway.clarify.horizon',
  options: UI_HORIZONS.map((h) => ({ id: h, label_i18n_key: `league.gateway.horizon.${h}` })),
}

export type PriceSeriesFamilyConfig = {
  category_id: PublicCategoryId
  ledger_category: PredictionCategory
  entity_kind: EntityKind
  synonyms: Record<string, string>
  extraRefusals?: readonly RefusalCode[]
  /**
   * Extra mention overlay (real-estate property / brokerage). Runs BEFORE
   * synonym lookup so a street address cannot resolve as a REIT ticker.
   */
  refuseMention?: (raw: string, normalized: string) => Refusal | null
  /** Twelve Data grade-source close description. */
  gradeCloseLabel: string
}

function refuse(code: RefusalCode, safe_facts?: Record<string, string>): Refusal {
  return { code, message_i18n_key: refusalMessageKey(code), ...(safe_facts ? { safe_facts } : {}) }
}

function normalizeMention(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '')
}

export function createPriceSeriesFamilyAdapter(cfg: PriceSeriesFamilyConfig, io: PriceSeriesIo): CategoryAdapter {
  const refusals = [...BASE_REFUSALS, ...(cfg.extraRefusals ?? [])]

  function instruments(): readonly string[] {
    return (catalogById(cfg.category_id)?.instruments ?? []).map((i) => i.instrument)
  }

  function chipIds(): readonly string[] {
    const cat = catalogById(cfg.category_id)
    return cat ? visibleChipEntries(cat).map((i) => i.instrument) : []
  }

  function isDecidableSlots(slots: NormalizeSlots): boolean {
    return instruments().includes(slots.entity_id) && isUiHorizon(slots.horizon)
  }

  return {
    category_id: cfg.category_id,
    ledger_category: cfg.ledger_category,
    entity_kinds: [cfg.entity_kind],
    observation_shape: null,

    async resolveEntity(raw: string, _locale: string): Promise<EntityResolution> {
      const catalog = instruments()
      const needle = normalizeMention(raw)
      if (!needle) return { ok: false, refuse: refuse('unsupported_entity', { supported: catalog.join(', ') }) }

      const overlay = cfg.refuseMention?.(raw, needle)
      if (overlay) return { ok: false, refuse: overlay }

      const exact = cfg.synonyms[needle] ?? (catalog.includes(needle.toUpperCase()) ? needle.toUpperCase() : null)
      if (exact && catalog.includes(exact)) {
        return { ok: true, entity_id: exact, entity_kind: cfg.entity_kind, label: exact }
      }

      const candidates = [
        ...new Set(
          Object.entries(cfg.synonyms)
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
          options: chipIds().map((t) => ({ id: t, label_i18n_key: `league.catalog.instruments.${t}` })),
        })
      }
      if (!partial.horizon) questions.push(HORIZON_QUESTION)
      return questions
    },

    jurisdictionGate(_viewer: GatewayViewer, _now: Date): Refusal | null {
      // Global matrix (`isCategoryAllowed`) is the category overlay for these
      // chips. memecoin EU/UK/ME/OTHER denial lives there and fires in the
      // shell before normalize / charge. real-estate property/brokerage is
      // a mention refusal, not a geo overlay.
      return null
    },

    refusalTaxonomy() {
      return refusals.map((code) => ({ code, message_i18n_key: refusalMessageKey(code) }))
    },

    composeProposition(slots: NormalizeSlots, now: Date = new Date()): ComposedRound {
      if (!isDecidableSlots(slots)) {
        throw new Error(
          `${cfg.category_id}.composeProposition called with undecidable slots — shell must gate on isDecidable`,
        )
      }
      const round = buildCatalogRankedRoundInput(slots.entity_id, slots.horizon!, now)
      if (!round) {
        throw new Error(`${cfg.category_id}.composeProposition: ${slots.entity_id} vanished from the catalog`)
      }
      return round
    },

    gradeSources(slots: NormalizeSlots): readonly [GradeSource, GradeSource, GradeSource] {
      return [
        {
          tier: 1,
          kind: 'twelve_data',
          endpoint: `/time_series?symbol=${slots.entity_id}&interval=1day (${cfg.gradeCloseLabel})`,
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
        category_id: cfg.category_id,
        entity_id: round.instrument,
        entity_kind: cfg.entity_kind,
        entity_label: round.instrument,
        horizon: isUiHorizon(round.horizon) ? round.horizon : null,
        resolve_by: round.resolves_at || null,
        proposition_kind: 'binary_close_higher',
        slots: {},
        confidence: 1,
      }
    },

    async buildPacket(_slots: NormalizeSlots, ctx: PacketBuildContext) {
      return buildPriceSeriesPacket(ctx, io)
    },
  }
}

const SESSION_CLOSE = 'regular-session close vs anchor close'
const SPOT_CLOSE = 'spot close vs prior close'

export const INDEX_ETF_SYNONYMS: Record<string, string> = {
  spy: 'SPY',
  spx: 'SPY',
  's&p': 'SPY',
  's&p500': 'SPY',
  sp500: 'SPY',
  에스앤피: 'SPY',
  에스엔피: 'SPY',
  에스앤피500: 'SPY',
  qqq: 'QQQ',
  ndx: 'QQQ',
  nasdaq: 'QQQ',
  nasdaq100: 'QQQ',
  나스닥: 'QQQ',
  나스닥100: 'QQQ',
}

export const GOLD_METAL_SYNONYMS: Record<string, string> = {
  gold: 'XAU/USD',
  xau: 'XAU/USD',
  'xau/usd': 'XAU/USD',
  금: 'XAU/USD',
  골드: 'XAU/USD',
  silver: 'XAG/USD',
  xag: 'XAG/USD',
  'xag/usd': 'XAG/USD',
  은: 'XAG/USD',
  실버: 'XAG/USD',
}

export const COMMODITY_ENERGY_SYNONYMS: Record<string, string> = {
  wti: 'WTICO/USD',
  oil: 'WTICO/USD',
  crude: 'WTICO/USD',
  'wtico/usd': 'WTICO/USD',
  원유: 'WTICO/USD',
  유가: 'WTICO/USD',
  오일: 'WTICO/USD',
  natgas: 'NATGAS/USD',
  gas: 'NATGAS/USD',
  'natgas/usd': 'NATGAS/USD',
  천연가스: 'NATGAS/USD',
  가스: 'NATGAS/USD',
}

export const FX_SYNONYMS: Record<string, string> = {
  eurusd: 'EUR/USD',
  'eur/usd': 'EUR/USD',
  euro: 'EUR/USD',
  유로: 'EUR/USD',
  유로달러: 'EUR/USD',
  usdkrw: 'USD/KRW',
  'usd/krw': 'USD/KRW',
  달러원: 'USD/KRW',
  원달러: 'USD/KRW',
  usdjpy: 'USD/JPY',
  'usd/jpy': 'USD/JPY',
  달러엔: 'USD/JPY',
  엔달러: 'USD/JPY',
}

export const CRYPTO_SYNONYMS: Record<string, string> = {
  btc: 'BTC/USD',
  bitcoin: 'BTC/USD',
  'btc/usd': 'BTC/USD',
  비트코인: 'BTC/USD',
  비트: 'BTC/USD',
  eth: 'ETH/USD',
  ethereum: 'ETH/USD',
  'eth/usd': 'ETH/USD',
  이더리움: 'ETH/USD',
  이더: 'ETH/USD',
  sol: 'SOL/USD',
  solana: 'SOL/USD',
  'sol/usd': 'SOL/USD',
  솔라나: 'SOL/USD',
}

export const MEMECOIN_SYNONYMS: Record<string, string> = {
  doge: 'DOGE/USD',
  dogecoin: 'DOGE/USD',
  'doge/usd': 'DOGE/USD',
  도지: 'DOGE/USD',
  도지코인: 'DOGE/USD',
  shib: 'SHIB/USD',
  shiba: 'SHIB/USD',
  'shib/usd': 'SHIB/USD',
  시바: 'SHIB/USD',
  시바이누: 'SHIB/USD',
}

export const REAL_ESTATE_SYNONYMS: Record<string, string> = {
  vnq: 'VNQ',
  뱅가드리츠: 'VNQ',
  뱅가드: 'VNQ',
  schh: 'SCHH',
  슈왑리츠: 'SCHH',
  슈왑: 'SCHH',
}

const PROPERTY_RE =
  /아파트|오피스텔|빌라|단독주택|매물|전세|월세|매매가|시세|평당|주소|단지|apartment|condo|house|appraisal|listing|address/i
const BROKERAGE_RE =
  /중개사|중개수수료|매수추천|매도추천|매수하세요|매도하세요|사야해|팔아야|brokerage|realtor|shouldibuy|shouldisell/i

export function refuseRealEstateMention(raw: string, normalized: string): Refusal | null {
  const hay = `${raw} ${normalized}`
  if (PROPERTY_RE.test(hay)) return refuse('specific_property')
  if (BROKERAGE_RE.test(hay)) return refuse('brokerage_advice')
  return null
}

export function createIndexEtfAdapter(io: PriceSeriesIo): CategoryAdapter {
  return createPriceSeriesFamilyAdapter(
    {
      category_id: 'index_etf',
      ledger_category: 'etf_index',
      entity_kind: 'index',
      synonyms: INDEX_ETF_SYNONYMS,
      gradeCloseLabel: SESSION_CLOSE,
    },
    io,
  )
}

export function createGoldMetalAdapter(io: PriceSeriesIo): CategoryAdapter {
  return createPriceSeriesFamilyAdapter(
    {
      category_id: 'gold_metals',
      ledger_category: 'gold_metal',
      entity_kind: 'pair',
      synonyms: GOLD_METAL_SYNONYMS,
      gradeCloseLabel: SPOT_CLOSE,
    },
    io,
  )
}

export function createCommodityEnergyAdapter(io: PriceSeriesIo): CategoryAdapter {
  return createPriceSeriesFamilyAdapter(
    {
      category_id: 'commodities_energy',
      ledger_category: 'commodity_energy',
      entity_kind: 'pair',
      synonyms: COMMODITY_ENERGY_SYNONYMS,
      gradeCloseLabel: SPOT_CLOSE,
    },
    io,
  )
}

export function createFxAdapter(io: PriceSeriesIo): CategoryAdapter {
  return createPriceSeriesFamilyAdapter(
    {
      category_id: 'fx',
      ledger_category: 'fx',
      entity_kind: 'pair',
      synonyms: FX_SYNONYMS,
      gradeCloseLabel: SPOT_CLOSE,
    },
    io,
  )
}

export function createCryptoAdapter(io: PriceSeriesIo): CategoryAdapter {
  return createPriceSeriesFamilyAdapter(
    {
      category_id: 'crypto',
      ledger_category: 'crypto_spot',
      entity_kind: 'pair',
      synonyms: CRYPTO_SYNONYMS,
      gradeCloseLabel: SPOT_CLOSE,
    },
    io,
  )
}

export function createMemecoinAdapter(io: PriceSeriesIo): CategoryAdapter {
  return createPriceSeriesFamilyAdapter(
    {
      category_id: 'memecoin',
      ledger_category: 'memecoin',
      entity_kind: 'pair',
      synonyms: MEMECOIN_SYNONYMS,
      gradeCloseLabel: SPOT_CLOSE,
    },
    io,
  )
}

export function createRealEstateAdapter(io: PriceSeriesIo): CategoryAdapter {
  return createPriceSeriesFamilyAdapter(
    {
      category_id: 'real_estate',
      ledger_category: 'real_estate',
      entity_kind: 'etf',
      synonyms: REAL_ESTATE_SYNONYMS,
      extraRefusals: ['specific_property', 'brokerage_advice'],
      refuseMention: refuseRealEstateMention,
      gradeCloseLabel: SESSION_CLOSE,
    },
    io,
  )
}
