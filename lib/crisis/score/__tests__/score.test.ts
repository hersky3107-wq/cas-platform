import { describe, expect, it } from 'vitest'
import { CASCADE_SEEDS } from '../../knowledge/cascades.seed'
import { buildAnomalyCard, cardBytes } from '../card'
import { matchCascades } from '../cascades'
import { compoundBonus, finalizeScore, rawRiskScore, stageFromScore } from '../compute'
import { campBucket, damWeight, damsNear, informFragility, nuclearNear, upstreamDamAdd } from '../fragility'
import { mollweideToWgs84 } from '../../population/mollweide'
import { aggregateUrbanPop, normalizeGhsCentre } from '../../population/normalize'
import { peopleNorm } from '../people'
import { explainRegion } from '../print'
import {
  advisoryComponent,
  combineTrigger,
  conflictAbsCut,
  conflictComponent,
  cycloneComponent,
  fireComponent,
  fireCuts,
  foodComponent,
  gdacsComponent,
  internetComponent,
  quakeComponent,
  rainComponent,
  riverComponent,
  silenceComponent,
  volcanoComponent,
  wikiComponent,
} from '../trigger'
import type { RegionScore, TriggerComponent } from '../types'

const now = new Date('2026-10-09T06:00:00Z')

describe('rain', () => {
  it('uses 7-day sum and a single 50 mm day', () => {
    expect(rainComponent([10, 10, 10, 10, 10, 10, 10]).value).toBe(0)
    expect(rainComponent([100, 0, 0, 0, 0, 0, 0]).value).toBe(0.5)
    expect(rainComponent([200, 0, 0, 0, 0, 0, 0]).value).toBe(1)
    expect(rainComponent([50, 0, 0, 0, 0, 0, 0]).value).toBe(0.5)
    expect(rainComponent([150, 0, 0, 0, 0, 0, 0]).value).toBeCloseTo(0.75)
  })
})

describe('river', () => {
  it('prefers 30-day mean ratios when present', () => {
    expect(riverComponent({ discharge: [100, 250], ratioTo30d: [1.2, 2] }).value).toBe(0.5)
    expect(riverComponent({ discharge: [100, 300], ratioTo30d: [3] }).value).toBe(1)
    expect(riverComponent({ discharge: [100, 200] }).value).toBe(0.5)
    expect(riverComponent({ discharge: [100, 150] }).value).toBe(0)
  })
})

describe('cyclone', () => {
  it('scores distance of a forecast point within 5 days', () => {
    const near = cycloneComponent(32.7, -13.2, now, [
      { lat: 32.7, lon: -13.2, event_time: '2026-10-10T00:00:00Z' },
    ])
    const mid = cycloneComponent(32.7, -13.2, now, [
      { lat: 33.8, lon: -14.5, event_time: '2026-10-11T00:00:00Z' },
    ])
    const later = cycloneComponent(32.7, -13.2, now, [
      { lat: 32.7, lon: -13.2, event_time: '2026-10-20T00:00:00Z' },
    ])
    expect(near.value).toBe(1)
    expect(mid.value).toBe(0.6)
    expect(later.value).toBe(0)
  })
})

describe('quake', () => {
  it('uses magnitude and an EMSC swarm', () => {
    const soft = quakeComponent(10, 10, now, [
      { lat: 10.2, lon: 10.1, mag: 5.6, source: 'usgs', event_time: '2026-10-08T00:00:00Z' },
    ])
    const hard = quakeComponent(10, 10, now, [
      { lat: 10.1, lon: 10.1, mag: 6.7, source: 'usgs', event_time: '2026-10-08T00:00:00Z' },
    ])
    const swarm = quakeComponent(10, 10, now, Array.from({ length: 10 }, (_, i) => ({
      lat: 10.01,
      lon: 10.01,
      mag: 3,
      source: 'emsc',
      event_time: new Date(now.getTime() - i * 3600_000).toISOString(),
    })))
    expect(soft.value).toBe(0.6)
    expect(hard.value).toBe(1)
    expect(swarm.value).toBe(0.4)
  })
})

describe('alerts and human components', () => {
  it('maps GDACS and volcano colors', () => {
    expect(
      gdacsComponent(1, 1, 9, 'LBY', now, [
        { lat: 1, lon: 1, alert: 'Orange', event_time: now.toISOString(), region_id: 9 },
      ]).value,
    ).toBe(0.6)
    expect(
      volcanoComponent(1, 1, now, [{ lat: 1, lon: 1, alert: 'red', event_time: now.toISOString() }]).value,
    ).toBe(1)
  })

  it('scores fire top 1% and watchlist', () => {
    const cut = fireCuts(new Map([[1, 1], [2, 2], [3, 100]]))
    expect(fireComponent({ frpSum: 100, top1Cut: cut, watchlist: false }).value).toBe(0.4)
    expect(fireComponent({ frpSum: 1, top1Cut: cut, watchlist: true }).value).toBe(0.6)
  })

  it('scores conflict ratios and a short-history absolute tail', () => {
    expect(conflictComponent({ conflictCount: 30, mean30d: 10, historyDays: 10, absCut: 99 }).value).toBe(0.6)
    expect(conflictComponent({ conflictCount: 50, mean30d: 10, historyDays: 10, absCut: 99 }).value).toBe(1)
    expect(conflictComponent({ conflictCount: 20, mean30d: null, historyDays: 2, absCut: 20 }).value).toBe(0.5)
    expect(conflictAbsCut([1, 2, 3, 100])).toBeGreaterThan(2)
  })

  it('scores silence, internet, advisory, wiki, food', () => {
    expect(silenceComponent({ totalEvents: 2, mean30d: 10, historyDays: 10 }).value).toBe(0.7)
    expect(silenceComponent({ totalEvents: 2, mean30d: 10, historyDays: 3 }).value).toBe(0)
    expect(internetComponent(true).value).toBe(0.8)
    expect(advisoryComponent({ changed: true, diverge: false }).value).toBe(0.6)
    expect(advisoryComponent({ changed: true, diverge: true }).value).toBe(0.7)
    expect(wikiComponent(true, 'Cyclone').value).toBe(0.4)
    expect(foodComponent(3).value).toBe(0.5)
    expect(foodComponent(4).value).toBe(1)
  })
})

describe('trigger combine', () => {
  it('uses 1 - product of complements', () => {
    expect(combineTrigger([
      { key: 'rain', department: 'natural', value: 0.5, raw: {} },
      { key: 'conflict', department: 'conflict', value: 0.6, raw: {} },
    ])).toBeCloseTo(1 - 0.5 * 0.4)
  })
})

describe('fragility', () => {
  it('weights older taller dams higher', () => {
    expect(damWeight(20, 2010, 2026)).toBeLessThan(damWeight(90, 1960, 2026))
  })

  it('keeps camp size in buckets so Lebanon is not raw-counted', () => {
    expect(campBucket(0)).toBe(0)
    expect(campBucket(2)).toBe(0.3)
    expect(campBucket(10)).toBe(0.45)
    expect(campBucket(6315)).toBe(0.6)
    expect(campBucket(20)).toBe(0.6)
  })

  it('adds upstream when a touching neighbor has rain/river and a dam', () => {
    const rain: TriggerComponent = { key: 'rain', department: 'natural', value: 0.5, raw: {} }
    const add = upstreamDamAdd(
      [2],
      new Map([[2, [rain]]]),
      [{ name: 'Mansour', lat: 32.8, lon: 22.6, region_id: 2, height_m: 75, year_built: 1977 }],
    )
    expect(add).toBe(0.15)
    expect(upstreamDamAdd([2], new Map([[2, [rain]]]), [])).toBe(0)
  })

  it('includes a dam within 50 km even if region_id differs', () => {
    const items = damsNear(32.76, 22.64, 1, [
      { name: 'Derna', lat: 32.8, lon: 22.6, region_id: 99, height_m: 70, year_built: 1977 },
    ], 2026)
    expect(items[0]?.name).toBe('Derna')
  })

  it('scales INFORM vulnerability and coping to at most 0.5', () => {
    expect(informFragility(10, 10)).toBe(0.5)
    expect(informFragility(0, 0)).toBe(0)
  })

  it('counts a nuclear plant only when quake or flood already fired', () => {
    const plant = [{ name: 'Hanul', lat: 37.1, lon: 129.3, region_id: 1 }]
    const quiet = nuclearNear(37.1, 129.3, 1, plant, [{ key: 'wiki', department: 'media', value: 0.4, raw: {} }])
    const quake = nuclearNear(37.1, 129.3, 1, plant, [{ key: 'quake', department: 'natural', value: 0.6, raw: {} }])
    expect(quiet).toEqual([])
    expect(quake[0]?.weight).toBe(0.3)
  })
})

describe('people and score', () => {
  it('log-scales urban population and mixes INFORM exposure', () => {
    expect(peopleNorm(0, null)).toBe(0)
    expect(peopleNorm(10_000_000, 0)).toBeCloseTo(0.8)
    expect(peopleNorm(10_000_000, 10)).toBe(1)
  })

  it('keeps the raw product and adds compound / cascade bonuses', () => {
    const raw = rawRiskScore(1, 1, 1)
    expect(raw).toBe(100)
    expect(stageFromScore(11)).toBe(1)
    expect(stageFromScore(12)).toBe(2)
    expect(stageFromScore(60)).toBe(5)
    const rainRiver: TriggerComponent[] = [
      { key: 'rain', department: 'natural', value: 0.5, raw: {} },
      { key: 'river', department: 'natural', value: 0.5, raw: {} },
    ]
    expect(compoundBonus(rainRiver, true)).toBe(10)
    expect(compoundBonus([
      { key: 'rain', department: 'natural', value: 0.5, raw: {} },
      { key: 'conflict', department: 'conflict', value: 0.6, raw: {} },
    ], false)).toBe(10)
  })
})

describe('cascades and cards', () => {
  it('matches a flood+dam cascade and not a nuclear-only one', () => {
    const watch = matchCascades({
      cascades: CASCADE_SEEDS,
      components: [{ key: 'rain', department: 'natural', value: 0.5, raw: {} }],
      kinds: new Set(['dam']),
      urbanPop: 50_000,
    })
    expect(watch.some((row) => row.id === 'flood-dam-failure')).toBe(true)
    expect(watch.some((row) => row.id === 'conflict-camp-measles')).toBe(false)
  })

  it('keeps anomaly cards under 2 KB', () => {
    const scored = finalizeScore({
      region_id: 1,
      name: 'Derna',
      country: 'Libya',
      iso3: 'LBY',
      urban_pop: 90_000,
      inform_exposure: 6,
      inform_vulnerability: 7,
      inform_coping: 8,
      components: [
        { key: 'rain', department: 'natural', value: 0.5, raw: { sum_mm: 142 } },
        { key: 'river', department: 'natural', value: 0.5, raw: { ratio: 2.2 } },
      ],
      dam_items: [
        { kind: 'dam', name: 'Derna Dam', lat: 32.8, lon: 22.6, weight: 0.4, attributes: { height_m: 75 } },
      ],
      camp_count: 2,
      nuclear_items: [],
      upstream_add: 0.15,
      urban_centres: [{ name: 'Derna', pop: 90_000, lat: 32.76, lon: 22.64 }],
      kinds: new Set(['dam', 'refugee_camp']),
    })
    expect(scored.stage).toBeGreaterThanOrEqual(2)
    expect(scored.bonus.cascade).toBe(10)
    const card = buildAnomalyCard(scored, [
      { source: 'usgs', title: 'M6.2', url: 'https://earthquake.usgs.gov/x', event_time: now.toISOString() },
      { source: 'gdacs', title: 'Flood', url: 'https://www.gdacs.org/x', event_time: now.toISOString() },
      { source: 'wiki_top', title: 'Storm Daniel', url: 'https://en.wikipedia.org/wiki/Storm_Daniel', event_time: now.toISOString() },
    ])
    expect(cardBytes(card)).toBeLessThan(2048)
    expect(card.region).toBe('Derna')
  })
})

describe('GHSL population', () => {
  it('keeps named centres with 2025 pop and converted coordinates', () => {
    const apia = normalizeGhsCentre(
      { ID_UC_G0: '1', GC_UCN_MAI_2025: 'Apia', GC_CNT_GAD_2025: 'Samoa', GC_POP_TOT_2025: '60041' },
      { x: -16907128.97, y: -1704473.775 },
    )
    expect(apia?.name).toBe('Apia')
    expect(apia?.lat).toBeCloseTo(-13.85, 1)
    expect(apia?.lon).toBeCloseTo(-172, 0)
    expect(normalizeGhsCentre({ ID_UC_G0: '1', GC_UCN_MAI_2025: 'X', GC_POP_TOT_2025: '0' }, { x: 0, y: 0 })).toBeNull()
    const agg = aggregateUrbanPop([
      { id: '1', name: 'A', country_name: 'L', pop: 100, lat: 1, lon: 2, region_id: 9 },
      { id: '2', name: 'B', country_name: 'L', pop: 50, lat: 1, lon: 2, region_id: 9 },
    ])
    expect(agg[0].urban_pop).toBe(150)
    expect(agg[0].urban_centres).toBe(2)
    const wgs = mollweideToWgs84(-16907128.97, -1704473.775)
    expect(wgs?.lat).toBeCloseTo(-13.85, 1)
  })
})

describe('print sample', () => {
  it('looks like the top-30 explanation', () => {
    const row: RegionScore = {
      region_id: 1,
      name: 'Derna',
      country: 'Libya',
      iso3: 'LBY',
      score: 42,
      raw_score: 22,
      stage: 3,
      trigger: 0.75,
      fragility: 0.6,
      people_norm: 0.3,
      urban_pop: 90000,
      components: [{ key: 'rain', department: 'natural', value: 0.5, raw: { sum_mm: 142 } }],
      departments: ['natural'],
      fragility_items: [{ kind: 'dam', name: 'Derna Dam', lat: 32.8, lon: 22.6, weight: 0.4, attributes: {} }],
      cascades: [{
        id: 'flood-dam-failure',
        trigger_type: 'flood',
        effect_type: 'dam_failure',
        lag_min_days: 0,
        lag_max_days: 2,
        evidence_level: 'sourced',
      }],
      urban_centres: [{ name: 'Derna', pop: 90000, lat: 32.76, lon: 22.64 }],
      bonus: { compound: 10, cascade: 10 },
    }
    const text = explainRegion(1, row)
    expect(text).toContain('1. Derna / Libya')
    expect(text).toContain('score=42.0 stage=3')
    expect(text).toContain('flood-dam-failure')
  })
})
