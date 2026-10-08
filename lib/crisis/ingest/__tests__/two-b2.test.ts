import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { HAZARD_TERM_STATUS, HAZARD_TERMS, matchHazardTitle } from '../../config/hazard-terms'
import { WIKI_PROJECTS } from '../../config/wiki-projects'
import { isConflictWatchlistIso3 } from '../../config/watchlist'
import {
  detectAdvisoryChanges,
  mapFcdoLevel,
  normalizeFcdoCountry,
  normalizeStateRss,
} from '../sources/advisories'
import {
  addGdeltEvent,
  emptyGdeltAgg,
  gdeltAggToDaily,
  gdeltFipsToIso3,
  mergeGdeltStats,
  parseGdeltExportTsv,
  parseGdeltLastupdate,
} from '../sources/gdelt'
import { normalizeIodaOutages } from '../sources/ioda'
import {
  aggregateFirmsDaily,
  parseFirmsDetections,
  shouldKeepFirmsPoint,
} from '../sources/firms'
import { matchWikiArticles, normalizeWikiTop } from '../sources/wiki-top'
import { normalizeFewsnetRows } from '../sources/fewsnet'
import { collapseMetricsByPk } from '../upsert'
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
    expect(gdeltFipsToIso3('MI')).toBe('MWI')
    expect(gdeltFipsToIso3('RS')).toBe('RUS')
    const events = parseGdeltExportTsv(read('gdelt-export.tsv'))
    expect(events).toHaveLength(2)
    expect(events[0].root).toBe('14')
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
    expect(state.find((row) => row.country_iso3 === 'AFG')?.level).toBe(4)
    expect(state.find((row) => row.country_iso3 === 'MWI')?.level).toBe(2)
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
