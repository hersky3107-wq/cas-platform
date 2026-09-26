/**
 * FAKE-CONSENSUS GUARD.
 *
 * The axis projection copies every system into one 오행 vector, so a layer
 * can look like it "agrees" with the centre when it is the same value
 * copied. Native extractors must not read consensus.elements. Mutating the
 * deficiency vector must not change any native finding.
 */
import { describe, expect, it } from 'vitest'
import { eokbu, fourPillars, tenGods } from '../../engines/calendar'
import { computeTalisman, extractNativeFindings } from '../index'
import { charts1988, fakeConsensus, LIVE_ACCESS } from './fixture'

describe('fake-consensus guard', () => {
  it('native findings stay identical when consensus.elements.deficiency is swapped', () => {
    const charts = charts1988()
    const wood = computeTalisman({
      access: LIVE_ACCESS,
      charts,
      consensus: fakeConsensus({ wood: 20, fire: 0, earth: 0, metal: 0, water: 0 }),
    })
    const water = computeTalisman({
      access: LIVE_ACCESS,
      charts,
      consensus: fakeConsensus({ wood: 0, fire: 0, earth: 0, metal: 0, water: 20 }),
    })
    expect(wood).not.toBeNull()
    expect(water).not.toBeNull()
    expect(wood!.layers).toEqual(water!.layers)
    expect(wood!.seals).toEqual(water!.seals)
    expect(wood!.centre).toEqual(water!.centre)
    expect(wood!.centre.source).toBe('eokbu')
  })

  it('중화 fallback lets the centre follow deficiency, but layers still ignore it', () => {
    const pillars = fourPillars({ date: '1984-02-15', time: '12:00', timezone: 'Asia/Seoul' })
    const charts = charts1988({
      saju: { eokbu: eokbu(pillars), tenGods: tenGods(pillars.day.stem, pillars), pillars },
    })
    expect(charts.saju?.eokbu.yongsin).toBeNull()
    const metal = computeTalisman({
      access: LIVE_ACCESS,
      charts,
      consensus: fakeConsensus({ metal: 14 }),
    })
    const water = computeTalisman({
      access: LIVE_ACCESS,
      charts,
      consensus: fakeConsensus({ water: 14 }),
    })
    expect(metal!.centre).toEqual({ source: 'consensus', mode: 'fill', element: 'metal' })
    expect(water!.centre).toEqual({ source: 'consensus', mode: 'fill', element: 'water' })
    expect(metal!.layers).toEqual(water!.layers)
    expect(metal!.seals).toEqual(water!.seals)
    const raw = extractNativeFindings(charts)
    expect(raw.saju?.gisin).toBe(charts.saju?.eokbu.gisin)
    expect(raw.ninestar).not.toBeNull()
  })

  it('reports 8 independent native findings vs 4 form-only, never derived from consensus.elements', () => {
    const result = computeTalisman({
      access: LIVE_ACCESS,
      charts: charts1988(),
      consensus: fakeConsensus({ wood: 20 }),
    })
    expect(result!.independence.native).toBe(8)
    expect(result!.independence.formOnly).toBe(4)
    expect(result!.layers.saju).not.toBeNull()
    expect(result!.layers.astro).not.toBeNull()
    expect(result!.layers.prism).not.toBeNull()
    expect(result!.layers.ziwei).not.toBeNull()
    expect(result!.layers.iching).not.toBeNull()
    expect(result!.layers.tarot).not.toBeNull()
    expect(result!.layers.name).not.toBeNull()
    expect(result!.layers.ninestar).not.toBeNull()
    expect(result!.layers.numerology.kind).toBe('form-only')
    expect(result!.layers.sukuyou.kind).toBe('form-only')
    expect(result!.layers.tzolkin.kind).toBe('form-only')
    expect(result!.layers.runes.kind).toBe('form-only')
    expect(JSON.stringify(result!.layers)).not.toContain('"wood":20')
  })
})
