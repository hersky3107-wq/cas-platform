/**
 * CROWDING & OVERHEATING + BOTH SIDES — computed from numbers the closed-book
 * packet already carries. Pure module, no I/O.
 *
 * Extreme positioning (hot funding, crowded long/short accounts, call-heavy
 * put/call, extreme Fear & Greed, lopsided COT, an overbought run stretched
 * far above its average) is a documented reversal-risk factor. The block flags
 * those extremes and lists the measured factors on each side. It never pads a
 * thin side: if the data points one way, the other side says "none measured".
 *
 * "세력" / manipulation is never asserted — the packet has no order-book depth.
 * Analyst / valuation lines carry no numbers (the rationale must not quote them).
 */
import type { ClosedBookPacketInput, CotPositioning, SeriesBar } from './closed-book-packet'

export const CROWDING_HEADER = 'CROWDING & OVERHEATING (computed from the numbers above; analysis input)'

export const CROWDING_USAGE =
  'HOW TO USE: extreme crowding or overheating raises mean-reversion / reversal risk — weigh it against trend and catalysts. It is a risk factor, not a timing signal: crowded trades can stay crowded, and clear one-way data may still lean heavily. "세력" / manipulation is a hypothesis you may raise, never a fact — this packet has no order-book depth.'

export const BOTH_SIDES_HEADER =
  'BOTH SIDES (real factors from the numbers above only — do not invent balance; an empty side means none was measured)'

export const RSI_OVERBOUGHT = 70
export const RSI_OVERSOLD = 30
/** Stretch vs SMA50 beyond this many 20-session sigmas is overheated / washed out. */
export const STRETCH_SIGMA = 2
export const VOLUME_SPIKE_X = 2
/** Binance funding per 8h, in percent. */
export const FUNDING_HOT_PCT = 0.05
export const FUNDING_EXTREME_PCT = 0.1
export const FUNDING_SHORT_CROWDED_PCT = -0.02
export const LONG_ACCOUNTS_CROWDED_PCT = 65
export const SHORT_ACCOUNTS_CROWDED_PCT = 60
export const FEAR_GREED_EXTREME_GREED = 75
export const FEAR_GREED_EXTREME_FEAR = 25
/** Managed-money long:short at or beyond 4:1 (either way) is crowded. */
export const COT_CROWDED_RATIO = 4
export const EQUITY_PUT_CALL_COMPLACENT = 0.5
export const EQUITY_PUT_CALL_FEARFUL = 0.9
export const TOTAL_PUT_CALL_COMPLACENT = 0.7
export const TOTAL_PUT_CALL_FEARFUL = 1.1
export const VIX_COMPLACENT = 13
export const VIX_FEARFUL = 30
export const SHORT_VOLUME_HEAVY_PCT = 60
export const TRAILING_PE_STRETCHED = 60
export const ETF_FLOW_MATERIAL_USDM = 100

/** Market-wide fear/greed readings flip for these: they rise when equities fall. */
const INVERSE_OR_VOL = new Set(['SPXU', 'SQQQ', 'SH', 'PSQ', 'SDS', 'QID', 'SPDN', 'VIXY', 'UVXY', 'VXX'])

export type CrowdingReport = {
  flags: string[]
  /** Factors for the affirmative side (higher close). */
  up: string[]
  /** Factors for the other side (lower close). */
  down: string[]
}

function fmt(n: number, digits = 2): string {
  return n.toFixed(digits)
}

export function rsi14(closes: readonly number[]): number | null {
  if (closes.length < 15) return null
  const window = closes.slice(-15)
  let gain = 0
  let loss = 0
  for (let i = 1; i < window.length; i++) {
    const d = window[i]! - window[i - 1]!
    if (d >= 0) gain += d
    else loss -= d
  }
  if (gain + loss === 0) return 50
  if (loss === 0) return 100
  const rs = gain / loss
  return 100 - 100 / (1 + rs)
}

function dailyStd(closes: readonly number[], window: number): number | null {
  if (closes.length < window + 1) return null
  const slice = closes.slice(-window - 1)
  const rets: number[] = []
  for (let i = 1; i < slice.length; i++) {
    const prev = slice[i - 1]!
    if (prev <= 0) return null
    rets.push(Math.log(slice[i]! / prev))
  }
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1)
  return Math.sqrt(variance)
}

function priceGauges(bars: readonly SeriesBar[], report: CrowdingReport): void {
  const closes = bars.map((b) => b.close).filter((c) => Number.isFinite(c) && c > 0)
  if (closes.length < 21) return
  const last = closes[closes.length - 1]!
  const chg20 = ((last - closes[closes.length - 21]!) / closes[closes.length - 21]!) * 100
  const rsi = rsi14(closes)
  const sma50 = closes.length >= 50 ? closes.slice(-50).reduce((s, c) => s + c, 0) / 50 : null
  const stretch = sma50 == null ? null : ((last - sma50) / sma50) * 100
  const sd = dailyStd(closes, 20)
  const sigma20 = sd == null ? null : sd * Math.sqrt(20) * 100
  const stretchSigma = stretch != null && sigma20 != null && sigma20 > 0 ? stretch / sigma20 : null

  if (rsi != null && rsi >= RSI_OVERBOUGHT) {
    report.flags.push(`RSI14 ${fmt(rsi, 0)} — overbought (≥${RSI_OVERBOUGHT})`)
    report.down.push(`overbought RSI14 ${fmt(rsi, 0)} — mean-reversion risk`)
  } else if (rsi != null && rsi <= RSI_OVERSOLD) {
    report.flags.push(`RSI14 ${fmt(rsi, 0)} — oversold (≤${RSI_OVERSOLD})`)
    report.up.push(`oversold RSI14 ${fmt(rsi, 0)} — bounce risk`)
  }

  if (stretch != null && stretchSigma != null && Math.abs(stretchSigma) >= STRETCH_SIGMA) {
    const dir = stretch > 0 ? 'above' : 'below'
    report.flags.push(
      `price ${fmt(Math.abs(stretch), 1)}% ${dir} SMA50 ≈ ${fmt(Math.abs(stretchSigma), 1)}σ of a 20-session move — ${stretch > 0 ? 'overheated run' : 'washed-out selloff'}`,
    )
    if (stretch > 0) report.down.push(`stretched ${fmt(stretch, 1)}% above SMA50 (≈${fmt(stretchSigma, 1)}σ)`)
    else report.up.push(`stretched ${fmt(Math.abs(stretch), 1)}% below SMA50 (≈${fmt(Math.abs(stretchSigma), 1)}σ)`)
  }

  if (stretch != null) {
    if (stretch > 0 && chg20 > 0) report.up.push(`above SMA50 with positive 20-session momentum (${fmt(chg20, 1)}%)`)
    else if (stretch < 0 && chg20 < 0) report.down.push(`below SMA50 with negative 20-session momentum (${fmt(chg20, 1)}%)`)
  }

  const withVol = bars.filter((b): b is SeriesBar & { volume: number } => typeof b.volume === 'number' && b.volume > 0)
  if (withVol.length >= 21) {
    const lastBar = withVol[withVol.length - 1]!
    const prevWindow = withVol.slice(-21, -1)
    const avg = prevWindow.reduce((s, b) => s + b.volume, 0) / prevWindow.length
    const ratio = avg > 0 ? lastBar.volume / avg : 0
    if (ratio >= VOLUME_SPIKE_X) {
      const prevClose = withVol[withVol.length - 2]!.close
      const dayUp = lastBar.close >= prevClose
      const blowOff = dayUp && rsi != null && rsi >= RSI_OVERBOUGHT
      report.flags.push(
        `volume ${fmt(ratio, 1)}× 20-session avg on an ${dayUp ? 'up' : 'down'} day${blowOff ? ' into overbought — blow-off risk' : ' — news/climax session'}`,
      )
      if (blowOff) report.down.push('high-volume push into overbought (blow-off risk)')
    }
  }
}

function equityPositioning(input: ClosedBookPacketInput, report: CrowdingReport): void {
  const slow = input.slow
  const last = input.anchorClose
  const c = input.consensus

  if (slow?.shortVolume && !('unavailable' in slow.shortVolume) && slow.shortVolume.shortPct >= SHORT_VOLUME_HEAVY_PCT) {
    report.flags.push(
      `short-sale volume share ${fmt(slow.shortVolume.shortPct, 1)}% (≥${SHORT_VOLUME_HEAVY_PCT}%) — heavy selling pressure, also squeeze fuel if price rises`,
    )
  }

  if (slow?.insider && !('unavailable' in slow.insider)) {
    const i = slow.insider
    if (i.sellTxns >= 5 && i.buyTxns === 0) {
      report.flags.push(`insider cluster selling: ${i.sellTxns} open-market sells, 0 buys in ${i.windowDays}d (weak for 1d; routine sales are common)`)
      report.down.push('insider cluster selling (weeks-months signal)')
    } else if (i.buyTxns >= 2) {
      report.up.push(`insider open-market buying (${i.buyTxns} txns in ${i.windowDays}d)`)
    }
  }

  if (!c) return
  if (c.statistics && !('unavailable' in c.statistics) && c.statistics.pe != null && c.statistics.pe >= TRAILING_PE_STRETCHED) {
    report.flags.push('trailing valuation multiple in the stretched band — priced for continued beats')
    report.down.push('stretched trailing valuation')
  }
  if (!('unavailable' in c.priceTarget) && typeof last === 'number') {
    const t = c.priceTarget
    if (last > t.high) {
      report.flags.push('last close above the highest analyst target — priced beyond every Street estimate')
      report.down.push('trading above the top Street target')
    } else if (last > t.median) {
      report.down.push('trading above the median Street target')
    } else if (last < t.low) {
      report.up.push('trading below the lowest Street target')
    } else if (last < t.median * 0.8) {
      report.up.push('wide gap below the median Street target')
    }
  }
  if (!('unavailable' in c.lastEarnings) && c.lastEarnings.surprisePct != null) {
    if (c.lastEarnings.surprisePct > 0) report.up.push('last earnings beat estimates')
    else if (c.lastEarnings.surprisePct < 0) report.down.push('last earnings missed estimates')
  }
}

function marketWideFear(input: ClosedBookPacketInput, report: CrowdingReport): void {
  const slow = input.slow
  if (!slow) return
  const inverse = INVERSE_OR_VOL.has(input.instrument.trim().toUpperCase())
  const greedSide = inverse ? report.up : report.down
  const fearSide = inverse ? report.down : report.up

  if (slow.putCall && !('unavailable' in slow.putCall)) {
    const p = slow.putCall
    const [value, label, lo, hi] =
      p.equity != null
        ? [p.equity, 'equity', EQUITY_PUT_CALL_COMPLACENT, EQUITY_PUT_CALL_FEARFUL]
        : [p.total, 'total', TOTAL_PUT_CALL_COMPLACENT, TOTAL_PUT_CALL_FEARFUL]
    if (value <= lo) {
      report.flags.push(`market-wide ${label} put/call ${fmt(value)} (≤${fmt(lo)}) — call-heavy complacency`)
      greedSide.push(`call-heavy ${label} put/call (contrarian: crowded upside)`)
    } else if (value >= hi) {
      report.flags.push(`market-wide ${label} put/call ${fmt(value)} (≥${fmt(hi)}) — put-heavy fear`)
      fearSide.push(`put-heavy ${label} put/call (contrarian: washed-out fear)`)
    }
  }
  if (slow.vixcls && !('unavailable' in slow.vixcls)) {
    const v = slow.vixcls.value
    if (v <= VIX_COMPLACENT) {
      report.flags.push(`VIX ${fmt(v)} (≤${VIX_COMPLACENT}) — complacency; downside surprises hit harder`)
      greedSide.push('low VIX complacency')
    } else if (v >= VIX_FEARFUL) {
      report.flags.push(`VIX ${fmt(v)} (≥${VIX_FEARFUL}) — fear spike; capitulation lows cluster here`)
      fearSide.push('VIX fear spike (contrarian)')
    }
  }
}

function cryptoPositioning(input: ClosedBookPacketInput, report: CrowdingReport): void {
  const crypto = input.crypto
  if (crypto && !('unavailable' in crypto.funding)) {
    const pct = crypto.funding.rate * 100
    if (pct >= FUNDING_HOT_PCT) {
      const extreme = pct >= FUNDING_EXTREME_PCT
      report.flags.push(`funding ${fmt(pct, 4)}%/8h — longs paying${extreme ? ' at an extreme' : ''}; long-squeeze risk`)
      report.down.push(`${extreme ? 'extreme' : 'hot'} positive funding (crowded longs)`)
    } else if (pct <= FUNDING_SHORT_CROWDED_PCT) {
      report.flags.push(`funding ${fmt(pct, 4)}%/8h — shorts paying; short-squeeze fuel`)
      report.up.push('negative funding (crowded shorts)')
    }
  }
  const slow = input.slow
  if (!slow) return
  if (slow.topTraderLs && !('unavailable' in slow.topTraderLs)) {
    const t = slow.topTraderLs
    const longPct =
      t.longAccountPct ?? (t.longShortRatio != null ? (t.longShortRatio / (1 + t.longShortRatio)) * 100 : null)
    if (longPct != null && longPct >= LONG_ACCOUNTS_CROWDED_PCT) {
      report.flags.push(`top-trader accounts ${fmt(longPct, 1)}% long — crowded long`)
      report.down.push('crowded long top-trader accounts')
    } else if (longPct != null && 100 - longPct >= SHORT_ACCOUNTS_CROWDED_PCT) {
      report.flags.push(`top-trader accounts ${fmt(100 - longPct, 1)}% short — crowded short`)
      report.up.push('crowded short top-trader accounts (squeeze fuel)')
    }
  }
  if (slow.takerRatio && !('unavailable' in slow.takerRatio) && slow.takerRatio.buySellRatio != null) {
    const r = slow.takerRatio.buySellRatio
    if (r >= 1.2) report.up.push(`aggressive taker buying (buy/sell ${fmt(r, 2)})`)
    else if (r <= 0.8) report.down.push(`aggressive taker selling (buy/sell ${fmt(r, 2)})`)
  }
  if (slow.fearGreed && !('unavailable' in slow.fearGreed)) {
    const v = slow.fearGreed.latest.value
    if (v >= FEAR_GREED_EXTREME_GREED) {
      report.flags.push(`Fear & Greed ${fmt(v, 0)} — extreme greed (market-wide)`)
      report.down.push('extreme greed sentiment (contrarian)')
    } else if (v <= FEAR_GREED_EXTREME_FEAR) {
      report.flags.push(`Fear & Greed ${fmt(v, 0)} — extreme fear (market-wide)`)
      report.up.push('extreme fear sentiment (contrarian)')
    }
  }
  for (const [label, flow] of [
    ['BTC spot ETF', slow.btcEtfFlow],
    ['ETH spot ETF', slow.ethEtfFlow],
  ] as const) {
    if (!flow || 'unavailable' in flow || Math.abs(flow.netFlowUsdM) < ETF_FLOW_MATERIAL_USDM) continue
    if (flow.netFlowUsdM > 0) report.up.push(`${label} net inflow ${fmt(flow.netFlowUsdM, 0)} US$m`)
    else report.down.push(`${label} net outflow ${fmt(Math.abs(flow.netFlowUsdM), 0)} US$m`)
  }
}

function cotLine(label: string, cot: CotPositioning | null | undefined): string | null {
  if (!cot || 'unavailable' in cot) return null
  const long = cot.managedMoneyLong
  const short = cot.managedMoneyShort
  if (long <= 0 && short <= 0) return null
  const ofOi = cot.openInterest > 0 ? ` (net ${fmt((cot.managedMoneyNet / cot.openInterest) * 100, 1)}% of OI)` : ''
  if (short === 0 || long / Math.max(short, 1) >= COT_CROWDED_RATIO) {
    return `${label}: speculators ${short === 0 ? 'all' : `${fmt(long / short, 1)}:1`} long${ofOi} — crowded long; unwind risk for this contract`
  }
  if (long === 0 || short / Math.max(long, 1) >= COT_CROWDED_RATIO) {
    return `${label}: speculators ${long === 0 ? 'all' : `${fmt(short / long, 1)}:1`} short${ofOi} — crowded short; short-covering risk for this contract`
  }
  return null
}

function cotPositioning(input: ClosedBookPacketInput, report: CrowdingReport): void {
  const s = input.slow
  if (!s) return
  const rows: Array<[string, CotPositioning | null | undefined]> = [
    ['COT gold', s.cotGold],
    ['COT silver', s.cotSilver],
    ['COT platinum', s.cotPlatinum],
    ['COT palladium', s.cotPalladium],
    ['COT WTI', s.cotWti],
    ['COT Brent', s.cotBrent],
    ['COT natural gas', s.cotNatgas],
    ['COT copper', s.cotCopper],
    ['COT corn', s.cotCorn],
    ['COT wheat', s.cotWheat],
    ['COT soybean', s.cotSoybean],
    ['COT coffee', s.cotCoffee],
    ['COT euro FX', s.cotEur],
    ['COT yen', s.cotJpy],
    ['COT sterling', s.cotGbp],
    ['COT Australian dollar', s.cotAud],
    ['COT USD index', s.cotDxy],
    ['COT E-mini S&P 500', s.cotEs],
    ['COT Nasdaq mini', s.cotNq],
    ['COT Dow', s.cotYm],
    ['COT Nikkei', s.cotNikkei],
    ['COT VIX futures', s.cotVix],
  ]
  let any = false
  for (const [label, cot] of rows) {
    if (cot && !('unavailable' in cot)) any = true
    const line = cotLine(label, cot)
    if (line) report.flags.push(line)
  }
  if (any) {
    report.flags.push(
      'COT note: managed-money / leveraged-funds only — commercial hedger positions are not in this feed; 3y managed-money percentile is on the COT line when history loaded. Map the contract to this instrument\'s direction yourself (an FX leg can be the quote currency).',
    )
  }
}

export function computeCrowding(input: ClosedBookPacketInput): CrowdingReport {
  const report: CrowdingReport = { flags: [], up: [], down: [] }
  priceGauges(input.series, report)
  if (input.category === 'stock') equityPositioning(input, report)
  if (input.category === 'stock' || input.category === 'etf_index') marketWideFear(input, report)
  if (input.category === 'crypto_spot' || input.category === 'crypto_perps' || input.category === 'memecoin') {
    cryptoPositioning(input, report)
  }
  cotPositioning(input, report)
  return report
}

/** Empty string when the packet has neither a usable series nor any positioning data. */
export function formatCrowding(input: ClosedBookPacketInput): string {
  const usableCloses = input.series.filter((b) => Number.isFinite(b.close) && b.close > 0).length
  if (usableCloses < 21 && !input.slow && !input.crypto) return ''
  const r = computeCrowding(input)
  const lines = [CROWDING_HEADER, CROWDING_USAGE]
  if (r.flags.length) {
    lines.push('flags:', ...r.flags.map((f) => `  - ${f}`))
  } else {
    lines.push('flags: none measured — no crowding or overheating extreme in this packet; do not invent one.')
  }
  lines.push(
    BOTH_SIDES_HEADER,
    `  argues higher close: ${r.up.length ? r.up.join('; ') : 'none measured'}`,
    `  argues lower close: ${r.down.length ? r.down.join('; ') : 'none measured'}`,
  )
  return lines.join('\n')
}

/** The crowding section of a persisted closed-book packet, or null. */
export function extractCrowdingBlock(packetText: string | null | undefined): string | null {
  if (!packetText) return null
  const start = packetText.indexOf(CROWDING_HEADER)
  if (start < 0) return null
  const end = packetText.indexOf('\n\n', start)
  return packetText.slice(start, end < 0 ? undefined : end).trim()
}
