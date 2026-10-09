import { describe, expect, it } from 'vitest'
import { CASCADE_SEEDS } from '../../knowledge/cascades.seed'
import { buildAnomalyCard, cardBytes } from '../card'
import { cascadeBonusApplies, matchCascades } from '../cascades'
import { compoundBonus, finalizeScore, rawRiskScore, stageFromScore } from '../compute'
import { advisoryPairDiverges } from '../advisory'
import { campBucket, damWeight, damsNear, diminish, informFragility, nuclearNear, upstreamDamAdd } from '../fragility'
import { classifyWikiTitle, wikiArticleTitle } from '../wiki'
import { scoreWriteEnabled } from '../write'
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
  healthAttentionComponent,
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
  it('requires a 50 m3/s peak and caps a near-zero baseline', () => {
    const tiny = riverComponent({ discharge: [0.1, 4.5] })
    expect(tiny.value).toBe(0)
    expect(tiny.raw.used).toBe('below_peak')
    const spike = riverComponent({ discharge: [0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 200] })
    expect(Number(spike.raw.ratio)).toBeLessThanOrEqual(10)
    expect(spike.value).toBe(1)
    const history = riverComponent({ discharge: [80, 200], ratioTo30d: [2.5], historyDays: 14 })
    expect(history.raw.used).toBe('ratio_to_30d_mean')
    expect(history.value).toBeGreaterThan(0.5)
    expect(riverComponent({ discharge: [80, 200], ratioTo30d: [9], historyDays: 3 }).raw.used).toBe('capped_peak_over_baseline')
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

  it('scores fire only when detections exist, then multiplies a watchlist', () => {
    const cut = fireCuts(new Map([[1, 1], [2, 2], [3, 100]]))
    expect(fireComponent({ frpSum: 0, count: 0, top1Cut: cut, watchlist: true }).value).toBe(0)
    expect(fireComponent({ frpSum: 100, count: 1, top1Cut: cut, watchlist: false }).value).toBe(0.4)
    expect(fireComponent({ frpSum: 100, count: 1, top1Cut: cut, watchlist: true }).value).toBeCloseTo(0.52)
    expect(fireComponent({ frpSum: 5, count: 20, top1Cut: cut, watchlist: false }).value).toBe(0.4)
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
    expect(wikiComponent(true, 'Cyclone').value).toBe(0)
    expect(healthAttentionComponent(true, 'Pneumonic plague').value).toBe(0.3)
    expect(healthAttentionComponent(false).value).toBe(0)
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

  it('scales INFORM vulnerability and coping to at most 0.3', () => {
    expect(informFragility(10, 10)).toBeCloseTo(0.3)
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
    expect(stageFromScore(39)).toBe(1)
    expect(stageFromScore(40)).toBe(2)
    expect(stageFromScore(55)).toBe(3)
    expect(stageFromScore(70)).toBe(4)
    expect(stageFromScore(85)).toBe(5)
    const rainRiver: TriggerComponent[] = [
      { key: 'rain', department: 'natural', value: 0.5, raw: {} },
      { key: 'river', department: 'natural', value: 0.5, raw: {} },
    ]
    expect(compoundBonus(rainRiver)).toBe(0)
    expect(compoundBonus([
      { key: 'rain', department: 'natural', value: 0.5, raw: {} },
      { key: 'conflict', department: 'conflict', value: 0.6, raw: {} },
    ])).toBe(15)
    expect(compoundBonus([
      { key: 'rain', department: 'natural', value: 0.4, raw: {} },
      { key: 'conflict', department: 'conflict', value: 0.6, raw: {} },
    ])).toBe(0)
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
    expect(scored.score).toBeLessThanOrEqual(100)
    const capped = finalizeScore({
      ...{
        region_id: 1,
        name: 'X',
        country: 'Y',
        iso3: 'YYY',
        urban_pop: 20_000_000,
        inform_exposure: 10,
        inform_vulnerability: 10,
        inform_coping: 10,
        components: [
          { key: 'rain', department: 'natural', value: 1, raw: {} },
          { key: 'conflict', department: 'conflict', value: 1, raw: {} },
        ],
        dam_items: [{ kind: 'dam', name: 'Big', lat: 1, lon: 1, weight: 1, attributes: {} }],
        camp_count: 40,
        nuclear_items: [],
        upstream_add: 0.15,
        urban_centres: [],
        kinds: new Set(['dam']),
      },
    })
    expect(capped.score).toBe(100)
    const quiet = finalizeScore({
      region_id: 2,
      name: 'Quiet',
      country: 'Y',
      iso3: 'YYY',
      urban_pop: 1000,
      inform_exposure: null,
      inform_vulnerability: null,
      inform_coping: null,
      components: [{ key: 'wiki', department: 'media', value: 0.3, raw: {} }],
      dam_items: [{ kind: 'dam', name: 'Idle', lat: 1, lon: 1, weight: 0.8, attributes: {} }],
      camp_count: 6315,
      nuclear_items: [{ kind: 'nuclear_plant', name: 'Plant', lat: 1, lon: 1, weight: 0.3, attributes: {} }],
      upstream_add: 0.15,
      urban_centres: [],
      kinds: new Set(['dam', 'refugee_camp', 'nuclear_plant']),
    })
    expect(quiet.fragility_items.some((item) => item.kind === 'dam' || item.kind === 'refugee_camp' || item.kind === 'nuclear_plant')).toBe(false)
    expect(quiet.bonus.cascade).toBe(0)
    const watched = matchCascades({
      cascades: CASCADE_SEEDS,
      components: scored.components,
      kinds: new Set(['dam']),
      urbanPop: 90_000,
    })
    expect(cascadeBonusApplies(watched, new Set(), CASCADE_SEEDS)).toBe(false)
    expect(cascadeBonusApplies(
      [{ id: 'empty-req', trigger_type: 'flood', effect_type: 'x', lag_min_days: 0, lag_max_days: 1, evidence_level: 'sourced' }],
      new Set(['dam']),
      [{ ...CASCADE_SEEDS[0], id: 'empty-req', conditions: { requires_fragility: [] } }],
    )).toBe(false)
    expect(diminish(0, 1.2)).toBe(0)
    expect(diminish(2, 1.2)).toBeGreaterThan(diminish(0.4, 1.2))
    expect(diminish(2, 1.2)).toBeLessThan(1)
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

describe('advisory divergence', () => {
  it('ignores a missing side and a close unchanged pair', () => {
    expect(advisoryPairDiverges({ us: { level: 4 }, uk: null, usChanged: true, ukChanged: false })).toBe(false)
    expect(advisoryPairDiverges({ us: null, uk: { level: 4 }, usChanged: false, ukChanged: true })).toBe(false)
    expect(advisoryPairDiverges({
      us: { level: 2 },
      uk: { level: 2 },
      usChanged: false,
      ukChanged: false,
    })).toBe(false)
    expect(advisoryPairDiverges({
      us: { level: 3 },
      uk: { level: 2 },
      usChanged: true,
      ukChanged: true,
    })).toBe(false)
  })

  it('fires when both levels differ by 2 or only one side changed', () => {
    expect(advisoryPairDiverges({
      us: { level: 4 },
      uk: { level: 1 },
      usChanged: false,
      ukChanged: false,
    })).toBe(true)
    expect(advisoryPairDiverges({
      us: { level: 2 },
      uk: { level: 2 },
      usChanged: true,
      ukChanged: false,
    })).toBe(true)
  })
})

describe('wiki title filter', () => {
  it('keeps current hazard articles and drops history and biographies', () => {
    expect(classifyWikiTitle('Чума', 'чума', 2026).keep).toBe(true)
    expect(classifyWikiTitle('Peste Negra', 'peste', 2026)).toEqual({ keep: false, reason: 'historical' })
    expect(classifyWikiTitle('15 Temmuz Darbe Girişimi', 'darbe', 2026).reason).toBe('historical')
    expect(classifyWikiTitle('Black Death', 'plague', 2026).reason).toBe('historical')
    expect(classifyWikiTitle('Hurricane Isaias (2026)', 'hurricane', 2026).keep).toBe(true)
    expect(classifyWikiTitle('Hurricane Isaias (2025)', 'hurricane', 2026).keep).toBe(true)
    expect(classifyWikiTitle('Kashmir earthquake, 2005', 'earthquake', 2026)).toEqual({ keep: false, reason: 'year' })
    expect(classifyWikiTitle('2004 Indian Ocean earthquake', 'earthquake', 2026).reason).toBe('year')
    expect(classifyWikiTitle('John Smith', 'flood', 2026)).toEqual({ keep: false, reason: 'person' })
    expect(classifyWikiTitle('Flooding in the valley', 'quake', 2026)).toEqual({ keep: false, reason: 'term' })
    expect(wikiArticleTitle('Чума (ru.wikipedia)')).toBe('Чума')
  })
})

describe('score write flag', () => {
  it('stays off unless the env value is 1, true, or yes', () => {
    expect(scoreWriteEnabled({})).toBe(false)
    expect(scoreWriteEnabled({ CRISIS_SCORE_WRITE_ENABLED: '' })).toBe(false)
    expect(scoreWriteEnabled({ CRISIS_SCORE_WRITE_ENABLED: '0' })).toBe(false)
    expect(scoreWriteEnabled({ CRISIS_SCORE_WRITE_ENABLED: '1' })).toBe(true)
    expect(scoreWriteEnabled({ CRISIS_SCORE_WRITE_ENABLED: 'yes' })).toBe(true)
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
      bonus: { compound: 15, cascade: 10 },
      context: ['wiki: Hurricane Isaias (2026)'],
    }
    const text = explainRegion(1, row)
    expect(text).toContain('1. Derna / Libya')
    expect(text).toContain('score=42.0 stage=3')
    expect(text).toContain('flood-dam-failure')
  })
})
