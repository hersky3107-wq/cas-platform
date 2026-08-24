import type { ColorBucket } from './card-types'
import type { PredictionCategory } from '@/lib/prediction/categories'
import { cacheBucketFor, computeResolvesAt, tradingApproximationNote, type UiHorizon } from './horizon'

/**
 * AI Prediction League — PUBLIC CATEGORY → INSTRUMENT CATALOG.
 *
 * DATA ONLY. The Cards tab, `GET /api/league/instruments`, and the curated-
 * instrument gate all read this file. Adding a category or a flagship chip
 * is a data edit here (+ i18n labels in `dictionary.ts`); do not hardcode
 * chips in the hub UI.
 *
 * The 12 public ids are the product surface. Each maps onto one ledger
 * `PredictionCategory` (the 15-value CHECK constraint). Schema leftovers
 * that are NOT a top-level chip:
 *  - esports never existed — absorbed into `sports`
 *  - `crypto_perps` / extra memecoins live under `crypto` / `memecoin`
 *  - `bond_rate` folds into `macro_econ` (coming-soon, no chips)
 *  - `futures_derivatives` is schema-only (not a public chip)
 *  - `entertainment_awards` is the ledger key for public `entertainment`
 */

export const PUBLIC_CATEGORY_IDS = [
  'sports',
  'crypto',
  'stocks',
  'fx',
  'gold_metals',
  'index_etf',
  'commodities_energy',
  'politics_election',
  'entertainment',
  'memecoin',
  'real_estate',
  'macro_econ',
] as const

export type PublicCategoryId = (typeof PUBLIC_CATEGORY_IDS)[number]

export type CatalogKind = 'instruments' | 'coming_soon'

export type CatalogInstrument = {
  /** Ledger + Twelve Data symbol. Never shown as the only label — i18n key is `instrument`. */
  instrument: string
  resolution_rule: string
}

export type PublicCategoryDef = {
  id: PublicCategoryId
  /** Value stored on `prediction_rounds.category`. Jurisdiction checks this key. */
  ledgerCategory: PredictionCategory
  tone: ColorBucket
  kind: CatalogKind
  instruments: readonly CatalogInstrument[]
}

export const PUBLIC_CATALOG: readonly PublicCategoryDef[] = [
  {
    id: 'sports',
    ledgerCategory: 'sports',
    tone: 'red',
    kind: 'coming_soon',
    instruments: [],
  },
  {
    id: 'crypto',
    ledgerCategory: 'crypto_spot',
    tone: 'yellow',
    kind: 'instruments',
    instruments: [
      { instrument: 'BTC/USD', resolution_rule: 'BTC/USD spot close vs prior close' },
      { instrument: 'ETH/USD', resolution_rule: 'ETH/USD spot close vs prior close' },
      { instrument: 'SOL/USD', resolution_rule: 'SOL/USD spot close vs prior close' },
    ],
  },
  {
    id: 'stocks',
    ledgerCategory: 'stock',
    tone: 'green',
    kind: 'instruments',
    instruments: [
      { instrument: 'AAPL', resolution_rule: 'NASDAQ regular-session close price vs prior close' },
      { instrument: 'NVDA', resolution_rule: 'NASDAQ regular-session close price vs prior close' },
      { instrument: 'TSLA', resolution_rule: 'NASDAQ regular-session close price vs prior close' },
    ],
  },
  {
    id: 'fx',
    ledgerCategory: 'fx',
    tone: 'yellow',
    kind: 'instruments',
    instruments: [
      { instrument: 'EUR/USD', resolution_rule: 'EUR/USD spot close vs prior close' },
      { instrument: 'USD/KRW', resolution_rule: 'USD/KRW spot close vs prior close' },
      { instrument: 'USD/JPY', resolution_rule: 'USD/JPY spot close vs prior close' },
    ],
  },
  {
    id: 'gold_metals',
    ledgerCategory: 'gold_metal',
    tone: 'green',
    kind: 'instruments',
    instruments: [
      { instrument: 'XAU/USD', resolution_rule: 'XAU/USD spot close vs prior close' },
      { instrument: 'XAG/USD', resolution_rule: 'XAG/USD spot close vs prior close' },
    ],
  },
  {
    id: 'index_etf',
    ledgerCategory: 'etf_index',
    tone: 'green',
    kind: 'instruments',
    instruments: [
      { instrument: 'SPX', resolution_rule: 'S&P 500 cash index close vs prior close' },
      { instrument: 'NDX', resolution_rule: 'Nasdaq-100 cash index close vs prior close' },
    ],
  },
  {
    id: 'commodities_energy',
    ledgerCategory: 'commodity_energy',
    tone: 'yellow',
    kind: 'instruments',
    instruments: [
      { instrument: 'WTICO/USD', resolution_rule: 'WTI crude spot close vs prior close' },
      { instrument: 'NATGAS/USD', resolution_rule: 'Natural gas spot close vs prior close' },
    ],
  },
  {
    id: 'politics_election',
    ledgerCategory: 'politics_election',
    tone: 'yellow',
    kind: 'coming_soon',
    instruments: [],
  },
  {
    id: 'entertainment',
    ledgerCategory: 'entertainment_awards',
    tone: 'red',
    kind: 'coming_soon',
    instruments: [],
  },
  {
    id: 'memecoin',
    ledgerCategory: 'memecoin',
    tone: 'red',
    kind: 'instruments',
    instruments: [
      { instrument: 'DOGE/USD', resolution_rule: 'DOGE/USD spot close vs prior close' },
      { instrument: 'SHIB/USD', resolution_rule: 'SHIB/USD spot close vs prior close' },
    ],
  },
  {
    id: 'real_estate',
    ledgerCategory: 'real_estate',
    tone: 'yellow',
    kind: 'instruments',
    instruments: [
      { instrument: 'VNQ', resolution_rule: 'VNQ regular-session close vs prior close' },
      { instrument: 'SCHH', resolution_rule: 'SCHH regular-session close vs prior close' },
    ],
  },
  {
    id: 'macro_econ',
    ledgerCategory: 'macro_econ',
    tone: 'green',
    kind: 'coming_soon',
    instruments: [],
  },
]

export const CATALOG_INSTRUMENT_IDS: readonly string[] = PUBLIC_CATALOG.flatMap((c) =>
  c.instruments.map((i) => i.instrument),
)

/** Server-owned ranked-round seed for a catalog instrument (never caller text). */
export type CatalogRankedRoundInput = {
  proposition_text: string
  category: PredictionCategory
  instrument: string
  horizon: string
  resolution_rule: string
  resolves_at: string
  item_type: 'ranked'
  cache_key: string
}

/**
 * Opens the current ranked round for a curated catalog symbol AT ONE OF THE
 * 4 SELECTABLE HORIZONS (`uiHorizon`, default `'1d'`). Proposition, rule, and
 * cache_key are taken from this file — a public caller cannot name them; the
 * only caller-controlled input is which of the 4 fixed horizon codes to use
 * (validated by `isUiHorizon` upstream — see `lib/league/access-policy.ts`).
 *
 * IDEMPOTENCY: the cache-key bucket matches the horizon's own cadence (day /
 * ISO week / month / quarter — see `cacheBucketFor`), so a long-horizon round
 * is opened once per period, not reopened daily while the previous one is
 * still pending. `resolves_at` is computed from `now` per the horizon +
 * category rule in `lib/league/horizon.ts` (trading sessions for
 * equities/ETFs, calendar days for crypto/FX) — never reinterpreted later.
 *
 * THE PROPOSITION NAMES THE ACTUAL RESOLVE DATE — never a relative phrase
 * like "over the next 1 month" or "21 trading days from now". Both the
 * proposition and `resolves_at` are string-sliced from the SAME `resolvesAt`
 * value computed below, so they can never disagree. For horizons whose date
 * used the weekday-count trading-session approximation (see
 * `tradingApproximationNote`), that limitation is appended to the
 * proposition itself, not left in a code comment nobody reading the card
 * would see.
 */
export function buildCatalogRankedRoundInput(
  instrument: string,
  uiHorizon: UiHorizon = '1d',
  now: Date = new Date()
): CatalogRankedRoundInput | null {
  const found = findCatalogInstrument(instrument)
  if (!found) return null
  const bucket = cacheBucketFor(uiHorizon, now)
  const resolvesAt = computeResolvesAt(found.category.ledgerCategory, uiHorizon, now.toISOString())
  const resolveDate = resolvesAt.slice(0, 10)
  const note = tradingApproximationNote(found.category.ledgerCategory, uiHorizon)
  const proposition_text = `Will ${found.entry.instrument} close higher by ${resolveDate} than its last close?${
    note ? ` (${resolveDate} ${note}.)` : ''
  }`
  return {
    proposition_text,
    category: found.category.ledgerCategory,
    instrument: found.entry.instrument,
    // The UI horizon code IS the stored value — no translation table.
    horizon: uiHorizon,
    resolution_rule: found.entry.resolution_rule,
    resolves_at: resolvesAt,
    item_type: 'ranked',
    cache_key: `daily|${found.entry.instrument}|${uiHorizon}|${bucket}`,
  }
}

export function findCatalogInstrument(instrument: string): {
  category: PublicCategoryDef
  entry: CatalogInstrument
} | null {
  const needle = instrument.trim()
  for (const category of PUBLIC_CATALOG) {
    const entry = category.instruments.find((i) => i.instrument === needle)
    if (entry) return { category, entry }
  }
  return null
}

export function catalogById(id: string): PublicCategoryDef | null {
  return PUBLIC_CATALOG.find((c) => c.id === id) ?? null
}

/** First financial (chip) category, preferring stocks so the existing AAPL card is the default. */
export function defaultCatalogCategoryId(
  visible: readonly { id: PublicCategoryId; kind: CatalogKind; instruments: readonly unknown[] }[],
): PublicCategoryId | null {
  const stocks = visible.find((c) => c.id === 'stocks' && c.kind === 'instruments')
  if (stocks) return stocks.id
  const financial = visible.find((c) => c.kind === 'instruments' && c.instruments.length > 0)
  return financial?.id ?? visible[0]?.id ?? null
}
