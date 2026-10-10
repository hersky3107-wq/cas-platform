import { describe, expect, it } from 'vitest'
import { CASCADE_SEEDS, cascadeCounts } from '../cascades.seed'
import { validateCascades } from '../validate'
import {
  isLargeDam,
  normalizeGdwBarrier,
  normalizeUnhcrLocation,
  normalizeWriPlant,
} from '../../fragility/normalize'
import { FIXED_SLOTS, isFixedScheduleDue, nextFixedSlot } from '../../ingest/schedule'
import { isDue } from '../../ingest/run'
import type { CrisisSource } from '../../ingest/types'

const CHECKED_URLS = new Set([
  'https://reliefweb.int/disaster/fl-2023-000168-lby',
  'https://www.who.int/health-topics/floods',
  'https://www.who.int/news-room/fact-sheets/detail/cholera',
  'https://www.who.int/news-room/fact-sheets/detail/measles',
  'https://www.who.int/health-topics/wildfires',
])

describe('cascade seed', () => {
  it('accepts the library', () => {
    expect(validateCascades(CASCADE_SEEDS)).toEqual([])
    const counts = cascadeCounts()
    expect(counts.total).toBe(42)
    expect(counts.sourced).toBe(10)
    expect(counts.hypothesis).toBe(32)
  })

  it('only allows https URLs that were checked, and empty sources on hypotheses', () => {
    for (const row of CASCADE_SEEDS) {
      if (row.evidence_level === 'hypothesis') {
        expect(row.sources).toEqual([])
        continue
      }
      expect(row.sources.length).toBeGreaterThan(0)
      for (const source of row.sources) {
        expect(source.url.startsWith('https://')).toBe(true)
        expect(CHECKED_URLS.has(source.url)).toBe(true)
      }
    }
  })

  it('rejects a sourced row with a placeholder URL', () => {
    const bad = {
      ...CASCADE_SEEDS[0],
      id: 'bad-url',
      sources: [{ title: 'x', url: 'https://example.com/flood', publisher: 'x', year: 2024 }],
    }
    expect(validateCascades([bad, ...CASCADE_SEEDS.slice(1)]).some((line) => line.includes('fake'))).toBe(true)
  })
})

describe('fragility normalizers', () => {
  it('keeps large GDW dams and drops the rest', () => {
    const small = normalizeGdwBarrier({
      DAM_NAME: 'Small',
      DAM_HGT_M: '8',
      CAP_MCM: '2',
      GRAND_ID: '-99',
      LAT_DAM: '10',
      LONG_DAM: '20',
    })
    const tall = normalizeGdwBarrier({
      DAM_NAME: 'Tall',
      DAM_HGT_M: '40',
      CAP_MCM: '-99',
      GRAND_ID: '-99',
      YEAR_DAM: '1980',
      RIVER: 'Nile',
      COUNTRY: 'Egypt',
      LAT_DAM: '24.1',
      LONG_DAM: '32.9',
    })
    const reservoir = normalizeGdwBarrier({
      DAM_NAME: 'Wide',
      DAM_HGT_M: '-99',
      CAP_MCM: '250',
      LAT_RIV: '1.5',
      LONG_RIV: '103.2',
    })
    const missing = normalizeGdwBarrier({
      DAM_NAME: 'Nowhere',
      DAM_HGT_M: '80',
      CAP_MCM: '500',
      LAT_DAM: '-99',
      LONG_DAM: '-99',
    })
    expect(small).toBeNull()
    expect(missing).toBeNull()
    expect(tall?.kind).toBe('dam')
    expect(tall?.confidence).toBe('dataset')
    expect(tall?.attributes.year_built).toBe(1980)
    expect(tall?.attributes.river).toBe('Nile')
    expect(reservoir?.attributes.capacity_mcm).toBe(250)
    expect(isLargeDam(14, 99, null)).toBe(false)
    expect(isLargeDam(null, null, 12)).toBe(true)
  })

  it('keeps only nuclear rows from WRI', () => {
    const nuclear = normalizeWriPlant({
      name: 'Hanul',
      primary_fuel: 'Nuclear',
      latitude: '37.1',
      longitude: '129.3',
      capacity_mw: '1000',
      country_long: 'South Korea',
      commissioning_year: '1988',
    })
    const coal = normalizeWriPlant({ name: 'Coal', primary_fuel: 'Coal', latitude: '1', longitude: '2' })
    const hydro = normalizeWriPlant({ name: 'Hydro', primary_fuel: 'Hydro', latitude: '1', longitude: '2' })
    expect(coal).toBeNull()
    expect(hydro).toBeNull()
    expect(nuclear?.kind).toBe('nuclear_plant')
    expect(nuclear?.attributes.status).toBe('unspecified_in_source')
  })

  it('keeps UNHCR settlements and drops admin centroids', () => {
    const camp = normalizeUnhcrLocation({
      gis_name: 'Maaji II',
      iso3: 'UGA',
      latitude_d: '3.2',
      longitude_d: '31.9',
      loc_subtype: '38',
    })
    const admin = normalizeUnhcrLocation({
      gis_name: 'Centroid',
      iso3: 'UGA',
      latitude_d: '1',
      longitude_d: '32',
      loc_subtype: '49',
    })
    const noCoords = normalizeUnhcrLocation({
      gis_name: 'Lost',
      iso3: 'UGA',
      loc_subtype: '39',
    })
    expect(admin).toBeNull()
    expect(noCoords).toBeNull()
    expect(camp?.kind).toBe('refugee_camp')
    expect(camp?.attributes.loc_subtype_label).toBe('Formal Settlement')
  })
})

const openmeteo = { key: 'openmeteo_forecast', fixedSchedule: FIXED_SLOTS.openmeteo_forecast, scheduleMinutes: 1440 } as CrisisSource

describe('fixed schedules', () => {
  it('waits for the Seoul slot, then catches up once that local day', () => {
    const wedEarly = new Date('2026-10-07T00:00:00Z')
    const wedSlot = new Date('2026-10-07T00:31:00Z')
    const friAfternoon = new Date('2026-10-09T06:00:00Z')
    expect(isFixedScheduleDue(FIXED_SLOTS.openmeteo_forecast, null, wedEarly)).toBe(false)
    expect(isFixedScheduleDue(FIXED_SLOTS.openmeteo_forecast, null, wedSlot)).toBe(true)
    expect(isFixedScheduleDue(FIXED_SLOTS.openmeteo_forecast, '2026-10-08T00:31:00Z', friAfternoon)).toBe(true)
    expect(isFixedScheduleDue(FIXED_SLOTS.openmeteo_forecast, '2026-10-09T00:31:00Z', friAfternoon)).toBe(false)
    expect(isDue({ last_success_at: '2026-10-08T00:31:00Z' } as never, friAfternoon, false, openmeteo)).toBe(true)
  })

  it('keeps weekly and monthly sources on their calendar day', () => {
    const tuesday = new Date('2026-10-06T01:16:00Z')
    const mondayEarly = new Date('2026-10-04T23:00:00Z')
    const mondaySlot = new Date('2026-10-05T01:16:00Z')
    const monthDay2 = new Date('2026-10-02T02:00:00Z')
    const monthDay1 = new Date('2026-10-01T01:30:00Z')
    const monthCatchup = new Date('2026-10-01T02:00:00Z')
    expect(isFixedScheduleDue(FIXED_SLOTS.fewsnet, null, tuesday)).toBe(false)
    expect(isFixedScheduleDue(FIXED_SLOTS.fewsnet, null, mondayEarly)).toBe(false)
    expect(isFixedScheduleDue(FIXED_SLOTS.fewsnet, null, mondaySlot)).toBe(true)
    expect(isFixedScheduleDue(FIXED_SLOTS.inform, null, monthDay2)).toBe(false)
    expect(isFixedScheduleDue(FIXED_SLOTS.inform, null, monthDay1)).toBe(true)
    expect(isFixedScheduleDue(FIXED_SLOTS.inform, null, monthCatchup)).toBe(true)
  })

  it('sets the next slot to the following Seoul day, not 24 hours after a late catch-up', () => {
    const fridayAfternoon = new Date('2026-10-09T06:00:00Z')
    expect(nextFixedSlot(FIXED_SLOTS.openmeteo_forecast, fridayAfternoon).toISOString()).toBe('2026-10-10T00:30:00.000Z')
    expect(new Date('2026-10-09T00:30:00Z').toISOString()).toBe('2026-10-09T00:30:00.000Z')
  })

  it('leaves minute-interval sources on next_due_at', () => {
    const now = new Date('2026-10-09T06:00:00Z')
    const later = { next_due_at: '2026-10-09T07:00:00Z', last_success_at: null } as never
    expect(isDue(later, now, false)).toBe(false)
    expect(isDue(null, now, false)).toBe(true)
  })
})
