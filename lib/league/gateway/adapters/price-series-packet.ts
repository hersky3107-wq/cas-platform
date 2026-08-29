import {
  assembleClosedBookInjection,
  type ClosedBookPacketInput,
  type ConsensusSnapshot,
  type CryptoSnapshot,
  type NonEnglishFinding,
  type SeriesBar,
  type SlowDataSnapshot,
} from '../../closed-book-packet'
import { decideResearchTier, type ResearchTier, type TierDecision } from '../../research-tier'
import { relationsFor, type ResearchLang } from '../../relations'
import { normalizeSessionDate } from '@/lib/prediction/resolution'
import type { DataPacket } from '../../market-data'
import type { ResearchPacket } from '../../research'
import type { RelatedInstrumentsResult } from '../../related-instruments'
import type { CategoryPacket, PacketBuildContext, PacketRound } from '../types'

/**
 * Price-series packet v2 assembly — MOVED VERBATIM out of
 * `orchestrator.generatePredictions` (which used to inline this between
 * `ensureRound` and `buildPrompts`). Numeric market data, base rate,
 * consensus, related instruments, multilingual findings, slow public data,
 * and research tiers are CATEGORY JUDGMENT, so they live behind
 * `CategoryAdapter.buildPacket` now — the stocks adapter delegates here, and
 * the orchestrator's legacy fallback for the other price chips (crypto/fx/
 * gold/index/commodities/memecoin/real-estate) calls the same function until
 * those categories get adapters of their own.
 *
 * All fetches are injected (`PriceSeriesIo`) so the assembly is unit-testable
 * and byte-parity with the pre-adapter path is provable without network.
 * Fetch ORDER is load-bearing (Twelve Data credit-window throttling) — see
 * the inline comments carried over from the orchestrator.
 */

export type PriceSeriesIo = {
  fetchDataPacket(instrument: string): Promise<DataPacket>
  fetchMarketConsensus(symbol: string): Promise<ConsensusSnapshot>
  fetchCryptoContext(instrument: string): Promise<CryptoSnapshot>
  getResearchPacket(args: {
    round: PacketRound
    budgetRemainingUsd: number
    tier?: ResearchTier
    languages?: readonly ResearchLang[]
  }): Promise<ResearchPacket>
  fetchRelatedInstruments(
    instrument: string,
    anchorSeries: readonly SeriesBar[],
  ): Promise<RelatedInstrumentsResult | null>
  fetchSlowData(args: { category: string; symbol?: string }): Promise<SlowDataSnapshot | null>
}

/**
 * Category predicates — moved from `lib/league/market-context.ts` (their only
 * caller was the orchestrator block that moved here; market-context re-exports
 * them for any external use). Equities/ETFs have the analyst endpoints;
 * FX/crypto/commodities typically do not.
 */
export function wantsConsensus(category: string): boolean {
  return category === 'stock' || category === 'etf_index'
}

export function wantsCryptoContext(category: string): boolean {
  return category === 'crypto_spot' || category === 'crypto_perps' || category === 'memecoin'
}

/**
 * Session date of a close, taken from the packet's dated bars — never from
 * `asOf` / wall-clock. Pure twin of `market-data.sessionDateForPrice` (that
 * module is 'server-only'; this one must stay importable by tests).
 */
export function sessionDateForClose(packet: DataPacket, price: number): string | null {
  const series = packet.series ?? []
  for (let i = series.length - 1; i >= 0; i--) {
    const bar = series[i]
    if (Math.abs(bar.close - price) < 0.005) return normalizeSessionDate(bar.date)
  }
  return null
}

/** Fetched inputs → `ClosedBookPacketInput`. Moved verbatim from the orchestrator. */
export function toClosedBookInput(
  round: PacketRound,
  packet: DataPacket,
  research: ResearchPacket,
  consensus: ConsensusSnapshot | null,
  crypto: CryptoSnapshot | null,
  v2?: {
    related?: ClosedBookPacketInput['related']
    slow?: SlowDataSnapshot | null
  },
): ClosedBookPacketInput {
  const series = packet.series ?? []
  const anchorClose = typeof packet.latestClose === 'number' ? packet.latestClose : null
  // v2 (B): non-English findings get their own shared section; English
  // findings keep flowing through the existing prose-findings filter.
  const enFindings = research.findings.filter((f) => (f.lang ?? 'en') === 'en')
  const nonEnglishFindings: NonEnglishFinding[] = research.findings
    .filter((f) => f.lang && f.lang !== 'en')
    .map((f) => ({ lang: f.lang!, query: f.query, summary: f.summary }))
  return {
    instrument: round.instrument,
    category: round.category,
    horizon: round.horizon,
    series,
    seriesSource: 'Twelve Data /time_series+quote',
    seriesAsOf: packet.asOf ?? series[series.length - 1]?.date ?? null,
    anchorClose,
    anchorSessionDate: anchorClose != null ? sessionDateForClose(packet, anchorClose) : null,
    quoteAsOf: packet.asOf ?? null,
    consensus,
    crypto,
    findings: enFindings,
    researchCacheKey: research.cacheKey,
    assembledAt: new Date().toISOString(),
    related: v2?.related ?? null,
    slow: v2?.slow ?? null,
    nonEnglishFindings,
    synthesis: research.synthesis,
  }
}

export async function buildPriceSeriesPacket(ctx: PacketBuildContext, io: PriceSeriesIo): Promise<CategoryPacket> {
  const round = ctx.round
  // One packet fetch per ROUND (quote + long time_series = 2 Twelve Data
  // credits). Consensus adds 5 more for equities (throttled to Basic's 8/min).
  const packet = await io.fetchDataPacket(round.instrument)
  // ANCHOR price event — emitted at the exact point the pre-adapter
  // orchestrator persisted it (before the consensus fetch). The shell decides
  // whether to honor it (only for a newly CREATED round).
  if (packet.available && typeof packet.latestClose === 'number') {
    await ctx.onEvent?.({
      kind: 'anchor_price',
      price: packet.latestClose,
      sessionDate: sessionDateForClose(packet, packet.latestClose),
    })
  }
  // v2 (D): consensus/crypto are fetched BEFORE research so the dispersion
  // signal can set the research budget tier. Twelve Data order within the
  // 7-credit/min window: quote+series (2) → consensus (5) → related series
  // (fetched below, CONCURRENTLY with the research AI calls, so the throttle
  // wait for a second credit window overlaps research latency instead of
  // stalling the user-visible stream).
  const [consensus, crypto] = await Promise.all([
    packet.available && wantsConsensus(round.category) && packet.symbol
      ? io.fetchMarketConsensus(packet.symbol)
      : Promise.resolve(null),
    wantsCryptoContext(round.category) ? io.fetchCryptoContext(round.instrument) : Promise.resolve(null),
  ])
  const tierDecision: TierDecision = decideResearchTier({
    category: round.category,
    consensus,
    crypto,
    closes: (packet.series ?? []).map((b) => b.close),
    anchorClose: typeof packet.latestClose === 'number' ? packet.latestClose : null,
  })
  const relations = relationsFor(round.instrument)
  // One research packet per ROUND, shared identically by tiers 1/2/3 (Scout
  // keeps its own live search). Cached per (instrument, horizon, tier, langs,
  // 6h bucket); its cost counts against the same kill-switch cap as the model
  // calls. Related-series (TD credits) and slow public data (free HTTP) run
  // concurrently with the research AI calls.
  const [research, related, slow] = await Promise.all([
    io.getResearchPacket({
      round,
      budgetRemainingUsd: ctx.costCapUsd,
      tier: tierDecision.tier,
      languages: relations?.asiaLinks ?? [],
    }),
    io.fetchRelatedInstruments(round.instrument, packet.series ?? []),
    io.fetchSlowData({ category: round.category, symbol: packet.symbol }),
  ])
  const injection =
    packet.available || research.available
      ? assembleClosedBookInjection(
          toClosedBookInput(round, packet, research, consensus, crypto, {
            related: related?.stats ?? null,
            slow,
          }),
        )
      : null
  return {
    injection,
    researchCacheKey: research.cacheKey,
    researchCostUsd: research.costUsd,
    dataPacket: {
      available: packet.available,
      symbol: packet.symbol,
      latestClose: packet.latestClose,
      error: packet.error,
    },
    research: {
      available: research.available,
      cached: research.cached,
      costUsd: Number(research.costUsd.toFixed(6)),
      queries: research.queries,
      tier: research.tier,
      tierSignal: tierDecision.signal,
      error: research.error,
    },
    relatedCreditsSpent: related?.creditsSpent ?? 0,
  }
}
