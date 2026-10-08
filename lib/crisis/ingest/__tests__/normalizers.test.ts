import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  billedCallsToday,
  estimateBilledCalls,
  OPENMETEO_BATCH_SIZE,
  OPENMETEO_COORD_DECIMALS,
  OPENMETEO_DAILY_BILLED_CAP,
  OPENMETEO_MAX_URL_CHARS,
  OPENMETEO_MINUTE_BILLED_CAP,
  remainingBudget,
  sleepMsForMinuteBudget,
  wouldExceedBudget,
} from '../budget'
import { buildDedupeKey } from '../dedupe'
import { normalizeEmsc } from '../sources/emsc'
import { EONET_CAP, EONET_KEEP, normalizeEonet } from '../sources/eonet'
import { normalizeFewsnetRows } from '../sources/fewsnet'
import { FIRMS_ROW_CAP, firmsConfidenceKeep, normalizeFirmsCsv } from '../sources/firms'
import { normalizeGdacsRss } from '../sources/gdacs'
import { buildGlofasForecasts } from '../sources/glofas'
import { normalizeInformScores } from '../sources/inform'
import { normalizeNhcStorms } from '../sources/nhc-jtwc'
import { buildOpenMeteoForecasts, forecastUrl, formatCoord, trimBatchToUrlLimit } from '../sources/openmeteo-forecast'
import {
  OPENMETEO_COMBINED_DAILY_CAP,
  OPENMETEO_SEED_BILLED,
  OPENMETEO_SEED_DATE_UTC,
  addBilled,
  extrapolateCount,
  providerAllowance,
  resolveQuotaLedger,
} from '../quota'
import { glofasUrl } from '../sources/glofas'
import { normalizeTsunamiAtom } from '../sources/tsunami'
import { normalizeUsgs } from '../sources/usgs'
import { normalizeHans } from '../sources/volcano'
import type { ForecastRegion } from '../types'

const FIX = path.join(import.meta.dirname, 'fixtures')

function read(name: string): string {
  return readFileSync(path.join(FIX, name), 'utf8')
}

function readJson(name: string): unknown {
  return JSON.parse(read(name))
}

const afar: ForecastRegion = {
  id: 11,
  level: 1,
  iso3: 'ETH',
  admin1_code: 'ET-AF',
  name: 'Afar',
  name_local: 'Afar',
  lat: 12,
  lon: 41,
}

describe('USGS all_hour fixture (crisis-probe geology raw_sample)', () => {
  it('keeps magnitude, depth, tsunami flag', () => {
    const rows = normalizeUsgs(readJson('usgs-all-hour.json'))
    expect(rows).toHaveLength(1)
    expect(rows[0].value_num).toBe(5)
    expect(rows[0].value_raw?.depth_km).toBe(10)
    expect(rows[0].value_raw?.tsunami).toBe(0)
    expect(rows[0].lat).toBeCloseTo(-7.7761)
    expect(rows[0].lon).toBeCloseTo(120.5395)
    expect(rows[0].source).toBe('usgs')
  })
})

describe('EMSC FDSN fixture (crisis-probe out2/emsc)', () => {
  it('dedupes against itself only', () => {
    const rows = normalizeEmsc(readJson('emsc.json'))
    expect(rows).toHaveLength(1)
    expect(rows[0].source).toBe('emsc')
    expect(rows[0].value_num).toBe(2.1)
    expect(rows[0].dedupe_key.startsWith('emsc|')).toBe(true)
  })
})

describe('GDACS RSS fixture', () => {
  it('reads alert level, severity, event type', () => {
    const rows = normalizeGdacsRss(read('gdacs.xml'))
    expect(rows[0].signal_type).toBe('TC')
    expect(rows[0].value_raw?.alert_level).toBe('Orange')
    expect(rows[0].value_num).toBeCloseTo(203.7024)
  })
})

describe('EONET open events fixture', () => {
  it('keeps storms, drops wildfires, uses the latest geometry point', () => {
    const { signals, beforeCap, capped } = normalizeEonet(readJson('eonet.json'))
    expect(signals).toHaveLength(1)
    expect(signals[0].title).toBe('Tropical Storm Isaias')
    expect(signals[0].signal_type).toBe('severeStorms')
    expect(signals[0].value_num).toBe(35)
    expect(signals.some((row) => row.signal_type === 'wildfires')).toBe(false)
    expect(EONET_KEEP.has('wildfires')).toBe(false)
    expect(beforeCap).toBe(1)
    expect(capped).toBe(false)
  })

  it('caps at 500 and reports the overflow', () => {
    const events = Array.from({ length: 520 }, (_, i) => ({
      id: `EONET_${i}`,
      title: `Storm ${i}`,
      categories: [{ id: 'severeStorms' }],
      geometry: [{ date: '2026-10-07T09:00:00Z', type: 'Point', coordinates: [i, 10] }],
    }))
    const { signals, capped, beforeCap } = normalizeEonet({ events }, EONET_CAP)
    expect(beforeCap).toBe(520)
    expect(signals).toHaveLength(500)
    expect(capped).toBe(true)
  })
})

describe('NHC forecast points', () => {
  it('stores cyclone_forecast_point with valid_time in value_raw', () => {
    const rows = normalizeNhcStorms(readJson('nhc.json'))
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.signal_type === 'cyclone_forecast_point')).toBe(true)
    expect(rows[0].value_raw?.valid_time).toBe('2026-10-08T00:00:00.000Z')
  })
})

describe('Tsunami Atom fixture', () => {
  it('parses PTWC georss', () => {
    const rows = normalizeTsunamiAtom(read('tsunami.xml'), 'PTWC')
    expect(rows[0].signal_type).toBe('tsunami_bulletin')
    expect(rows[0].lat).toBeCloseTo(-7.8)
    expect(rows[0].lon).toBeCloseTo(120.5)
  })
})

describe('USGS HANS volcano fixture', () => {
  it('keeps aviation color code', () => {
    const rows = normalizeHans(readJson('volcano-hans.json'))
    expect(rows[0].signal_type).toBe('elevated_volcano')
    expect(rows[0].value_raw?.color_code).toBe('ORANGE')
    expect(rows[0].country_iso3).toBe('USA')
  })
})

describe('FIRMS VIIRS CSV fixture', () => {
  it('keeps high/nominal and VIIRS h/n, drops l, keeps MODIS >= 30', () => {
    const parsed = normalizeFirmsCsv(read('firms.csv'))
    expect(parsed.signals).toHaveLength(2)
    expect(parsed.before).toBe(3)
    expect(firmsConfidenceKeep('h')).toBe(true)
    expect(firmsConfidenceKeep('n')).toBe(true)
    expect(firmsConfidenceKeep('l')).toBe(false)
    expect(firmsConfidenceKeep('80')).toBe(true)
    expect(firmsConfidenceKeep('10')).toBe(false)
    const letters = normalizeFirmsCsv(
      'latitude,longitude,confidence,frp,acq_date,acq_time,satellite\n1,2,h,3,2026-10-08,0100,N\n1,3,l,1,2026-10-08,0100,N\n1,4,85,9,2026-10-08,0100,T\n',
    )
    expect(letters.signals).toHaveLength(2)
    expect(letters.signals.map((row) => row.value_raw?.confidence)).toEqual(['85', 'h'])
    expect(FIRMS_ROW_CAP).toBe(20000)
  })
})

describe('Open-Meteo compact forecast', () => {
  it('emits one row per region with the series blob', () => {
    const region: ForecastRegion = { ...afar, id: 1, iso3: 'NPL', name: 'Bagmati', lat: 27.7172, lon: 85.324 }
    const rows = buildOpenMeteoForecasts(readJson('openmeteo.json'), [region], '2026-10-08T00:00:00.000Z')
    expect(rows).toHaveLength(1)
    expect(rows[0].source).toBe('openmeteo_forecast')
    expect(rows[0].issued_date).toBe('2026-10-08')
    expect(rows[0].horizon_days).toBe(2)
    const series = rows[0].series
    expect(series.dates).toEqual(['2026-10-08', '2026-10-09'])
    expect(series.precip_mm).toEqual([2.1, 0.4])
    expect(series.tmax_c).toEqual([22.1, 21])
    expect(series.tmin_c).toEqual([12, 11.5])
    expect(series.wind_max_ms).toEqual([8.2, 9.1])
  })
})

describe('GloFAS compact forecast', () => {
  it('stores discharge and the 30-day ratio in one series', () => {
    const region: ForecastRegion = { ...afar, id: 9, iso3: 'NPL', name: 'Bagmati', lat: 27.7172, lon: 85.324 }
    const rows = buildGlofasForecasts(readJson('glofas.json'), [region], '2026-10-08T00:00:00.000Z', new Map([[9, 100]]))
    expect(rows).toHaveLength(1)
    expect(rows[0].source).toBe('glofas')
    expect(rows[0].series.discharge_m3s).toEqual([120.5, 130])
    expect(rows[0].series.ratio_to_30d_mean).toEqual([1.205, 1.3])
  })
})

describe('Open-Meteo quota ledger', () => {
  const today = new Date('2026-10-08T12:00:00.000Z')

  it('seeds 4586 when today has no billed_today', () => {
    const resolved = resolveQuotaLedger(null, today)
    expect(resolved.seeded).toBe(true)
    expect(resolved.ledger).toEqual({ date_utc: OPENMETEO_SEED_DATE_UTC, billed_today: OPENMETEO_SEED_BILLED })
    expect(addBilled(resolved.ledger, 100).billed_today).toBe(4686)
  })

  it('does not reseed once today is recorded, and resets on the next UTC day', () => {
    const kept = resolveQuotaLedger({ date_utc: '2026-10-08', billed_today: 4700 }, today)
    expect(kept.seeded).toBe(false)
    expect(kept.ledger.billed_today).toBe(4700)
    const next = resolveQuotaLedger({ date_utc: '2026-10-08', billed_today: 4700 }, new Date('2026-10-09T00:00:00.000Z'))
    expect(next.ledger).toEqual({ date_utc: '2026-10-09', billed_today: 0 })
  })

  it('gives forecast priority up to 5000 and glofas the remainder of 9000', () => {
    expect(providerAllowance('openmeteo_forecast', 4586)).toBe(414)
    expect(providerAllowance('glofas', 4586)).toBe(4000)
    expect(providerAllowance('openmeteo_forecast', 4586) + providerAllowance('glofas', 4586)).toBe(OPENMETEO_COMBINED_DAILY_CAP - 4586)
    expect(providerAllowance('openmeteo_forecast', 9000)).toBe(0)
    expect(providerAllowance('glofas', 9000)).toBe(0)
    expect(extrapolateCount(100, 100, 4600)).toBe(4600)
  })
})

describe('FEWS NET name match', () => {
  it('maps Afar/ET and logs unmatched', () => {
    const { metrics, unmatched } = normalizeFewsnetRows(readJson('fewsnet.json') as unknown[], [afar], '2026-10-08T00:00:00.000Z')
    expect(metrics).toHaveLength(1)
    expect(metrics[0].region_id).toBe(11)
    expect(metrics[0].metric).toBe('ipc_ml1')
    expect(unmatched.some((row) => /Unknown District/.test(row))).toBe(true)
  })
})

describe('INFORM country scores', () => {
  it('writes to the country region', () => {
    const rows = normalizeInformScores(
      readJson('inform.json') as unknown[],
      'inform_risk',
      new Map([
        ['AFG', 100],
        ['ETH', 200],
      ]),
      '2026-09-02T00:00:00.000Z',
      '2026-10-08T00:00:00.000Z',
    )
    expect(rows).toHaveLength(2)
    expect(rows[0].value).toBeCloseTo(7.8)
    expect(rows[0].valid_time).toBe('2026-09-02T00:00:00.000Z')
  })
})

describe('dedupe key stability', () => {
  it('is identical for the same USGS inputs', () => {
    const a = normalizeUsgs(readJson('usgs-all-hour.json'))[0]
    const b = normalizeUsgs(readJson('usgs-all-hour.json'))[0]
    expect(a.dedupe_key).toBe(b.dedupe_key)
    expect(buildDedupeKey({ source: 'usgs', signalType: 'earthquake', id: 'us6000u0wa', lat: -7.7761, lon: 120.5395, eventTime: a.event_time })).toBe(a.dedupe_key)
  })
})

describe('budget guard math', () => {
  it('counts one billed call per location at forecast_days=7', () => {
    expect(estimateBilledCalls(4833)).toBe(4833)
    expect(wouldExceedBudget(4800, 500, OPENMETEO_DAILY_BILLED_CAP)).toBe(true)
    expect(wouldExceedBudget(4000, 500, OPENMETEO_DAILY_BILLED_CAP)).toBe(false)
    expect(remainingBudget(4500, 5000)).toBe(500)
    expect(billedCallsToday({ billed_date: '2026-10-07', billed_calls: 4000 }, new Date('2026-10-08T00:00:00Z'))).toBe(0)
    expect(billedCallsToday({ billed_date: '2026-10-08', billed_calls: 4000 }, new Date('2026-10-08T12:00:00Z'))).toBe(4000)
  })

  it('sleeps when a rolling minute would exceed 500 billed calls', () => {
    const now = 1_000_000
    const stamps = Array.from({ length: 450 }, (_, i) => now - 10_000 + i)
    expect(sleepMsForMinuteBudget(stamps, 40, now, OPENMETEO_MINUTE_BILLED_CAP)).toBe(0)
    expect(sleepMsForMinuteBudget(stamps, 60, now, OPENMETEO_MINUTE_BILLED_CAP)).toBeGreaterThan(0)
  })
})

describe('Open-Meteo batching', () => {
  it('uses 100-location batches, 3-decimal coords, and stays under 7000 chars', () => {
    expect(OPENMETEO_BATCH_SIZE).toBe(100)
    expect(OPENMETEO_COORD_DECIMALS).toBe(3)
    expect(formatCoord(-7.7761)).toBe('-7.776')
    const many: ForecastRegion[] = Array.from({ length: 100 }, (_, i) => ({
      ...afar,
      id: i + 1,
      lat: -7.7761 + i * 0.01,
      lon: 120.5395 + i * 0.01,
    }))
    const url = forecastUrl(many)
    expect(url.length).toBeLessThanOrEqual(OPENMETEO_MAX_URL_CHARS)
    expect(url).toContain('latitude=-7.776')
    expect(url).toContain('wind_speed_unit=ms')
    const flood = glofasUrl(many)
    expect(flood.length).toBeLessThanOrEqual(OPENMETEO_MAX_URL_CHARS)
    const trimmed = trimBatchToUrlLimit(many, forecastUrl, 800)
    expect(trimmed.length).toBeLessThan(100)
    expect(forecastUrl(trimmed).length).toBeLessThanOrEqual(800)
  })
})
