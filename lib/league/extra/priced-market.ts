/**
 * Money-market pass of the consensus extra seat, routed by `pricedMarketPath`.
 * Every path returns an `AcceptedMarketMatch` that already cleared
 * relevance ≥ 0.7 and the ±7-day deadline window, or null.
 */
import type { DailyMarketRound } from './daily-market-search'
import { pricedMarketPath, type AcceptedMarketMatch } from './market-match'
import type { SportsBaselineRound } from './sports-baseline'

export type PricedMarketRound = DailyMarketRound &
  SportsBaselineRound & {
    proposition_text: string
    closed_book_packet_text?: string | null
  }

export type PricedMarketDeps = {
  eventMarket: (round: PricedMarketRound) => Promise<AcceptedMarketMatch | null>
  dailyMarket: (round: DailyMarketRound) => Promise<AcceptedMarketMatch | null>
  sportsBaseline: (round: SportsBaselineRound) => Promise<AcceptedMarketMatch | null>
}

export async function matchPricedMarket(
  round: PricedMarketRound,
  deps: PricedMarketDeps,
): Promise<AcceptedMarketMatch | null> {
  const path = pricedMarketPath(round.category, round.instrument)
  const run =
    path === 'event'
      ? deps.eventMarket
      : path === 'daily'
        ? deps.dailyMarket
        : path === 'sports'
          ? deps.sportsBaseline
          : null
  if (!run) return null
  return run(round).catch(() => null)
}
