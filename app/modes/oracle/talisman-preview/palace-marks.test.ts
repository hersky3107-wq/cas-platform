import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { constructedPreviews } from './constructed'
import { TALISMAN_FRAMES } from './variants'
import { TalismanSvg } from './TalismanSvg'

const PHONE = TALISMAN_FRAMES[0]!

function lineAttrs(tag: string): { x1: number; y1: number; x2: number; y2: number } | null {
  const num = (name: string) => {
    const m = tag.match(new RegExp(`${name}="([-0-9.]+)"`))
    return m ? Number(m[1]) : null
  }
  const x1 = num('x1')
  const y1 = num('y1')
  const x2 = num('x2')
  const y2 = num('y2')
  if (x1 == null || y1 == null || x2 == null || y2 == null) return null
  return { x1, y1, x2, y2 }
}

function circleAttrs(tag: string): { cx: number; cy: number; r: number } | null {
  const num = (name: string) => {
    const m = tag.match(new RegExp(`${name}="([-0-9.]+)"`))
    return m ? Number(m[1]) : 0
  }
  if (!/\bcx=/.test(tag) && !/\bcy=/.test(tag)) return null
  return { cx: num('cx'), cy: num('cy'), r: num('r') || 0 }
}

/** A "!" is a long vertical tick with a small disc sitting under its lower end. */
function warningIcons(html: string): number {
  const lines = [...html.matchAll(/<line\b[^>]*>/g)].map((m) => lineAttrs(m[0]!)).filter(Boolean)
  const dots = [...html.matchAll(/<circle\b[^>]*>/g)].map((m) => circleAttrs(m[0]!)).filter(Boolean)
  let hits = 0
  for (const line of lines) {
    const dx = Math.abs(line!.x1 - line!.x2)
    const dy = line!.y2 - line!.y1
    if (dx > 3 || Math.abs(dy) < 16) continue
    const x = (line!.x1 + line!.x2) / 2
    const lowerY = Math.max(line!.y1, line!.y2)
    for (const dot of dots) {
      if (dot!.r > 8 || dot!.r < 2) continue
      if (Math.abs(dot!.cx - x) <= 4 && dot!.cy >= lowerY - 2 && dot!.cy <= lowerY + 10) hits += 1
    }
  }
  return hits
}

describe('ziwei palace marks', () => {
  it('encodes the palace index as 1–3 diamonds along the arc, never a tick-over-dot', () => {
    const row = constructedPreviews().find((item) => item.id === 'sinkang')!
    const html = renderToStaticMarkup(
      createElement(TalismanSvg, { spec: row.spec, frame: PHONE, uid: 'palace' }),
    )
    expect(html).toContain('data-palace-diamond="true"')
    expect(html).toContain('data-palace-diamonds="1"')
    expect(html).toContain('data-palace-diamonds="2"')
    expect(html).toContain('data-palace-diamonds="3"')
    const marks = [...html.matchAll(/<g[^>]*data-palace-mark="(\d+)"[^>]*data-palace-diamonds="(\d+)"[^>]*>/g)]
    expect(marks.length).toBeGreaterThan(0)
    for (const mark of marks) {
      const index = Number(mark[1])
      const count = Number(mark[2])
      expect(count).toBe((index % 3) + 1)
    }
    expect(html).not.toMatch(/data-palace-mark="\d+"[^>]*>\s*<line\b/)
    expect(html).toMatch(/data-palace-mark="\d+"[^>]*>\s*<polygon\b/)
    expect(warningIcons(html)).toBe(0)
  })
})
