import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { constructedPreviews } from './constructed'
import { TALISMAN_FRAMES } from './variants'
import { TalismanSvg } from './TalismanSvg'

const SQUARE = TALISMAN_FRAMES[2]!

describe('fill versus drain', () => {
  it('fills with a solid core and inward rays, drains with a hollow gap and vents', () => {
    const rows = constructedPreviews()
    const fill = rows.find((row) => row.id === 'lean-weak')!
    const drain = rows.find((row) => row.id === 'lean-strong')!
    const follow = rows.find((row) => row.id === 'follow')!
    const fillHtml = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: fill.spec, frame: SQUARE, uid: 'fill' }),
    )
    const drainHtml = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: drain.spec, frame: SQUARE, uid: 'drain' }),
    )
    const followHtml = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: follow.spec, frame: SQUARE, uid: 'follow' }),
    )
    expect(fillHtml).toContain('data-fill-core="true"')
    expect(fillHtml).toContain('data-ray="in"')
    expect(drainHtml).toContain('data-drain-gap="true"')
    expect(drainHtml).toContain('data-ray="out"')
    expect(followHtml).toContain('data-centre="follow-spiral"')
  })
})
