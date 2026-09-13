/**
 * Gold 1d closed-book packet WITHOUT model calls.
 * Twelve Data (series + related) + free metals feeds only. Research findings = [].
 *
 * Run: npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/print-gold-packet.ts
 */
import { fetchDataPacket, sessionDateForPrice } from '../lib/league/market-data'
import { fetchRelatedInstruments } from '../lib/league/related-instruments'
import { fetchSlowData } from '../lib/league/slow-data'
import { buildCatalogRankedRoundInput, PUBLIC_CATALOG } from '../lib/league/catalog'
import {
  assembleClosedBookInjection,
  estimatePacketTokens,
  type ClosedBookPacketInput,
} from '../lib/league/closed-book-packet'
import { LEAGUE_ROSTER } from '../lib/league/roster'

async function main() {
  const now = new Date()
  const seed = buildCatalogRankedRoundInput('XAU/USD', '1d', now)
  if (!seed) throw new Error('XAU/USD is not in the public catalog')

  const gold = PUBLIC_CATALOG.find((c) => c.id === 'gold_metals')
  console.log('===== GOLD_METALS CATALOG =====')
  console.log(JSON.stringify(gold?.instruments.map((i) => i.instrument)))

  const t0 = Date.now()
  const packet = await fetchDataPacket(seed.instrument)
  if (!packet.available) throw new Error(`packet unavailable: ${packet.error}`)
  const tQuote = Date.now()

  const related = await fetchRelatedInstruments(seed.instrument, packet.series ?? [])
  const tRelated = Date.now()
  const slow = await fetchSlowData({ category: seed.category, symbol: packet.symbol })
  const tSlow = Date.now()

  const series = packet.series ?? []
  const anchorClose = typeof packet.latestClose === 'number' ? packet.latestClose : null
  const base: ClosedBookPacketInput = {
    instrument: seed.instrument,
    category: seed.category,
    horizon: seed.horizon,
    series,
    seriesSource: 'Twelve Data /time_series+quote',
    seriesAsOf: packet.asOf ?? series[series.length - 1]?.date ?? null,
    anchorClose,
    anchorSessionDate: anchorClose != null ? sessionDateForPrice(packet, anchorClose) : null,
    quoteAsOf: packet.asOf ?? null,
    consensus: null,
    crypto: null,
    findings: [],
    researchCacheKey: 'rp_v4|XAU/USD|1d|print|no-models',
    assembledAt: now.toISOString(),
  }

  const withoutMetals = assembleClosedBookInjection(base)
  const withMetals = assembleClosedBookInjection({
    ...base,
    related: related?.stats ?? null,
    slow,
  })

  console.log('\n===== GOLD 1d PACKET (no model calls) — VERBATIM START =====')
  console.log(withMetals)
  console.log('===== GOLD 1d PACKET (no model calls) — VERBATIM END =====\n')

  const baseRate = withMetals
    .split('\n')
    .filter((l) => l.startsWith('BASE RATE') || l.startsWith('over the last') || l.startsWith('NOTE:'))
    .join('\n')
  console.log('===== BASE RATE LINES =====')
  console.log(baseRate)

  const closedBook = LEAGUE_ROSTER.filter((m) => m.league_tier !== 'scout')
  const inputPriceSumPerMTok = closedBook.reduce((s, m) => s + m.price.inputPerMTokens, 0)
  const v0 = estimatePacketTokens(withoutMetals)
  const v1 = estimatePacketTokens(withMetals)
  const deltaTokens = v1 - v0
  const deltaInputCost34x = (deltaTokens * inputPriceSumPerMTok) / 1_000_000

  console.log(
    JSON.stringify(
      {
        proposition: seed.proposition_text,
        resolves_at: seed.resolves_at,
        seriesBars: series.length,
        relatedStats: related?.stats.length ?? 0,
        relatedCreditsSpent: related?.creditsSpent ?? 0,
        twelveDataCreditsThisRound: 2 + (related?.creditsSpent ?? 0),
        timingsMs: { quoteAndSeries: tQuote - t0, related: tRelated - tQuote, slow: tSlow - tRelated },
        tokens: { withoutRelatedSlow: v0, withRelatedSlow: v1, delta: deltaTokens },
        closedBookModels: closedBook.length,
        inputPriceSumPerMTok: Number(inputPriceSumPerMTok.toFixed(2)),
        relatedSlowInputCostAtClosedBook: Number(deltaInputCost34x.toFixed(4)),
        researchModelCalls: 0,
        researchCostUsd: 0,
      },
      null,
      2,
    ),
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
