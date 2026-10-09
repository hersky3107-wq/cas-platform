import { describe, expect, it } from 'vitest'
import { hazardsFromGdacsType, hazardsFromReliefwebTypes, hazardsOf, sameHazard } from '../../config/hazard-taxonomy'
import { isOilDependentIso3 } from '../../config/oil'
import { oilContextLine, oilFromRows, observedRainFromRows } from '../../score/snapshot'
import { internetRaw, observedRainAdjust, outageActive, rainComponent } from '../../score/trigger'
import { looksLikeJwt } from '../earthdata'
import { countriesInText } from '../sources/advisories'
import { normalizeCloudflareOutages } from '../sources/cloudflare-radar'
import { eiaUrl, normalizeEiaSpot } from '../sources/eia'
import { normalizeMetaculusPosts } from '../sources/metaculus'
import { imergCell, imergGranules, imergPointUrl, parseImergAscii, pickImergDays, rankImergTargets, threeDayTotal } from '../sources/nasa-imerg'
import { normalizeReliefwebDisasters, normalizeReliefwebReports, reliefwebDate, reportsSince } from '../sources/reliefweb'

const NOW = new Date('2026-10-09T00:00:00Z')

describe('hazard taxonomy', () => {
  it('reads hazards from text, ReliefWeb types, and GDACS codes', () => {
    expect(hazardsOf('Floods and landslides in Badulla')).toEqual(expect.arrayContaining(['flood', 'landslide']))
    expect(hazardsOf('Dengue cases rise')).toEqual(expect.arrayContaining(['dengue', 'disease']))
    expect(hazardsFromReliefwebTypes(['Flash Flood', 'Land Slide'])).toEqual(expect.arrayContaining(['flood', 'landslide']))
    expect(hazardsFromGdacsType('TC')).toContain('cyclone')
    expect(hazardsFromGdacsType('fl')).toEqual(['flood'])
  })

  it('matches a specific disease only against the same disease or the umbrella', () => {
    expect(sameHazard(['flood'], ['flood', 'displacement'])).toBe('flood')
    expect(sameHazard(['dengue', 'disease'], ['cholera', 'disease'])).toBeNull()
    expect(sameHazard(['disease'], ['cholera', 'disease'])).toBe('disease')
    expect(sameHazard(['earthquake'], ['flood'])).toBeNull()
  })
})

describe('countriesInText', () => {
  it('finds names and demonyms longest first, and not inside words', () => {
    expect(countriesInText('Will Sri Lanka declare a flood emergency?')).toEqual(['LKA'])
    expect(countriesInText('Will Israeli strikes hit Lebanon before Iran talks?')).toEqual(expect.arrayContaining(['ISR', 'LBN', 'IRN']))
    expect(countriesInText('Will the US and UK sign?')).toEqual(expect.arrayContaining(['USA', 'GBR']))
    expect(countriesInText('Will the virus spread in the community?')).toEqual([])
  })
})

describe('ReliefWeb', () => {
  it('normalizes reports and disasters into reliefweb_report signals', () => {
    const reports = normalizeReliefwebReports({
      data: [
        {
          id: 101,
          fields: {
            title: 'Sri Lanka: Floods - Badulla District Situation Report',
            url_alias: 'https://reliefweb.int/report/sri-lanka/floods-badulla',
            date: { created: '2026-10-05T10:00:00+00:00', original: '2026-10-04T00:00:00+00:00' },
            primary_country: { iso3: 'lka' },
            country: [{ iso3: 'LKA' }],
            disaster_type: [{ name: 'Flood' }],
            source: [{ shortname: 'DMC' }],
          },
        },
        { id: 102, fields: { url: 'https://reliefweb.int/x' } },
      ],
    })
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({
      source: 'reliefweb',
      signal_type: 'reliefweb_report',
      country_iso3: 'LKA',
      url: 'https://reliefweb.int/report/sri-lanka/floods-badulla',
      event_time: '2026-10-04T00:00:00.000Z',
    })
    expect((reports[0].value_raw as { hazards: string[] }).hazards).toContain('flood')
    const disasters = normalizeReliefwebDisasters({
      data: [{ id: 7, fields: { name: 'Sri Lanka: Floods - Oct 2026', status: 'ongoing', country: [{ iso3: 'LKA' }], type: [{ name: 'Flood' }], date: { event: '2026-10-01T00:00:00+00:00' } } }],
    })
    expect(disasters[0].value_raw).toMatchObject({ kind: 'disaster', status: 'ongoing' })
    expect(disasters[0].dedupe_key).not.toBe(reports[0].dedupe_key)
  })

  it('drops milliseconds for the range filter and floors the cursor at 30 days', () => {
    expect(reliefwebDate('2026-10-09T06:00:00.000Z')).toBe('2026-10-09T06:00:00+00:00')
    expect(reportsSince(null, NOW)).toBe('2026-09-09T00:00:00.000Z')
    expect(reportsSince({ reports_since: '2026-10-08T12:00:00.000Z' }, NOW)).toBe('2026-10-08T11:00:00.000Z')
  })
})

describe('Metaculus', () => {
  it('stores title, url, countries, close date, and a hidden probability as null', () => {
    const rows = normalizeMetaculusPosts(
      {
        results: [
          {
            id: 555,
            slug: 'sri-lanka-flood-emergency',
            title: 'Will Sri Lanka declare a national flood emergency before 2027?',
            published_at: '2026-09-01T00:00:00Z',
            question: { id: 9, type: 'binary', scheduled_close_time: '2026-12-31T00:00:00Z' },
          },
          {
            id: 556,
            title: 'Will Pakistan hold elections?',
            question: { id: 10, type: 'binary', aggregations: { recency_weighted: { latest: { centers: [0.42] } } } },
          },
        ],
      },
      'geopolitics',
    )
    expect(rows[0]).toMatchObject({
      signal_type: 'metaculus_question',
      country_iso3: 'LKA',
      url: 'https://www.metaculus.com/questions/555/sri-lanka-flood-emergency/',
      value_num: null,
    })
    expect(rows[0].value_raw).toMatchObject({ probability_hidden: true, close_time: '2026-12-31T00:00:00.000Z', countries: ['LKA'] })
    expect(rows[1].value_num).toBe(0.42)
  })
})

describe('Cloudflare Radar', () => {
  it('writes one internet_outage signal per country and counts annotations without one', () => {
    const { signals, noCountry } = normalizeCloudflareOutages({
      result: {
        annotations: [
          { id: 'a1', locations: ['LK', 'IN'], startDate: '2026-10-08T00:00:00Z', endDate: null, outage: { outageType: 'NATIONWIDE', outageCause: 'POWER_OUTAGE' }, description: 'Power cut' },
          { id: 'a2', locations: [], asnsDetails: [], startDate: '2026-10-08T00:00:00Z', outage: { outageType: 'NETWORK' } },
        ],
      },
    })
    expect(noCountry).toBe(1)
    expect(signals.map((row) => row.country_iso3)).toEqual(['LKA', 'IND'])
    expect(signals[0]).toMatchObject({ source: 'cloudflare', signal_type: 'internet_outage', value_num: 4 })
    expect(signals[0].dedupe_key).toBe('cloudflare|internet_outage|a1|LKA')
  })

  it('keeps an open Cloudflare outage active, and marks corroboration when both sources agree', () => {
    const since = '2026-10-06T00:00:00.000Z'
    expect(outageActive({ source: 'cloudflare', eventTime: '2026-09-20T00:00:00Z', until: null }, since)).toBe(true)
    expect(outageActive({ source: 'cloudflare', eventTime: '2026-09-20T00:00:00Z', until: '2026-09-21T00:00:00Z' }, since)).toBe(false)
    expect(outageActive({ source: 'ioda', eventTime: '2026-10-07T00:00:00Z', until: null }, since)).toBe(true)
    expect(internetRaw(['ioda', 'cloudflare'])).toMatchObject({ ioda: true, cloudflare: true, corroborated: true })
    expect(internetRaw(['ioda'])).toMatchObject({ corroborated: false })
  })
})

describe('EIA', () => {
  it('builds the spot URL and global metrics for Brent and WTI', () => {
    expect(eiaUrl('k')).toContain('facets[series][]=RBRTE')
    const rows = normalizeEiaSpot(
      { response: { data: [
        { period: '2026-10-06', series: 'RBRTE', value: '125.44' },
        { period: '2026-10-06', series: 'RWTC', value: 96.24 },
        { period: '2026-10-06', series: 'OTHER', value: 1 },
      ] } },
      '2026-10-09T00:00:00.000Z',
    )
    expect(rows.map((row) => [row.metric, row.value, row.valid_time])).toEqual([
      ['brent_usd', 125.44, '2026-10-06T00:00:00.000Z'],
      ['wti_usd', 96.24, '2026-10-06T00:00:00.000Z'],
    ])
  })

  it('computes the 30-day change and only oil-dependent economies get the line', () => {
    const oil = oilFromRows([
      { metric: 'brent_usd', valid_time: '2026-10-06T00:00:00Z', value: 110 },
      { metric: 'brent_usd', valid_time: '2026-09-05T00:00:00Z', value: 100 },
      { metric: 'wti_usd', valid_time: '2026-10-06T00:00:00Z', value: 90 },
    ])
    expect(oil?.brent).toMatchObject({ value: 110, change30: 10 })
    expect(oil?.wti?.change30).toBeNull()
    expect(oilContextLine(oil)).toBe('oil: Brent $110.00 (2026-10-06, +10% vs 30d); WTI $90.00 (2026-10-06) [EIA]')
    expect(isOilDependentIso3('LKA')).toBe(true)
    expect(isOilDependentIso3('NGA')).toBe(true)
    expect(isOilDependentIso3('ISL')).toBe(false)
  })
})

describe('NASA IMERG', () => {
  it('maps a point to the 0.1 degree cell and parses the DAP2 ASCII value', () => {
    expect(imergCell(6.99, 81.06)).toEqual({ lonIndex: 2610, latIndex: 969 })
    const ascii = (value: string) =>
      `Dataset: 3B-DAY-L.MS.MRG.3IMERG.20261007-S000000-E235959.V07C.nc4\nprecipitation.lat, 6.95000000000001\nprecipitation.precipitation[precipitation.time=17076][precipitation.lon=81.05], ${value}\n`
    expect(parseImergAscii(ascii('2.47'))).toBe(2.47)
    expect(parseImergAscii(ascii('-9999.9'))).toBeNull()
    expect(parseImergAscii('Dataset: ERROR\nstatus, 400')).toBeNull()
    expect(imergPointUrl('https://opendap.earthdata.nasa.gov/x/3B-DAY.nc4', 6.99, 81.06)).toBe(
      'https://opendap.earthdata.nasa.gov/x/3B-DAY.nc4.ascii?precipitation%5B0%3A0%5D%5B2610%3A2610%5D%5B969%3A969%5D',
    )
  })

  it('prefers Late, falls back to Early, and needs all three days for a total', () => {
    const granules = imergGranules({ feed: { entry: [
      { time_start: '2026-10-07T00:00:00Z', links: [{ href: 'https://opendap.earthdata.nasa.gov/a.nc4.html' }] },
      { time_start: '2026-10-06T00:00:00Z', links: [{ href: 'https://example.com/b' }] },
    ] } })
    expect([...granules.entries()]).toEqual([['2026-10-07', 'https://opendap.earthdata.nasa.gov/a.nc4']])
    const late = new Map([['2026-10-06', 'L6'], ['2026-10-07', 'L7']])
    const early = new Map([['2026-10-07', 'E7'], ['2026-10-08', 'E8']])
    expect(pickImergDays(late, early)).toEqual([
      { day: '2026-10-08', run: 'early', url: 'E8' },
      { day: '2026-10-07', run: 'late', url: 'L7' },
      { day: '2026-10-06', run: 'late', url: 'L6' },
    ])
    const values = new Map([
      ['2026-10-08', { value: 1.5, run: 'early' as const }],
      ['2026-10-07', { value: 2, run: 'late' as const }],
    ])
    expect(threeDayTotal(values, ['2026-10-08', '2026-10-07', '2026-10-06'])).toBeNull()
    values.set('2026-10-06', { value: 0.25, run: 'late' })
    expect(threeDayTotal(values, ['2026-10-08', '2026-10-07', '2026-10-06'])).toEqual({ total: 3.75, runs: ['early', 'late', 'late'] })
  })

  it('reads rain-forecast regions first, then stage and score', () => {
    const target = (region_id: number, stage: number, score: number) => ({ region_id, lat: 0, lon: 0, stage, score })
    const ranked = rankImergTargets(
      [target(1, 5, 90), target(2, 2, 40), target(3, 3, 60), target(4, 4, 70)],
      new Map([[2, 0.8], [3, 0.2]]),
    )
    expect(ranked.map((row) => row.region_id)).toEqual([2, 3, 1, 4])
  })

  it('downgrades a high forecast when three observed days stay dry, and confirms heavy observed rain', () => {
    const forecast = rainComponent([60, 50, 40, 30, 20, 10, 0])
    expect(forecast.value).toBeGreaterThanOrEqual(0.5)
    const dry = observedRainAdjust(forecast, { sum3: 4, maxDay: 2, days: ['a', 'b', 'c'], runs: ['late'] })
    expect(dry.value).toBeCloseTo(forecast.value * 0.8)
    expect(dry.raw.observed).toBe('downgraded')
    const wet = observedRainAdjust(forecast, { sum3: 90, maxDay: 55, days: ['a', 'b', 'c'], runs: ['late'] })
    expect(wet.value).toBe(forecast.value)
    expect(wet.raw.observed).toBe('confirmed')
    expect(observedRainAdjust(forecast, null)).toBe(forecast)
  })

  it('reads the latest three-day total and the wettest day per region', () => {
    const observed = observedRainFromRows([
      { region_id: 1, metric: 'imerg_precip_1d', valid_time: '2026-10-08T00:00:00Z', value: 30, detail: {}, issued_at: '2026-10-09T00:00:00Z' },
      { region_id: 1, metric: 'imerg_precip_1d', valid_time: '2026-10-07T00:00:00Z', value: 10, detail: {}, issued_at: '2026-10-09T00:00:00Z' },
      { region_id: 1, metric: 'imerg_precip_1d', valid_time: '2026-10-06T00:00:00Z', value: 5, detail: {}, issued_at: '2026-10-09T00:00:00Z' },
      { region_id: 1, metric: 'imerg_precip_3d', valid_time: '2026-10-08T00:00:00Z', value: 45, detail: { days: ['2026-10-08', '2026-10-07', '2026-10-06'], runs: ['early', 'late', 'late'] }, issued_at: '2026-10-09T00:00:00Z' },
    ])
    expect(observed.get(1)).toEqual({ sum3: 45, maxDay: 30, days: ['2026-10-08', '2026-10-07', '2026-10-06'], runs: ['early', 'late', 'late'] })
  })
})

describe('Earthdata', () => {
  it('recognises an EDL token by shape', () => {
    expect(looksLikeJwt('eyJhbGciOi.eyJzdWIi.c2ln')).toBe(true)
    expect(looksLikeJwt('hunter2')).toBe(false)
  })
})
