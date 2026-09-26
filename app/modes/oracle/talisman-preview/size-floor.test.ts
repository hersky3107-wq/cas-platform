import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { constructedPreviews } from './constructed'
import { PHONE_RENDER_WIDTH, SIZE_FLOOR_PX, TALISMAN_SW } from './TalismanSvg'
import { TalismanSvg } from './TalismanSvg'
import { CIRCLE_SCALE, TALISMAN_FRAMES } from './variants'

const PHONE = TALISMAN_FRAMES[0]!

describe('talisman size floor', () => {
  it('keeps primary strokes and hairlines at the canvas floor', () => {
    expect(TALISMAN_SW.med).toBeGreaterThanOrEqual(3)
    expect(TALISMAN_SW.hair).toBeGreaterThanOrEqual(1.2)
  })

  it('renders the phone master so marks stay ≥ 10px at 390 wide', () => {
    const row = constructedPreviews().find((item) => item.id === 'purpose-wealth')!
    const html = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: row.spec, frame: PHONE, uid: 'floor' }),
    )
    expect(PHONE.viewBox[2]).toBe(1000)
    expect(html).toContain('data-centre-hanja-size="140"')
    const centrePx = (140 * CIRCLE_SCALE * PHONE_RENDER_WIDTH) / 1000
    expect(centrePx).toBeGreaterThanOrEqual(SIZE_FLOOR_PX)

    const fonts = [...html.matchAll(/font-size="([0-9.]+)"/g)].map((m) => Number(m[1]))
    expect(fonts.length).toBeGreaterThan(0)
    const tooSmall = fonts.filter((size) => {
      const px = size >= 26 && size < 50
        ? (size * CIRCLE_SCALE * PHONE_RENDER_WIDTH) / 1000
        : (size * PHONE_RENDER_WIDTH) / 1000
      return px < SIZE_FLOOR_PX
    })
    expect(tooSmall).toEqual([])

    expect(html).toContain('data-mark="nawal"')
    expect(html).toContain('data-palace-mark=')
  })
})
