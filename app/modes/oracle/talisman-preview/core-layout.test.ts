import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { constructedPreviews } from './constructed'
import { TALISMAN_FRAMES } from './variants'
import { TalismanSvg } from './TalismanSvg'

const PHONE = TALISMAN_FRAMES[0]!
const SQUARE = TALISMAN_FRAMES[2]!

describe('core layout', () => {
  it('puts the physics mark in the tall core and keeps the hanja only on circle crops', () => {
    const row = constructedPreviews().find((item) => item.id === 'sinkang')!
    const phone = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: row.spec, frame: PHONE, uid: 'core-phone' }),
    )
    const square = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: row.spec, frame: SQUARE, uid: 'core-sq' }),
    )
    expect(phone).toContain('data-physics-height="120"')
    expect(phone).not.toContain('data-centre-hanja=')
    expect(phone).toContain('data-hanja="火"')
    expect(square).toContain('data-centre-hanja="火"')
    expect(square).toContain('data-centre-hanja-size="140"')
    expect(square).toContain('data-physics-height="50"')
  })
})
