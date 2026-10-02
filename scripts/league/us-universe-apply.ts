/**
 * Seed public.league_kr_universe with 35 US names from SEIBro
 * (보관금액 TOP50 as of 2026-09-30 ∪ 결제금액 매수+매도 TOP50 2026-09-02~2026-10-01).
 * ETFs, leverage, SK Hynix ADR, and Yandex are already excluded.
 *
 * Tickers are verified via the same Twelve Data client as the world stock lane.
 * Failed symbols are never written. Never deletes. Never touches KOSPI/KOSDAQ.
 *
 *   npx tsx --env-file=.env.local scripts/league/us-universe-apply.ts
 *   npx tsx --env-file=.env.local scripts/league/us-universe-apply.ts --apply
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeStockInstrument, isUsListingExchange } from '@/lib/league/gateway/adapters/stock-catalog'
import { parseSymbolSearchRows } from '@/lib/league/gateway/adapters/stock-search'
import type { LeagueKrUniverseDbRow } from '@/lib/league/korea-universe-apply'

const TABLE = 'league_kr_universe'
const SHORT_HISTORY_BARS = 60
const SERIES_OUTPUT = 90
const SPACEX_SEARCH = 'Space Exploration Technologies'
const CRYPTO_LINKED = new Set(['IREN', 'BMNR', 'MSTR', 'CRCL'])
const TWELVE_DATA_BASE = 'https://api.twelvedata.com'

/**
 * Same vendor + `TWELVE_DATA_API_KEY` as `lib/league/market-data.ts`.
 * Inlined so this CLI does not import the server-only module.
 */
export async function twelveDataGetForScript(
  path: string,
  params: Record<string, string>,
): Promise<{ ok: true; json: any } | { ok: false; error: string }> {
  const apiKey = process.env.TWELVE_DATA_API_KEY?.trim()
  if (!apiKey) return { ok: false, error: 'TWELVE_DATA_API_KEY not set' }
  const qs = new URLSearchParams({ ...params, apikey: apiKey }).toString()
  try {
    const res = await fetch(`${TWELVE_DATA_BASE}/${path}?${qs}`)
    const body = await res.text().catch(() => '')
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status} ${res.statusText}${body ? ` - ${body.slice(0, 300)}` : ''}` }
    }
    let json: any
    try {
      json = JSON.parse(body)
    } catch {
      return { ok: false, error: `Non-JSON response: ${body.slice(0, 300)}` }
    }
    if (json?.status === 'error') {
      return { ok: false, error: `TwelveData error${json?.code ? ` ${json.code}` : ''}: ${json?.message ?? 'unknown'}` }
    }
    return { ok: true, json }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown fetch error' }
  }
}

export type UsUniverseSeed = {
  rank: number
  /** Expected ticker. Null = resolve only via symbol_search. */
  ticker: string | null
  nameKo: string
  search?: string
}

export const US_UNIVERSE_SEED: readonly UsUniverseSeed[] = [
  { rank: 1, ticker: 'TSLA', nameKo: '테슬라' },
  { rank: 2, ticker: 'NVDA', nameKo: '엔비디아' },
  { rank: 3, ticker: 'GOOGL', nameKo: '알파벳 A' },
  { rank: 4, ticker: 'AAPL', nameKo: '애플' },
  { rank: 5, ticker: 'MU', nameKo: '마이크론' },
  { rank: 6, ticker: 'PLTR', nameKo: '팔란티어' },
  { rank: 7, ticker: 'IONQ', nameKo: '아이온큐' },
  { rank: 8, ticker: 'MSFT', nameKo: '마이크로소프트' },
  { rank: 9, ticker: 'AVGO', nameKo: '브로드컴' },
  { rank: 10, ticker: 'SNDK', nameKo: '샌디스크' },
  { rank: 11, ticker: null, nameKo: '스페이스X', search: SPACEX_SEARCH },
  { rank: 12, ticker: 'AMZN', nameKo: '아마존' },
  { rank: 13, ticker: 'AMD', nameKo: 'AMD' },
  { rank: 14, ticker: 'INTC', nameKo: '인텔' },
  { rank: 15, ticker: 'TSM', nameKo: 'TSMC' },
  { rank: 16, ticker: 'META', nameKo: '메타' },
  { rank: 17, ticker: 'MRVL', nameKo: '마벨 테크놀로지' },
  { rank: 18, ticker: 'IREN', nameKo: '아이렌' },
  { rank: 19, ticker: 'BMNR', nameKo: '비트마인' },
  { rank: 20, ticker: 'MSTR', nameKo: '스트래티지' },
  { rank: 21, ticker: 'RKLB', nameKo: '로켓랩' },
  { rank: 22, ticker: 'CRCL', nameKo: '서클' },
  { rank: 23, ticker: 'ASML', nameKo: 'ASML' },
  { rank: 24, ticker: 'BE', nameKo: '블룸에너지' },
  { rank: 25, ticker: 'AMAT', nameKo: '어플라이드 머티어리얼즈' },
  { rank: 26, ticker: 'LRCX', nameKo: '램리서치' },
  { rank: 27, ticker: 'BRK.B', nameKo: '버크셔해서웨이 B' },
  { rank: 28, ticker: 'LITE', nameKo: '루멘텀' },
  { rank: 29, ticker: 'O', nameKo: '리얼티인컴' },
  { rank: 30, ticker: 'ORCL', nameKo: '오라클' },
  { rank: 31, ticker: 'SMR', nameKo: '뉴스케일 파워' },
  { rank: 32, ticker: 'PANW', nameKo: '팔로알토 네트웍스' },
  { rank: 33, ticker: 'DELL', nameKo: '델 테크놀로지스' },
  { rank: 34, ticker: 'COHR', nameKo: '코히런트' },
  { rank: 35, ticker: 'MRNA', nameKo: '모더나' },
]

export type UsUniverseVerifyRow = {
  rank: number
  ticker: string
  nameKo: string
  exchange: string
  instrument: string
  bars: number
  flags: string[]
  ok: boolean
  vendorName: string
  error?: string
}

export type TwelveDataClient = (
  path: string,
  params: Record<string, string>,
) => Promise<{ ok: true; json: any } | { ok: false; error: string }>

export function flagsForUsUniverse(ticker: string, bars: number): string[] {
  const flags: string[] = []
  if (bars < SHORT_HISTORY_BARS) flags.push('short_history')
  if (CRYPTO_LINKED.has(ticker.toUpperCase())) flags.push('crypto_linked')
  return flags
}

export function planUsUniverseWrites(rows: UsUniverseVerifyRow[], now: string): LeagueKrUniverseDbRow[] {
  return rows
    .filter((row) => row.ok)
    .map((row) => ({
      market: 'US',
      code: row.ticker,
      name: row.nameKo,
      group_id: null,
      status: 'pinned',
      popularity_rank: row.rank,
      avg_trdval_20d_eok: null,
      mktcap_eok: null,
      visible: true,
      removed_at: null,
      flags: row.flags,
      updated_at: now,
    }))
}

function asExchange(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

function asSymbol(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

function quoteLooksListed(json: unknown): boolean {
  const rec = json as { close?: unknown; name?: unknown; exchange?: unknown; datetime?: unknown }
  if (!asExchange(rec.exchange)) return false
  const close = Number(rec.close)
  return Number.isFinite(close) || typeof rec.datetime === 'string' || typeof rec.name === 'string'
}

function pickSpacexHit(json: unknown): { symbol: string; exchange: string; name: string } | null {
  const data = (json as { data?: unknown })?.data
  const rows = Array.isArray(data) ? data : []
  const parsed = parseSymbolSearchRows(rows)
  const hit = parsed.hits.find((h) => /space\s*exploration|spacex/i.test(h.name))
  if (!hit) return null
  return { symbol: hit.symbol, exchange: hit.exchange, name: hit.name }
}

function countBars(json: unknown): number {
  const values = (json as { values?: unknown })?.values
  return Array.isArray(values) ? values.length : 0
}

function failed(seed: UsUniverseSeed, ticker: string, error: string): UsUniverseVerifyRow {
  return {
    rank: seed.rank,
    ticker: ticker || seed.ticker || '?',
    nameKo: seed.nameKo,
    exchange: '',
    instrument: '',
    bars: 0,
    flags: [],
    ok: false,
    vendorName: '',
    error,
  }
}

export async function verifyUsUniverseSeed(
  seed: UsUniverseSeed,
  tdGet: TwelveDataClient,
): Promise<UsUniverseVerifyRow> {
  let ticker = seed.ticker
  if (!ticker) {
    const query = seed.search ?? SPACEX_SEARCH
    const search = await tdGet('symbol_search', { symbol: query, outputsize: '30' })
    if (!search.ok) return failed(seed, '?', `symbol_search: ${search.error}`)
    const hit = pickSpacexHit(search.json)
    if (!hit) return failed(seed, '?', `symbol_search: no NYSE/NASDAQ hit for "${query}"`)
    ticker = hit.symbol
  }

  const quote = await tdGet('quote', { symbol: ticker })
  if (!quote.ok) return failed(seed, ticker, `quote: ${quote.error}`)
  if (!quoteLooksListed(quote.json)) return failed(seed, ticker, 'quote: empty / not listed')

  const quotedSymbol = asSymbol(quote.json?.symbol) || ticker
  if (seed.ticker && quotedSymbol !== seed.ticker.toUpperCase()) {
    return failed(seed, ticker, `quote symbol mismatch: expected ${seed.ticker}, got ${quotedSymbol}`)
  }

  const exchange = asExchange(quote.json?.exchange)
  if (!isUsListingExchange(exchange)) {
    return failed(seed, quotedSymbol, `exchange not NYSE/NASDAQ: ${exchange || '(empty)'}`)
  }

  const instrument = encodeStockInstrument({ exchange, symbol: quotedSymbol })
  if (!instrument) return failed(seed, quotedSymbol, `STOCK encoder rejected ${exchange}:${quotedSymbol}`)

  const series = await tdGet('time_series', {
    symbol: quotedSymbol,
    interval: '1day',
    outputsize: String(SERIES_OUTPUT),
  })
  if (!series.ok) return failed(seed, quotedSymbol, `time_series: ${series.error}`)
  const bars = countBars(series.json)
  const vendorName = String(quote.json?.name ?? '').trim()
  return {
    rank: seed.rank,
    ticker: quotedSymbol,
    nameKo: seed.nameKo,
    exchange,
    instrument,
    bars,
    flags: flagsForUsUniverse(quotedSymbol, bars),
    ok: true,
    vendorName,
  }
}

export function formatUsUniverseTable(rows: UsUniverseVerifyRow[]): string {
  const header = ['rank', 'ticker', 'exchange', 'instrument', 'bars', 'flags', 'status']
  const body = rows.map((row) => [
    String(row.rank),
    row.ticker,
    row.exchange || '—',
    row.instrument || '—',
    String(row.bars),
    row.flags.join(',') || '—',
    row.ok ? 'OK' : `FAILED${row.error ? ` (${row.error})` : ''}`,
  ])
  const cols = header.map((h, i) => Math.max(h.length, ...body.map((r) => r[i]!.length)))
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(cols[i]!)).join('  ')
  return [line(header), line(cols.map((n) => '-'.repeat(n))), ...body.map(line)].join('\n')
}

function parseArgs(argv: string[]): { apply: boolean } {
  let apply = false
  for (const arg of argv) {
    if (arg === '--apply') apply = true
    else if (arg === '--dry-run') apply = false
  }
  return { apply }
}

async function writeUsRows(rows: LeagueKrUniverseDbRow[]): Promise<void> {
  if (rows.length === 0) return
  const { supabaseAdmin } = await import('@/lib/supabase/server')
  const usOnly = rows.filter((row) => row.market === 'US')
  const { error } = await supabaseAdmin.from(TABLE).upsert(usOnly, { onConflict: 'market,code' })
  if (error) throw new Error(`league_kr_universe upsert: ${error.message}`)
}

async function main(): Promise<void> {
  const { apply } = parseArgs(process.argv.slice(2))
  const verified: UsUniverseVerifyRow[] = []
  for (const seed of US_UNIVERSE_SEED) {
    process.stdout.write(`verify ${seed.rank} ${seed.ticker ?? seed.search ?? seed.nameKo}… `)
    const row = await verifyUsUniverseSeed(seed, twelveDataGetForScript)
    verified.push(row)
    console.log(row.ok ? `${row.ticker} ${row.exchange} bars=${row.bars}` : `FAILED ${row.error}`)
  }

  console.log('')
  console.log(formatUsUniverseTable(verified))
  const ok = verified.filter((r) => r.ok)
  const failedRows = verified.filter((r) => !r.ok)
  console.log('')
  console.log(`OK ${ok.length} / FAILED ${failedRows.length} / seed ${US_UNIVERSE_SEED.length}`)
  for (const row of ok) {
    if (row.vendorName) console.log(`  ${row.ticker} vendor="${row.vendorName}" instrument=${row.instrument}`)
  }

  const now = new Date().toISOString()
  const writes = planUsUniverseWrites(verified, now)
  if (!apply) {
    console.log(`dry-run: would write ${writes.length} US pinned rows (no KOSPI/KOSDAQ, no deletes)`)
    return
  }
  await writeUsRows(writes)
  console.log(`wrote ${writes.length} US rows (FAILED skipped, no deletes)`)
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isDirect) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
