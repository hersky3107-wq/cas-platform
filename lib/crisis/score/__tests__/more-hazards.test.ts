import { describe, expect, it } from 'vitest'
import { HAZARD_UI_KO } from '../../i18n/hazards'
import { fourWeekConflictRise, type DailyVolume } from '../slowburn'
import {
  advisoryReasonWeight,
  classifyOutage,
  diseaseFromTitle,
  forecastGeomagneticG,
  parseAdvisoryReasons,
  terrorComponent,
  ucdpConfirms,
  waterborneComponent,
} from '../more-hazards'

describe('more hazards', () => {
  it('classifies outage causes and the government chip', () => {
    expect(classifyOutage(['GOVERNMENT shutdown order'], 'IRN').cause).toBe('government_directed')
    expect(classifyOutage(['POWER_OUTAGE in the capital'], 'USA').weight).toBe(0)
    expect(classifyOutage(['cable cut'], 'USA').cause).toBe('cable_cut')
    expect(classifyOutage(['weather'], 'USA').weight).toBe(0)
    expect(classifyOutage(['unspecified drop'], 'USA')).toEqual({ cause: 'unknown', weight: 0.5 })
    expect(classifyOutage(['national exam blackout'], 'IND').weight).toBe(0.2)
    expect(classifyOutage(['unspecified drop'], 'IRQ').cause).toBe('exam')
    expect(HAZARD_UI_KO.internetCauseLine('government_directed')).toBe('인터넷 차단 · 정부 지시')
  })

  it('parses advisory reasons and halves advisories without conflict, unrest, or terrorism', () => {
    const reasons = parseAdvisoryReasons('Do not travel due to armed conflict, kidnapping, and crime.')
    expect(reasons).toEqual(['armed_conflict', 'kidnapping', 'crime'])
    expect(advisoryReasonWeight(reasons)).toBe(1)
    expect(advisoryReasonWeight(['crime', 'health'])).toBe(0.5)
    expect(advisoryReasonWeight([])).toBe(0.5)
    expect(HAZARD_UI_KO.advisoryReasonLine(4, ['armed_conflict', 'kidnapping'])).toBe('여행경보 4단계 · 무력 충돌, 납치')
  })

  it('keeps terror at region level and does not name a target or group', () => {
    const country = terrorComponent({ level: 0, threatToday: 12, threatMean: 2, threatDays: 10, advisoryTerror: true })
    expect(country.value).toBe(0)
    const region = terrorComponent({ level: 1, threatToday: 8, threatMean: 2, threatDays: 10, advisoryTerror: true })
    expect(region.value).toBe(0.8)
    expect(JSON.stringify(region.raw)).not.toMatch(/isis|target|group|actor/i)
    expect(HAZARD_UI_KO.terrorRiskLine()).toBe('테러 위험 상승')
  })

  it('confirms conflict only from a nearby UCDP event', () => {
    const region = { id: 4, lat: 15, lon: 45, iso3: 'YEM' }
    expect(ucdpConfirms(region, [{ lat: 15.2, lon: 45.2, regionId: null, iso3: 'YEM', at: null }])).toBe(true)
    expect(ucdpConfirms(region, [{ lat: 40, lon: 10, regionId: 9, iso3: 'FRA', at: null }])).toBe(false)
  })

  it('reads the SWPC forecast scale and a WHO disease name', () => {
    const text = 'observed Kp was 4. The greatest expected 3 hr Kp for Oct 10 is 7.33 (NOAA Scale G3).'
    expect(forecastGeomagneticG(text)).toBe(3)
    expect(diseaseFromTitle('Ebola disease - Democratic Republic of the Congo')).toBe('Ebola disease')
    expect(HAZARD_UI_KO.waterborneLine()).toBe('수인성 감염병 위험 · 1~3주 뒤')
    expect(waterborneComponent({ rain: 0.6, river: 0, camp: true, vulnerability: 2 }).value).toBe(0.55)
    expect(waterborneComponent({ rain: 0.6, river: 0, camp: false, vulnerability: 3 }).value).toBe(0)
  })

  it('shows a four-week conflict-coverage rise', () => {
    const rows: DailyVolume[] = Array.from({ length: 28 }, (_, index) => ({
      day: new Date(Date.parse('2026-09-13T00:00:00Z') + index * 86_400_000).toISOString().slice(0, 10),
      events: 10,
      conflict_share: 0.2 + index * 0.01,
      avg_goldstein: -1,
      avg_tone: -1,
      cameo_18_20: 2,
      cameo_share: 0.2,
      num_sources: 4,
    }))
    const pct = fourWeekConflictRise(rows, '2026-10-10')
    expect(pct).not.toBeNull()
    expect(pct!).toBeGreaterThan(0)
    expect(HAZARD_UI_KO.slowBurnRiseLine(38)).toBe('분쟁 보도 4주 연속 증가 +38%')
  })
})
