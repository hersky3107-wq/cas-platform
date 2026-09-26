declare module 'opentype.js' {
  export type PathCommand =
    | { type: 'M' | 'L'; x: number; y: number }
    | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { type: 'Q'; x1: number; y1: number; x: number; y: number }
    | { type: 'Z' }

  export class Path {
    commands: PathCommand[]
    getBoundingBox(): { x1: number; y1: number; x2: number; y2: number }
  }

  export class Glyph {
    index: number
    name: string
    unicode?: number
    advanceWidth: number
    getPath(x: number, y: number, fontSize: number): Path
  }

  export class Font {
    unitsPerEm: number
    numGlyphs: number
    names: Record<string, unknown>
    charToGlyph(ch: string): Glyph
  }

  export function parse(buffer: ArrayBuffer): Font
  const opentype: { parse: typeof parse }
  export default opentype
}
