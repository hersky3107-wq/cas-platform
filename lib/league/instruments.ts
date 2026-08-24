import 'server-only'

import type { PredictionCategory } from '@/lib/prediction/categories'
import type { UiHorizon } from './horizon'

/**
 * AI Prediction League ??daily fixed instrument set (cron v1 scope).
 *
 * v1 SCOPE (do NOT extend ad hoc ??// v2):
 *  - ONE horizon: 1d (the canonical code; a daily round).
 *  - SMALL fixed set, free-tier-resolvable only (US equities / FX / crypto).
 *   Twelve Data's free (Basic) tier does NOT cover international exchanges
 *   (e.g. KRX / 005930), so those are intentionally excluded here.
 *  - No weekly-topical rounds, no multi-horizon, no non-finance categories yet.
 *
 * Each entry carries everything the orchestrator's ensureRound needs to build
 * a ranked, scored round (category / horizon / resolution_rule / item_type),
 * plus the denormalized color_bucket so the config is self-describing (the
 * orchestrator re-derives color_bucket from category, but keeping it here makes
 * a single instrument's traffic-light visible without reading the orchestrator).
 *
 * HORIZON VOCABULARY: this legacy opener writes the SAME 4 canonical codes as
 * the rest of the league (`UiHorizon` = '1d'/'1w'/'1m'/'3m'), so a round it
 * opens satisfies the `prediction_rounds` horizon CHECK. Aliasing the type to
 * `UiHorizon` (rather than redeclaring '24h') makes a non-canonical value a
 * compile error here, not a runtime INSERT failure after 40 paid model calls.
 */
export type LeagueHorizon = UiHorizon

export type FixedInstrument = {
  /** Ledger instrument string (also the Twelve Data symbol for price categories). */
  instrument: string
  category: PredictionCategory
  horizon: LeagueHorizon
  /** Snapshot of how the round is judged (stored verbatim on the round). */
  resolution_rule: string
  /** 'ranked' counts toward league scoring; 'on_demand' never does. */
  item_type: 'ranked' | 'on_demand'
  /** Denormalized traffic-light bucket (green/yellow/red). */
  color_bucket: 'green' | 'yellow' | 'red'
  /** Human label for logs / reports and the auto-generated proposition text. */
  label: string
}

export const DAILY_FIXED_INSTRUMENTS: readonly FixedInstrument[] = [
  {
    instrument: 'AAPL',
    category: 'stock',
    horizon: '1d',
    resolution_rule: 'NASDAQ regular-session close price vs prior close',
    item_type: 'ranked',
    color_bucket: 'green',
    label: 'Apple (AAPL)',
  },
  {
    instrument: 'NVDA',
    category: 'stock',
    horizon: '1d',
    resolution_rule: 'NASDAQ regular-session close price vs prior close',
    item_type: 'ranked',
    color_bucket: 'green',
    label: 'NVIDIA (NVDA)',
  },
  {
    instrument: 'BTC/USD',
    category: 'crypto_spot',
    horizon: '1d',
    resolution_rule: 'BTC/USD spot close vs prior close',
    item_type: 'ranked',
    color_bucket: 'green',
    label: 'Bitcoin (BTC/USD)',
  },
  {
    instrument: 'EUR/USD',
    category: 'fx',
    horizon: '1d',
    resolution_rule: 'EUR/USD spot close vs prior close',
    item_type: 'ranked',
    color_bucket: 'green',
    label: 'EUR/USD',
  },
]

/** Look up a single fixed instrument by its ledger instrument string. */
export function findFixedInstrument(instrument: string): FixedInstrument | null {
  return DAILY_FIXED_INSTRUMENTS.find((i) => i.instrument === instrument) ?? null
}
