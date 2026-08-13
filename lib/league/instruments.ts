import 'server-only'

import type { PredictionCategory } from '@/lib/prediction/reconciliation'

/**
 * AI Prediction League — daily fixed instrument set (cron v1 scope).
 *
 * v1 SCOPE (do NOT extend ad hoc — // v2):
 *  - ONE horizon: 24h.
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
 */
export type LeagueHorizon = '24h' | '7d' | '1m'

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
    horizon: '24h',
    resolution_rule: 'NASDAQ regular-session close price vs prior close',
    item_type: 'ranked',
    color_bucket: 'green',
    label: 'Apple (AAPL)',
  },
  {
    instrument: 'NVDA',
    category: 'stock',
    horizon: '24h',
    resolution_rule: 'NASDAQ regular-session close price vs prior close',
    item_type: 'ranked',
    color_bucket: 'green',
    label: 'NVIDIA (NVDA)',
  },
  {
    instrument: 'BTC/USD',
    category: 'crypto_spot',
    horizon: '24h',
    resolution_rule: 'BTC/USD spot close vs prior close',
    item_type: 'ranked',
    color_bucket: 'green',
    label: 'Bitcoin (BTC/USD)',
  },
  {
    instrument: 'EUR/USD',
    category: 'fx',
    horizon: '24h',
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
