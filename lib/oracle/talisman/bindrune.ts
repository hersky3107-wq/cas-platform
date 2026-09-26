/**
 * Bindrune from a stored Elder Futhark draw.
 * All stones share one vertical stave. Reversed stones are mirrored
 * vertically before the segments are merged. Missing draw → stave only.
 */

export type BindruneStone = { name: string; reversed: boolean }
export type BindruneSeg = readonly [number, number, number, number]

export const BIND_TOLERANCE = 1
export const BIND_HALF = 44
export const FUDAN_BASELINE_Y = 92
export const BIND_Y_WITH_FUDAN = 234
export const BIND_Y_BARE = 290

const STAVE: BindruneSeg = [0, -40, 0, 40]

/** Arms only. The shared stave is added once. Local units, y down. */
const ARMS: Record<string, readonly BindruneSeg[]> = {
  Fehu: [
    [0, -28, 16, -36],
    [0, -12, 16, -20],
  ],
  Uruz: [
    [0, -32, 14, -32],
    [14, -32, 14, 6],
    [14, 6, 0, 6],
  ],
  Thurisaz: [
    [0, -16, 16, 0],
    [16, 0, 0, 16],
  ],
  Ansuz: [
    [0, -28, 16, -36],
    [0, -12, 16, -20],
  ],
  Raidho: [
    [0, -28, 16, -36],
    [0, -12, 16, -20],
    [8, -16, 16, 8],
  ],
  Kenaz: [
    [14, -22, 0, 0],
    [0, 0, 14, 22],
  ],
  Gebo: [
    [-14, -22, 14, 22],
    [14, -22, -14, 22],
  ],
  Wunjo: [
    [0, -28, 14, -20],
    [14, -20, 0, -8],
  ],
  Hagalaz: [
    [-12, -16, 12, -16],
    [-12, 16, 12, 16],
    [-12, -16, 12, 16],
  ],
  Nauthiz: [[-12, 20, 12, -20]],
  Isa: [],
  Jera: [
    [-12, -8, 4, -24],
    [4, -24, 12, -8],
    [12, 8, -4, 24],
    [-4, 24, -12, 8],
  ],
  Eihwaz: [
    [0, -40, 10, -28],
    [0, 40, -10, 28],
  ],
  Perthro: [
    [0, -24, 14, -24],
    [14, -24, 14, 8],
    [14, 8, 0, 20],
  ],
  Algiz: [
    [0, 8, -14, -20],
    [0, 8, 14, -20],
    [0, 8, 0, -32],
  ],
  Sowilo: [
    [8, -28, -8, -4],
    [-8, -4, 8, 20],
  ],
  Tiwaz: [
    [0, -40, -14, -20],
    [0, -40, 14, -20],
  ],
  Berkano: [
    [0, -28, 14, -16],
    [14, -16, 0, -4],
    [0, -4, 14, 10],
    [14, 10, 0, 22],
  ],
  Ehwaz: [
    [-10, -24, -10, 24],
    [10, -24, 10, 24],
    [-10, -8, 10, -20],
    [-10, 8, 10, 20],
  ],
  Mannaz: [
    [-10, -24, -10, 24],
    [10, -24, 10, 24],
    [-10, -24, 10, 8],
    [10, -24, -10, 8],
  ],
  Laguz: [
    [0, -28, 14, -12],
    [14, -12, 0, 4],
  ],
  Ingwaz: [
    [0, -16, 12, 0],
    [12, 0, 0, 16],
    [0, 16, -12, 0],
    [-12, 0, 0, -16],
  ],
  Dagaz: [
    [-12, -20, 12, 20],
    [12, -20, -12, 20],
    [-12, -20, -12, 20],
    [12, -20, 12, 20],
  ],
  Othala: [
    [0, 8, -12, -8],
    [-12, -8, 0, -24],
    [0, -24, 12, -8],
    [12, -8, 0, 8],
    [-8, 4, 0, 20],
    [8, 4, 0, 20],
  ],
}

function flipY(seg: BindruneSeg): BindruneSeg {
  return [seg[0], -seg[1], seg[2], -seg[3]]
}

function armsOf(name: string): readonly BindruneSeg[] {
  return ARMS[name] ?? []
}

export function stoneSegments(stone: BindruneStone): BindruneSeg[] {
  const arms = armsOf(stone.name)
  return stone.reversed ? arms.map(flipY) : [...arms]
}

function almost(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol
}

function mergePair(a: BindruneSeg, b: BindruneSeg, tol: number): BindruneSeg | null {
  const adx = a[2] - a[0]
  const ady = a[3] - a[1]
  const bdx = b[2] - b[0]
  const bdy = b[3] - b[1]
  const alen = Math.hypot(adx, ady)
  const blen = Math.hypot(bdx, bdy)
  if (alen < 1e-6 || blen < 1e-6) return null
  const cross = adx * bdy - ady * bdx
  if (Math.abs(cross) > tol * Math.max(alen, blen)) return null
  const dist = Math.abs(adx * (b[1] - a[1]) - ady * (b[0] - a[0])) / alen
  if (dist > tol) return null
  const ux = adx / alen
  const uy = ady / alen
  const ts = [0, alen, (b[0] - a[0]) * ux + (b[1] - a[1]) * uy, (b[2] - a[0]) * ux + (b[3] - a[1]) * uy]
  const a0 = Math.min(0, alen)
  const a1 = Math.max(0, alen)
  const b0 = Math.min(ts[2]!, ts[3]!)
  const b1 = Math.max(ts[2]!, ts[3]!)
  if (a1 + tol < b0 || b1 + tol < a0) return null
  const lo = Math.min(...ts)
  const hi = Math.max(...ts)
  return [a[0] + lo * ux, a[1] + lo * uy, a[0] + hi * ux, a[1] + hi * uy]
}

export function mergeSegments(input: readonly BindruneSeg[], tolerance = BIND_TOLERANCE): BindruneSeg[] {
  const segs = input.map((seg) =>
    seg[0] < seg[2] - 1e-9 || (almost(seg[0], seg[2], 1e-9) && seg[1] <= seg[3]) ? seg : ([seg[2], seg[3], seg[0], seg[1]] as BindruneSeg),
  )
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < segs.length; i += 1) {
      for (let j = i + 1; j < segs.length; j += 1) {
        const merged = mergePair(segs[i]!, segs[j]!, tolerance)
        if (!merged) continue
        segs[i] = merged
        segs.splice(j, 1)
        changed = true
        break
      }
      if (changed) break
    }
  }
  return segs.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3])
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export function segmentsToPath(segs: readonly BindruneSeg[]): string {
  return segs.map((seg) => `M${round1(seg[0])} ${round1(seg[1])} L${round1(seg[2])} ${round1(seg[3])}`).join(' ')
}

export function composeBindrune(stones: readonly BindruneStone[] | null | undefined): {
  d: string
  staveOnly: boolean
  segments: BindruneSeg[]
} {
  const list = stones?.length ? stones : []
  const arms = list.flatMap(stoneSegments)
  const segs = mergeSegments([STAVE, ...arms])
  return {
    d: segmentsToPath(segs),
    staveOnly: list.length === 0,
    segments: segs,
  }
}

export function bindruneCenterY(hasFudan: boolean): number {
  if (!hasFudan) return BIND_Y_BARE
  const fudanBottom = FUDAN_BASELINE_Y + 8
  const naturalTop = BIND_Y_WITH_FUDAN - BIND_HALF
  if (naturalTop < fudanBottom + 12) return fudanBottom + 12 + BIND_HALF
  return BIND_Y_WITH_FUDAN
}
