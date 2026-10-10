import { describe, expect, it } from 'vitest'
import { HAZARD_UI_KO } from '../../i18n/hazards'
import { assessDrought, assessHeatCold, ensoActive } from '../assess'
import { climateFromDaily, percentile } from '../stats'
import { populationWeight, wetBulbC, windChillC } from '../thermo'
import { climateAllowance } from '../../ingest/quota'
import { CASCADE_SEEDS } from '../../knowledge/cascades.seed'
import { matchCascades } from '../../score/cascades'
import type { ClimateNormals } from '../stats'

const october: ClimateNormals = {
  months: Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    tmaxP95: index + 1 === 10 ? 30 : 25,
    tmaxP5: 5,
    tminP95: 15,
    tminP5: index + 1 === 10 ? 0 : 5,
    tmaxMean: index + 1 === 10 ? 32 : 20,
    tminMean: index + 1 === 10 ? 8 : 5,
    precipDailyMean: 3,
    soilMean: 0.3,
    sampleDays: 300,
  })),
  precip30d: 20,
  precip30dBase: 90,
  precip90d: 40,
  precip90dBase: 200,
  soilRecent: 0.1,
}

describe('heat, cold, drought', () => {
  it('computes Stull wet-bulb and wind chill', () => {
    expect(wetBulbC(20, 50)).toBeGreaterThan(12)
    expect(wetBulbC(20, 50)).toBeLessThan(15)
    expect(wetBulbC(35, 70)).toBeGreaterThan(wetBulbC(35, 30))
    const chill = windChillC(0, 10)
    expect(chill).not.toBeNull()
    expect(chill!).toBeLessThan(-5)
    expect(windChillC(20, 10)).toBeNull()
    expect(populationWeight(2_000_000)).toBe(1)
    expect(populationWeight(0)).toBeLessThan(1)
  })

  it('flags three days above the local p95 and a dangerous wet-bulb', () => {
    const days = Array.from({ length: 9 }, (_, index) => ({
      date: `2026-10-${String(10 + index).padStart(2, '0')}`,
      tmax: index >= 6 ? 42 : 24,
      tmin: 12,
      rh: index >= 6 ? 90 : 40,
      wind: 3,
    }))
    const [heat] = assessHeatCold({ days, normals: october, population: 1_000_000 })
    expect(heat.key).toBe('heat')
    expect(heat.value).toBe(1)
    expect(heat.raw.consecutive_days).toBe(3)
    expect(heat.raw.anomaly_c).toBe(10)
    expect(heat.raw.lead_min).toBe(6)
    expect(heat.raw.lead_max).toBe(8)
    expect(HAZARD_UI_KO.heatForecastLine(32, 3, 4)).toBe('습구온도 32°C 3일 연속 예보 (평년 최고 대비 +4°C)')
    expect(HAZARD_UI_KO.formatExpectedWindow({ type: 'relative_days', min: 6, max: 9 })).toBe('6~9일 뒤')
  })

  it('flags a cold spell below the local p5', () => {
    const days = Array.from({ length: 4 }, (_, index) => ({
      date: `2026-10-${String(10 + index).padStart(2, '0')}`,
      tmax: 2,
      tmin: -8,
      rh: 40,
      wind: 8,
    }))
    const cold = assessHeatCold({ days, normals: october, population: 1_000_000 }).find((row) => row.key === 'cold')
    expect(cold).toBeTruthy()
    expect(cold!.raw.consecutive_days).toBe(4)
    expect(typeof cold!.raw.wind_chill_c).toBe('number')
  })

  it('needs two drought factors and only cascades to food crisis where IPC exists', () => {
    expect(ensoActive('El Niño Advisory', 1.2)).toBe(true)
    expect(ensoActive('ENSO-neutral', 0.1)).toBe(false)
    const drought = assessDrought({
      normals: october,
      population: 1_000_000,
      ensoStatus: 'El Niño Advisory',
      ensoAnomaly: 1.2,
    })
    expect(drought?.raw.factors).toEqual(['rain', 'soil', 'enso'])
    expect(HAZARD_UI_KO.droughtForecastLine(0.2, ['rain', 'soil', 'enso'])).toContain('90일 강수')
    const component = { key: 'drought', department: 'natural', value: 0.7, raw: {} }
    const withIpc = matchCascades({
      cascades: CASCADE_SEEDS,
      components: [component],
      kinds: new Set(),
      urbanPop: 100000,
      ipc: 3,
    })
    const without = matchCascades({
      cascades: CASCADE_SEEDS,
      components: [component],
      kinds: new Set(),
      urbanPop: 100000,
      ipc: null,
    })
    expect(withIpc.some((row) => row.id === 'drought-food-crisis')).toBe(true)
    expect(without.some((row) => row.id === 'drought-food-crisis')).toBe(false)
  })

  it('stores monthly p95 and p5 from a daily archive', () => {
    const days = Array.from({ length: 40 }, (_, index) => ({
      date: `2020-01-${String((index % 28) + 1).padStart(2, '0')}`,
      tmax: index < 38 ? 10 + index : 40,
      tmin: index < 2 ? -15 : 0,
      precip: 1,
      soil: 0.2,
    }))
    const normals = climateFromDaily(days)
    const january = normals.months[0]
    expect(january.tmaxP95).toBeGreaterThan(january.tmaxP5 ?? 0)
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3)
    expect(climateAllowance(0)).toBe(0)
    expect(climateAllowance(4800)).toBeGreaterThan(0)
  })
})
