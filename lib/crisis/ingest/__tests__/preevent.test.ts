import { describe, expect, it } from 'vitest'
import { escalationValue, gridKey, growthPace, linkEvents } from '../../events/link'
import { normalizeEnso, parseEnsoStatus, parseNino34 } from '../sources/enso'
import { normalizeJtwcAdvisory } from '../sources/jtwc-tcfa'
import { normalizeNhcOutlookKml } from '../sources/nhc-outlook'
import { alertRank, deriveVolcanoUnrest } from '../sources/volcano-unrest'
import { geographicKinds } from '../../score/fragility'
import { isHealthWikiConcept } from '../../config/wiki-health'
import { amplifyFired } from '../../score/wiki-amplifier'
import { claimYear, eventIsOlderThan, wikidataYear } from '../../score/wikidata'
import { finalizeScore } from '../../score/compute'
import { vectorDiseaseContext } from '../../score/vector-watch'
import type { TriggerComponent } from '../../score/types'

const KML = `<?xml version="1.0"?>
<kml><Document>
<Placemark>
<Polygon><outerBoundaryIs><LinearRing>
<coordinates>-90.0,10.0,0 -91.0,11.0,0 -90.0,12.0,0</coordinates>
</LinearRing></outerBoundaryIs></Polygon>
<ExtendedData>
<Data name="Disturbance"><value>1</value></Data>
<Data name="2day_percentage"><value>0%</value></Data>
<Data name="7day_percentage"><value>60%</value></Data>
<Data name="2day_category"><value>Low</value></Data>
<Data name="7day_category"><value>Medium</value></Data>
<Data name="Discussion"><value>1. South of Guatemala: formation chance through 7 days medium 60 percent.</value></Data>
</ExtendedData>
</Placemark>
<Placemark><name>no disturbance</name><Point><coordinates>-50,25,0</coordinates></Point></Placemark>
</Document></kml>`

const JTWC = `ABPW10 PGTW 090600
1. WESTERN NORTH PACIFIC AREA:
   A. TROPICAL CYCLONE SUMMARY:
      (1) AT 09OCT26 0000Z, TYPHOON 27W (KOGUMA) WAS LOCATED NEAR 18.3N 156.6E.
      MAXIMUM SUSTAINED SURFACE WINDS WERE ESTIMATED AT 85 KNOTS.
   B. TROPICAL DISTURBANCE SUMMARY:
      (1) AN AREA OF CONVECTION HAS PERSISTED NEAR 10.2N 140.5E.
      THE POTENTIAL FOR THE DEVELOPMENT OF A SIGNIFICANT TROPICAL CYCLONE WITHIN THE NEXT 24 HOURS IS MEDIUM.
   C. SUBTROPICAL SYSTEM SUMMARY: NONE.
NNNN`

describe('pre-event normalizers', () => {
  it('reads NHC outlook probabilities and a centroid', () => {
    const rows = normalizeNhcOutlookKml(KML, 'pac', '2026-10-09T05:00:00.000Z')
    expect(rows).toHaveLength(1)
    expect(rows[0].signal_type).toBe('cyclone_formation')
    expect(rows[0].value_num).toBe(60)
    expect(rows[0].value_raw?.prob_48h).toBe(0)
    expect(rows[0].lat).toBeCloseTo(11, 0)
    expect(rows[0].lon).toBeCloseTo(-90.3, 0)
  })

  it('reads a JTWC disturbance and a named storm', () => {
    const none = normalizeJtwcAdvisory('B. TROPICAL DISTURBANCE SUMMARY: NONE.\nC. SUBTROPICAL', 'io', '2026-10-09T00:00:00.000Z')
    expect(none.filter((row) => row.signal_type === 'cyclone_formation')).toHaveLength(0)
    const rows = normalizeJtwcAdvisory(JTWC, 'wpac', '2026-10-09T06:00:00.000Z')
    const formation = rows.find((row) => row.signal_type === 'cyclone_formation')
    const storm = rows.find((row) => row.signal_type === 'cyclone_forecast_point')
    expect(formation?.value_raw?.potential).toBe('medium')
    expect(formation?.lat).toBeCloseTo(10.2, 1)
    expect(formation?.lon).toBeCloseTo(140.5, 1)
    expect(storm?.value_num).toBe(85)
    expect(storm?.value_raw?.storm_id).toBe('wpac:KOGUMA')
  })

  it('reads ENSO status and the Niño-3.4 column', () => {
    const html = '<span>El Niño Advisory</span><p>Niño-3.4</p>'
    expect(parseEnsoStatus(html)).toBe('El Niño Advisory')
    const index = 'YR MON NINO1+2 ANOM NINO3 ANOM NINO4 ANOM NINO3.4 ANOM\n2026 9 28.0 1.0 27.0 1.0 29.0 1.0 28.0 2.1\n'
    expect(parseNino34(index)?.anomaly).toBeCloseTo(2.1)
    const row = normalizeEnso(html, index, '2026-10-09T00:00:00.000Z')
    expect(row.signal.signal_type).toBe('enso_status')
    expect(row.metric.metric).toBe('nino34_anomaly')
    expect(row.metric.value).toBeCloseTo(2.1)
  })

  it('derives volcano unrest from a swarm or a HANS increase', () => {
    const quakes = Array.from({ length: 10 }, (_, i) => ({
      lat: 10 + i * 0.001,
      lon: 20,
      at: '2026-10-09T00:00:00.000Z',
      source: 'usgs',
    }))
    const swarm = deriveVolcanoUnrest({
      quakes,
      volcanoes: [{ id: 'v1', name: 'Test', lat: 10, lon: 20 }],
      hans: [],
      now: new Date('2026-10-09T12:00:00.000Z'),
    })
    expect(swarm[0]?.signal_type).toBe('volcano_unrest')
    expect(swarm[0]?.value_num).toBe(10)
    expect(alertRank('WARNING')).toBeGreaterThan(alertRank('ADVISORY'))
    const raised = deriveVolcanoUnrest({
      quakes: [],
      volcanoes: [],
      hans: [
        { id: 'h1', name: 'Kilauea', lat: 19, lon: -155, alert: 'ADVISORY', at: '2026-10-01T00:00:00.000Z' },
        { id: 'h1', name: 'Kilauea', lat: 19, lon: -155, alert: 'WATCH', at: '2026-10-09T00:00:00.000Z' },
      ],
      now: new Date('2026-10-09T12:00:00.000Z'),
    })
    expect(raised[0]?.value_raw?.rule).toBe('hans_increase')
  })
})

describe('wiki amplifier and neighbours', () => {
  it('multiplies a fired component and leaves a quiet region alone', () => {
    const rain: TriggerComponent = { key: 'rain', department: 'natural', value: 0.5, raw: {} }
    const boosted = amplifyFired([rain], true)
    expect(boosted[0].value).toBeCloseTo(0.575)
    expect(amplifyFired([rain], false)[0].value).toBe(0.5)
    const capped = amplifyFired([{ ...rain, value: 0.9 }], true)
    expect(capped[0].value).toBe(1)
    expect(amplifyFired([{ ...rain, value: 0 }], true)[0].value).toBe(0)
    expect(isHealthWikiConcept('Veba', 'veba')).toBe(true)
    expect(isHealthWikiConcept('Hurricane Isaias (2026)', 'hurricane')).toBe(false)
  })

  it('counts a dam in a neighbour region', () => {
    const kinds = geographicKinds(
      1,
      [2],
      [{ name: 'Across', lat: 1, lon: 1, region_id: 2, height_m: 40, year_built: 1980, kind: 'dam' }],
      [],
      [{ name: 'Port', lat: 1, lon: 1, region_id: 1, kind: 'port' }],
    )
    expect(kinds.has('dam')).toBe(true)
    expect(kinds.has('port')).toBe(true)
    expect(kinds.has('nuclear_plant')).toBe(false)
  })

  it('drops a Wikidata event that started more than two years ago', () => {
    expect(wikidataYear({ time: '+1346-00-00T00:00:00Z' })).toBe(1346)
    expect(eventIsOlderThan(1346, 2026)).toBe(true)
    expect(eventIsOlderThan(2025, 2026)).toBe(false)
    expect(claimYear({ P580: [{ mainsnak: { datavalue: { value: { time: '+2016-07-15T00:00:00Z' } } } }] })).toBe(2016)
  })

  it('puts vector watch on the card context without changing the score', () => {
    expect(vectorDiseaseContext(['2026-08-20'], new Date('2026-10-09T00:00:00.000Z'))).toBe('vector_disease_watch')
    expect(vectorDiseaseContext(['2026-10-01'], new Date('2026-10-09T00:00:00.000Z'))).toBeNull()
    const base = {
      region_id: 1,
      name: 'X',
      country: 'Y',
      iso3: 'YEM',
      urban_pop: 1000,
      inform_exposure: null,
      inform_vulnerability: null,
      inform_coping: null,
      components: [{ key: 'rain', department: 'natural', value: 0.5, raw: {} }] satisfies TriggerComponent[],
      dam_items: [{ kind: 'dam', name: 'D', lat: 1, lon: 1, weight: 0.4, attributes: {} }],
      camp_count: 0,
      nuclear_items: [],
      upstream_add: 0,
      urban_centres: [],
      kinds: new Set(['dam']),
    }
    const plain = finalizeScore(base)
    const watched = finalizeScore({ ...base, watchlist: true })
    expect(watched.fragility).toBeGreaterThan(plain.fragility)
    expect(watched.fragility_items.find((item) => item.kind === 'dam')?.weight).toBeCloseTo(0.6)
  })
})

describe('event linker', () => {
  it('marks a cyclone growing fast when the 3-day wind slope is steep', () => {
    const now = new Date('2026-10-09T00:00:00.000Z')
    const events = linkEvents([
      { kind: 'cyclone', key: 'AL09', name: 'Isaias', at: '2026-10-06T00:00:00.000Z', value: 40, unit: 'kt', region_id: 1, source: 'nhc_jtwc', ref: 'AL09' },
      { kind: 'cyclone', key: 'AL09', name: 'Isaias', at: '2026-10-09T00:00:00.000Z', value: 100, unit: 'kt', region_id: 1, source: 'gdacs', ref: 'AL09' },
      { kind: 'fire_cluster', key: gridKey(10.2, 20.2), name: 'cell', at: '2026-10-09T00:00:00.000Z', value: 10, unit: 'frp', region_id: 2, source: 'firms', ref: 'a' },
    ], now)
    const storm = events.find((row) => row.kind === 'cyclone')
    expect(storm?.pace).toBe('growing_fast')
    expect(storm?.status).toBe('growing')
    expect(storm?.source_refs.map((row) => row.source).sort()).toEqual(['gdacs', 'nhc_jtwc', 'slope'])
    expect(escalationValue('growing_fast')).toBe(0.8)
    expect(escalationValue('growing')).toBe(0.5)
    expect(growthPace([{ date: '2026-10-08', value: 5, unit: 'kt' }, { date: '2026-10-09', value: 6, unit: 'kt' }], 'cyclone', now).pace).toBe('stable')
  })
})
