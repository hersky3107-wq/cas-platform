import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { computeTalisman } from '@/lib/oracle/talisman'
import { ziweiChart } from '@/lib/oracle/engines/ziwei'
import { palacesFrom, specFromComputation } from './from-computation'
import { constructedPreviews, constructedSinkang } from './constructed'
import { TALISMAN_FRAMES } from './variants'
import { TalismanSvg } from './TalismanSvg'
import { charts1988, fakeConsensus, LIVE_ACCESS } from '@/lib/oracle/talisman/__tests__/fixture'

describe('palacesFrom ziwei ring signals', () => {
  it('reads 살성 count, 主星 brightness, 化忌, and 대한 from the sanitized chart', () => {
    const charts = charts1988({
      ziwei: ziweiChart({
        birthDate: '1988-03-15',
        birthTime: '04:30',
        tz: 'Asia/Seoul',
        sex: 'male',
        atDate: '2026-08-15',
      }),
    })
    const computation = computeTalisman({
      access: LIVE_ACCESS,
      charts,
      consensus: fakeConsensus({ water: 8 }),
    })
    expect(computation).not.toBeNull()
    const palaces = palacesFrom(computation!, charts)
    expect(palaces).toHaveLength(12)
    expect(palaces!.some((palace) => palace.maleficCount > 0)).toBe(true)
    expect(palaces!.some((palace) => palace.brightness === 'solid' || palace.brightness === 'faint')).toBe(true)
    expect(palaces!.filter((palace) => palace.daXian)).toHaveLength(1)
    const sealedHuaJi = palaces!.filter((palace) => palace.sealed)
    expect(sealedHuaJi.every((palace) => palace.huaJi === false)).toBe(true)
    expect(palaces!.filter((palace) => palace.huaJi && palace.sealed)).toHaveLength(0)
    const spec = specFromComputation(computation!, charts, { sessionId: 'test', dateLabel: '2026.08.15' })
    expect(spec.palaces).toEqual(palaces)
    expect(computation!.seals.every((seal) =>
      seal.kind === 'ninestar-killing' ||
      seal.kind === 'ziwei-malefic' ||
      seal.kind === 'ziwei-huaji' ||
      seal.kind === 'name-daehyung',
    )).toBe(true)
  })

  it('marks 空宮 from the raw chart, not the seal-subtracted layer', () => {
    const charts = charts1988()
    const computation = computeTalisman({
      access: LIVE_ACCESS,
      charts,
      consensus: fakeConsensus({ water: 8 }),
    })
    const palaces = palacesFrom(computation!, charts)
    const rawEmpty = charts.ziwei?.palaces.filter((palace) => !palace.stars.some((star) => star.category === 'major')) ?? []
    expect(palaces!.filter((palace) => palace.empty)).toHaveLength(rawEmpty.length)
  })
})

describe('PRISM absence', () => {
  it('leaves the dent null when coreMatrix is missing', () => {
    const charts = charts1988({ prism: null })
    const computation = computeTalisman({
      access: LIVE_ACCESS,
      charts,
      consensus: fakeConsensus({ water: 8 }),
    })
    const spec = specFromComputation(computation!, charts, { sessionId: 'no-prism', dateLabel: '2026.08.15' })
    expect(spec.prismDentAxis).toBeNull()
  })
})

describe('constructed 신강 preview fixture', () => {
  it('drains from 억부 용신', () => {
    const { spec, stats } = constructedSinkang()
    expect(stats.centreSource).toBe('eokbu')
    expect(stats.centreMode).toBe('drain')
    expect(spec.mode).toBe('drain')
    expect(spec.palaces).toHaveLength(12)
    expect(spec.palaces?.some((palace) => palace.daXian)).toBe(true)
  })
})

describe('constructed centre fixtures', () => {
  const rows = constructedPreviews()

  it('중화 and 종격 use 억부 lean / follow, not consensus', () => {
    const junghwa = rows.find((row) => row.id === 'junghwa')!
    const jonggyeok = rows.find((row) => row.id === 'jonggyeok')!
    expect(junghwa.stats).toMatchObject({
      centreSource: 'eokbu-lean',
      centreMode: 'fill',
      centreElement: 'fire',
      centrePath: '억부 경향',
      centreIntensity: 'soft',
    })
    expect(junghwa.spec.element).toBe('fire')
    expect(junghwa.spec.intensity).toBe('soft')
    expect(jonggyeok.stats).toMatchObject({
      centreSource: 'jonggyeok',
      centreMode: 'follow',
      centreElement: 'earth',
      centrePath: '종격 follow',
    })
    expect(jonggyeok.spec.mode).toBe('follow')
  })

  it('lean-weak, lean-strong, and follow fixtures match the named paths', () => {
    const weak = rows.find((row) => row.id === 'lean-weak')!
    const strong = rows.find((row) => row.id === 'lean-strong')!
    const follow = rows.find((row) => row.id === 'follow')!
    expect(weak.stats.centrePath).toBe('억부 경향')
    expect(weak.spec.mode).toBe('fill')
    expect(weak.spec.intensity).toBe('soft')
    expect(strong.stats.centrePath).toBe('억부 경향')
    expect(strong.spec.mode).toBe('drain')
    expect(strong.spec.intensity).toBe('soft')
    expect(follow.stats.centrePath).toBe('종격 follow')
    expect(follow.spec.mode).toBe('follow')
    const followHtml = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: follow.spec, frame: TALISMAN_FRAMES[2]!, uid: 'follow-core' }),
    )
    expect(followHtml).toContain('data-centre="follow-spiral"')
    const softHtml = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: weak.spec, frame: TALISMAN_FRAMES[2]!, uid: 'soft-core' }),
    )
    expect(softHtml).toContain('data-intensity="soft"')
  })

  it('consensus with no leader keeps a null element and draws no earth centre', () => {
    const row = rows.find((item) => item.id === 'consensus-null')!
    expect(row.stats.centreElement).toBeNull()
    expect(row.stats.centreSource).toBe('consensus')
    expect(row.stats.centrePath).toBe('fallback')
    expect(row.spec.element).toBeNull()
    expect(row.spec.mode).toBe('fill')
  })

  it('no-PRISM fixture does not invent a dent', () => {
    const row = rows.find((item) => item.id === 'no-prism')!
    expect(row.spec.prismDentAxis).toBeNull()
    expect(row.spec.prismColors).toBeNull()
    expect(row.stats.centreMode).toBe('drain')
    const html = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: row.spec, frame: TALISMAN_FRAMES[2]!, uid: 'blank-rim' }),
    )
    expect(html).toContain('data-prism="blank"')
    expect(html).not.toContain('#6b5b8c')
  })

  it('paints identity wash, need outline, and impulse dent from the PRISM palette', () => {
    const row = rows.find((item) => item.id === 'sinkang')!
    expect(row.spec.prismColors).toEqual({ impulse: 'crimson', need: 'gold', identity: 'indigo' })
    const html = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: row.spec, frame: TALISMAN_FRAMES[2]!, uid: 'prism-rim' }),
    )
    expect(html).toContain('data-prism="identity"')
    expect(html).toContain('data-prism="need"')
    expect(html).toContain('data-prism="impulse"')
    expect(html).toContain('#4B0082')
    expect(html).toContain('#D4AF37')
    expect(html).toContain('#9B1B30')
    expect(html).not.toContain('#6b5b8c')
  })

  it('draws a neutral pentagon and keeps the spine when the element is null', () => {
    const row = rows.find((item) => item.id === 'consensus-null')!
    const html = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: row.spec, frame: TALISMAN_FRAMES[2]!, uid: 'null-core' }),
    )
    expect(html).toContain('data-centre="balanced"')
    expect(html).toContain('data-spine="kept"')
    for (const mark of ['>G<', '>ds²<', '>W Z<', '>SU(3)<', '>γ<']) {
      expect(html).toContain(mark)
    }
    expect(html).not.toContain('土')
    expect(html).not.toContain('黃龍')
    expect(html).not.toContain('5 · 10')
    expect(html).not.toContain('#c4a35a')
  })

  it('secondary fixture picks natal 금 and emphasises luoshu 4·9', () => {
    const row = rows.find((item) => item.id === 'secondary')!
    expect(row.stats.secondaryElement).toBe('metal')
    expect(row.stats.absentElements).toEqual(['metal', 'water'])
    expect(row.spec.secondaryElement).toBe('metal')
    expect(row.spec.absentElements).toEqual(['metal', 'water'])
    const html = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: row.spec, frame: TALISMAN_FRAMES[2]!, uid: 'sec' }),
    )
    expect(html).toContain('data-secondary-sector="4"')
    expect(html).toContain('data-secondary-sector="9"')
    expect(html).not.toContain('data-secondary-sector="1"')
  })

  it('draws missing birth digits as empty polygons in the numerology band', () => {
    const row = rows.find((item) => item.id === 'sinkang')!
    expect(row.spec.numerologyMissing).toEqual([3, 5, 6, 7])
    const html = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: row.spec, frame: TALISMAN_FRAMES[2]!, uid: 'num-miss' }),
    )
    for (const digit of [3, 5, 6, 7]) {
      expect(html).toContain(`data-numerology-missing="${digit}"`)
    }
  })
})
