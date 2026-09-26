import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { computeTalisman } from '@/lib/oracle/talisman'
import { ziweiChart } from '@/lib/oracle/engines/ziwei'
import { palacesFrom, specFromComputation } from './from-computation'
import { constructedPreviews, constructedSinkang } from './constructed'
import { FAKE_TALISMAN_SERIAL } from '@/lib/oracle/talisman'
import { TALISMAN_GLYPHS } from '@/lib/oracle/talisman/glyphs'
import { PHYSICS_CAPTION, TALISMAN_FRAMES, type ElementKey } from './variants'
import { TalismanSvg } from './TalismanSvg'
import { charts1988, fakeConsensus, LIVE_ACCESS } from '@/lib/oracle/talisman/__tests__/fixture'

const PHONE = TALISMAN_FRAMES[0]!
const SQUARE = TALISMAN_FRAMES[2]!

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
      createElement(TalismanSvg, { spec: follow.spec, frame: SQUARE, uid: 'follow-core' }),
    )
    expect(followHtml).toContain('data-centre="follow-spiral"')
    expect(followHtml).toContain('data-ray="in"')
    const softHtml = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: weak.spec, frame: SQUARE, uid: 'soft-core' }),
    )
    expect(softHtml).toContain('data-intensity="soft"')
    expect(softHtml).toContain('data-fill-core="true"')
    expect(softHtml).toContain('data-ray="in"')
    const drainHtml = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: strong.spec, frame: SQUARE, uid: 'drain-core' }),
    )
    expect(drainHtml).toContain('data-core="drain"')
    expect(drainHtml).toContain('data-drain-gap="true"')
    expect(drainHtml).toContain('data-ray="out"')
    expect(drainHtml).not.toContain('data-fill-core="true"')
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
      createElement(TalismanSvg, { spec: row.spec, frame: SQUARE, uid: 'blank-rim' }),
    )
    expect(html).toContain('data-prism="blank"')
    expect(html).not.toContain('#6b5b8c')
  })

  it('carries the physics caption on the spec and never draws it inside the SVG', () => {
    const row = rows.find((item) => item.id === 'sinkang')!
    expect(row.spec.physicsCaption).toBe(PHYSICS_CAPTION)
    const html = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: row.spec, frame: SQUARE, uid: 'phys' }),
    )
    expect(html).not.toContain('물리학적 주장')
    expect(html).not.toContain('오행-물리 대응')
  })

  it('paints identity wash, need outline, and impulse dent from the PRISM palette', () => {
    const row = rows.find((item) => item.id === 'sinkang')!
    expect(row.spec.prismColors).toEqual({ impulse: 'crimson', need: 'gold', identity: 'indigo' })
    const html = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: row.spec, frame: SQUARE, uid: 'prism-rim' }),
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
      createElement(TalismanSvg, { spec: row.spec, frame: SQUARE, uid: 'null-core' }),
    )
    expect(html).toContain('data-centre="balanced"')
    expect(html).toContain('data-spine="kept"')
    expect(html).not.toContain('>G<')
    expect(html).not.toContain('>ds²<')
    expect(html).not.toContain('土')
    expect(html).not.toContain('黃龍')
    expect(html).not.toContain('5 · 10')
    expect(html).not.toContain('#c4a35a')
    expect(html).not.toContain('SIGILLVM')
  })

  it('prints a fake serial and no birth date on constructed fixtures', () => {
    const row = rows.find((item) => item.id === 'sinkang')!
    expect(row.spec.serial).toBe(FAKE_TALISMAN_SERIAL)
    const html = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: row.spec, frame: PHONE, uid: 'serial' }),
    )
    expect(html).toContain('No. 7f2a19')
    expect(html).not.toContain('1984')
    expect(html).not.toContain(row.spec.sessionId)
  })

  it('strips decorative hanja and keeps only the centre glyph plus 符膽', () => {
    const row = rows.find((item) => item.id === 'sinkang')!
    const html = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: { ...row.spec, fudanGlyph: '財', purposeWealth: true }, frame: PHONE, uid: 'dehanja' }),
    )
    const square = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: { ...row.spec, fudanGlyph: '財', purposeWealth: true }, frame: SQUARE, uid: 'dehanja-sq' }),
    )
    const texts = [...html.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]!.trim()).filter(Boolean)
    expect(html).toContain('data-hanja="財"')
    expect(html).not.toContain('data-centre-hanja=')
    expect(square).toContain('data-hanja="火"')
    expect(square).toContain('data-centre-hanja="火"')
    expect(html).not.toContain('靑龍')
    expect(html).not.toContain('朱雀')
    expect(html).not.toContain('黃龍')
    expect(html).not.toContain('白虎')
    expect(html).not.toContain('玄武')
    expect(html).not.toContain('SIGILLVM')
    expect(html).not.toContain('>命<')
    expect(html).toContain('data-palace-mark=')
    expect(html).toContain('feGaussianBlur')
    expect(html).toContain('opacity="0.45"')
    expect(texts.some((t) => /[\u3400-\u9FFF]/.test(t))).toBe(false)
  })

  it('paints each 오행 from the matching generated codepoint path', () => {
    const row = rows.find((item) => item.id === 'sinkang')!
    const expected: Array<[ElementKey, string, number]> = [
      ['wood', '木', 0x6728],
      ['fire', '火', 0x706b],
      ['earth', '土', 0x571f],
      ['metal', '金', 0x91d1],
      ['water', '水', 0x6c34],
    ]
    for (const [element, hanja, code] of expected) {
      const glyph = TALISMAN_GLYPHS[hanja]!
      expect(glyph.codepoint).toBe(code)
      const html = renderToStaticMarkup(
        createElement(TalismanSvg, {
          spec: { ...row.spec, element, fudanGlyph: null },
          frame: SQUARE,
          uid: `glyph-${hanja}`,
        }),
      )
      expect(html).toContain(`data-hanja="${hanja}"`)
      expect(html).toContain(`data-hanja-codepoint="${code}"`)
      expect(html).toContain(`d="${glyph.d}"`)
      expect(html).toContain('fill-rule="evenodd"')
      expect(html).not.toContain('data-hanja="七"')
      expect(html).not.toContain('data-hanja="上"')
    }
    const follow = rows.find((item) => item.id === 'follow')!
    const followHtml = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: follow.spec, frame: SQUARE, uid: 'follow-earth' }),
    )
    expect(follow.spec.element).toBe('earth')
    expect(followHtml).toContain('data-hanja="土"')
    expect(followHtml).toContain(`data-hanja-codepoint="${0x571f}"`)
    expect(followHtml).toContain(`d="${TALISMAN_GLYPHS['土']!.d}"`)
  })

  it('renders zero CJK text nodes after hanja-to-path', () => {
    const row = rows.find((item) => item.id === 'sinkang')!
    const html = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: { ...row.spec, fudanGlyph: '和合' }, frame: PHONE, uid: 'nockj' }),
    )
    const texts = [...html.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1] ?? '')
    expect(texts.some((t) => /[\u3400-\u9FFF\uF900-\uFAFF]/.test(t))).toBe(false)
    expect(html).toContain('data-hanja="和"')
    expect(html).toContain('data-hanja="合"')
    expect(html.match(/<text\b[^>]*>[\s\S]*?<\/text>/g)?.some((node) => /[\u3400-\u9FFF\uF900-\uFAFF]/.test(node))).toBe(
      false,
    )
  })

  it('secondary fixture picks natal 금 and emphasises luoshu 4·9', () => {
    const row = rows.find((item) => item.id === 'secondary')!
    expect(row.stats.secondaryElement).toBe('metal')
    expect(row.stats.absentElements).toEqual(['metal', 'water'])
    expect(row.spec.secondaryElement).toBe('metal')
    expect(row.spec.absentElements).toEqual(['metal', 'water'])
    const html = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: row.spec, frame: SQUARE, uid: 'sec' }),
    )
    expect(html).toContain('data-secondary-sector="4"')
    expect(html).toContain('data-secondary-sector="9"')
    expect(html).not.toContain('data-secondary-sector="1"')
  })

  it('frames the 符膽 path and draws 鎭 larger than the other purposes', () => {
    const row = rows.find((item) => item.id === 'sinkang')!
    const wealth = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: { ...row.spec, fudanGlyph: '財' }, frame: PHONE, uid: 'fudan-w' }),
    )
    const love = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: { ...row.spec, fudanGlyph: '和合' }, frame: PHONE, uid: 'fudan-l' }),
    )
    const exorcism = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: { ...row.spec, fudanGlyph: '鎭' }, frame: PHONE, uid: 'fudan-x' }),
    )
    expect(wealth).toContain('data-fudan="財"')
    expect(wealth).toContain('data-fudan-size="380"')
    expect(love).toContain('data-fudan-size="380"')
    expect(exorcism).toContain('data-fudan="鎭"')
    expect(exorcism).toContain('data-fudan-size="460"')
    expect(wealth).toContain('stroke-linecap="square"')
    expect(wealth).toContain('rx="8"')
  })

  it('bindrune fixtures merge the stored draw and leave a bare stave when runes are missing', () => {
    const three = rows.find((item) => item.id === 'bindrune-3')!
    const five = rows.find((item) => item.id === 'bindrune-5')!
    const reversed = rows.find((item) => item.id === 'bindrune-reversed')!
    expect(three.spec.bindruneRunes).toHaveLength(3)
    expect(five.spec.bindruneRunes).toHaveLength(5)
    expect(reversed.spec.bindruneRunes?.some((rune) => rune.reversed)).toBe(true)
    expect(reversed.spec.fudanGlyph).toBe('財')
    const threeHtml = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: three.spec, frame: PHONE, uid: 'br3' }),
    )
    const fiveHtml = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: five.spec, frame: PHONE, uid: 'br5' }),
    )
    const revHtml = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: reversed.spec, frame: PHONE, uid: 'brr' }),
    )
    expect(threeHtml).toContain('data-bindrune="merged"')
    expect(fiveHtml).toContain('data-bindrune="merged"')
    expect(revHtml).toContain('data-bindrune="merged"')
    expect(revHtml).toContain('data-hanja="財"')
    expect(threeHtml).not.toEqual(fiveHtml)
    const blank = renderToStaticMarkup(
      createElement(TalismanSvg, {
        spec: { ...three.spec, bindruneRunes: null },
        frame: PHONE,
        uid: 'bare',
      }),
    )
    expect(blank).toContain('data-bindrune="stave"')
  })

  it('draws missing birth digits as empty polygons in the numerology band', () => {
    const row = rows.find((item) => item.id === 'sinkang')!
    expect(row.spec.numerologyMissing).toEqual([3, 5, 6, 7])
    const html = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: row.spec, frame: SQUARE, uid: 'num-miss' }),
    )
    for (const digit of [3, 5, 6, 7]) {
      expect(html).toContain(`data-numerology-missing="${digit}"`)
    }
  })

  it('applies each purpose table as layer emphasis and a swapped 符膽', () => {
    const sinkang = rows.find((item) => item.id === 'sinkang')!
    expect(sinkang.spec.purposeFilter).toBeNull()
    expect(sinkang.spec.fudanGlyph).toBeNull()
    const sinkangHtml = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: sinkang.spec, frame: PHONE, uid: 'no-purpose' }),
    )
    expect(sinkangHtml).not.toContain('data-purpose-hit=')
    expect(sinkangHtml).not.toContain('data-fudan=')

    const expected = [
      { id: 'purpose-wealth' as const, glyph: '財', hits: ['ziwei', 'saju', 'prism', 'iching'], miss: ['ninestar', 'name'] },
      { id: 'purpose-love' as const, glyph: '和合', hits: ['ziwei', 'prism'], miss: ['saju', 'iching', 'ninestar'] },
      { id: 'purpose-promotion' as const, glyph: '登科', hits: ['ziwei', 'saju', 'prism', 'iching'], miss: ['ninestar'] },
      { id: 'purpose-health' as const, glyph: '康寧', hits: ['ziwei', 'prism'], miss: ['saju', 'iching', 'ninestar'] },
      { id: 'purpose-exorcism' as const, glyph: '鎭', hits: ['ziwei', 'iching', 'ninestar'], miss: ['saju', 'prism'] },
    ]
    for (const row of expected) {
      const item = rows.find((entry) => entry.id === row.id)!
      expect(item.spec.fudanGlyph).toBe(row.glyph)
      expect(item.spec.purposeFilter?.purpose).toBe(row.id.replace('purpose-', ''))
      const html = renderToStaticMarkup(
        createElement(TalismanSvg, { spec: item.spec, frame: PHONE, uid: row.id }),
      )
      expect(html).toContain(`data-fudan="${row.glyph}"`)
      for (const hit of row.hits) expect(html).toContain(`data-purpose-hit="${hit}"`)
      for (const miss of row.miss) expect(html).not.toContain(`data-purpose-hit="${miss}"`)
    }
    expect(rows.find((item) => item.id === 'purpose-wealth')!.spec.purposeFilter?.ziwei).toBe('財')
    expect(rows.find((item) => item.id === 'purpose-love')!.spec.purposeFilter?.ziwei).toBe('夫')
    expect(rows.find((item) => item.id === 'purpose-promotion')!.spec.purposeFilter?.ziwei).toBe('官')
    expect(rows.find((item) => item.id === 'purpose-health')!.spec.purposeFilter?.ziwei).toBe('疾')
    expect(rows.find((item) => item.id === 'purpose-exorcism')!.spec.fudanGlyph).toBe('鎭')
    const exorcismHtml = renderToStaticMarkup(
      createElement(TalismanSvg, {
        spec: rows.find((item) => item.id === 'purpose-exorcism')!.spec,
        frame: PHONE,
        uid: 'ex-size',
      }),
    )
    expect(exorcismHtml).toContain('data-fudan-size="460"')
  })

  it('stamps a vermilion seal on every talisman and uses the fire ink for 화', () => {
    const sinkang = rows.find((item) => item.id === 'sinkang')!
    const phone = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: sinkang.spec, frame: PHONE, uid: 'seal-phone' }),
    )
    const square = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: sinkang.spec, frame: SQUARE, uid: 'seal-sq' }),
    )
    expect(phone).toContain('data-seal-knot="true"')
    expect(phone).toContain('data-seal-stamp="true"')
    expect(square).toContain('data-seal-stamp="true"')
    expect(phone).toContain('data-seal-ink="#8f1d14"')
    const earth = rows.find((item) => item.id === 'follow')!
    const earthHtml = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: earth.spec, frame: PHONE, uid: 'seal-earth' }),
    )
    expect(earthHtml).toContain('data-seal-ink="#c23b22"')
    const blank = renderToStaticMarkup(
      createElement(TalismanSvg, {
        spec: { ...sinkang.spec, bindruneRunes: null },
        frame: PHONE,
        uid: 'seal-serial',
      }),
    )
    expect(blank).toContain('7f2a19')
  })

  it('uses the tall master for phone/wallet and the circle-only crop for square/16:9', () => {
    const row = rows.find((item) => item.id === 'sinkang')!
    const phone = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: row.spec, frame: PHONE, uid: 'comp-phone' }),
    )
    const wallet = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: row.spec, frame: TALISMAN_FRAMES[1]!, uid: 'comp-wallet' }),
    )
    const square = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: row.spec, frame: SQUARE, uid: 'comp-square' }),
    )
    const desktop = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: row.spec, frame: TALISMAN_FRAMES[3]!, uid: 'comp-desk' }),
    )
    expect(PHONE.viewBox).toEqual([0, 0, 1000, 2166])
    expect(TALISMAN_FRAMES[1]!.viewBox).toEqual([0, 0, 1000, 2166])
    expect(phone).toContain('data-layout="tall"')
    expect(phone).toContain('data-tall-frame="true"')
    expect(phone).toContain('data-zone="top"')
    expect(phone).toContain('data-zone="circle"')
    expect(phone).toContain('data-zone="bottom"')
    expect(phone).toContain('data-circle="900"')
    expect(phone).toContain('viewBox="0 0 1000 2166"')
    expect(wallet).toContain('viewBox="0 0 1000 2166"')
    expect(square).toContain('data-layout="circle"')
    expect(square).not.toContain('data-tall-frame="true"')
    expect(square).not.toContain('data-serial="true"')
    expect(desktop).toContain('data-layout="circle"')
    expect(square).toContain('viewBox="50 650 900 900"')
  })
})
