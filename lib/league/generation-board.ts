import type { LeagueTier } from './card-types'
import { LEAGUE_TIERS } from './card-types'
import { extraSeatIds } from './extra/seats'
import { getRoster, lookupRosterEntry } from './roster'

/**
 * Live-board seat math. Display only — does not change what `buildCardData`
 * puts on tiles. While a round is streaming, each tier mounts
 * `getRoster([tier]).length` slots: arrival-order tiles, then 미응답 for
 * dropped seats, then pulsing skeletons for still-open seats. Finished cards
 * reuse the same 미응답 slots (no skeletons) so a null-direction seat does
 * not shrink the tier.
 */

export type StreamingTierFill = {
  expected: number
  noResponse: number
  skeletons: number
}

export function rosterIdsForTier(tier: LeagueTier): string[] {
  return tier === 'extra' ? [...extraSeatIds()] : getRoster([tier]).map((entry) => entry.model_id)
}

export function rosterSeatCounts(): Record<LeagueTier, number> {
  return {
    premier: rosterIdsForTier('premier').length,
    challenger: rosterIdsForTier('challenger').length,
    world: rosterIdsForTier('world').length,
    scout: rosterIdsForTier('scout').length,
    extra: rosterIdsForTier('extra').length,
  }
}

export function droppedIdsForTier(tier: LeagueTier, droppedModelIds: readonly string[]): string[] {
  const seats = new Set(rosterIdsForTier(tier))
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of droppedModelIds) {
    if (!seats.has(id) || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export function droppedCountForTier(tier: LeagueTier, droppedModelIds: readonly string[]): number {
  return droppedIdsForTier(tier, droppedModelIds).length
}

export function noResponseSeatLabel(modelId: string, noResponse: string): string {
  const entry = lookupRosterEntry(modelId)
  const name = entry?.product_alias?.trim()
  return name ? `${name} ${noResponse}` : noResponse
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
