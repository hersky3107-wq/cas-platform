import { describe, expect, it } from 'vitest'
import {
  droppedCountForTier,
  droppedIdsForTier,
  noResponseSeatLabel,
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

  it('labels an official drop with product alias + 미응답', () => {
    expect(droppedIdsForTier('premier', ['kimi-k3', 'mimo-v2.5'])).toEqual(['kimi-k3'])
    expect(droppedIdsForTier('world', ['kimi-k3', 'mimo-v2.5'])).toEqual(['mimo-v2.5'])
    expect(noResponseSeatLabel('kimi-k3', '미응답')).toBe('Kimi 미응답')
    expect(noResponseSeatLabel('mimo-v2.5', '미응답')).toBe('MiMo 미응답')
    expect(noResponseSeatLabel('unknown-seat', '미응답')).toBe('미응답')
  })
})
