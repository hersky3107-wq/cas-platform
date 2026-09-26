import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TALISMAN_FRAMES, TALISMAN_VARIANTS } from './variants'
import { TalismanSvg } from './TalismanSvg'

describe('seal marks', () => {
  it('uses a stamped knot instead of the lock/square UI', () => {
    const spec = TALISMAN_VARIANTS[1]!
    const html = renderToStaticMarkup(
      createElement(TalismanSvg, { spec, frame: TALISMAN_FRAMES[2]!, uid: 'knot' }),
    )
    expect(html).toContain('data-seal-knot="true"')
    expect(html).not.toContain('data-lock=')
  })
})
