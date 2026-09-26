import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TALISMAN_ZODIAC, TALISMAN_ZODIAC_FONT, TALISMAN_ZODIAC_IDS, TALISMAN_ZODIAC_LICENCE } from '@/lib/oracle/talisman/zodiac'
import { constructedPreviews } from './constructed'
import { TALISMAN_FRAMES } from '../variants'
import { TalismanSvg } from '../TalismanSvg'

const SQUARE = TALISMAN_FRAMES[2]!
const LATIN = ['AR', 'TA', 'GE', 'CN', 'LE', 'VI', 'LI', 'SC', 'SG', 'CP', 'AQ', 'PI'] as const

describe('zodiac sign glyphs', () => {
  it('traces the twelve signs from OFL Noto Sans Symbols and draws no Latin text', () => {
    expect(TALISMAN_ZODIAC_FONT).toBe('Noto Sans Symbols Regular')
    expect(TALISMAN_ZODIAC_LICENCE).toBe('SIL Open Font License, Version 1.1')
    const src = readFileSync('lib/oracle/talisman/zodiac.generated.ts', 'utf8')
    expect(src).toContain('Noto Sans Symbols Regular')
    expect(src).toContain('SIL Open Font License, Version 1.1')
    expect(src).toContain('No commercial or unknown-licence')

    const row = constructedPreviews().find((item) => item.id === 'sinkang')!
    const html = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: row.spec, frame: SQUARE, uid: 'zodiac' }),
    )
    for (const id of TALISMAN_ZODIAC_IDS) {
      const glyph = TALISMAN_ZODIAC[id]
      expect(html).toContain(`data-zodiac="${id}"`)
      expect(html).toContain(`data-zodiac-codepoint="${glyph.codepoint}"`)
      expect(html).toContain(glyph.d)
    }
    const texts = [...html.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((m) => (m[1] ?? '').trim())
    expect(texts.some((t) => LATIN.includes(t as (typeof LATIN)[number]))).toBe(false)
    expect(html).not.toContain('>AR<')
    expect(html).not.toContain('>TA<')
  })
})
