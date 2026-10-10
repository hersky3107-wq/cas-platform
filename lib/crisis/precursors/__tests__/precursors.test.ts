import { describe, expect, it } from 'vitest'
import { CASCADE_SEEDS } from '../../knowledge/cascades.seed'
import { HAZARD_UI_KO } from '../../i18n/hazards'
import { PRECURSOR_LICENSES } from '../licenses'
import { applyEarthquakePrecursor, applyVolcanoPrecursor } from '../apply'
import {
  bValueDrop,
  cellKey,
  earthquakeStrength,
  maximumLikelihoodB,
  rateFlags,
  swarmClusters,
} from '../earthquake'
import { hazardZoneFromPlateKm, isCoastalKm, pointSegmentKm } from '../geometry'
import { weekProbabilities } from '../oaf'
import { parseVaacXml, vaacXmlLinks } from '../../ingest/sources/vaac'
import { volcanoPrecursorFires, volcanoPrecursors } from '../volcano'
import { matchCascades } from '../../score/cascades'
import type { TriggerComponent } from '../../score/types'

const NOW = new Date('2026-10-10T00:00:00Z')

function quake(lat: number, lon: number, mag: number, hoursAgo: number) {
  return { lat, lon, mag, at: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString() }
}

describe('earthquake precursors', () => {
  it('flags a 1-degree cell at >= 3x and >= 5 events', () => {
    const recent = Array.from({ length: 6 }, () => quake(35.2, 139.2, 3, 10))
    const year = new Map<string, number>([[cellKey(35.2, 139.2), 20]])
    const [flag] = rateFlags(recent, year, NOW)
    expect(flag.count7d).toBe(6)
    expect(flag.multiplier).toBeGreaterThanOrEqual(3)
    expect(flag.expected7d).toBeGreaterThan(0)
    const empty = new Map<string, number>()
    const [fresh] = rateFlags(recent, empty, NOW)
    expect(fresh.expected7d).toBeCloseTo(7 / 365, 5)
    expect(fresh.multiplier).toBeCloseTo(6 / (7 / 365), 4)
    expect(rateFlags(recent.slice(0, 4), year, NOW)).toHaveLength(0)
    const quiet = new Map<string, number>([[cellKey(35.2, 139.2), 400]])
    expect(rateFlags(recent, quiet, NOW)).toHaveLength(0)
  })

  it('multiplies the rate by the hazard zone and clamps', () => {
    expect(earthquakeStrength(3, 1)).toBe(1)
    expect(earthquakeStrength(3, 0.2)).toBeCloseTo(0.6)
    expect(hazardZoneFromPlateKm(10)).toBe(1)
    expect(hazardZoneFromPlateKm(800)).toBe(0.1)
    expect(hazardZoneFromPlateKm(null)).toBe(0.35)
  })

  it('finds a 72h swarm of small events inside 50 km', () => {
    const events = Array.from({ length: 15 }, (_, i) => quake(10 + i * 0.01, 10, 2.8, i))
    expect(swarmClusters(events, NOW)).toHaveLength(1)
    expect(swarmClusters(events.slice(0, 5), NOW)).toHaveLength(0)
  })

  it('flags a b-value drop when enough events exist', () => {
    const low = Array.from({ length: 40 }, () => 4)
    expect(maximumLikelihoodB(low)).not.toBeNull()
    expect(bValueDrop(low, [])?.reference).toBe(1)
    const reference = Array.from({ length: 40 }, () => 2.6)
    const drop = bValueDrop(low, reference)
    expect(drop).not.toBeNull()
    expect(drop!.recent).toBeLessThan(drop!.reference)
  })

  it('writes a probability forecast onto the quake component', () => {
    const base: TriggerComponent = { key: 'quake', department: 'natural', value: 0, raw: {} }
    const next = applyEarthquakePrecursor(base, {
      flag: {
        cell: '35,139',
        lat: 35.5,
        lon: 139.5,
        count7d: 23,
        yearCount: 27,
        expected7d: 4,
        multiplier: 5.75,
      },
      hazardZone: 1,
      swarm: null,
      bDrop: null,
      oaf: { m5: 0.12, m6: 0.02, m7: 0.001 },
    })
    expect(next.value).toBe(1)
    expect(next.raw.forecast).toBe('probability')
    expect(next.raw.count_7d).toBe(23)
    const line = HAZARD_UI_KO.earthquakeProbabilityLine(5.75, 23, 4, { m5: 0.12, m6: 0.02, m7: 0.001 })
    expect(line.startsWith('확률 예보')).toBe(true)
    expect(line).toContain('평소의 5.8배')
    expect(line).toContain('7일간 M2.5+ 23회')
    expect(line).toContain('평소 4회')
    expect(line).toContain('M5+')
    expect(HAZARD_UI_KO.formatExpectedWindow({ type: 'lead', key: 'days_to_weeks' })).toBe('수일~수주')
  })
})

describe('volcano precursors', () => {
  it('fires when two precursor types rise, or when the alert steps up', () => {
    const bits = volcanoPrecursors({
      lat: 14.47,
      lon: -90.88,
      now: NOW,
      volcanoes: [{ id: '342090', name: 'Fuego', lat: 14.47, lon: -90.88 }],
      quakes: Array.from({ length: 8 }, () => quake(14.47, -90.88, 2.7, 5)),
      yearCounts: new Map(),
      points: [{ lat: 14.47, lon: -90.88, name: 'Fuego', at: NOW.toISOString(), kind: 'thermal' }],
    })
    expect(volcanoPrecursorFires(bits)).toBe(true)
    expect(bits.map((bit) => bit.kind).sort()).toEqual(['seismic', 'thermal'])
    expect(volcanoPrecursorFires([{ kind: 'thermal' }])).toBe(false)
    expect(volcanoPrecursorFires([{ kind: 'alert', steps: 2 }])).toBe(true)
    const line = HAZARD_UI_KO.volcanoProbabilityLine([
      { kind: 'seismic', multiplier: 5 },
      { kind: 'thermal' },
      { kind: 'alert', steps: 2 },
    ])
    expect(line).toBe('확률 예보 · 화산 아래 지진 5배 + 열 이상 + 경보 2단계 상향')
  })

  it('parses a VAAC advisory position and skips a page without xml links', () => {
    const xml = '<EruptingVolcano><name>FUEGO 342090</name><gml:pos>14.467 -90.867</gml:pos></EruptingVolcano>'
    expect(parseVaacXml(xml, 'FVXX')?.lat).toBeCloseTo(14.467)
    expect(vaacXmlLinks('<a href="/products/atmosphere/vaac/volcanoes/xml_files/FVXX20_20261010_0706.xml">x</a>')).toHaveLength(1)
    expect(vaacXmlLinks('<p>none</p>')).toHaveLength(0)
  })

  it('reads the one-week OAF magnitude probabilities', () => {
    const week = weekProbabilities({
      forecast: [
        { label: '1 Day', bins: [{ magnitude: 5, probability: 0.01 }] },
        { label: '1 Week', bins: [{ magnitude: 5, probability: 0.2 }, { magnitude: 6, probability: 0.05 }, { magnitude: 7, probability: 0.004 }] },
      ],
    })
    expect(week).toEqual({ m5: 0.2, m6: 0.05, m7: 0.004 })
  })
})

describe('cascades and licenses', () => {
  it('enables building collapse, landslide dam, coastal tsunami, and dam damage', () => {
    const components: TriggerComponent[] = [{ key: 'quake', department: 'natural', value: 0.8, raw: { forecast: 'probability' } }]
    const coastal = matchCascades({
      cascades: CASCADE_SEEDS,
      components,
      kinds: new Set(['dam']),
      urbanPop: 80_000,
      coastal: true,
    })
    expect(coastal.some((row) => row.id === 'earthquake-building-collapse')).toBe(true)
    expect(coastal.some((row) => row.id === 'earthquake-landslide-dam')).toBe(true)
    expect(coastal.some((row) => row.id === 'earthquake-tsunami')).toBe(true)
    expect(coastal.some((row) => row.id === 'earthquake-dam-damage')).toBe(true)
    const inland = matchCascades({
      cascades: CASCADE_SEEDS,
      components,
      kinds: new Set(),
      urbanPop: 80_000,
      coastal: false,
    })
    expect(inland.some((row) => row.id === 'earthquake-tsunami')).toBe(false)
    expect(inland.some((row) => row.id === 'earthquake-dam-damage')).toBe(false)
  })

  it('keeps GEM, GNSS, weekly GVP, MIROVA, and SO2 skipped', () => {
    const skipped = PRECURSOR_LICENSES.filter((row) => row.status === 'skipped').map((row) => row.source)
    expect(skipped.join(' ')).toMatch(/GEM/)
    expect(skipped.join(' ')).toMatch(/GNSS/)
    expect(skipped.join(' ')).toMatch(/weekly/)
    expect(skipped.join(' ')).toMatch(/MIROVA/)
    expect(skipped.join(' ')).toMatch(/SO2/)
    expect(pointSegmentKm(1, 0, { lon: 0, lat: 0 }, { lon: 2, lat: 0 })).toBeGreaterThan(100)
    expect(isCoastalKm(40)).toBe(true)
    expect(isCoastalKm(200)).toBe(false)
    const base: TriggerComponent = { key: 'volcano', department: 'natural', value: 0, raw: {} }
    expect(applyVolcanoPrecursor(base, [{ kind: 'alert', steps: 1 }]).raw.forecast).toBe('probability')
  })
})
