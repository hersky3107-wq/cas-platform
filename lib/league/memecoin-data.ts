import 'server-only'

import {
  binancePerpSymbol,
  memecoinFieldPlan,
  parseFearGreedJson,
  parseTakerRatio,
  parseTopTraderLs,
} from './memecoin-parse'
import type { SlowDataSnapshot } from './closed-book-packet'

/**
 * Free memecoin packet feeds. Zero API-key cost.
 * Binance public futures (funding/OI live in `fetchCryptoContext` via the
 * same 1000x map) + top-trader L/S + taker buy/sell + Alternative.me Fear
 * & Greed. Farside BTC ETF flows stay in slow-data.ts (CRYPTO_CATEGORIES).
 * Per-chip isolation of BTC/ETH/SOL beta is relations, not extra HTTP.
 */

const FETCH_TIMEOUT_MS = 15_000
const UA = 'cas-platform-league-research/1.0 (contact: admin@cas-platform.example)'
const BINANCE_FAPI = 'https://fapi.binance.com'
const FNG_URL = 'https://api.alternative.me/fng/?limit=7'
const RATIO_PERIOD = '1h'
const MEMECOIN_CATEGORIES = new Set(['memecoin'])

type Fail = { unavailable: string }

async function getJson(url: string): Promise<{ ok: true; json: unknown } | { ok: false; error: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': UA } })
    const text = await res.text()
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${text.slice(0, 160)}` }
    try {
      return { ok: true, json: JSON.parse(text) as unknown }
    } catch {
      return { ok: false, error: `Non-JSON: ${text.slice(0, 120)}` }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg.toLowerCase().includes('abort') ? `timeout after ${FETCH_TIMEOUT_MS}ms` : msg }
  } finally {
    clearTimeout(timer)
  }
}

const dayMemo = new Map<string, unknown>()
function utcDay(): string {
  return new Date().toISOString().slice(0, 10)
}
async function memoDaily<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const k = `${key}|${utcDay()}`
  const hit = dayMemo.get(k)
  if (hit !== undefined) return hit as T
  const value = await fn()
  dayMemo.set(k, value)
  return value
}

async function fetchFearGreed(): Promise<SlowDataSnapshot['fearGreed']> {
  return memoDaily('altme-fng', async () => {
    const r = await getJson(FNG_URL)
    if (!r.ok) return { unavailable: `Alternative.me /fng: ${r.error}` }
    return parseFearGreedJson(r.json)
  })
}

async function fetchTopTraderLs(symbol: string): Promise<SlowDataSnapshot['topTraderLs']> {
  return memoDaily(`binance-top-ls|${symbol}|${RATIO_PERIOD}`, async () => {
    const r = await getJson(
      `${BINANCE_FAPI}/futures/data/topLongShortPositionRatio?symbol=${encodeURIComponent(symbol)}&period=${RATIO_PERIOD}&limit=1`,
    )
    if (!r.ok) return { unavailable: `Binance topLongShortPositionRatio ${symbol}: ${r.error}` }
    return parseTopTraderLs(r.json, symbol, RATIO_PERIOD)
  })
}

async function fetchTakerRatio(symbol: string): Promise<SlowDataSnapshot['takerRatio']> {
  return memoDaily(`binance-taker|${symbol}|${RATIO_PERIOD}`, async () => {
    const r = await getJson(
      `${BINANCE_FAPI}/futures/data/takerlongshortRatio?symbol=${encodeURIComponent(symbol)}&period=${RATIO_PERIOD}&limit=1`,
    )
    if (!r.ok) return { unavailable: `Binance takerlongshortRatio ${symbol}: ${r.error}` }
    return parseTakerRatio(r.json, symbol, RATIO_PERIOD)
  })
}

export async function fetchMemecoinSlowFields(
  category: string,
  instrument?: string,
): Promise<{
  fearGreed?: SlowDataSnapshot['fearGreed']
  topTraderLs?: SlowDataSnapshot['topTraderLs']
  takerRatio?: SlowDataSnapshot['takerRatio']
} | null> {
  if (!MEMECOIN_CATEGORIES.has(category)) return null
  const plan = memecoinFieldPlan(instrument)
  const symbol = plan?.binanceSymbol ?? binancePerpSymbol(instrument)
  const [fearGreed, topTraderLs, takerRatio] = await Promise.all([
    fetchFearGreed(),
    symbol
      ? fetchTopTraderLs(symbol)
      : Promise.resolve({ unavailable: `no Binance perp mapping for ${instrument ?? '(missing)'}` } satisfies Fail),
    symbol
      ? fetchTakerRatio(symbol)
      : Promise.resolve({ unavailable: `no Binance perp mapping for ${instrument ?? '(missing)'}` } satisfies Fail),
  ])
  return { fearGreed, topTraderLs, takerRatio }
}
