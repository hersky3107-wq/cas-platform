import { isUiHorizon, sessionsForHorizon, type UiHorizon } from './horizon'

/**
 * Closed-book packet assembly — PURE. No fetches, no AI calls.
 *
 * Numbers first, prose last. Every field carries a source + as-of; a failed
 * fetch is rendered as UNAVAILABLE, never omitted, never guessed.
 */

export const PRINTED_SESSION_COUNT = 20
/** Lookback pairs for the base rate (need lookback + horizon bars in the series). */
export const BASE_RATE_LOOKBACK = 1000
/**
 * time_series outputsize: 1000 lookback + 63 (3m equity sessions) + 20 buffer.
 * One Twelve Data credit — same as the previous 10-bar series call.
 */
export const SERIES_OUTPUT_SIZE = 1083

export type SeriesBar = { date: string; close: number }

export type ConsensusSnapshot = {
  fetchedAt: string
  priceTarget:
    | { high: number; median: number; low: number; average: number; current: number | null; currency: string | null }
    | { unavailable: string }
  recommendations:
    | { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number }
    | { unavailable: string }
  lastEarnings:
    | { date: string; actual: number; estimate: number | null; surprisePct: number | null }
    | { unavailable: string }
  latestRating: { date: string; firm: string; rating: string } | { unavailable: string }
  epsTrend: { period: string; currentEstimate: number } | { unavailable: string }
}

export type CryptoSnapshot = {
  fetchedAt: string
  funding: { rate: number; nextFundingTime: string | null } | { unavailable: string }
  openInterest: { contracts: number } | { unavailable: string }
  markIv: { ivPct: number; instrument: string } | { unavailable: string }
}

export type ResearchFinding = { query: string; summary: string }

/**
 * Packet v2 (A): locally computed stats for ONE related series (see
 * `related-stats.ts` for the math and `relations.ts` for the map).
 * The unavailable variant is printed as an UNAVAILABLE line, never dropped.
 */
export type RelatedInstrumentStat =
  | {
      symbol: string
      role: string
      note: string
      lastClose: number
      lastDate: string
      move1dPct: number | null
      corr: { r: number; n: number } | null
      beta: { beta: number; n: number } | null
      leadLag: readonly { lag: number; r: number; n: number }[]
    }
  | { symbol: string; role: string; note: string; unavailable: string }

/**
 * Packet v2 (C): slow-diffusing public datasets. Field semantics:
 *  - `null`            → not applicable to this category (line omitted)
 *  - `{ unavailable }` → applicable but the fetch failed (line printed)
 */
export type SlowDataSnapshot = {
  fetchedAt: string
  shortVolume:
    | { date: string; shortShares: number; totalShares: number; shortPct: number }
    | { unavailable: string }
    | null
  putCall:
    | { date: string; total: number; index: number | null; equity: number | null }
    | { unavailable: string }
    | null
  btcEtfFlow: { date: string; netFlowUsdM: number } | { unavailable: string } | null
  insider:
    | {
        windowDays: number
        buyTxns: number
        buyShares: number
        sellTxns: number
        sellShares: number
        netShares: number
        latestFilingDate: string | null
      }
    | { unavailable: string }
    | null
}

/** Packet v2 (B): a native-language research finding (original + English gloss). */
export type NonEnglishFinding = { lang: string; query: string; summary: string }

export type ClosedBookPacketInput = {
  instrument: string
  category: string
  horizon: string
  series: SeriesBar[]
  seriesSource: string
  seriesAsOf: string | null
  /** Latest close used as the grading baseline (same number persisted as anchor_price). */
  anchorClose: number | null
  anchorSessionDate: string | null
  quoteAsOf: string | null
  consensus: ConsensusSnapshot | null
  crypto: CryptoSnapshot | null
  findings: ResearchFinding[]
  researchCacheKey: string
  assembledAt: string
  /** v2 (A) — cross-asset chain stats; omitted section when null/undefined. */
  related?: readonly RelatedInstrumentStat[] | null
  /** v2 (C) — slow public data; omitted section when null/undefined. */
  slow?: SlowDataSnapshot | null
  /** v2 (B) — shared native-language findings; omitted section when empty. */
  nonEnglishFindings?: readonly NonEnglishFinding[]
  /** v2 (D) — high-tier synthesis; when present it REPLACES prose findings. */
  synthesis?: string | null
}

export type BaseRate = {
  horizon: UiHorizon
  sessionsAhead: number
  lookbackSessions: number
  n: number
  upCount: number
  upPct: number
}

export function computeRealizedVol(closes: number[], window: number): number | null {
  if (closes.length < window + 1) return null
  const slice = closes.slice(-window - 1)
  const rets: number[] = []
  for (let i = 1; i < slice.length; i++) {
    if (slice[i - 1] <= 0 || slice[i] <= 0) continue
    rets.push(Math.log(slice[i] / slice[i - 1]))
  }
  if (rets.length < 5) return null
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length
  const varSum = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1)
  return Math.sqrt(varSum) * Math.sqrt(252)
}

export function computeSma(closes: number[], n: number): number | null {
  if (closes.length < n) return null
  const slice = closes.slice(-n)
  return slice.reduce((a, b) => a + b, 0) / n
}

export function range52w(bars: SeriesBar[]): { high: number; low: number; highDate: string; lowDate: string } | null {
  const window = bars.slice(-252)
  if (window.length < 20) return null
  let high = window[0].close
  let low = window[0].close
  let highDate = window[0].date
  let lowDate = window[0].date
  for (const b of window) {
    if (b.close > high) {
      high = b.close
      highDate = b.date
    }
    if (b.close < low) {
      low = b.close
      lowDate = b.date
    }
  }
  return { high, low, highDate, lowDate }
}

/**
 * Historical frequency that the close `sessionsAhead` bars later was HIGHER.
 * Uses the last `lookback` pairs from `bars` (oldest→newest). Per-horizon:
 * callers MUST pass this round's session count — never reuse a 1d rate for 3m.
 */
export function computeBaseRate(
  bars: SeriesBar[],
  sessionsAhead: number,
  lookback = BASE_RATE_LOOKBACK,
  horizon: UiHorizon = '1d',
): BaseRate | null {
  if (sessionsAhead < 1 || bars.length < sessionsAhead + 2) return null
  const maxPairs = bars.length - sessionsAhead
  const n = Math.min(lookback, maxPairs)
  const start = maxPairs - n
  let upCount = 0
  for (let i = start; i < start + n; i++) {
    if (bars[i + sessionsAhead].close > bars[i].close) upCount += 1
  }
  return {
    horizon,
    sessionsAhead,
    lookbackSessions: n,
    n,
    upCount,
    upPct: (upCount / n) * 100,
  }
}

export function resolveHorizonForRate(horizon: string): UiHorizon {
  return isUiHorizon(horizon) ? horizon : '1d'
}

/** A "numeric fact" is a price, percent, or count — not just a calendar date. */
export function hasNumericFact(text: string): boolean {
  if (/\$[\d]/.test(text)) return true
  if (/\d+\.\d+\s*%/.test(text) || /\d+\s*%/.test(text)) return true
  // Bare numbers that are not years / ISO dates / citation indices.
  const stripped = text
    .replace(/\b20\d{2}(-\d{2}-\d{2})?\b/g, ' ')
    .replace(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/gi, ' ')
    .replace(/\[\d+\]/g, ' ')
  return /\b\d+\.\d+\b/.test(stripped) || /\b\d{2,}\b/.test(stripped)
}

/** Absence-of-news findings (the Aug-24 macro block) cost tokens and add no number. */
export function isAbsenceFinding(text: string): boolean {
  return /no major (?:releases?|announcements?|data|news)/i.test(text)
}

export const MAX_PROSE_FINDINGS = 2
export const MAX_PROSE_CHARS_EACH = 400

/** Cut at the last sentence end within maxChars; else last whitespace; else hard cut. */
export function trimAtSentenceBoundary(text: string, maxChars = MAX_PROSE_CHARS_EACH): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return trimmed
  const slice = trimmed.slice(0, maxChars)
  const sentenceEnd = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '))
  if (sentenceEnd >= Math.floor(maxChars * 0.4)) {
    return slice.slice(0, sentenceEnd + 1).trim()
  }
  const space = slice.lastIndexOf(' ')
  if (space >= Math.floor(maxChars * 0.4)) return slice.slice(0, space).trim()
  return slice.trim()
}

/** Significant numbers for restatement detection (skip lone years / tiny ints). */
export function extractSignificantNumbers(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of text.matchAll(/\d+\.\d+|\d{2,}/g)) {
    const raw = m[0]
    // Skip 4-digit years that dominate date noise.
    if (/^20\d{2}$/.test(raw) || /^19\d{2}$/.test(raw)) continue
    out.add(raw)
  }
  return out
}

/** True when every significant number in the finding already appears in the numeric blocks. */
export function isRestatingNumericBlocks(summary: string, numericNumbers: Set<string>): boolean {
  const found = extractSignificantNumbers(summary)
  if (found.size === 0) return false
  for (const n of found) {
    if (!numericNumbers.has(n)) return false
  }
  return true
}

export function selectProseFindings(
  findings: ResearchFinding[],
  numericBlockText = '',
): ResearchFinding[] {
  const numericNumbers = extractSignificantNumbers(numericBlockText)
  return findings
    .filter((f) => hasNumericFact(f.summary) && !isAbsenceFinding(f.summary))
    .filter((f) => !isRestatingNumericBlocks(f.summary, numericNumbers))
    .slice(0, MAX_PROSE_FINDINGS)
    .map((f) => ({ query: f.query, summary: trimAtSentenceBoundary(f.summary, MAX_PROSE_CHARS_EACH) }))
}

function fmt(n: number, digits = 2): string {
  return Number.isFinite(n) ? n.toFixed(digits) : 'n/a'
}

function pct(n: number): string {
  return `${n >= 0 ? '+' : ''}${fmt(n, 1)}%`
}

function unavailable(label: string, reason: string): string {
  return `${label}: UNAVAILABLE (${reason})`
}

function formatNumericMarket(input: ClosedBookPacketInput): string {
  const bars = input.series
  const closes = bars.map((b) => b.close)
  const last = input.anchorClose
  const asOf = input.seriesAsOf ?? input.quoteAsOf ?? 'unknown'
  const src = input.seriesSource
  const lines: string[] = [
    `NUMERIC MARKET (source: ${src}; as-of ${asOf})`,
  ]

  if (typeof last === 'number') {
    const session = input.anchorSessionDate ?? 'unknown session'
    lines.push(
      `ANCHOR CLOSE (grading baseline — the round is scored against this number): ${fmt(last)} on ${session}`,
    )
  } else {
    lines.push(unavailable('ANCHOR CLOSE (grading baseline)', `${src} returned no last close; as-of ${asOf}`))
  }

  const printed = bars.slice(-PRINTED_SESSION_COUNT)
  if (printed.length) {
    lines.push(`Last ${printed.length} session closes (oldest→newest):`)
    for (const b of printed) lines.push(`  ${b.date}: ${fmt(b.close)}`)
  } else {
    lines.push(unavailable('session closes', `${src} series empty; as-of ${asOf}`))
  }

  const vol = computeRealizedVol(closes, 20)
  lines.push(
    vol == null
      ? unavailable('realized vol (20-session, ann.)', `need ≥21 closes; had ${closes.length}; source ${src}; as-of ${asOf}`)
      : `realized vol (20-session, ann.): ${fmt(vol * 100, 1)}% (source: ${src}; as-of ${asOf})`,
  )

  const r52 = range52w(bars)
  if (r52 && typeof last === 'number') {
    const fromHigh = ((last - r52.high) / r52.high) * 100
    const fromLow = ((last - r52.low) / r52.low) * 100
    lines.push(
      `52w range: ${fmt(r52.low)} (${r52.lowDate}) – ${fmt(r52.high)} (${r52.highDate}); last is ${pct(fromHigh)} from high, ${pct(fromLow)} from low (source: ${src}; as-of ${asOf})`,
    )
  } else {
    lines.push(unavailable('52w high/low', `need ~252 session closes; had ${closes.length}; source ${src}; as-of ${asOf}`))
  }

  const sma20 = computeSma(closes, 20)
  const sma50 = computeSma(closes, 50)
  lines.push(
    sma20 == null
      ? unavailable('SMA20', `need 20 closes; had ${closes.length}; source ${src}; as-of ${asOf}`)
      : `SMA20: ${fmt(sma20)} (source: ${src}; as-of ${asOf})`,
  )
  lines.push(
    sma50 == null
      ? unavailable('SMA50', `need 50 closes; had ${closes.length}; source ${src}; as-of ${asOf}`)
      : `SMA50: ${fmt(sma50)} (source: ${src}; as-of ${asOf})`,
  )

  return lines.join('\n')
}

function formatBaseRate(input: ClosedBookPacketInput): string {
  const h = resolveHorizonForRate(input.horizon)
  const ahead = sessionsForHorizon(input.category, h)
  const rate = computeBaseRate(input.series, ahead, BASE_RATE_LOOKBACK, h)
  const asOf = input.seriesAsOf ?? 'unknown'
  const src = input.seriesSource
  if (!rate) {
    return unavailable(
      `BASE RATE (${h}, ${ahead} session${ahead === 1 ? '' : 's'} ahead)`,
      `need >${ahead} daily bars; had ${input.series.length}; source ${src}; as-of ${asOf}`,
    )
  }
  const unit = ahead === 1 ? '1 session later' : `${ahead} sessions later`
  return [
    `BASE RATE (${h} — ${ahead} session${ahead === 1 ? '' : 's'}, not calendar days)`,
    `over the last ${rate.n} sessions, ${input.instrument} closed higher ${unit} ${fmt(rate.upPct, 1)}% of the time (n=${rate.n}; lookback=${rate.lookbackSessions} pairs; source: ${src}; as-of ${asOf})`,
  ].join('\n')
}

function formatConsensus(c: ConsensusSnapshot | null, instrument: string, last: number | null): string {
  if (!c) {
    return unavailable('CONSENSUS', 'not fetched for this category')
  }
  const asOf = c.fetchedAt
  const lines: string[] = [`CONSENSUS (source: Twelve Data; as-of ${asOf})`]

  if ('unavailable' in c.priceTarget) {
    lines.push(unavailable('price target', `${c.priceTarget.unavailable}; as-of ${asOf}`))
  } else {
    const t = c.priceTarget
    const spread = t.high - t.low
    const vs = last ?? t.current
    const spreadPct = typeof vs === 'number' && vs > 0 ? (spread / vs) * 100 : null
    lines.push(
      `price target: hi ${fmt(t.high)} / median ${fmt(t.median)} / lo ${fmt(t.low)} / avg ${fmt(t.average)}${
        t.currency ? ` ${t.currency}` : ''
      }`,
    )
    lines.push(
      spreadPct == null
        ? `dispersion: range ${fmt(spread)} (median ${fmt(t.median)}; no last price to scale)`
        : `dispersion: range ${fmt(spread)} = ${fmt(spreadPct, 1)}% of last close — analysts disagree (median ${fmt(t.median)}; n=hi/lo/median from /price_target)`,
    )
  }

  if ('unavailable' in c.recommendations) {
    lines.push(unavailable('recommendations', `${c.recommendations.unavailable}; as-of ${asOf}`))
  } else {
    const r = c.recommendations
    lines.push(
      `recommendations (current month): ${r.strongBuy} strong_buy / ${r.buy} buy / ${r.hold} hold / ${r.sell} sell / ${r.strongSell} strong_sell (source: Twelve Data /recommendations; as-of ${asOf})`,
    )
  }

  if ('unavailable' in c.lastEarnings) {
    lines.push(unavailable('last earnings', `${c.lastEarnings.unavailable}; as-of ${asOf}`))
  } else {
    const e = c.lastEarnings
    const surprise = e.surprisePct == null ? 'n/a' : pct(e.surprisePct)
    lines.push(
      `last earnings (${e.date}): actual ${fmt(e.actual)} vs est ${e.estimate == null ? 'n/a' : fmt(e.estimate)} (surprise ${surprise}) (source: Twelve Data /earnings; as-of ${asOf})`,
    )
  }

  if ('unavailable' in c.epsTrend) {
    lines.push(unavailable('eps trend', `${c.epsTrend.unavailable}; as-of ${asOf}`))
  } else {
    lines.push(
      `eps trend ${c.epsTrend.period}: ${fmt(c.epsTrend.currentEstimate, 4)} (source: Twelve Data /eps_trend; as-of ${asOf})`,
    )
  }

  if ('unavailable' in c.latestRating) {
    lines.push(unavailable('latest rating', `${c.latestRating.unavailable}; as-of ${asOf}`))
  } else {
    const r = c.latestRating
    lines.push(`latest rating: ${r.firm} ${r.rating} on ${r.date} (source: Twelve Data /analyst_ratings/light; as-of ${asOf})`)
  }

  void instrument
  return lines.join('\n')
}

function formatCrypto(crypto: CryptoSnapshot | null, wanted: boolean): string {
  if (!wanted) return ''
  if (!crypto) {
    return [
      'CRYPTO POSITIONING',
      unavailable('funding', 'crypto snapshot not assembled'),
      unavailable('open interest', 'crypto snapshot not assembled'),
      unavailable('mark_iv', 'crypto snapshot not assembled'),
    ].join('\n')
  }
  const asOf = crypto.fetchedAt
  const lines: string[] = [`CRYPTO POSITIONING (as-of ${asOf})`]
  if ('unavailable' in crypto.funding) {
    lines.push(unavailable('funding', `${crypto.funding.unavailable}; as-of ${asOf}`))
  } else {
    const next = crypto.funding.nextFundingTime ? `; next ${crypto.funding.nextFundingTime}` : ''
    lines.push(
      `funding: ${fmt(crypto.funding.rate * 100, 4)}% (source: Binance /fapi/v1/premiumIndex; as-of ${asOf}${next})`,
    )
  }
  if ('unavailable' in crypto.openInterest) {
    lines.push(unavailable('open interest', `${crypto.openInterest.unavailable}; as-of ${asOf}`))
  } else {
    lines.push(
      `open interest: ${fmt(crypto.openInterest.contracts, 3)} contracts (source: Binance /fapi/v1/openInterest; as-of ${asOf})`,
    )
  }
  if ('unavailable' in crypto.markIv) {
    lines.push(unavailable('mark_iv', `${crypto.markIv.unavailable}; as-of ${asOf}`))
  } else {
    lines.push(
      `mark_iv: ${fmt(crypto.markIv.ivPct, 2)}% on ${crypto.markIv.instrument} (source: Deribit public/get_book_summary_by_currency; as-of ${asOf})`,
    )
  }
  return lines.join('\n')
}

/** Non-English findings kept in the shared packet (with English gloss). */
export const MAX_NON_ENGLISH_FINDINGS = 3
export const MAX_NON_ENGLISH_CHARS_EACH = 450
/** High-tier research synthesis is trimmed to this budget. */
export const SYNTHESIS_MAX_CHARS = 1400

function signed(n: number, digits = 2): string {
  return `${n >= 0 ? '+' : ''}${fmt(n, digits)}`
}

function formatRelated(related: readonly RelatedInstrumentStat[] | null | undefined): string {
  if (!related || !related.length) return ''
  const lines: string[] = [
    'RELATED INSTRUMENTS (cross-asset chain; corr/beta/lead-lag computed locally from date-aligned daily closes; lead-lag printed only when |r| >= 0.25; source: Twelve Data /time_series)',
  ]
  for (const s of related) {
    const head = `${s.symbol} [${s.role} — ${s.note}]`
    if ('unavailable' in s) {
      lines.push(`  ${unavailable(head, s.unavailable)}`)
      continue
    }
    const move = s.move1dPct == null ? '1d n/a' : `1d ${pct(s.move1dPct)}`
    const corr = s.corr == null ? 'corr20 n/a' : `corr20 ${signed(s.corr.r)} (n=${s.corr.n})`
    const beta = s.beta == null ? 'beta20 n/a' : `beta20 ${signed(s.beta.beta)} (n=${s.beta.n})`
    const lead =
      s.leadLag.length === 0
        ? 'lead-lag: none >= |0.25|'
        : `lead-lag: ${s.leadLag.map((l) => `t-${l.lag} r=${signed(l.r)} (n=${l.n})`).join(', ')}`
    lines.push(`  ${head}: last ${fmt(s.lastClose)} on ${s.lastDate} (${move}); ${corr}; ${beta}; ${lead}`)
  }
  return lines.join('\n')
}

function fmtShares(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

function formatSlowData(slow: SlowDataSnapshot | null | undefined): string {
  if (!slow) return ''
  const lines: string[] = [
    `SLOW PUBLIC DATA (slow-diffusing public datasets; each line names the horizon it informs; as-of ${slow.fetchedAt})`,
  ]
  if (slow.shortVolume) {
    lines.push(
      'unavailable' in slow.shortVolume
        ? `  ${unavailable('short-sale volume', slow.shortVolume.unavailable)}`
        : `  short-sale volume (${slow.shortVolume.date}): short ${fmtShares(slow.shortVolume.shortShares)} / total ${fmtShares(slow.shortVolume.totalShares)} = ${fmt(slow.shortVolume.shortPct, 1)}% short-volume ratio (source: FINRA CNMS daily file; informative horizon: days-weeks)`,
    )
  }
  if (slow.putCall) {
    lines.push(
      'unavailable' in slow.putCall
        ? `  ${unavailable('put/call ratios', slow.putCall.unavailable)}`
        : `  put/call ratios (${slow.putCall.date}): total ${fmt(slow.putCall.total)}${
            slow.putCall.index == null ? '' : ` / index ${fmt(slow.putCall.index)}`
          }${slow.putCall.equity == null ? '' : ` / equity ${fmt(slow.putCall.equity)}`} (source: CBOE daily market statistics; informative horizon: days-weeks)`,
    )
  }
  if (slow.btcEtfFlow) {
    lines.push(
      'unavailable' in slow.btcEtfFlow
        ? `  ${unavailable('BTC spot ETF flows', slow.btcEtfFlow.unavailable)}`
        : `  BTC spot ETF net flow (${slow.btcEtfFlow.date}): ${signed(slow.btcEtfFlow.netFlowUsdM, 1)} US$m (source: Farside Investors; informative horizon: days-weeks)`,
    )
  }
  if (slow.insider) {
    lines.push(
      'unavailable' in slow.insider
        ? `  ${unavailable('insider Form 4', slow.insider.unavailable)}`
        : `  insider Form 4 (SEC EDGAR, trailing ${slow.insider.windowDays}d, open-market P/S only): buys ${slow.insider.buyTxns} txns / ${fmtShares(slow.insider.buyShares)} sh; sells ${slow.insider.sellTxns} txns / ${fmtShares(slow.insider.sellShares)} sh; net ${fmtShares(slow.insider.netShares)} sh${
            slow.insider.latestFilingDate ? `; latest filing ${slow.insider.latestFilingDate}` : ''
          } (source: SEC EDGAR data.sec.gov; informative horizon: weeks-months — weak for 1d)`,
    )
  }
  // Only the header would remain → treat as no section.
  return lines.length > 1 ? lines.join('\n') : ''
}

function formatNonEnglish(findings: readonly NonEnglishFinding[] | undefined): string {
  if (!findings?.length) return ''
  const kept = findings
    .filter((f) => hasNumericFact(f.summary))
    .slice(0, MAX_NON_ENGLISH_FINDINGS)
    .map((f) => ({ ...f, summary: trimAtSentenceBoundary(f.summary, MAX_NON_ENGLISH_CHARS_EACH) }))
  if (!kept.length) return ''
  return [
    'NON-ENGLISH FINDINGS (native-language sources with English gloss; identical block for every closed-book model):',
    ...kept.map((f, i) => `${i + 1}) [${f.lang}] ${f.query}\n   ${f.summary}`),
  ].join('\n')
}

function formatSynthesis(synthesis: string | null | undefined): string {
  const trimmed = synthesis?.trim()
  if (!trimmed) return ''
  return [
    'RESEARCH SYNTHESIS (director decomposition, distilled numbers-first; numeric blocks above are authoritative if they disagree):',
    trimAtSentenceBoundary(trimmed, SYNTHESIS_MAX_CHARS),
  ].join('\n')
}

function formatProse(findings: ResearchFinding[], numericBlockText: string): string {
  const kept = selectProseFindings(findings, numericBlockText)
  // Absent section rather than an empty "none kept" stub — saves tokens and
  // avoids inviting models to invent prose over a blank heading.
  if (!kept.length) return ''
  return [
    'PROSE FINDINGS (demoted; numeric blocks above are authoritative if they disagree):',
    ...kept.map((f, i) => `${i + 1}) ${f.query}\n   ${f.summary}`),
  ].join('\n')
}

/**
 * The exact text closed-book models receive (minus the proposition header /
 * closer, which `buildPrompts` wraps). Persist THIS string.
 */
export function assembleClosedBookInjection(input: ClosedBookPacketInput): string {
  const wantsCrypto = input.category === 'crypto_spot' || input.category === 'crypto_perps' || input.category === 'memecoin'
  const parts = [
    formatNumericMarket(input),
    '',
    formatBaseRate(input),
    '',
    formatConsensus(input.consensus, input.instrument, input.anchorClose),
  ]
  if (wantsCrypto) {
    parts.push('', formatCrypto(input.crypto, true))
  }
  const related = formatRelated(input.related)
  if (related) parts.push('', related)
  const slow = formatSlowData(input.slow)
  if (slow) parts.push('', slow)
  const numericBlockText = parts.join('\n')
  const nonEnglish = formatNonEnglish(input.nonEnglishFindings)
  if (nonEnglish) parts.push('', nonEnglish)
  // High-tier synthesis REPLACES raw prose findings (it already distilled them).
  const synthesis = formatSynthesis(input.synthesis)
  if (synthesis) {
    parts.push('', synthesis)
  } else {
    const prose = formatProse(input.findings, numericBlockText)
    if (prose) parts.push('', prose)
  }
  return parts.join('\n')
}

export function estimatePacketTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
