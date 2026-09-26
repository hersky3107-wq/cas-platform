import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TZOLKIN_NAWAL } from '@/lib/oracle/engines/calendar/tables'
import { NawalGlyph, NawalSheet } from './nawal-glyphs'
import { TALISMAN_FRAMES, TALISMAN_VARIANTS } from './variants'
import { TalismanSvg } from './TalismanSvg'

describe('nawal geometric glyphs', () => {
  it('draws twenty distinct marks and lists them on the sheet', () => {
    const sheet = renderToStaticMarkup(createElement(NawalSheet))
    expect(sheet).toContain('data-nawal-sheet')
    for (let n = 1; n <= 20; n += 1) {
      expect(sheet).toContain(`data-nawal="${n}"`)
    }
    for (const row of TZOLKIN_NAWAL) {
      expect(sheet).toContain(row.name.replaceAll("'", '&#x27;'))
    }
    const marks = new Set(
      Array.from({ length: 20 }, (_, i) =>
        renderToStaticMarkup(createElement(NawalGlyph, { nawal: i + 1 })),
      ),
    )
    expect(marks.size).toBe(20)
  })

  it('replaces the kin mark without touching tone bars or dots', () => {
    const spec = TALISMAN_VARIANTS[0]!
    expect(spec.tzolkinTone).toBe(9)
    expect(spec.tzolkinNawal).toBe(7)
    const html = renderToStaticMarkup(
      createElement(TalismanSvg, { spec, frame: TALISMAN_FRAMES[2]!, uid: 'kin' }),
    )
    expect(html).toContain('data-nawal="7"')
    expect(html).toContain('width="48" height="9"')
    expect(html).not.toContain('M-14 10 L-4 2 L6 10 L14 4 L8 22 L-8 22 Z')
  })
})
