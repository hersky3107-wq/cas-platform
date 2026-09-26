import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { constructedPreviews } from './constructed'
import { ELEMENT_META, TALISMAN_FRAMES } from '../variants'
import { TalismanSvg } from '../TalismanSvg'

const SQUARE = TALISMAN_FRAMES[2]!

describe('palace band tint', () => {
  it('washes the grey palace segments with the centre 오행 colour', () => {
    const row = constructedPreviews().find((item) => item.id === 'sinkang')!
    const html = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: row.spec, frame: SQUARE, uid: 'tint' }),
    )
    const accent = ELEMENT_META[row.spec.element!].accent
    expect(html).toContain('data-palace-tint="true"')
    expect(html).toMatch(new RegExp(`fill="${accent}"[^>]*data-palace-tint="true"`))
    expect(html).toMatch(/opacity="0\.\d+"[^>]*data-palace-tint="true"/)
  })
})
