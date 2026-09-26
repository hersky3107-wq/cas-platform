import { describe, expect, it } from 'vitest'
import { runeDraw } from '../../engines/draw'
import {
  BIND_Y_BARE,
  BIND_Y_WITH_FUDAN,
  FUDAN_BASELINE_Y,
  bindruneCenterY,
  composeBindrune,
  mergeSegments,
  stoneSegments,
} from '../bindrune'

describe('composeBindrune', () => {
  it('is deterministic for the same stored draw', () => {
    const draw = runeDraw({ seed: 'talisman-runes-bindrune-3', count: 3, pickedPositions: [1, 2, 3] })
    const stones = draw.runes.map((rune) => ({ name: rune.name, reversed: rune.reversed }))
    expect(composeBindrune(stones)).toEqual(composeBindrune(stones))
    expect(composeBindrune(stones).staveOnly).toBe(false)
    expect(composeBindrune(stones).d.startsWith('M')).toBe(true)
    expect(composeBindrune(stones).d.includes('Tiwaz')).toBe(false)
  })

  it('dedupes collinear overlapping segments within 1 unit', () => {
    const doubled = mergeSegments([
      [0, -40, 0, 40],
      [0, -40.4, 0, 10],
      [0, 8, 0, 40.3],
    ])
    expect(doubled).toHaveLength(1)
    expect(doubled[0]![1]).toBeLessThanOrEqual(-40)
    expect(doubled[0]![3]).toBeGreaterThanOrEqual(40)
  })

  it('mirrors reversed stones vertically and does not lock them', () => {
    const upright = stoneSegments({ name: 'Kenaz', reversed: false })
    const reversed = stoneSegments({ name: 'Kenaz', reversed: true })
    expect(reversed).toEqual(upright.map((seg) => [seg[0], -seg[1], seg[2], -seg[3]]))
    expect(composeBindrune([{ name: 'Tiwaz', reversed: true }]).d).not.toBe(
      composeBindrune([{ name: 'Tiwaz', reversed: false }]).d,
    )
  })

  it('draws only the stave when the rune system is missing', () => {
    const bare = composeBindrune(null)
    expect(bare.staveOnly).toBe(true)
    expect(bare.segments).toEqual([[0, -40, 0, 40]])
    expect(composeBindrune([])).toEqual(bare)
  })
})

describe('bindrune vs 符膽 placement', () => {
  it('keeps the 符膽 readable; bindrune sits below it without overlap', () => {
    expect(FUDAN_BASELINE_Y).toBe(92)
    expect(bindruneCenterY(false)).toBe(BIND_Y_BARE)
    expect(bindruneCenterY(true)).toBe(BIND_Y_WITH_FUDAN)
    const fudanBottom = FUDAN_BASELINE_Y + 8
    expect(BIND_Y_WITH_FUDAN - 44).toBeGreaterThan(fudanBottom + 12)
  })
})
