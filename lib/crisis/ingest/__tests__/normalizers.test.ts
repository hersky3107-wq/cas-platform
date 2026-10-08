import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  billedCallsToday,
  estimateBilledCalls,
  OPENMETEO_DAILY_BILLED_CAP,
  remainingBudget,
  wouldExceedBudget,
} from '../budget'
import { buildDedupeKey } from '../dedupe'
import { normalizeEmsc } from '../sources/emsc'
import { normalizeEonet } from '../sources/eonet'
import { normalizeFewsnetRows } from '../sources/fewsnet'
import { FIRMS_ROW_CAP, normalizeFirmsCsv } from '../sources/firms'
import { normalizeGdacsRss } from '../sources/gdacs'
import { normalizeGlofas, withDischargeRatio } from '../sources/glofas'
import { normalizeInformScores } from '../sources/inform'
import { normalizeNhcStorms } from '../sources/nhc-jtwc'
import { normalizeOpenMeteoForecast } from '../sources/openmeteo-forecast'
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
  it('uses the latest geometry point', () => {
    const rows = normalizeEonet(readJson('eonet.json'))
    expect(rows[0].title).toBe('Tropical Storm Isaias')
    expect(rows[0].signal_type).toBe('severeStorms')
    expect(rows[0].value_num).toBe(35)
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
  it('keeps high/nominal only and respects the cap', () => {
    const rows = normalizeFirmsCsv(read('firms.csv'))
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => ['high', 'nominal'].includes(String(row.value_raw?.confidence)))).toBe(true)
    expect(FIRMS_ROW_CAP).toBe(5000)
  })
})

describe('Open-Meteo daily forecast', () => {
  it('emits one metric row per day and field', () => {
    const region: ForecastRegion = { ...afar, id: 1, iso3: 'NPL', name: 'Bagmati', lat: 27.7172, lon: 85.324 }
    const rows = normalizeOpenMeteoForecast(readJson('openmeteo.json'), [region], '2026-10-08T00:00:00.000Z')
    expect(rows).toHaveLength(8)
    expect(rows.filter((row) => row.metric === 'precipitation_sum')).toHaveLength(2)
  })
})

describe('GloFAS discharge + 30-day ratio', () => {
  it('stores discharge and ratio when a mean exists', () => {
    const region: ForecastRegion = { ...afar, id: 9, iso3: 'NPL', name: 'Bagmati', lat: 27.7172, lon: 85.324 }
    const rows = normalizeGlofas(readJson('glofas.json'), [region], '2026-10-08T00:00:00.000Z')
    expect(rows[0].metric).toBe('river_discharge')
    expect(rows[0].value).toBeCloseTo(120.5)
    const extra = withDischargeRatio(rows, new Map([[9, 100]]))
    expect(extra[0].metric).toBe('river_discharge_vs_30d_mean')
    expect(extra[0].value).toBeCloseTo(1.205)
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
})
