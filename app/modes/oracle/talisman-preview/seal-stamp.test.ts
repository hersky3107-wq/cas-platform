import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { constructedPreviews } from './constructed'
import { PHONE_RENDER_WIDTH, SIZE_FLOOR_PX } from './TalismanSvg'
import { TALISMAN_FRAMES } from './variants'
import { TalismanSvg } from './TalismanSvg'

const PHONE = TALISMAN_FRAMES[0]!

describe('seal stamp', () => {
  it('is a clean vermilion square with the bindrune and serial cut out in cream', () => {
    const row = constructedPreviews().find((item) => item.id === 'sinkang')!
    const html = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: row.spec, frame: PHONE, uid: 'stamp' }),
    )
    expect(html).toContain('data-seal-stamp="true"')
    expect(html).toContain('data-seal-edge="square"')
    expect(html).toContain('data-seal-cutout="bindrune"')
    expect(html).toContain('data-seal-serial="true"')
    expect(html).toContain('#f3ead8')
    expect(html).toContain('data-seal-ink="#8f1d14"')
    const stamp = html.match(/data-seal-stamp="true"[\s\S]*?<\/g><\/g>/)?.[0] ?? html
    expect(stamp).toContain('7f2a19')
    const fonts = [...html.matchAll(/<text\b[^>]*data-seal-serial="true"[^>]*>/g)]
      .map((m) => Number(m[0]!.match(/font-size="([0-9.]+)"/)?.[1] ?? 0))
      .filter((n) => n > 0)
    expect(fonts.length).toBeGreaterThan(0)
    expect(fonts.every((size) => (size * PHONE_RENDER_WIDTH) / 1000 >= SIZE_FLOOR_PX)).toBe(true)
  })
})
