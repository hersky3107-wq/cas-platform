/**
 * Twelve Data /symbol_search for the global lane.
 *
 * On by default (Ultra is the live plan). TWELVE_DATA_STOCK_UNIVERSE=off
 * (or 0 / false) disables the network search; quote + series + the analyst
 * 5-pack for STOCK: rows use the same flag in the stocks adapter.
 *
 * v1 coverage is US tape only: NYSE / NASDAQ common stock and ADRs
 * (TSM, TM, BABA). Local non-US listings (TSE 7203, TWSE 2330, HKEX 0700)
 * are reported as `nonUsOnly` so the adapter can point at the ADR.
 */

export type StockSearchHit = {
  symbol: string
  exchange: string
  name: string
  instrumentType: string
}

export type UsListingSearchResult = {
  hits: StockSearchHit[]
  /** Every vendor row was a Korea listing — global lane must not open it. */
  koreaOnly: boolean
  /** Equity rows exist, but only on local non-US venues. */
  nonUsOnly?: boolean
}

const US_EXCHANGES = new Set([
  'NASDAQ',
  'NASDAQGS',
  'NASDAQGM',
  'NYSE',
  'NYSE ARCA',
  'NYSE AMERICAN',
  'AMEX',
  'BATS',
])

const US_TYPES = new Set([
  'common stock',
  'american depositary receipt',
  'depositary receipt',
  'adr',
])

export function stockUniverseDataEnabled(): boolean {
  const flag = (process.env.TWELVE_DATA_STOCK_UNIVERSE ?? 'ultra').trim().toLowerCase()
  return !(flag === 'off' || flag === '0' || flag === 'false')
}

function isKoreaRow(row: { exchange?: string; country?: string }): boolean {
  const exchange = (row.exchange ?? '').toUpperCase()
  const country = (row.country ?? '').toUpperCase()
  return (
    exchange.includes('KRX') ||
    exchange.includes('KOSDAQ') ||
    exchange.includes('KOSPI') ||
    country === 'KR' ||
    country === 'KOREA' ||
    country === 'SOUTH KOREA'
  )
}

function isEquityKind(row: { instrument_type?: string; type?: string }): boolean {
  const kind = (row.instrument_type ?? row.type ?? '').trim().toLowerCase()
  if (!kind) return true
  return US_TYPES.has(kind)
}

function keepUsRow(row: { exchange?: string; instrument_type?: string; type?: string }): boolean {
  const exchange = (row.exchange ?? '').trim().toUpperCase()
  if (!US_EXCHANGES.has(exchange)) return false
  return isEquityKind(row)
}

/**
 * Live /symbol_search. No-ops when the universe flag is off, and swallows
 * transport errors so a vendor outage cannot 500 the prompt.
 */
export async function searchUsListings(query: string): Promise<UsListingSearchResult> {
  const q = query.trim()
  if (!q || !stockUniverseDataEnabled()) return { hits: [], koreaOnly: false }
  const key = process.env.TWELVE_DATA_API_KEY?.trim()
  if (!key) return { hits: [], koreaOnly: false }

  const url = `https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(q)}&outputsize=30&apikey=${encodeURIComponent(key)}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return { hits: [], koreaOnly: false }
    const json = (await res.json()) as {
      data?: Array<{
        symbol?: string
        instrument_name?: string
        exchange?: string
        country?: string
        instrument_type?: string
        type?: string
      }>
    }
    return parseSymbolSearchRows(Array.isArray(json.data) ? json.data : [])
  } catch {
    return { hits: [], koreaOnly: false }
  }
}

/** Pure row filter for /symbol_search — exported for tests. */
export function parseSymbolSearchRows(
  rows: Array<{
    symbol?: string
    instrument_name?: string
    exchange?: string
    country?: string
    instrument_type?: string
    type?: string
  }>,
): UsListingSearchResult {
  if (rows.length === 0) return { hits: [], koreaOnly: false }
  const koreaOnly = rows.every((row) => isKoreaRow(row))
  const hits: StockSearchHit[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (!keepUsRow(row)) continue
    const symbol = (row.symbol ?? '').trim().toUpperCase()
    const exchange = (row.exchange ?? '').trim().toUpperCase()
    const name = (row.instrument_name ?? symbol).trim()
    if (!symbol || !exchange || !name) continue
    const id = `${exchange}:${symbol}`
    if (seen.has(id)) continue
    seen.add(id)
    hits.push({
      symbol,
      exchange,
      name,
      instrumentType: (row.instrument_type ?? row.type ?? '').trim(),
    })
    if (hits.length >= 8) break
  }
  const localEquity = rows.some(
    (row) =>
      !isKoreaRow(row) &&
      !US_EXCHANGES.has((row.exchange ?? '').trim().toUpperCase()) &&
      isEquityKind(row),
  )
  return {
    hits,
    koreaOnly: koreaOnly && hits.length === 0,
    nonUsOnly: hits.length === 0 && !koreaOnly && localEquity,
  }
}
