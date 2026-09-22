import 'server-only'

import {
  cryptoMajorFieldPlan,
  parseBlockchainChart,
  parseCoinGeckoGlobal,
  parseMempoolDifficulty,
  parseMempoolFees,
} from './crypto-parse'
import type { SlowDataSnapshot } from './closed-book-packet'

/**
 * Crypto-major extras on top of memecoin-data (Fear & Greed + Binance L/S/taker).
 * Free, no keys: blockchain.info charts, mempool.space, CoinGecko /global.
 * Isolation: BTC on-chain + BTC dominance; ETH dominance only; SOL/XRP/BNB skip.
 */

const FETCH_TIMEOUT_MS = 15_000
const UA = 'cas-platform-league-research/1.0 (contact: admin@cas-platform.example)'
const CRYPTO_SPOT = 'crypto_spot'

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

async function fetchHashRate(): Promise<SlowDataSnapshot['hashRate']> {
  return memoDaily('btc-hashrate', async () => {
    const r = await getJson('https://api.blockchain.info/charts/hash-rate?timespan=7days&format=json')
    if (!r.ok) return { unavailable: `blockchain.info hash-rate: ${r.error}` }
    return parseBlockchainChart(r.json, 'blockchain.info hash-rate')
  })
}

async function fetchActiveAddresses(): Promise<SlowDataSnapshot['activeAddresses']> {
  return memoDaily('btc-active-addresses', async () => {
    const r = await getJson('https://api.blockchain.info/charts/n-unique-addresses?timespan=7days&format=json')
    if (!r.ok) return { unavailable: `blockchain.info n-unique-addresses: ${r.error}` }
    return parseBlockchainChart(r.json, 'blockchain.info n-unique-addresses')
  })
}

async function fetchDifficulty(): Promise<SlowDataSnapshot['difficultyAdjustment']> {
  return memoDaily('btc-difficulty', async () => {
    const r = await getJson('https://mempool.space/api/v1/difficulty-adjustment')
    if (!r.ok) return { unavailable: `mempool.space difficulty-adjustment: ${r.error}` }
    return parseMempoolDifficulty(r.json)
  })
}

async function fetchFees(): Promise<SlowDataSnapshot['mempoolFees']> {
  return memoDaily('btc-mempool-fees', async () => {
    const r = await getJson('https://mempool.space/api/v1/fees/recommended')
    if (!r.ok) return { unavailable: `mempool.space fees: ${r.error}` }
    return parseMempoolFees(r.json)
  })
}

async function fetchDominance(): Promise<{ btc: SlowDataSnapshot['btcDominance']; eth: SlowDataSnapshot['ethDominance'] }> {
  return memoDaily('coingecko-global', async () => {
    const r = await getJson('https://api.coingecko.com/api/v3/global')
    if (!r.ok) {
      const fail = { unavailable: `CoinGecko /global: ${r.error}` } satisfies Fail
      return { btc: fail, eth: fail }
    }
    const parsed = parseCoinGeckoGlobal(r.json)
    if ('unavailable' in parsed) return { btc: parsed, eth: parsed }
    return {
      btc:
        parsed.btcPct == null
          ? { unavailable: 'CoinGecko /global: no btc dominance' }
          : { date: parsed.date, pct: parsed.btcPct },
      eth:
        parsed.ethPct == null
          ? { unavailable: 'CoinGecko /global: no eth dominance' }
          : { date: parsed.date, pct: parsed.ethPct },
    }
  })
}

export async function fetchCryptoSpotSlowFields(
  category: string,
  instrument?: string,
): Promise<{
  hashRate?: SlowDataSnapshot['hashRate']
  activeAddresses?: SlowDataSnapshot['activeAddresses']
  difficultyAdjustment?: SlowDataSnapshot['difficultyAdjustment']
  mempoolFees?: SlowDataSnapshot['mempoolFees']
  btcDominance?: SlowDataSnapshot['btcDominance']
  ethDominance?: SlowDataSnapshot['ethDominance']
} | null> {
  if (category !== CRYPTO_SPOT) return null
  const plan = cryptoMajorFieldPlan(instrument)
  if (!plan) return null

  const [hashRate, activeAddresses, difficultyAdjustment, mempoolFees, dominance] = await Promise.all([
    plan.onChainBtc ? fetchHashRate() : Promise.resolve(null),
    plan.onChainBtc ? fetchActiveAddresses() : Promise.resolve(null),
    plan.onChainBtc ? fetchDifficulty() : Promise.resolve(null),
    plan.onChainBtc ? fetchFees() : Promise.resolve(null),
    plan.btcDominance || plan.ethDominance ? fetchDominance() : Promise.resolve(null),
  ])

  return {
    ...(hashRate ? { hashRate } : {}),
    ...(activeAddresses ? { activeAddresses } : {}),
    ...(difficultyAdjustment ? { difficultyAdjustment } : {}),
    ...(mempoolFees ? { mempoolFees } : {}),
    ...(plan.btcDominance && dominance ? { btcDominance: dominance.btc } : {}),
    ...(plan.ethDominance && dominance ? { ethDominance: dominance.eth } : {}),
  }
}
