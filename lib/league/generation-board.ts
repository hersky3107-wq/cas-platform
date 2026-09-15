import type { LeagueTier } from './card-types'
import { LEAGUE_TIERS } from './card-types'
import { getRoster } from './roster'

/**
 * Live-board seat math. Display only — does not change what `buildCardData`
 * puts on tiles. While a round is streaming, each tier mounts
 * `getRoster([tier]).length` slots: arrival-order tiles, then 미응답 for
 * dropped seats, then pulsing skeletons for still-open seats.
 */

export type StreamingTierFill = {
  expected: number
  noResponse: number
  skeletons: number
}

export function rosterIdsForTier(tier: LeagueTier): string[] {
  return getRoster([tier]).map((entry) => entry.model_id)
}

export function rosterSeatCounts(): Record<LeagueTier, number> {
  return {
    premier: rosterIdsForTier('premier').length,
    challenger: rosterIdsForTier('challenger').length,
    world: rosterIdsForTier('world').length,
    scout: rosterIdsForTier('scout').length,
  }
}

export function droppedCountForTier(tier: LeagueTier, droppedModelIds: readonly string[]): number {
  const seats = new Set(rosterIdsForTier(tier))
  let n = 0
  const seen = new Set<string>()
  for (const id of droppedModelIds) {
    if (!seats.has(id) || seen.has(id)) continue
    seen.add(id)
    n += 1
  }
  return n
}

export function streamingTierFill(
  expectedSeatCount: number,
  tileCount: number,
  droppedCount: number
): StreamingTierFill {
  const expected = Math.max(0, expectedSeatCount)
  const tiles = Math.max(0, tileCount)
  const remaining = Math.max(0, expected - tiles)
  const noResponse = Math.min(Math.max(0, droppedCount), remaining)
  return {
    expected,
    noResponse,
    skeletons: Math.max(0, remaining - noResponse),
  }
}

export function streamingTiers(): readonly LeagueTier[] {
  return LEAGUE_TIERS
}
