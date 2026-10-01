/**
 * STOCK:{exchange}:{symbol}
 *
 * Resolved US listing identity persisted on the round the same way
 * MATCH: / ELECTION: / SHOW: / PROPERTY: persist theirs. Catalog flagships
 * (AAPL, NVDA, TSLA) stay plain tickers so existing rounds keep grading.
 * expected_name is written into resolution_rule — the instrument id cannot
 * carry a display name that itself contains colons.
 */

import { cacheBucketFor, computeResolvesAt, tradingApproximationNote, type UiHorizon } from '../../horizon'
import type { CatalogRankedRoundInput } from '../../catalog'

export type StockParts = {
  exchange: string
  symbol: string
}

const SYMBOL_RE = /^[A-Z.]{1,6}$/

/** NYSE / NASDAQ and the ADR venues Twelve Data labels on those tapes. */
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

export function isUsListingExchange(exchange: string): boolean {
  return US_EXCHANGES.has(exchange.trim().toUpperCase())
}

export function encodeStockInstrument(args: { exchange: string; symbol: string }): string | null {
  const exchange = args.exchange.trim().toUpperCase()
  const symbol = args.symbol.trim().toUpperCase()
  if (!isUsListingExchange(exchange) || !SYMBOL_RE.test(symbol)) return null
  return `STOCK:${exchange}:${symbol}`
}

export function decodeStockInstrument(instrument: string | null | undefined): StockParts | null {
  if (!instrument) return null
  const parts = instrument.split(':')
  if (parts.length !== 3 || parts[0] !== 'STOCK') return null
  const exchange = (parts[1] ?? '').trim().toUpperCase()
  const symbol = (parts[2] ?? '').trim().toUpperCase()
  if (!isUsListingExchange(exchange) || !SYMBOL_RE.test(symbol)) return null
  return { exchange, symbol }
}

/** Plain ticker the quote/series/analyst call will use once Ultra is on. */
export function stockQuoteSymbol(instrument: string): string {
  return decodeStockInstrument(instrument)?.symbol ?? instrument.trim()
}

export function stockChipLabel(instrument: string): string | null {
  const parts = decodeStockInstrument(instrument)
  if (!parts) return null
  return `${parts.symbol} · ${parts.exchange}`
}

/**
 * Korean listings typed into the global lane. They are not opened as US
 * tickers (symbol_search on "Samsung" returns 005930.KRX).
 */
export function mentionsKoreaListing(raw: string): boolean {
  const compact = raw.replace(/\s+/g, '')
  if (compact.includes('삼성전자') || compact.includes('삼전') || compact.includes('005930')) return true
  if (/\bsamsung\b/i.test(raw)) return true
  if (/^\d{6}(\.(ks|kq))?$/i.test(raw.trim())) return true
  return false
}

/**
 * Local non-US tickers (TSE 7203, TWSE 2330, HKEX 0700, or with a venue
 * suffix). v1 opens the US-listed ADR instead. Korean 6-digit codes are
 * caught by `mentionsKoreaListing` first.
 */
export function mentionsLocalNonUsListing(raw: string): boolean {
  const t = raw.trim()
  if (/^\d{4,5}$/.test(t)) return true
  return /\b\d{3,6}\.(T|TW|TWO|HK|SS|SZ|L|PA|DE)\b/i.test(t)
}

/**
 * Names → US-tape ticker. /symbol_search matches Latin text only, and name
 * queries rank local warrants above the ADR ("Taiwan Semiconductor" never
 * reaches TSM), so known names search by ticker.
 */
const NAME_TICKER_ALIASES: Record<string, string> = {
  마이크로소프트: 'MSFT',
  마소: 'MSFT',
  아마존: 'AMZN',
  구글: 'GOOGL',
  알파벳: 'GOOGL',
  메타: 'META',
  넷플릭스: 'NFLX',
  팔란티어: 'PLTR',
  브로드컴: 'AVGO',
  인텔: 'INTC',
  퀄컴: 'QCOM',
  마이크론: 'MU',
  코카콜라: 'KO',
  디즈니: 'DIS',
  나이키: 'NKE',
  스타벅스: 'SBUX',
  코스트코: 'COST',
  월마트: 'WMT',
  일라이릴리: 'LLY',
  화이자: 'PFE',
  보잉: 'BA',
  오라클: 'ORCL',
  세일즈포스: 'CRM',
  어도비: 'ADBE',
  코인베이스: 'COIN',
  아이온큐: 'IONQ',
  대만반도체: 'TSM',
  tsmc: 'TSM',
  'taiwan semiconductor': 'TSM',
  도요타: 'TM',
  토요타: 'TM',
  소니: 'SONY',
  알리바바: 'BABA',
  바이두: 'BIDU',
  니오: 'NIO',
  에이에스엠엘: 'ASML',
}

const SEARCH_STOP = new Set([
  'will',
  'it',
  'is',
  'be',
  'go',
  'by',
  'next',
  'this',
  'rise',
  'fall',
  'close',
  'higher',
  'lower',
  'stock',
  'stocks',
  'share',
  'shares',
  'price',
  'the',
  'and',
  'tomorrow',
  'today',
  'day',
  'days',
  'week',
  'weeks',
  'month',
  'months',
  'quarter',
  'quarters',
  'up',
  'down',
  'after',
  'before',
  'end',
  'year',
  'years',
  'earnings',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'one',
  'two',
  'three',
])

/**
 * /symbol_search query: a known name alias (→ ticker), else an all-caps
 * ticker-looking token, else the remaining Latin words as one phrase
 * ("Hon Hai"). Null when nothing searchable is left.
 */
export function equitySearchQuery(raw: string): string | null {
  const compact = raw.replace(/\s+/g, '').toLowerCase()
  const aliasKeys = Object.keys(NAME_TICKER_ALIASES).sort((a, b) => b.length - a.length)
  for (const key of aliasKeys) {
    if (compact.includes(key.replace(/\s+/g, '').toLowerCase())) return NAME_TICKER_ALIASES[key]!
  }
  const latin = (raw.match(/[A-Za-z][A-Za-z0-9.&-]*/g) ?? []).filter(
    (t) => t.length >= 2 && !SEARCH_STOP.has(t.toLowerCase()),
  )
  if (latin.length === 0) return null
  const ticker = latin.find((t) => /^[A-Z][A-Z.]{1,5}$/.test(t))
  if (ticker) return ticker
  return latin.slice(0, 3).join(' ')
}

/**
 * Always-run Perplexity seeds for a stock round (on top of the research
 * director's gap queries): news, catalysts, earnings tone, overheating /
 * positioning, Street views, and Korean retail flow (서학개미 수급).
 */
export function stockAugmentationQueries(args: { instrument: string; category: string }): { q: string; lang: string }[] {
  if (args.category !== 'stock') return []
  const symbol = stockQuoteSymbol(args.instrument).toUpperCase()
  if (!symbol) return []
  return [
    { q: `${symbol} stock latest news and catalysts this week (product, regulatory, macro, guidance)`, lang: 'en' },
    { q: `${symbol} most recent earnings call: guidance change, beat/miss, management tone, post-earnings drift`, lang: 'en' },
    { q: `${symbol} upcoming catalysts dates: next earnings date, investor day, product launch, index rebalance, lockup`, lang: 'en' },
    { q: `${symbol} overbought or oversold now: RSI, distance from 50/200-day average, unusual options activity, short interest change`, lang: 'en' },
    { q: `${symbol} analyst upgrades downgrades and price target changes in the last two weeks`, lang: 'en' },
    { q: `${symbol} 서학개미 순매수 순매도 수급 최근 동향`, lang: 'ko' },
  ]
}

export function buildStockRankedRoundInput(
  instrument: string,
  uiHorizon: UiHorizon,
  now: Date = new Date(),
  expectedName?: string | null,
): CatalogRankedRoundInput | null {
  const parts = decodeStockInstrument(instrument)
  if (!parts) return null
  const bucket = cacheBucketFor(uiHorizon, now)
  const resolvesAt = computeResolvesAt('stock', uiHorizon, now.toISOString(), parts.symbol)
  const resolveDate = resolvesAt.slice(0, 10)
  const note = tradingApproximationNote('stock', uiHorizon, parts.symbol)
  const name = (expectedName ?? parts.symbol).replace(/[\r\n]/g, ' ').trim().slice(0, 80) || parts.symbol
  const proposition_text = `Will ${parts.symbol} close higher by ${resolveDate} than its last close?${
    note ? ` (${resolveDate} ${note}.)` : ''
  }`
  return {
    proposition_text,
    category: 'stock',
    instrument,
    horizon: uiHorizon,
    resolution_rule: `${parts.exchange} regular-session close. Identity: ${name}.`,
    resolves_at: resolvesAt,
    item_type: 'ranked',
    cache_key: `daily|${instrument}|${uiHorizon}|${bucket}`,
  }
}

/**
 * Deterministic parser for stock lane time horizons from freeform user queries.
 *
 * Supported mappings:
 *   1d: 내일 / 오늘 / 하루 / 1일 / 익일 / 당일 / today / tomorrow / 1d / 1 day / 24h
 *   1w: 다음주 / 다음 주 / 일주일 / 1주일 / 1주 / 이번주 / 이번 주 / 한주 / 한 주 / next week / this week / 1w / 1 week / 7d
 *   1m: 한달 / 한 달 / 1달 / 1개월 / 일개월 / 다음달 / 다음 달 / 이번달 / 이번 달 / next month / this month / 1m / 1 month / 30d
 *   3m: 3개월 / 삼개월 / 3달 / 세달 / 세 달 / 석달 / 석 달 / 분기 / 이번 분기 / 다음 분기 / 1분기 / 3m / 3 months / quarter / 1 quarter / 90d
 *
 * Safeguards:
 *   - Standalone "3m" / "mmm" query (just the company 3M / MMM) is NOT parsed as horizon.
 *   - Korean calendar dates like "10월 1일" do NOT match "1일".
 *   - Words like "하루종일" or "분기점" do NOT match "하루" or "분기".
 */
export function parseStockHorizonFromQuery(raw: string): UiHorizon | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  // Standalone "3M" or "MMM" is a company/ticker query, not a horizon.
  if (/^(3m|mmm)$/i.test(trimmed)) return null

  // 1. Check 3 months / quarter
  // Korean: 3개월, 삼개월, 3달, 세달, 석달, 이번 분기, 다음 분기, 분기 (excluding 분기점/분기별)
  const ko3m = /(?<![가-힣0-9])(?:3|삼|세|석)\s*(?:개월|달)(?![가-힣])|(?<![가-힣])(?:이번|다음|올|1|한)?\s*분기(?![가-힣0-9])/i
  // English: 3m, 3 months, 3 month, three months, quarter, next quarter, 90d
  const en3m = /\b(?:3\s*m(?:onths?)?|three\s*months?|(?:this\s*|next\s*|1\s*)?quarter|90\s*d(?:ays?)?)\b/i
  if (ko3m.test(trimmed) || en3m.test(trimmed)) return '3m'

  // 2. Check 1 month
  // Korean: 1개월, 일개월, 1달, 한달, 한 달, 이번달, 다음달
  const ko1m = /(?<![가-힣0-9])(?:1|일)\s*개월(?![가-힣])|(?<![가-힣0-9])(?:1|한)\s*달(?![가-힣])|(?<![가-힣])(?:이번|다음)\s*달(?![가-힣])/i
  // English: 1m, 1 month, one month, this month, next month, 30d
  const en1m = /\b(?:1\s*m(?:onths?)?|one\s*month|(?:this\s*|next\s*)month|30\s*d(?:ays?)?)\b/i
  if (ko1m.test(trimmed) || en1m.test(trimmed)) return '1m'

  // 3. Check 1 week
  // Korean: 다음주, 이번주, 1주일, 일주일, 1주, 한주, 한 주
  const ko1w = /(?<![가-힣])(?:다음|이번)\s*주(?![가-힣])|(?<![가-힣0-9])(?:1|일)\s*주일(?![가-힣])|(?<![가-힣0-9])(?:1|한)\s*주(?:간)?(?![가-힣0-9])/i
  // English: 1w, 1 week, one week, this week, next week, 7d
  const en1w = /\b(?:1\s*w(?:eeks?)?|one\s*week|(?:this\s*|next\s*)week|7\s*d(?:ays?)?)\b/i
  if (ko1w.test(trimmed) || en1w.test(trimmed)) return '1w'

  // 4. Check 1 day
  // Korean: 내일, 오늘, 하루, 익일, 당일, 1일 (guarding against calendar dates like 10월 1일)
  const ko1d = /(?<![가-힣])(?:내일|오늘|하루|익일|당일)(?![가-힣])|(?<!\d\s*월\s*|[\d])1\s*일(?![0-9가-힣])/i
  // English: 1d, 1 day, one day, today, tomorrow, 24h
  const en1d = /\b(?:1\s*d(?:ays?)?|one\s*day|today|tomorrow|24\s*h(?:ours?)?)\b/i
  if (ko1d.test(trimmed) || en1d.test(trimmed)) return '1d'

  return null
}

const ALL_HORIZON_RES: readonly RegExp[] = [
  // 3m
  /(?<![가-힣0-9])(?:3|삼|세|석)\s*(?:개월|달)(?![가-힣])/gi,
  /(?<![가-힣])(?:이번|다음|올|1|한)?\s*분기(?![가-힣0-9])/gi,
  /\b(?:3\s*m(?:onths?)?|three\s*months?|(?:this\s*|next\s*|1\s*)?quarter|90\s*d(?:ays?)?)\b/gi,
  // 1m
  /(?<![가-힣0-9])(?:1|일)\s*개월(?![가-힣])/gi,
  /(?<![가-힣0-9])(?:1|한)\s*달(?![가-힣])/gi,
  /(?<![가-힣])(?:이번|다음)\s*달(?![가-힣])/gi,
  /\b(?:1\s*m(?:onths?)?|one\s*month|(?:this\s*|next\s*)month|30\s*d(?:ays?)?)\b/gi,
  // 1w
  /(?<![가-힣])(?:다음|이번)\s*주(?![가-힣])/gi,
  /(?<![가-힣0-9])(?:1|일)\s*주일(?![가-힣])/gi,
  /(?<![가-힣0-9])(?:1|한)\s*주(?:간)?(?![가-힣0-9])/gi,
  /\b(?:1\s*w(?:eeks?)?|one\s*week|(?:this\s*|next\s*)week|7\s*d(?:ays?)?)\b/gi,
  // 1d
  /(?<![가-힣])(?:내일|오늘|하루|익일|당일)(?![가-힣])/gi,
  /(?<!\d\s*월\s*|[\d])1\s*일(?![0-9가-힣])/gi,
  /\b(?:1\s*d(?:ays?)?|one\s*day|today|tomorrow|24\s*h(?:ours?)?)\b/gi,
]

export function stripStockHorizonFromQuery(raw: string): string {
  const trimmed = raw.trim()
  if (/^(3m|mmm)$/i.test(trimmed)) return raw
  let cleaned = raw
  for (const re of ALL_HORIZON_RES) {
    cleaned = cleaned.replace(re, ' ')
  }
  return cleaned.replace(/\s+/g, ' ').trim()
}
