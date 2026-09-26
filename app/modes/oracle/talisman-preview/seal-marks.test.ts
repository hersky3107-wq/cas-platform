import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { constructedPreviews } from './constructed'
import { TALISMAN_FRAMES, TALISMAN_VARIANTS } from './variants'
import { TalismanSvg } from './TalismanSvg'

const SQUARE = TALISMAN_FRAMES[2]!

describe('seal marks', () => {
  it('uses a cord knot, not a wheel, lock, or boxed luoshu cell', () => {
    const spec = TALISMAN_VARIANTS[1]!
    const html = renderToStaticMarkup(
      createElement(TalismanSvg, { spec, frame: SQUARE, uid: 'knot' }),
    )
    expect(html).toContain('data-seal-knot="true"')
    expect(html).toContain('data-knot-style="cord"')
    expect(html).toContain('data-knot-cord="true"')
    expect(html).toContain('data-knot-tie="true"')
    expect(html).not.toContain('data-lock=')
    expect(html).toContain('data-sealed-cell=')
    expect(html).toContain('data-sealed-hatch="true"')
    expect(html).toContain('opacity="0.7"')
    expect(html).toContain('data-knot-scale="0.75"')
    expect(html).not.toMatch(/data-sealed-cell="\d+"[^>]*>\s*<rect\b[^>]*stroke=/)
    expect(html).not.toContain('data-hyung-box')
    const hex = html.match(/data-iching-hex="true"[^>]*>([\s\S]*?)<\/g>/)?.[1] ?? ''
    expect(html).toContain('data-iching-hex="true"')
    expect(hex).not.toContain('<rect')
    expect(hex).toContain('<line')
  })

  it('draws the same cord knot on constructed 흉방 cells', () => {
    const row = constructedPreviews().find((item) => item.id === 'purpose-exorcism')!
    const html = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: row.spec, frame: SQUARE, uid: 'ex-knot' }),
    )
    expect(html).toContain('data-knot-style="cord"')
    expect(html).toContain('data-sealed-hatch="true"')
  })
})
