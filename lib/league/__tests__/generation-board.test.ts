import { describe, expect, it } from 'vitest'
import {
  droppedCountForTier,
  rosterSeatCounts,
  streamingTierFill,
  streamingTiers,
} from '../generation-board'
import { getRoster } from '../roster'

describe('generation-board seat plan', () => {
  it('seat counts come from getRoster per tier, not a hardcoded 41', () => {
    const counts = rosterSeatCounts()
    expect(counts.premier).toBe(getRoster(['premier']).length)
    expect(counts.challenger).toBe(getRoster(['challenger']).length)
    expect(counts.world).toBe(getRoster(['world']).length)
    expect(counts.scout).toBe(getRoster(['scout']).length)
    expect(counts.extra).toBe(4)
    expect(counts.premier + counts.challenger + counts.world + counts.scout).toBe(getRoster().length)
  })

  it('always plans official tiers plus extra so they can mount empty and fill together', () => {
    expect(streamingTiers()).toEqual(['premier', 'challenger', 'world', 'scout', 'extra'])
  })

  it('a world tile plus two drops leaves skeletons in world only — other tiers stay full-skeleton', () => {
    const counts = rosterSeatCounts()
    expect(streamingTierFill(counts.premier, 0, 0).skeletons).toBe(counts.premier)
    expect(streamingTierFill(counts.world, 1, 2)).toEqual({
      expected: counts.world,
      noResponse: 2,
      skeletons: counts.world - 3,
    })
  })

  it('when every remaining seat dropped, skeletons hit zero so the bar can complete', () => {
    expect(streamingTierFill(10, 8, 2)).toEqual({ expected: 10, noResponse: 2, skeletons: 0 })
    expect(streamingTierFill(6, 6, 0)).toEqual({ expected: 6, noResponse: 0, skeletons: 0 })
  })

  it('attributes dropped ids to their own tier', () => {
    const premier = getRoster(['premier']).map((e) => e.model_id)
    const world = getRoster(['world']).map((e) => e.model_id)
    expect(droppedCountForTier('premier', [premier[0]!, world[0]!])).toBe(1)
    expect(droppedCountForTier('world', [premier[0]!, world[0]!])).toBe(1)
    expect(droppedCountForTier('scout', [premier[0]!])).toBe(0)
  })
})
