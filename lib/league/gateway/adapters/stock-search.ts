/**
 * Twelve Data /symbol_search for the global lane.
 *
 * Wired now, inert until Ultra. Set TWELVE_DATA_STOCK_UNIVERSE=ultra
 * (or 1 / true) after the plan is purchased. Until then this returns no
 * hits and does not call the network. Quote + series + the analyst
 * 5-pack use the same flag in the stocks adapter packet path.
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
  const flag = (process.env.TWELVE_DATA_STOCK_UNIVERSE ?? '').trim().toLowerCase()
  return flag === 'ultra' || flag === '1' || flag === 'true'
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

function keepUsRow(row: { exchange?: string; instrument_type?: string; type?: string }): boolean {
  const exchange = (row.exchange ?? '').trim().toUpperCase()
  if (!US_EXCHANGES.has(exchange)) return false
  const kind = (row.instrument_type ?? row.type ?? '').trim().toLowerCase()
  if (!kind) return true
  return US_TYPES.has(kind)
}

/**
 * Live /symbol_search. No-ops unless the Ultra flag is on, and swallows
 * transport errors so a missing plan cannot 500 the prompt.
 */
export async function searchUsListings(query: string): Promise<UsListingSearchResult> {
  const q = query.trim()
  if (!q || !stockUniverseDataEnabled()) return { hits: [], koreaOnly: false }
  const key = process.env.TWELVE_DATA_API_KEY?.trim()
  if (!key) return { hits: [], koreaOnly: false }

  const url = `https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(q)}&outputsize=20&apikey=${encodeURIComponent(key)}`
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
    const rows = Array.isArray(json.data) ? json.data : []
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
    return { hits, koreaOnly: koreaOnly && hits.length === 0 }
  } catch {
    return { hits: [], koreaOnly: false }
  }
}
