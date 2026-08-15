import { COIN_YANG, COIN_YIN } from './conventions'
import { createRng } from './rng'
import {
  BRANCH_ELEMENT,
  HEXAGRAM_NAMES,
  KING_WEN_BY_BITS,
  NAJIA_BRANCHES,
  PALACE_BY_KING_WEN,
  SIX_BEASTS,
  SIX_BEAST_START_BY_STEM,
  STEM_HANJA,
  TRIGRAM_BY_BITS,
  sixRelative,
  type LineValue,
} from './tables'
import type { DayStemInput, HexagramInfo, IchingDrawResult, IchingLine } from './types'

function bitsFromYangFlags(yang: readonly boolean[]): number {
  return yang.reduce((bits, isYang, index) => bits + (isYang ? 1 << index : 0), 0)
}

export function hexagramFromYangFlags(yang: readonly boolean[]): HexagramInfo {
  if (yang.length !== 6) throw new RangeError('draw engine: hexagram requires 6 lines')
  const kingWen = KING_WEN_BY_BITS[bitsFromYangFlags(yang)]!
  const name = HEXAGRAM_NAMES[kingWen - 1]!
  return { kingWen, hanja: name.hanja, hangul: name.hangul, english: name.english, lines: yang }
}

function flipChanging(values: readonly LineValue[]): boolean[] {
  return values.map((value) => {
    const yang = value === 7 || value === 9
    const changing = value === 6 || value === 9
    return changing ? !yang : yang
  })
}

function resolveDayStem(input: DayStemInput | undefined): string | null {
  if (input === undefined || input === null) return null
  if (typeof input === 'number') {
    if (!Number.isInteger(input) || input < 0 || input > 9) {
      throw new RangeError(`draw engine: dayStem index must be 0..9, got ${input}`)
    }
    return STEM_HANJA[input]!
  }
  if (typeof input === 'object') {
    const hanja = input.hanja
    if (!(hanja in SIX_BEAST_START_BY_STEM) && input.index === undefined) {
      throw new RangeError(`draw engine: unknown dayStem hanja "${hanja}"`)
    }
    if (hanja in SIX_BEAST_START_BY_STEM) return hanja
    return STEM_HANJA[input.index!]!
  }
  const key = input.trim()
  if (key in SIX_BEAST_START_BY_STEM) return key
  throw new RangeError(`draw engine: unknown dayStem "${input}"`)
}

function najiaBranches(yang: readonly boolean[]): string[] {
  const lower = TRIGRAM_BY_BITS[bitsFromYangFlags(yang.slice(0, 3))]!
  const upper = TRIGRAM_BY_BITS[bitsFromYangFlags(yang.slice(3, 6))]!
  return [...NAJIA_BRANCHES[lower].inner, ...NAJIA_BRANCHES[upper].outer]
}

function coinLine(rng: ReturnType<typeof createRng>): LineValue {
  const sum =
    (rng.nextBool() ? COIN_YANG : COIN_YIN) +
    (rng.nextBool() ? COIN_YANG : COIN_YIN) +
    (rng.nextBool() ? COIN_YANG : COIN_YIN)
  return sum as LineValue
}

export function buildLiuyao(input: {
  seed: string
  values: readonly LineValue[]
  dayStem?: DayStemInput
}): IchingDrawResult {
  if (input.values.length !== 6) throw new RangeError('draw engine: 육효 requires 6 line values')
  for (const value of input.values) {
    if (value !== 6 && value !== 7 && value !== 8 && value !== 9) {
      throw new RangeError(`draw engine: invalid line value ${value}`)
    }
  }

  const primaryYang = input.values.map((value) => value === 7 || value === 9)
  const primary = hexagramFromYangFlags(primaryYang)
  const resulting = hexagramFromYangFlags(flipChanging(input.values))
  const palace = PALACE_BY_KING_WEN[primary.kingWen]
  if (!palace) throw new Error(`draw engine: missing palace for hexagram ${primary.kingWen}`)

  const stem = resolveDayStem(input.dayStem)
  const beastStart = stem === null ? null : SIX_BEAST_START_BY_STEM[stem]!
  const branches = najiaBranches(primaryYang)
  const changingPositions: number[] = []

  const lines: IchingLine[] = input.values.map((value, index) => {
    const changing = value === 6 || value === 9
    if (changing) changingPositions.push(index + 1)
    const branch = branches[index]!
    const element = BRANCH_ELEMENT[branch]!
    return {
      position: index + 1,
      value,
      changing,
      yang: value === 7 || value === 9,
      branch,
      element,
      relative: sixRelative(palace.element, element),
      beast: beastStart === null ? null : SIX_BEASTS[(beastStart + index) % 6]!,
    }
  })

  return {
    seed: input.seed,
    primary,
    resulting,
    palace: palace.palace,
    palaceElement: palace.element,
    generation: palace.generation,
    shi: palace.shi,
    ying: palace.ying,
    lines,
    changingPositions,
    limitations: stem === null ? ['no_day_stem'] : [],
  }
}

export function ichingDraw(input: { seed: string; dayStem?: DayStemInput }): IchingDrawResult {
  const rng = createRng(input.seed)
  const values = [coinLine(rng), coinLine(rng), coinLine(rng), coinLine(rng), coinLine(rng), coinLine(rng)]
  return buildLiuyao({ seed: input.seed, values, dayStem: input.dayStem })
}
