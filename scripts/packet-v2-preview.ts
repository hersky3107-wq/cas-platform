/**
 * PACKET V2 PREVIEW — assembles the full v2 closed-book packet for AAPL 1d
 * through the SAME steps the orchestrator now runs (consensus → tier →
 * research(tier, langs) ∥ related ∥ slow → assemble), prints it verbatim,
 * and reports token count + the 34x per-round input-cost delta vs today.
 *
 * Spends: ~7-13 Twelve Data credits (free) + one fresh research packet
 * (≈$0.01-0.09 depending on tier). Creates NO round, writes NO ledger row
 * (the research durable cache row is the only write, same as any run).
 *
 * Run: npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/packet-v2-preview.ts
 */
import { fetchDataPacket, sessionDateForPrice } from '../lib/league/market-data'
import { fetchMarketConsensus, wantsConsensus } from '../lib/league/market-context'
import { getResearchPacket } from '../lib/league/research'
import { decideResearchTier } from '../lib/league/research-tier'
import { relationsFor } from '../lib/league/relations'
import { fetchRelatedInstruments } from '../lib/league/related-instruments'
import { fetchSlowData } from '../lib/league/slow-data'
import {
  assembleClosedBookInjection,
  estimatePacketTokens,
  type ClosedBookPacketInput,
  type NonEnglishFinding,
} from '../lib/league/closed-book-packet'
import { LEAGUE_ROSTER } from '../lib/league/roster'

const TODAY_ROUND_COST_USD = 0.6517 // measured baseline provided by the owner

async function main() {
  const instrument = 'AAPL'
  const category = 'stock'
  const horizon = '1d'
  const round = {
    instrument,
    category,
    proposition_text: `Will ${instrument} close higher by tomorrow than its last close?`,
    horizon,
    resolution_rule: 'NASDAQ regular-session close price vs prior close',
    resolves_at: new Date(Date.now() + 86_400_000).toISOString(),
  }

  const t0 = Date.now()
  const packet = await fetchDataPacket(instrument)
  if (!packet.available) throw new Error(`packet unavailable: ${packet.error}`)
  const tQuote = Date.now()

  const consensus = wantsConsensus(category) && packet.symbol ? await fetchMarketConsensus(packet.symbol) : null
  const tConsensus = Date.now()

  const tierDecision = decideResearchTier({
    category,
    consensus,
    crypto: null,
    closes: (packet.series ?? []).map((b) => b.close),
    anchorClose: typeof packet.latestClose === 'number' ? packet.latestClose : null,
  })
  const relations = relationsFor(instrument)

  const [research, related, slow] = await Promise.all([
    getResearchPacket({
      round,
      budgetRemainingUsd: 2,
      tier: tierDecision.tier,
      languages: relations?.asiaLinks ?? [],
    }),
    fetchRelatedInstruments(instrument, packet.series ?? []),
    fetchSlowData({ category, symbol: packet.symbol }),
  ])
  const tParallel = Date.now()

  const series = packet.series ?? []
  const anchorClose = typeof packet.latestClose === 'number' ? packet.latestClose : null
  const enFindings = research.findings.filter((f) => (f.lang ?? 'en') === 'en')
  const nonEnglishFindings: NonEnglishFinding[] = research.findings
    .filter((f) => f.lang && f.lang !== 'en')
    .map((f) => ({ lang: f.lang!, query: f.query, summary: f.summary }))

  const base: ClosedBookPacketInput = {
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
    findings: enFindings,
    researchCacheKey: research.cacheKey,
    assembledAt: new Date().toISOString(),
  }

  const v1Text = assembleClosedBookInjection(base) // today's packet shape
  const v2Text = assembleClosedBookInjection({
    ...base,
    related: related?.stats ?? null,
    slow,
    nonEnglishFindings,
    synthesis: research.synthesis,
  })

  console.log('===== PACKET V2 (AAPL 1d) — VERBATIM START =====')
  console.log(v2Text)
  console.log('===== PACKET V2 (AAPL 1d) — VERBATIM END =====\n')

  const v1Tokens = estimatePacketTokens(v1Text)
  const v2Tokens = estimatePacketTokens(v2Text)
  const deltaTokens = v2Tokens - v1Tokens

  // 34 closed-book models each receive the packet once as input tokens.
  const closedBook = LEAGUE_ROSTER.filter((m) => m.league_tier !== 'scout')
  const inputPriceSumPerMTok = closedBook.reduce((s, m) => s + m.price.inputPerMTokens, 0)
  const deltaInputCost34x = (deltaTokens * inputPriceSumPerMTok) / 1_000_000

  const relatedCredits = related?.creditsSpent ?? 0
  const relatedCacheHits = related?.cacheHits ?? 0
  const totalCreditsThisRound = 2 + (consensus ? 5 : 0) + relatedCredits

  console.log('===== PACKET V2 REPORT =====')
  console.log(
    JSON.stringify(
      {
        tier: research.tier,
        tierSignal: tierDecision.signal,
        researchCached: research.cached,
        researchCostUsd: Number(research.costUsd.toFixed(4)),
        researchQueries: research.queries.length,
        nonEnglishFindings: nonEnglishFindings.length,
        synthesisPresent: !!research.synthesis,
        relatedStats: related?.stats.length ?? 0,
        relatedCreditsSpent: relatedCredits,
        relatedCacheHits,
        twelveDataCreditsThisRound: totalCreditsThisRound,
        overPerMinuteBudget: totalCreditsThisRound > 7,
        timingsMs: {
          quoteAndSeries: tQuote - t0,
          consensus: tConsensus - tQuote,
          researchRelatedSlowParallel: tParallel - tConsensus,
        },
        tokens: { v1: v1Tokens, v2: v2Tokens, delta: deltaTokens },
        closedBookModels: closedBook.length,
        inputPriceSumPerMTok: Number(inputPriceSumPerMTok.toFixed(2)),
        deltaInputCostAt34x: Number(deltaInputCost34x.toFixed(4)),
        researchCostDeltaVsNormalTier: 'see report — tier-dependent',
        todayRoundCostUsd: TODAY_ROUND_COST_USD,
        estimatedNewRoundCostUsd: Number(
          (TODAY_ROUND_COST_USD + deltaInputCost34x + research.costUsd).toFixed(4),
        ),
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
