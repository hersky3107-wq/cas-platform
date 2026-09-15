import { describe, expect, it } from 'vitest'
import { droppedRosterModelIds, revealConsensusConclusion, rosterGenerationProgress } from '../generation-progress'
import { getRoster } from '../roster'

describe('rosterGenerationProgress', () => {
  it('uses the live roster length as the denominator, not a hardcoded 41', () => {
    const roster = getRoster().map((e) => e.model_id)
    const progress = rosterGenerationProgress(roster, [])
    expect(progress.rosterSize).toBe(getRoster().length)
    expect(progress.rosterSize).toBe(roster.length)
    expect(progress.answered).toBe(0)
    expect(progress.complete).toBe(false)
  })

  it('a premier-only run uses that tier’s seat count, not the full roster', () => {
    const premier = getRoster(['premier']).map((e) => e.model_id)
    const progress = rosterGenerationProgress(premier, premier.slice(0, 3))
    expect(progress.rosterSize).toBe(premier.length)
    expect(progress.rosterSize).not.toBe(getRoster().length)
    expect(progress.answered).toBe(3)
    expect(progress.complete).toBe(false)
  })

  it('counts dropped/null rows as resolved so N can reach the denominator', () => {
    const roster = ['a', 'b', 'c', 'd']
    // 2 tiles + 2 no-opinion drops (null rows written, excluded from tiles)
    const written = ['a', 'b', 'c', 'd']
    const progress = rosterGenerationProgress(roster, written)
    expect(progress).toEqual({ rosterSize: 4, answered: 4, complete: true })
  })

  it('does not stall when some seats dropped — 2 tiles + 2 drops is 4/4, not 2/4', () => {
    const roster = ['tile-1', 'tile-2', 'drop-1', 'drop-2']
    const writtenIncludingDrops = roster
    const tilesOnly = ['tile-1', 'tile-2']
    expect(rosterGenerationProgress(roster, tilesOnly)).toEqual({
      rosterSize: 4,
      answered: 2,
      complete: false,
    })
    expect(rosterGenerationProgress(roster, writtenIncludingDrops)).toEqual({
      rosterSize: 4,
      answered: 4,
      complete: true,
    })
  })

  it('ignores retired / off-roster rows and does not double-count duplicates', () => {
    const roster = ['live-a', 'live-b']
    const written = ['live-a', 'live-a', 'retired-granite', 'someone-else']
    expect(rosterGenerationProgress(roster, written)).toEqual({
      rosterSize: 2,
      answered: 1,
      complete: false,
    })
  })

  it('empty roster is not complete', () => {
    expect(rosterGenerationProgress([], [])).toEqual({
      rosterSize: 0,
      answered: 0,
      complete: false,
    })
  })

  it('lists only roster seats whose row is a null-direction drop', () => {
    expect(
      droppedRosterModelIds(['a', 'b', 'c'], [
        { model_id: 'a', predicted_direction: 'up' },
        { model_id: 'b', predicted_direction: null },
        { model_id: 'retired', predicted_direction: null },
        { model_id: 'b', predicted_direction: null },
        { model_id: 'c', predicted_direction: null },
      ])
    ).toEqual(['b', 'c'])
  })
})

describe('revealConsensusConclusion', () => {
  it('hides the conclusion while seats are still filling (complete === false)', () => {
    expect(revealConsensusConclusion(false, true)).toBe(false)
    expect(revealConsensusConclusion(false, false)).toBe(false)
  })

  it('reveals the conclusion when generation.complete is true', () => {
    expect(revealConsensusConclusion(true, true)).toBe(true)
    expect(revealConsensusConclusion(true, false)).toBe(true)
  })

  it('static cards (no generation job) reveal the conclusion', () => {
    expect(revealConsensusConclusion(undefined, false)).toBe(true)
    expect(revealConsensusConclusion(null, false)).toBe(true)
  })

  it('a live stream with no complete flag yet does not reveal', () => {
    expect(revealConsensusConclusion(undefined, true)).toBe(false)
    expect(revealConsensusConclusion(null, true)).toBe(false)
  })
})
