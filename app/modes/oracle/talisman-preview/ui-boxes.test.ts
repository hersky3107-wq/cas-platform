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
})
