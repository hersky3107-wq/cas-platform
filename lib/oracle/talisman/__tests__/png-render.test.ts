import { readFileSync } from 'node:fs'
import opentype from 'opentype.js'
import { describe, expect, it } from 'vitest'
import { constructedPreviews } from '@/app/modes/oracle/talisman-preview/constructed'
import {
  TALISMAN_PNG_FONT_LICENCE,
  TALISMAN_PNG_FONT_PATH,
  TALISMAN_PNG_FORMATS,
  TALISMAN_PNG_SIZE,
  collectSvgText,
  renderTalismanPng,
  talismanSvgForPng,
} from '@/lib/oracle/talisman/png'

function missingGlyphs(text: string): string[] {
  const buf = readFileSync(TALISMAN_PNG_FONT_PATH)
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  const missing: string[] = []
  for (const ch of text) {
    if (/\s/.test(ch)) continue
    const glyph = font.charToGlyph(ch)
    if (!glyph || glyph.index === 0 || glyph.name === '.notdef') missing.push(ch)
  }
  return missing
}

describe('talisman PNG renderer', () => {
  it('renders each format at the exact pixel size with the bundled OFL font and no system fonts', async () => {
    const row = constructedPreviews().find((item) => item.id === 'sinkang')!
    expect(TALISMAN_PNG_FONT_LICENCE).toBe('SIL Open Font License, Version 1.1')
    const times: Record<string, number> = {}
    for (const format of TALISMAN_PNG_FORMATS) {
      const svg = talismanSvgForPng(row.spec, format)
      expect(svg).toContain('font-family="Noto Sans"')
      expect(svg).not.toContain('ui-monospace')
      const text = collectSvgText(svg)
      expect(missingGlyphs(text)).toEqual([])
      const rendered = await renderTalismanPng(row.spec, format)
      times[format] = rendered.ms
      expect(rendered.width).toBe(TALISMAN_PNG_SIZE[format].width)
      expect(rendered.height).toBe(TALISMAN_PNG_SIZE[format].height)
      expect(rendered.png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true)
      expect(rendered.engine === 'native' || rendered.engine === 'wasm').toBe(true)
    }
    console.log('talisman png render ms', times)
  }, 60_000)
})
