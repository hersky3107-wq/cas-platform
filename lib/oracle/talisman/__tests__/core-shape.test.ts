import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { constructedPreviews } from './constructed'
import {
  PHYSICS_DISC,
  TALISMAN_GROUND,
  contrastRatio,
  physicsPlate,
} from '../TalismanSvg'
import { ELEMENT_META, ELEMENT_KEYS, TALISMAN_FRAMES } from '../variants'
import { TalismanSvg } from '../TalismanSvg'

const PHONE = TALISMAN_FRAMES[0]!
const SQUARE = TALISMAN_FRAMES[2]!

function parsePoints(points: string): Array<{ x: number; y: number }> {
  return points
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .reduce<number[][]>((rows, n, i, all) => {
      if (i % 2 === 0) rows.push([n, all[i + 1]!])
      return rows
    }, [])
    .filter((p) => p[0] != null && p[1] != null)
    .map(([x, y]) => ({ x, y }))
}

function turnSense(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
  return Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))
}

/** Four strokes that share a centre and bend the same way — a pinwheel. */
function bentFourArms(html: string): boolean {
  const physics = html.match(/data-physics="true"[\s\S]*?data-centre-hanja|data-physics="true"[\s\S]*?<\/g><\/g>/)?.[0] ?? html
  const polylines = [...physics.matchAll(/<polyline\b[^>]*points="([^"]+)"/g)].map((m) => parsePoints(m[1]!))
  const zigzags = polylines.filter((pts) => {
    if (pts.length < 4) return false
    const turns = []
    for (let i = 0; i < pts.length - 2; i += 1) {
      turns.push(turnSense(pts[i]!, pts[i + 1]!, pts[i + 2]!))
    }
    const nonzero = turns.filter((t) => t !== 0)
    if (nonzero.length < 2) return false
    return nonzero.every((t) => t === nonzero[0])
  })
  const uniqueAxes = new Set(
    zigzags.map((pts) => {
      const dx = pts[pts.length - 1]!.x - pts[0]!.x
      const dy = pts[pts.length - 1]!.y - pts[0]!.y
      return Math.round((Math.atan2(dy, dx) * 4) / Math.PI)
    }),
  )
  return uniqueAxes.size >= 2 && zigzags.length >= 2
}

describe('core physics shape', () => {
  it('does not form a 4-arm bent pinwheel and keeps rays outside the physics disc', () => {
    const row = constructedPreviews().find((item) => item.id === 'sinkang')!
    const html = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: row.spec, frame: PHONE, uid: 'core-shape' }),
    )
    expect(row.spec.element).toBe('fire')
    expect(html).toContain('data-physics-fire="wave"')
    expect(html).toContain('data-physics-disc="true"')
    expect(html).not.toContain('0,-34 -10,-24 0,-14')
    expect(bentFourArms(html)).toBe(false)

    const fill = constructedPreviews().find((item) => item.id === 'lean-weak')!
    const fillHtml = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: fill.spec, frame: SQUARE, uid: 'core-fill' }),
    )
    const inners = [...fillHtml.matchAll(/data-ray="in"[^>]*/g)].map((m) => {
      const tag = m[0]!
      const num = (name: string) => Number(tag.match(new RegExp(`${name}="([-0-9.]+)"`))?.[1] ?? 0)
      const x1 = num('x1')
      const y1 = num('y1')
      const x2 = num('x2')
      const y2 = num('y2')
      const r1 = Math.hypot(x1 - 500, y1 - 500)
      const r2 = Math.hypot(x2 - 500, y2 - 500)
      return Math.min(r1, r2)
    })
    expect(inners.length).toBeGreaterThan(0)
    expect(inners.every((r) => r >= PHYSICS_DISC)).toBe(true)
  })

  it('paints the physics mark at ≥ 3:1 against the plate behind it', () => {
    for (const element of ELEMENT_KEYS) {
      const fillPlate = physicsPlate(ELEMENT_META[element].accent)
      expect(contrastRatio(TALISMAN_GROUND, fillPlate)).toBeGreaterThanOrEqual(3)
      const drainInk = ELEMENT_META[element].accent
      expect(contrastRatio(drainInk, TALISMAN_GROUND)).toBeGreaterThanOrEqual(3)
    }
    const water = constructedPreviews().find((item) => item.id === 'lean-strong')!
    const waterHtml = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: water.spec, frame: SQUARE, uid: 'contrast-w' }),
    )
    expect(water.spec.mode).toBe('drain')
    expect(waterHtml).toContain(`data-physics-ink="${ELEMENT_META.water.accent}"`)
    const fill = constructedPreviews().find((item) => item.id === 'lean-weak')!
    const fillHtml = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: fill.spec, frame: SQUARE, uid: 'contrast-f' }),
    )
    expect(fill.spec.mode).toBe('fill')
    expect(fillHtml).toContain(`data-physics-ink="${TALISMAN_GROUND}"`)
    expect(fillHtml).toContain('data-physics-outline="true"')
  })
})
