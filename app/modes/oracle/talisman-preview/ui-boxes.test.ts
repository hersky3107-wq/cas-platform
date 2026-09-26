import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { constructedPreviews } from './constructed'
import { TALISMAN_FRAMES, TALISMAN_VARIANTS } from './variants'
import { TalismanSvg } from './TalismanSvg'

const SQUARE = TALISMAN_FRAMES[2]!

describe('remaining UI boxes', () => {
  it('keeps the knot and drops the square around sealed 낙서 and 刑 seats', () => {
    const spec = TALISMAN_VARIANTS[1]!
    const html = renderToStaticMarkup(
      createElement(TalismanSvg, { spec, frame: SQUARE, uid: 'boxes' }),
    )
    expect(html).toContain('data-hyung-knot="true"')
    expect(html).toContain('data-sealed-cell=')
    const hyung = html.match(/data-hyung-knot="true"[^>]*>([\s\S]*?)<\/g>/)?.[1] ?? ''
    expect(hyung).toContain('data-seal-knot="true"')
    expect(hyung).not.toContain('<rect')
    expect(hyung).not.toContain('<path')
    expect(html).not.toMatch(/data-luoshu="true"[^>]*>\s*<rect/)
    const live = constructedPreviews().find((item) => item.id === 'sinkang')!
    const liveHtml = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: live.spec, frame: SQUARE, uid: 'boxes-live' }),
    )
    expect(liveHtml).toContain('data-seal-knot="true"')
  })

  it('drops the tzolkin card frame left of the core and keeps the kin marks', () => {
    const row = constructedPreviews().find((item) => item.id === 'lean-strong')!
    const html = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: row.spec, frame: TALISMAN_FRAMES[0]!, uid: 'water-box' }),
    )
    expect(row.spec.element).toBe('water')
    expect(html).toContain('data-mark="nawal"')
    expect(html).toContain('data-nawal=')
    expect(html).not.toContain('width="80" height="96"')
    expect(html).not.toContain('width="40" height="40"')
    expect(html).toContain('data-saju-seat="day"')
  })
})
