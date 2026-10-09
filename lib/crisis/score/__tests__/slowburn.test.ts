import { describe, expect, it } from 'vitest'
import { cycloneCoversRegion } from '../../events/link'
import {
  backfillDayList,
  canonicalDyad,
  isDomesticEvent,
  pendingBackfillDays,
} from '../../ingest/sources/gdelt-relations'
import { gdeltActorToIso3, gdeltFipsToIso3 } from '../../ingest/sources/gdelt'
import {
  assessTrend,
  conflictSpread,
  hasNewActor,
  hasNewActorCounted,
  hasSingleDaySpike,
  isQuietRise,
  scoreVolume,
  slowBurnValue,
  theilSenSlope,
  type DailyVolume,
} from '../slowburn'
import { amplifyFired } from '../wiki-amplifier'
import { isInstitutionWikiTitle, wikiTitleRole } from '../wiki-roles'
import type { TriggerComponent } from '../types'

describe('cyclone track gate', () => {
  it('does not attach Atlantic al092026 to Pacific Mexico', () => {
    const track = [
      { lat: 23.3, lon: -91.2 },
      { lat: 25.4, lon: -88.4 },
      { lat: 25.8, lon: -88.4 },
    ]
    expect(cycloneCoversRegion(track, 21.89296, -104.89874, 300)).toBe(false)
    expect(cycloneCoversRegion(track, 19.11367, -103.9446, 300)).toBe(false)
    expect(cycloneCoversRegion(track, 22.48497, -89.64297, 300)).toBe(true)
  })
})

describe('wiki amplifier roles', () => {
  it('keeps institution titles off natural components', () => {
    expect(isInstitutionWikiTitle('Mobilização Nacional')).toBe(true)
    expect(wikiTitleRole('Mobilização Nacional', 'mobilização', 'mobilization')).toBe('human')
    expect(wikiTitleRole('Hurricane Isaias (2026)', 'hurricane', 'cyclone')).toBe('natural')
    const rain: TriggerComponent = { key: 'rain', department: 'natural', value: 0.5, raw: {} }
    const conflict: TriggerComponent = { key: 'conflict', department: 'conflict', value: 0.6, raw: {} }
    const institutionOnly = amplifyFired([rain, conflict], { natural: false, human: true })
    expect(institutionOnly[0].value).toBe(0.5)
    expect(institutionOnly[1].value).toBeCloseTo(0.69)
    const quiet = amplifyFired([rain], { natural: false, human: false })
    expect(quiet[0].value).toBe(0.5)
    const storm = amplifyFired([rain], { natural: true, human: false })
    expect(storm[0].value).toBeCloseTo(0.575)
  })
})

describe('slow burn', () => {
  it('measures a steady rise and rejects a one-day spike', () => {
    const rising = Array.from({ length: 12 }, (_, i) => 0.1 + i * 0.01)
    expect(theilSenSlope(rising)).toBeCloseTo(0.01)
    expect(hasSingleDaySpike(rising)).toBe(false)
    expect(assessTrend(rising, 'up', 0.002).significant).toBe(true)
    const spike = [1, 1, 1, 1, 1, 1, 1, 1, 1, 20]
    expect(hasSingleDaySpike(spike)).toBe(true)
    const quiet = isQuietRise([
      { key: 'a', slope: 1, worsening: true, significant: true, spiked: false },
      { key: 'b', slope: 1, worsening: true, significant: true, spiked: false },
      { key: 'c', slope: 1, worsening: true, significant: true, spiked: false },
    ])
    expect(quiet).toBe(true)
    expect(isQuietRise([
      { key: 'a', slope: 1, worsening: true, significant: true, spiked: true },
      { key: 'b', slope: 1, worsening: true, significant: true, spiked: false },
      { key: 'c', slope: 1, worsening: true, significant: true, spiked: false },
    ])).toBe(false)
  })

  it('scores quiet rise, dyad focus, and spread', () => {
    const rows: DailyVolume[] = Array.from({ length: 20 }, (_, i) => ({
      day: `2026-09-${String(i + 1).padStart(2, '0')}`,
      events: 10,
      conflict_share: 0.2 + i * 0.01,
      avg_goldstein: -1 - i * 0.1,
      avg_tone: -1 - i * 0.1,
      cameo_18_20: 2 + i,
      cameo_share: (2 + i) / 10,
      num_sources: 4 + i,
    }))
    const scored = scoreVolume(rows, '2026-09-20')
    expect(scored.quiet).toBe(true)
    expect(slowBurnValue({ quiet: true, dyad: false, escalation: false })).toBe(0.4)
    expect(slowBurnValue({ quiet: true, dyad: true, escalation: false })).toBe(0.6)
    expect(slowBurnValue({ quiet: false, dyad: false, escalation: true })).toBe(0.7)
    expect(conflictSpread([2], [1], new Map([[2, [1]]]))).toBe(true)
    expect(conflictSpread([1], [1], new Map())).toBe(false)
    expect(hasNewActor(['RUS'], ['UKR'])).toBe(true)
    expect(hasNewActor(['UKR'], ['UKR'])).toBe(false)
    expect(hasNewActorCounted(new Map([['RUS', 4]]), new Set())).toBe(false)
    expect(hasNewActorCounted(new Map([['RUS', 5]]), new Set())).toBe(true)
    expect(hasNewActorCounted(new Map([['RUS', 8]]), new Set(['RUS']))).toBe(false)
  })

  it('does not fire quiet rise on raw cameo counts without a share rise', () => {
    const rows: DailyVolume[] = Array.from({ length: 20 }, (_, i) => ({
      day: `2026-09-${String(i + 1).padStart(2, '0')}`,
      events: 100 + i * 20,
      conflict_share: 0.2,
      avg_goldstein: -1,
      avg_tone: -1,
      cameo_18_20: 20 + i * 4,
      cameo_share: 0.2,
      num_sources: 50 + i,
    }))
    expect(scoreVolume(rows, '2026-09-20').quiet).toBe(false)
  })
})

describe('dyad mapping and backfill checkpoint', () => {
  it('maps FIPS actors into an undirected pair and skips domestic duplicates', () => {
    expect(gdeltFipsToIso3('US')).toBe('USA')
    expect(gdeltFipsToIso3('MX')).toBe('MEX')
    expect(gdeltActorToIso3('AUS')).toBe('AUS')
    expect(gdeltActorToIso3('MEX')).toBe('MEX')
    expect(gdeltActorToIso3('ZZZ')).toBeNull()
    expect(canonicalDyad('USA', 'MEX')).toEqual(['MEX', 'USA'])
    expect(canonicalDyad('MEX', 'MEX')).toBeNull()
    expect(canonicalDyad(null, 'MEX')).toBeNull()
    expect(isDomesticEvent('MEX', 'MEX', null)).toBe(true)
    expect(isDomesticEvent('MEX', 'USA', 'MEX')).toBe(false)
    expect(isDomesticEvent('MEX', null, null)).toBe(true)
  })

  it('resumes after the checkpoint and skips completed days', () => {
    expect(backfillDayList('20261007', 3)).toEqual(['20261005', '20261006', '20261007'])
    expect(pendingBackfillDays(['20261005', '20261006', '20261007'], ['20261005'])).toEqual(['20261006', '20261007'])
  })
})
