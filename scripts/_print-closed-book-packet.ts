/**
 * Print full closed-book injection for AAPL 1d + UNAVAILABLE failure sims.
 * Run: npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/_print-closed-book-packet.ts
 */
import { fetchDataPacket, sessionDateForPrice } from '../lib/league/market-data'
import { fetchMarketConsensus, wantsConsensus } from '../lib/league/market-context'
import { getResearchPacket } from '../lib/league/research'
import {
  assembleClosedBookInjection,
  estimatePacketTokens,
  type ClosedBookPacketInput,
  type ConsensusSnapshot,
  type CryptoSnapshot,
} from '../lib/league/closed-book-packet'

async function main() {
  const instrument = 'AAPL'
  const category = 'stock'
  const horizon = '1d'
  const packet = await fetchDataPacket(instrument)
  if (!packet.available) throw new Error(`packet unavailable: ${packet.error}`)

  const research = await getResearchPacket({
    round: {
      instrument,
      category,
      proposition_text: `Will ${instrument} close higher by tomorrow than its last close?`,
      horizon,
      resolution_rule: 'NASDAQ regular-session close price vs prior close',
      resolves_at: new Date(Date.now() + 86_400_000).toISOString(),
    },
    budgetRemainingUsd: 1,
  })

  const consensus = wantsConsensus(category) && packet.symbol ? await fetchMarketConsensus(packet.symbol) : null
  const series = packet.series ?? []
  const anchorClose = typeof packet.latestClose === 'number' ? packet.latestClose : null
  const input: ClosedBookPacketInput = {
    instrument,
    category,
    horizon,
    series,
    seriesSource: 'Twelve Data /time_series+quote',
    seriesAsOf: packet.asOf ?? series[series.length - 1]?.date ?? null,
    anchorClose,
    anchorSessionDate: anchorClose != null ? sessionDateForPrice(packet, anchorClose) : null,
    quoteAsOf: packet.asOf ?? null,
    consensus,
    crypto: null,
    findings: research.findings,
    researchCacheKey: research.cacheKey,
    assembledAt: new Date().toISOString(),
  }

  const text = assembleClosedBookInjection(input)
  console.log('===== FULL CLOSED-BOOK PACKET (AAPL 1d) — START =====')
  console.log(text)
  console.log('===== FULL CLOSED-BOOK PACKET (AAPL 1d) — END =====')
  console.log(
    JSON.stringify({
      chars: text.length,
      tokensApprox: estimatePacketTokens(text),
      researchCached: research.cached,
      researchCostUsd: research.costUsd,
      seriesBars: series.length,
      findingsKeptHint: (text.match(/^PROSE FINDINGS/m) && !text.includes('none kept')) || false,
    }),
  )

  // (4) UNAVAILABLE sims
  const failedConsensus: ConsensusSnapshot = {
    fetchedAt: new Date().toISOString(),
    priceTarget: { unavailable: 'Twelve Data /price_target: HTTP 429 rate limit' },
    recommendations: { unavailable: 'Twelve Data /recommendations: HTTP 429 rate limit' },
    lastEarnings: { unavailable: 'Twelve Data /earnings: HTTP 429 rate limit' },
    latestRating: { unavailable: 'Twelve Data /analyst_ratings/light: HTTP 429 rate limit' },
    epsTrend: { unavailable: 'Twelve Data /eps_trend: HTTP 429 rate limit' },
  }
  const failedCrypto: CryptoSnapshot = {
    fetchedAt: new Date().toISOString(),
    funding: { unavailable: 'Binance /fapi/v1/premiumIndex: HTTP 500' },
    openInterest: { unavailable: 'Binance /fapi/v1/openInterest: timeout after 12000ms' },
    markIv: { unavailable: 'Deribit book_summary: connection refused' },
  }

  const consensusFail = assembleClosedBookInjection({ ...input, consensus: failedConsensus })
  const consSection = consensusFail.slice(consensusFail.indexOf('CONSENSUS'), consensusFail.indexOf('PROSE FINDINGS'))
  console.log('\n===== CONSENSUS FAILURE SECTION — START =====')
  console.log(consSection.trim())
  console.log('===== CONSENSUS FAILURE SECTION — END =====')

  const cryptoFail = assembleClosedBookInjection({
    ...input,
    instrument: 'BTC/USD',
    category: 'crypto_spot',
    consensus: null,
    crypto: failedCrypto,
  })
  const cryptoSection = cryptoFail.slice(cryptoFail.indexOf('CRYPTO POSITIONING'), cryptoFail.indexOf('PROSE FINDINGS'))
  console.log('\n===== CRYPTO FAILURE SECTION — START =====')
  console.log(cryptoSection.trim())
  console.log('===== CRYPTO FAILURE SECTION — END =====')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
