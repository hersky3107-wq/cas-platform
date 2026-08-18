/**
 * Ledger prediction categories (the CHECK constraint on
 * `prediction_rounds.category`). Shared, no `server-only` — the public catalog
 * and the jurisdiction matrix both need the union without pulling the
 * reconciler into the client bundle.
 *
 * The PUBLIC Cards tab shows 12 categories (`lib/league/catalog.ts`); this
 * union is the larger ledger set those 12 map onto. `bond_rate`,
 * `crypto_perps`, `futures_derivatives`, and `entertainment_awards` stay so
 * historical rows remain valid. `real_estate` is the one additive value.
 */
export type PredictionCategory =
  | 'stock'
  | 'etf_index'
  | 'bond_rate'
  | 'gold_metal'
  | 'macro_econ'
  | 'commodity_energy'
  | 'crypto_spot'
  | 'fx'
  | 'futures_derivatives'
  | 'politics_election'
  | 'sports'
  | 'entertainment_awards'
  | 'memecoin'
  | 'crypto_perps'
  | 'real_estate'
