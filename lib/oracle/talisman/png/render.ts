import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TalismanSvg } from '@/app/modes/oracle/talisman-preview/TalismanSvg'
import type { TalismanSpec } from '@/app/modes/oracle/talisman-preview/variants'
import { loadResvg, type TalismanPngEngine } from './engine'
import { frameForPng, TALISMAN_PNG_SIZE, type TalismanPngFormat } from './formats'
import { TALISMAN_PNG_FONT_FAMILY, TALISMAN_PNG_FONT_PATH } from './font'

const GROUND = '#07080c'

export type TalismanPngResult = {
  png: Buffer
  width: number
  height: number
  engine: TalismanPngEngine
  ms: number
}

function withXmlns(svg: string): string {
  if (svg.includes('xmlns=')) return svg
  return svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
}

function pinLatinFont(svg: string): string {
  return svg
    .replace(/font-family="[^"]*"/g, `font-family="${TALISMAN_PNG_FONT_FAMILY}"`)
    .replace(/fontFamily="[^"]*"/g, `font-family="${TALISMAN_PNG_FONT_FAMILY}"`)
}

function innerMarkup(svg: string): string {
  return withXmlns(svg).replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
}

function wrapExact(
  svg: string,
  width: number,
  height: number,
  viewBox: readonly [number, number, number, number],
  bleed: number,
): string {
  const innerW = width - bleed * 2
  const innerH = height - bleed * 2
  const vb = viewBox.join(' ')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${GROUND}"/>
  <svg x="${bleed}" y="${bleed}" width="${innerW}" height="${innerH}" viewBox="${vb}" preserveAspectRatio="xMidYMid meet">${innerMarkup(svg)}</svg>
</svg>`
}

export function talismanSvgForPng(spec: TalismanSpec, format: TalismanPngFormat): string {
  const frame = frameForPng(format)
  const size = TALISMAN_PNG_SIZE[format]
  const raw = renderToStaticMarkup(
    createElement(TalismanSvg, { spec, frame, uid: `png-${spec.id}-${format}` }),
  )
  return wrapExact(pinLatinFont(raw), size.width, size.height, frame.viewBox, size.bleed)
}

export function collectSvgText(svg: string): string {
  return [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
    .map((m) => (m[1] ?? '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
    .join('')
}

export async function renderTalismanPng(spec: TalismanSpec, format: TalismanPngFormat): Promise<TalismanPngResult> {
  const size = TALISMAN_PNG_SIZE[format]
  const svg = talismanSvgForPng(spec, format)
  const { Resvg, engine } = await loadResvg()
  const started = Date.now()
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size.width },
    font: {
      fontFiles: [TALISMAN_PNG_FONT_PATH],
      loadSystemFonts: false,
      defaultFontFamily: TALISMAN_PNG_FONT_FAMILY,
    },
    background: GROUND,
  })
  const png = Buffer.from(resvg.render().asPng())
  return {
    png,
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
    engine,
    ms: Date.now() - started,
  }
}
