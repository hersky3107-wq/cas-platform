import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { HAZARD_TERM_STATUS, HAZARD_TERMS, matchHazardTitle } from '../../config/hazard-terms'
import { WIKI_PROJECTS } from '../../config/wiki-projects'
import { isConflictWatchlistIso3 } from '../../config/watchlist'
import {
  detectAdvisoryChanges,
  mapFcdoLevel,
  nameToIso3,
  normalizeFcdoCountry,
  normalizeStateRss,
} from '../sources/advisories'
import {
  addGdeltEvent,
  describeGdeltRow,
  emptyGdeltAgg,
  GDELT_COL,
  gdeltAggToDaily,
  gdeltFipsToIso3,
  mergeGdeltStats,
  parseGdeltExportTsv,
  parseGdeltLastupdate,
} from '../sources/gdelt'
import { iodaDedupeKey, normalizeIodaOutages } from '../sources/ioda'
import {
  aggregateFirmsDaily,
  dedupeFirmsDetections,
  firmsVolumeIsLow,
  parseFirmsDetections,
  shouldKeepFirmsPoint,
} from '../sources/firms'
import { matchWikiArticles, normalizeWikiTop, wikiDaysToTry, wikiTopUrl } from '../sources/wiki-top'
import { normalizeFewsnetRows } from '../sources/fewsnet'
import {
  collapseAdvisories,
  collapseDaily,
  collapseForecasts,
  collapseMetricsByPk,
  collapseSignals,
} from '../upsert'
import type { ForecastRegion } from '../types'

const FIX = path.join(import.meta.dirname, 'fixtures')

function read(name: string): string {
  return readFileSync(path.join(FIX, name), 'utf8')
}

function readJson(name: string): unknown {
  return JSON.parse(read(name))
}

const malawi: ForecastRegion = {
  id: 88,
  level: 0,
  iso3: 'MWI',
  admin1_code: null,
  name: 'Malawi',
  name_local: 'Malawi',
  lat: -13.25,
  lon: 34.3,
}

describe('FEWS NET PK collapse (Malawi sub-units)', () => {
  it('keeps the max IPC phase and merges unit names', () => {
    const rows = [
      {
        country: 'Malawi',
        country_code: 'MW',
        geographic_unit_name: 'Balaka',
        scenario: 'ML1',
        value: 2,
        reporting_date: '2026-06-01',
      },
      {
        country: 'Malawi',
        country_code: 'MW',
        geographic_unit_name: 'Blantyre',
        scenario: 'ML1',
        value: 4,
        reporting_date: '2026-06-01',
      },
    ]
    const { metrics, unmatched } = normalizeFewsnetRows(rows, [malawi], '2026-10-08T00:00:00.000Z')
    expect(unmatched).toEqual([])
    expect(metrics).toHaveLength(1)
    expect(metrics[0].region_id).toBe(88)
    expect(metrics[0].value).toBe(4)
    expect(metrics[0].detail?.units).toEqual(['Balaka', 'Blantyre'])
    const again = collapseMetricsByPk([...metrics, ...metrics])
    expect(again).toHaveLength(1)
    expect(again[0].value).toBe(4)
  })
})

describe('FIRMS aggregation and keep rules', () => {
  it('aggregates per region/day and keeps high FRP or watchlist only', () => {
    const csv = read('firms.csv')
    const extra =
      csv +
      '-13.2,34.3,330,1,1,2026-10-08,0412,N,VIIRS,high,2.0NRT,290,150.0,N\n'
    const { detections } = parseFirmsDetections(extra)
    const assigned = detections.map((row) => ({
      ...row,
      region_id: 7,
      country_iso3: row.frp >= 100 ? 'UKR' : 'IDN',
    }))
    const daily = aggregateFirmsDaily(assigned)
    expect(daily).toHaveLength(1)
    expect(daily[0].source).toBe('firms')
    expect(daily[0].stats.count).toBe(3)
    expect(daily[0].stats.frp_max).toBe(150)
    expect(daily[0].stats.day).toBe(2)
    expect(daily[0].stats.night).toBe(1)
    expect(shouldKeepFirmsPoint(12.4, 'IDN')).toBe(false)
    expect(shouldKeepFirmsPoint(150, 'IDN')).toBe(true)
    expect(shouldKeepFirmsPoint(4.1, 'UKR')).toBe(true)
    expect(isConflictWatchlistIso3('UKR')).toBe(true)
    const kept = assigned.filter((row) => shouldKeepFirmsPoint(row.frp, row.country_iso3))
    expect(kept).toHaveLength(1)
  })
})

describe('IODA official outage envelope', () => {
  it('emits internet_outage with country ISO3 and score', () => {
    const rows = normalizeIodaOutages(readJson('ioda.json'), 'alert', new Map([['MWI', 88]]))
    expect(rows).toHaveLength(2)
    expect(rows[0].signal_type).toBe('internet_outage')
    expect(rows[0].country_iso3).toBe('MWI')
    expect(rows[0].value_num).toBe(18)
    expect(rows[0].value_raw?.region_id).toBe(88)
    expect(rows[1].value_raw?.entity_type).toBe('region')
  })
})

describe('GDELT 2.0 export sample', () => {
  it('parses lastupdate and aggregates CAMEO roots without storing events', () => {
    expect(parseGdeltLastupdate(read('gdelt-lastupdate.txt'))).toContain('20261008194500.export.CSV.zip')
    expect(GDELT_COL.ActionGeo_Lat).toBe(56)
    expect(GDELT_COL.ActionGeo_Long).toBe(57)
    expect(GDELT_COL.ActionGeo_CountryCode).toBe(53)
    expect(GDELT_COL.EventRootCode).toBe(28)
    expect(gdeltFipsToIso3('MI')).toBe('MWI')
    expect(gdeltFipsToIso3('CU')).toBe('CUB')
    expect(gdeltFipsToIso3('RS')).toBe('RUS')
    const tsv = read('gdelt-export.tsv')
    const first = tsv.split(/\n/).find((line) => line.trim()) ?? ''
    expect(describeGdeltRow(first)).toContain('ncols=61')
    expect(describeGdeltRow(first)).toContain('ActionGeo_CountryCode=MI')
    expect(describeGdeltRow(first)).toContain('ActionGeo_Lat=-13.254')
    const events = parseGdeltExportTsv(tsv)
    expect(events).toHaveLength(2)
    expect(events[0].root).toBe('14')
    expect(events[0].lat).toBeCloseTo(-13.254)
    expect(events[0].lon).toBeCloseTo(34.301)
    expect(events[0].fips).toBe('MI')
    expect(events[1].root).toBe('19')
    const agg = emptyGdeltAgg(88, '2026-10-08')
    for (const row of events) addGdeltEvent(agg, row)
    expect(agg.total_events).toBe(2)
    expect(agg.protest).toBe(1)
    expect(agg.fight).toBe(1)
    const merged = mergeGdeltStats({ total_events: 10, goldstein_sum: 5, tone_sum: -1, num_sources: 8 }, agg)
    expect(merged.total_events).toBe(12)
    const daily = gdeltAggToDaily(merged, 4.5)
    expect(daily.source).toBe('gdelt')
    expect(daily.stats.mean_30d).toBe(4.5)
    expect(daily.stats.avg_goldstein).toBeCloseTo(merged.goldstein_sum / merged.total_events)
  })
})

describe('wiki top + hazard terms', () => {
  it('matches flood/cholera and marks terms unverified', () => {
    expect(WIKI_PROJECTS).toHaveLength(40)
    expect(HAZARD_TERMS.every((row) => row.status === HAZARD_TERM_STATUS)).toBe(true)
    expect(matchHazardTitle('2026 Kerala floods', 'en')?.concept).toBe('flood')
    const articles = normalizeWikiTop(readJson('wiki-top.json'))
    expect(articles.some((row) => row.article.startsWith('Special:'))).toBe(false)
    const matches = matchWikiArticles(articles, 'en.wikipedia')
    expect(matches.map((row) => row.concept).sort()).toEqual(['cholera', 'flood'])
    expect(matches[0].status).toBe('ai_seed_unverified')
  })
})

describe('travel advisories', () => {
  it('normalizes State RSS and FCDO to 1-4 and flags change/divergence', () => {
    const state = normalizeStateRss(read('state-advisories.xml'), '2026-10-08T00:00:00.000Z')
    expect(state.advisories.find((row) => row.country_iso3 === 'AFG')?.level).toBe(4)
    expect(state.advisories.find((row) => row.country_iso3 === 'MWI')?.level).toBe(2)
    expect(nameToIso3('Curaçao')).toBe('CUW')
    expect(nameToIso3('São Tomé and Príncipe')).toBe('STP')
    expect(nameToIso3("Côte d'Ivoire")).toBe('CIV')
    expect(nameToIso3('Mexico Travel Advisory')).toBe('MEX')
    expect(nameToIso3('The Kyrgyz Republic')).toBe('KGZ')
    const dup = normalizeStateRss(
      `<rss><channel>
        <item><title>Malawi - Level 1: Exercise Normal Precautions</title></item>
        <item><title>Malawi - Level 2: Exercise Increased Caution</title></item>
        <item><title>French West Indies - Level 1: Exercise Normal Precautions</title></item>
      </channel></rss>`,
      '2026-10-08T00:00:00.000Z',
    )
    expect(dup.advisories).toHaveLength(1)
    expect(dup.advisories[0].level).toBe(2)
    expect(dup.collapsed).toBe(1)
    expect(dup.unmatched).toEqual(['French West Indies'])
    const fcdo = normalizeFcdoCountry(readJson('fcdo-country.json'), '2026-10-08T00:00:00.000Z')
    expect(fcdo?.level).toBe(4)
    expect(mapFcdoLevel(['avoid_all_but_essential_travel']).level).toBe(3)
    expect(mapFcdoLevel(['avoid_all_travel_to_parts']).level).toBe(2)
    expect(mapFcdoLevel([]).level).toBe(1)

    const incoming = [
      { country_iso3: 'AFG', source: 'us_state' as const, level: 4, level_text: 'Level 4', updated_at: '2026-10-08T00:00:00.000Z', title: 'AFG' },
      { country_iso3: 'AFG', source: 'uk_fcdo' as const, level: 1, level_text: 'none', updated_at: '2026-09-01T00:00:00.000Z', title: 'AFG' },
    ]
    const out = detectAdvisoryChanges(
      incoming,
      [{ country_iso3: 'AFG', source: 'us_state', level: 2, updated_at: '2026-09-01T00:00:00.000Z' }],
      '2026-10-08T12:00:00.000Z',
    )
    expect(out.history[0]?.previous_level).toBe(2)
    expect(out.changeSignals[0]?.signal_type).toBe('advisory_change')
    expect(out.changeSignals[0]?.value_raw?.us_state).toBe(4)
    expect(out.changeSignals[0]?.value_raw?.uk_fcdo).toBe(1)
    expect(out.divergeSignals.some((row) => row.signal_type === 'advisory_divergence')).toBe(true)
  })
})

describe('in-batch upsert collapse', () => {
  it('collapses signals, metrics, forecasts, daily, and advisories', () => {
    const signals = collapseSignals([
      {
        department: 'connectivity', source: 'ioda', signal_type: 'internet_outage', title: 'a',
        lat: null, lon: null, country_iso3: 'MWI', value_num: 2, value_raw: { tags: ['a'] },
        unit_raw: null, event_time: '2026-10-08T00:00:00.000Z', url: null, dedupe_key: 'same',
      },
      {
        department: 'connectivity', source: 'ioda', signal_type: 'internet_outage', title: 'b',
        lat: null, lon: null, country_iso3: 'MWI', value_num: 9, value_raw: { tags: ['b'] },
        unit_raw: null, event_time: '2026-10-08T01:00:00.000Z', url: null, dedupe_key: 'same',
      },
    ])
    expect(signals).toHaveLength(1)
    expect(signals[0].value_num).toBe(9)
    expect(signals[0].value_raw?.tags).toEqual(['b', 'a'])
    expect(iodaDedupeKey({ entityType: 'country', entityCode: 'MW', datasource: 'bgp', start: '2026-10-08T00:00:00.000Z' }))
      .toBe('ioda|internet_outage|country|MW|bgp|2026-10-08T00:00:00.000Z')

    const metrics = collapseMetricsByPk([
      { region_id: 1, metric: 'ipc_ml1', valid_time: 't', issued_at: 'i', value: 2, unit: 'ipc_phase', source: 'fewsnet', detail: { units: ['A'] } },
      { region_id: 1, metric: 'ipc_ml1', valid_time: 't', issued_at: 'i', value: 4, unit: 'ipc_phase', source: 'fewsnet', detail: { units: ['B'] } },
    ])
    expect(metrics).toHaveLength(1)
    expect(metrics[0].value).toBe(4)
    expect(metrics[0].detail?.units).toEqual(['A', 'B'])

    const forecasts = collapseForecasts([
      { region_id: 1, source: 'openmeteo_forecast', issued_date: '2026-10-08', issued_at: '2026-10-08T00:00:00.000Z', horizon_days: 7, series: { a: 1 } },
      { region_id: 1, source: 'openmeteo_forecast', issued_date: '2026-10-08', issued_at: '2026-10-08T06:00:00.000Z', horizon_days: 7, series: { a: 2 } },
    ])
    expect(forecasts).toHaveLength(1)
    expect(forecasts[0].series).toEqual({ a: 2 })

    const daily = collapseDaily([
      { region_id: 1, day: '2026-10-08', source: 'firms', stats: { frp_max: 10, matches: ['old'] } },
      { region_id: 1, day: '2026-10-08', source: 'firms', stats: { frp_max: 40, matches: ['new'] } },
    ])
    expect(daily).toHaveLength(1)
    expect(daily[0].stats.frp_max).toBe(40)
    expect(daily[0].stats.matches).toEqual(['new', 'old'])

    const advisories = collapseAdvisories([
      { country_iso3: 'MWI', source: 'us_state', level: 2, level_text: 'L2', updated_at: '2026-10-08T00:00:00.000Z', fetched_at: '2026-10-08T00:00:00.000Z' },
      { country_iso3: 'MWI', source: 'us_state', level: 4, level_text: 'L4', updated_at: '2026-10-07T00:00:00.000Z', fetched_at: '2026-10-08T00:00:00.000Z' },
    ])
    expect(advisories).toHaveLength(1)
    expect(advisories[0].level).toBe(4)
  })
})

describe('FIRMS low-volume sensor merge', () => {
  it('treats a short file as low and dedupes rounded coordinates', () => {
    expect(firmsVolumeIsLow(225, [])).toBe(true)
    expect(firmsVolumeIsLow(225, [16000, 15000, 16455])).toBe(true)
    expect(firmsVolumeIsLow(12000, [16000, 15000, 16455])).toBe(false)
    const { detections } = parseFirmsDetections(read('firms.csv'))
    const copy = detections.map((row) => ({ ...row, lat: row.lat + 0.004, frp: row.frp + 1 }))
    const merged = dedupeFirmsDetections([...detections, ...copy])
    expect(merged.length).toBe(detections.length)
    expect(merged[0].frp).toBeGreaterThan(detections[0].frp)
  })
})

describe('wiki day fallback', () => {
  it('tries yesterday then the day before on the documented REST path', () => {
    const days = wikiDaysToTry(new Date('2026-10-09T12:00:00.000Z'))
    expect(days.map((day) => day.toISOString().slice(0, 10))).toEqual(['2026-10-08', '2026-10-07'])
    expect(wikiTopUrl('fa.wikipedia', days[0])).toBe(
      'https://wikimedia.org/api/rest_v1/metrics/pageviews/top/fa.wikipedia/all-access/2026/10/08',
    )
    expect(wikiTopUrl('uk.wikipedia', days[1])).toContain('/uk.wikipedia/all-access/2026/10/07')
  })
})
