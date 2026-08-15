/**
 * All lookup tables for the PRISM-5 engine. Logic stays in index.ts.
 *
 * MBTI → domain scores: the original source spec said MBTI must not move
 * domain scores. Business decision overrides that — see MBTI_CYCLE_AFFINITY.
 */
import type { SeasonElement } from '../calendar'
import { AXIS_TARGET_MEAN, AXIS_TARGET_SD, MBTI_AFFINITY_CLAMP } from './conventions'

export type ColorAxis = 'activation' | 'expansion' | 'control' | 'relation' | 'recovery' | 'sensitivity'
export type CoreAxis = 'drive' | 'stability' | 'relation' | 'control' | 'exploration' | 'reflection'
export type ColorVector = Record<ColorAxis, number>
export type CoreVector = Record<CoreAxis, number>

export const COLOR_AXES = [
  'activation',
  'expansion',
  'control',
  'relation',
  'recovery',
  'sensitivity',
] as const satisfies readonly ColorAxis[]

export const CORE_AXES = [
  'drive',
  'stability',
  'relation',
  'control',
  'exploration',
  'reflection',
] as const satisfies readonly CoreAxis[]

export const DOMAIN_NAMES = ['work', 'money', 'love', 'social', 'energy'] as const
export type DomainName = (typeof DOMAIN_NAMES)[number]
export type DomainScores = Record<DomainName, number>

/** Identity color → core axes. Impulse / Need never enter coreMatrix. */
export const COLOR_TO_CORE: Record<ColorAxis, CoreAxis> = {
  activation: 'drive',
  recovery: 'stability',
  relation: 'relation',
  control: 'control',
  expansion: 'exploration',
  sensitivity: 'reflection',
}

export const PRISM_COLORS = [
  'crimson',
  'scarlet',
  'amber',
  'gold',
  'coral',
  'rose',
  'azure',
  'indigo',
  'violet',
  'teal',
  'sage',
  'slate',
  'ochre',
  'olive',
  'bronze',
  'sand',
  'ivory',
  'pearl',
  'silver',
  'mint',
  'onyx',
  'plum',
  'navy',
  'ember',
] as const
export type PrismColor = (typeof PRISM_COLORS)[number]

/** 24 colors × AXCRVS, 0–100. */
export const COLOR_PROFILES: Record<PrismColor, ColorVector> = {
  crimson: { activation: 88, expansion: 70, control: 55, relation: 48, recovery: 30, sensitivity: 40 },
  scarlet: { activation: 82, expansion: 78, control: 42, relation: 60, recovery: 28, sensitivity: 38 },
  amber: { activation: 74, expansion: 80, control: 40, relation: 55, recovery: 36, sensitivity: 42 },
  gold: { activation: 68, expansion: 62, control: 70, relation: 58, recovery: 48, sensitivity: 35 },
  coral: { activation: 72, expansion: 65, control: 38, relation: 78, recovery: 40, sensitivity: 50 },
  rose: { activation: 58, expansion: 52, control: 35, relation: 85, recovery: 55, sensitivity: 62 },
  azure: { activation: 40, expansion: 55, control: 48, relation: 60, recovery: 58, sensitivity: 70 },
  indigo: { activation: 32, expansion: 48, control: 62, relation: 42, recovery: 60, sensitivity: 78 },
  violet: { activation: 38, expansion: 70, control: 45, relation: 50, recovery: 48, sensitivity: 80 },
  teal: { activation: 45, expansion: 58, control: 50, relation: 55, recovery: 72, sensitivity: 52 },
  sage: { activation: 36, expansion: 42, control: 48, relation: 58, recovery: 80, sensitivity: 55 },
  slate: { activation: 34, expansion: 38, control: 72, relation: 40, recovery: 70, sensitivity: 48 },
  ochre: { activation: 55, expansion: 50, control: 65, relation: 45, recovery: 62, sensitivity: 40 },
  olive: { activation: 42, expansion: 44, control: 58, relation: 52, recovery: 75, sensitivity: 46 },
  bronze: { activation: 60, expansion: 48, control: 75, relation: 42, recovery: 50, sensitivity: 38 },
  sand: { activation: 48, expansion: 40, control: 52, relation: 62, recovery: 68, sensitivity: 44 },
  ivory: { activation: 50, expansion: 46, control: 40, relation: 70, recovery: 65, sensitivity: 58 },
  pearl: { activation: 44, expansion: 50, control: 38, relation: 72, recovery: 60, sensitivity: 64 },
  silver: { activation: 40, expansion: 42, control: 68, relation: 48, recovery: 58, sensitivity: 55 },
  mint: { activation: 52, expansion: 60, control: 35, relation: 66, recovery: 70, sensitivity: 50 },
  onyx: { activation: 48, expansion: 35, control: 80, relation: 30, recovery: 45, sensitivity: 42 },
  plum: { activation: 42, expansion: 58, control: 50, relation: 48, recovery: 52, sensitivity: 75 },
  navy: { activation: 38, expansion: 40, control: 78, relation: 36, recovery: 55, sensitivity: 50 },
  ember: { activation: 80, expansion: 55, control: 60, relation: 40, recovery: 32, sensitivity: 45 },
}

function colorPairRms(a: ColorVector, b: ColorVector): number {
  let sumSq = 0
  for (const axis of COLOR_AXES) {
    const delta = a[axis] - b[axis]
    sumSq += delta * delta
  }
  return Math.sqrt(sumSq / COLOR_AXES.length)
}

function computeColorConflictBounds(): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < PRISM_COLORS.length; i++) {
    for (let j = i + 1; j < PRISM_COLORS.length; j++) {
      const dist = colorPairRms(COLOR_PROFILES[PRISM_COLORS[i]!], COLOR_PROFILES[PRISM_COLORS[j]!])
      if (dist < min) min = dist
      if (dist > max) max = dist
    }
  }
  return { min, max }
}

/**
 * Exact empirical min/max RMS color distance across all 24-choose-2 = 276
 * unique color pairs, computed once at module load (not hardcoded).
 * `currentConflict` rescales the raw impulse/need distance against this
 * range so the closest pair reads ~0 and the farthest pair reads ~100.
 */
export const COLOR_CONFLICT_BOUNDS: { min: number; max: number } = computeColorConflictBounds()
export const COLOR_CONFLICT_PAIR_COUNT = (PRISM_COLORS.length * (PRISM_COLORS.length - 1)) / 2

export const MBTI_TYPES = [
  'INTJ',
  'INTP',
  'ENTJ',
  'ENTP',
  'INFJ',
  'INFP',
  'ENFJ',
  'ENFP',
  'ISTJ',
  'ISFJ',
  'ESTJ',
  'ESFJ',
  'ISTP',
  'ISFP',
  'ESTP',
  'ESFP',
] as const
export type MbtiType = (typeof MBTI_TYPES)[number]

/**
 * Letter deltas on the six core axes, applied from a 50 baseline.
 * Relation spread across 16 types ≈ 44; Stability ≈ 36 — unequal on purpose.
 */
export const MBTI_LETTER_DELTAS: Record<'E' | 'I' | 'S' | 'N' | 'T' | 'F' | 'J' | 'P', Partial<CoreVector>> = {
  E: { drive: 12, relation: 6, reflection: -12 },
  I: { drive: -12, relation: -6, reflection: 12 },
  S: { stability: 6, exploration: -14, reflection: -6 },
  N: { stability: -6, exploration: 14, reflection: 6 },
  T: { control: 8, relation: -16 },
  F: { control: -8, relation: 16 },
  J: { drive: 6, stability: 12, control: 10, exploration: -6 },
  P: { drive: -6, stability: -12, control: -10, exploration: 6 },
}

function sampleSd(values: number[]): { mean: number; sd: number } {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1)
  return { mean, sd: Math.sqrt(variance) }
}

function emptyCore(fill: number): CoreVector {
  return { drive: fill, stability: fill, relation: fill, control: fill, exploration: fill, reflection: fill }
}

function clamp100(n: number): number {
  return Math.min(100, Math.max(0, n))
}

function applyDeltas(base: CoreVector, deltas: Partial<CoreVector>): CoreVector {
  const out = { ...base }
  for (const axis of CORE_AXES) {
    out[axis] = clamp100(out[axis] + (deltas[axis] ?? 0))
  }
  return out
}

/** Raw (pre-normalization) MBTI vectors — used only to build stats. */
export const MBTI_RAW: Record<MbtiType, CoreVector> = Object.fromEntries(
  MBTI_TYPES.map((type) => {
    let vector = emptyCore(50)
    for (const letter of type) {
      vector = applyDeltas(vector, MBTI_LETTER_DELTAS[letter as keyof typeof MBTI_LETTER_DELTAS])
    }
    return [type, vector]
  }),
) as Record<MbtiType, CoreVector>

export const MBTI_AXIS_STATS: Record<CoreAxis, { mean: number; sd: number }> = Object.fromEntries(
  CORE_AXES.map((axis) => [axis, sampleSd(MBTI_TYPES.map((type) => MBTI_RAW[type][axis]))]),
) as Record<CoreAxis, { mean: number; sd: number }>

export function projectColorToCore(color: ColorVector): CoreVector {
  const out = emptyCore(0)
  for (const colorAxis of COLOR_AXES) {
    out[COLOR_TO_CORE[colorAxis]] = color[colorAxis]
  }
  return out
}

export const COLOR_CORE_RAW: Record<PrismColor, CoreVector> = Object.fromEntries(
  PRISM_COLORS.map((name) => [name, projectColorToCore(COLOR_PROFILES[name])]),
) as Record<PrismColor, CoreVector>

export const COLOR_AXIS_STATS: Record<CoreAxis, { mean: number; sd: number }> = Object.fromEntries(
  CORE_AXES.map((axis) => [axis, sampleSd(PRISM_COLORS.map((name) => COLOR_CORE_RAW[name][axis]))]),
) as Record<CoreAxis, { mean: number; sd: number }>

export function normalizeAxis(raw: number, stats: { mean: number; sd: number }): number {
  if (stats.sd === 0) return AXIS_TARGET_MEAN
  return clamp100(AXIS_TARGET_MEAN + ((raw - stats.mean) * AXIS_TARGET_SD) / stats.sd)
}

export function normalizeCore(raw: CoreVector, stats: Record<CoreAxis, { mean: number; sd: number }>): CoreVector {
  const out = emptyCore(0)
  for (const axis of CORE_AXES) {
    out[axis] = normalizeAxis(raw[axis], stats[axis])
  }
  return out
}

/** Authored on the common scale (center 50). Not re-normalized. */
export const SEASON_VECTORS: Record<SeasonElement, CoreVector> = {
  WOOD: { drive: 58, stability: 44, relation: 54, control: 42, exploration: 64, reflection: 48 },
  FIRE: { drive: 66, stability: 40, relation: 60, control: 48, exploration: 58, reflection: 42 },
  EARTH: { drive: 48, stability: 62, relation: 56, control: 54, exploration: 44, reflection: 50 },
  METAL: { drive: 50, stability: 56, relation: 42, control: 66, exploration: 40, reflection: 54 },
  WATER: { drive: 42, stability: 52, relation: 48, control: 46, exploration: 56, reflection: 64 },
}

export const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const
export type WeekdayName = (typeof WEEKDAY_NAMES)[number]

/** 7 weekday-rhythm vectors, authored on the common scale. */
export const WEEKDAY_VECTORS: readonly CoreVector[] = [
  { drive: 44, stability: 58, relation: 62, control: 40, exploration: 52, reflection: 56 },
  { drive: 60, stability: 48, relation: 46, control: 62, exploration: 50, reflection: 46 },
  { drive: 56, stability: 50, relation: 52, control: 54, exploration: 58, reflection: 48 },
  { drive: 50, stability: 54, relation: 58, control: 50, exploration: 48, reflection: 54 },
  { drive: 54, stability: 52, relation: 50, control: 58, exploration: 54, reflection: 50 },
  { drive: 58, stability: 46, relation: 60, control: 48, exploration: 56, reflection: 42 },
  { drive: 46, stability: 60, relation: 54, control: 44, exploration: 50, reflection: 60 },
]

export const CYCLE_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const
export type CycleId = (typeof CYCLE_IDS)[number]

export type CycleDef = {
  id: CycleId
  name: string
  base: DomainScores
  primaryWeekday: number
  secondaryWeekday: number
  luckyAction: string
  tabooAction: string
  stackTags: readonly StackAxis[]
}

export type StackAxis = 'expansion' | 'control' | 'recovery' | 'relation' | 'competition'

function stretchCycleBase(score: number): number {
  // v1.2.0 FIX 4: stretch cycle bases around 60 by 1.45 to give each cycle
  // a distinct signature. Formula is intentionally uniform; clamped 20-95.
  return Math.min(95, Math.max(20, Math.round(60 + (score - 60) * 1.45)))
}

export const CYCLES: readonly CycleDef[] = [
  {
    id: 0,
    name: 'Ignition',
    base: { work: stretchCycleBase(62), money: stretchCycleBase(54), love: stretchCycleBase(58), social: stretchCycleBase(64), energy: stretchCycleBase(70) },
    primaryWeekday: 0,
    secondaryWeekday: 1,
    luckyAction: 'Start one visible thing before noon',
    tabooAction: 'Do not pile on a second new project',
    stackTags: ['expansion'],
  },
  {
    id: 1,
    name: 'Ascent',
    base: { work: stretchCycleBase(68), money: stretchCycleBase(60), love: stretchCycleBase(50), social: stretchCycleBase(52), energy: stretchCycleBase(58) },
    primaryWeekday: 1,
    secondaryWeekday: 4,
    luckyAction: 'Push the one metric that already moves',
    tabooAction: 'Do not renegotiate the whole plan',
    stackTags: ['expansion', 'competition'],
  },
  {
    id: 2,
    name: 'Bloom',
    base: { work: stretchCycleBase(52), money: stretchCycleBase(50), love: stretchCycleBase(70), social: stretchCycleBase(68), energy: stretchCycleBase(60) },
    primaryWeekday: 5,
    secondaryWeekday: 0,
    luckyAction: 'Say the warm thing out loud',
    tabooAction: 'Do not withdraw to "think it over" all week',
    stackTags: ['relation'],
  },
  {
    id: 3,
    name: 'Tension',
    base: { work: stretchCycleBase(56), money: stretchCycleBase(48), love: stretchCycleBase(42), social: stretchCycleBase(44), energy: stretchCycleBase(40) },
    primaryWeekday: 3,
    secondaryWeekday: 2,
    luckyAction: 'Name the friction in one sentence',
    tabooAction: 'Do not force a cheerful override',
    stackTags: ['competition', 'control'],
  },
  {
    id: 4,
    name: 'Harvest',
    base: { work: stretchCycleBase(60), money: stretchCycleBase(72), love: stretchCycleBase(54), social: stretchCycleBase(50), energy: stretchCycleBase(52) },
    primaryWeekday: 4,
    secondaryWeekday: 5,
    luckyAction: 'Collect what is already owed',
    tabooAction: 'Do not spend the surplus on a new bet',
    stackTags: ['control'],
  },
  {
    id: 5,
    name: 'Recalibrate',
    base: { work: stretchCycleBase(44), money: stretchCycleBase(48), love: stretchCycleBase(50), social: stretchCycleBase(46), energy: stretchCycleBase(64) },
    primaryWeekday: 6,
    secondaryWeekday: 3,
    luckyAction: 'Cut one recurring drain',
    tabooAction: 'Do not add a new habit stack',
    stackTags: ['recovery'],
  },
  {
    id: 6,
    name: 'Breakthrough',
    base: { work: stretchCycleBase(70), money: stretchCycleBase(58), love: stretchCycleBase(48), social: stretchCycleBase(54), energy: stretchCycleBase(56) },
    primaryWeekday: 2,
    secondaryWeekday: 1,
    luckyAction: 'Ship the half-finished draft',
    tabooAction: 'Do not wait for a cleaner mood',
    stackTags: ['expansion', 'competition'],
  },
  {
    id: 7,
    name: 'Bond',
    base: { work: stretchCycleBase(48), money: stretchCycleBase(50), love: stretchCycleBase(72), social: stretchCycleBase(70), energy: stretchCycleBase(54) },
    primaryWeekday: 0,
    secondaryWeekday: 5,
    luckyAction: 'Give undivided time to one person',
    tabooAction: 'Do not keep score in the conversation',
    stackTags: ['relation'],
  },
  {
    id: 8,
    name: 'Command',
    base: { work: stretchCycleBase(72), money: stretchCycleBase(64), love: stretchCycleBase(44), social: stretchCycleBase(50), energy: stretchCycleBase(52) },
    primaryWeekday: 1,
    secondaryWeekday: 4,
    luckyAction: 'Make the call others are circling',
    tabooAction: 'Do not micromanage the follow-through',
    stackTags: ['control', 'competition'],
  },
  {
    id: 9,
    name: 'Restore',
    base: { work: stretchCycleBase(42), money: stretchCycleBase(46), love: stretchCycleBase(52), social: stretchCycleBase(48), energy: stretchCycleBase(72) },
    primaryWeekday: 6,
    secondaryWeekday: 0,
    luckyAction: 'Protect a real empty block',
    tabooAction: 'Do not treat rest as a reward you have to earn',
    stackTags: ['recovery'],
  },
  {
    id: 10,
    name: 'Distill',
    base: { work: stretchCycleBase(54), money: stretchCycleBase(62), love: stretchCycleBase(48), social: stretchCycleBase(42), energy: stretchCycleBase(50) },
    primaryWeekday: 3,
    secondaryWeekday: 6,
    luckyAction: 'Write the rule you have been living',
    tabooAction: 'Do not announce a rebrand',
    stackTags: ['control'],
  },
  {
    id: 11,
    name: 'Threshold',
    base: { work: stretchCycleBase(50), money: stretchCycleBase(52), love: stretchCycleBase(56), social: stretchCycleBase(60), energy: stretchCycleBase(48) },
    primaryWeekday: 5,
    secondaryWeekday: 2,
    luckyAction: 'Close one door so the next one can open',
    tabooAction: 'Do not start a third identity project',
    stackTags: ['expansion', 'relation'],
  },
]

export const CYCLE_BY_ID: Record<CycleId, CycleDef> = Object.fromEntries(CYCLES.map((c) => [c.id, c])) as Record<
  CycleId,
  CycleDef
>

export type ElementRelation = 'SUPPORT' | 'RESONANCE' | 'OUTPUT' | 'CHALLENGE' | 'PRESSURE'

const ELEMENT_ORDER: readonly SeasonElement[] = ['WOOD', 'FIRE', 'EARTH', 'METAL', 'WATER']

/** Season produces the next in the 상생 cycle. */
export const ELEMENT_PRODUCES: Record<SeasonElement, SeasonElement> = {
  WOOD: 'FIRE',
  FIRE: 'EARTH',
  EARTH: 'METAL',
  METAL: 'WATER',
  WATER: 'WOOD',
}

export const ELEMENT_OVERCOMES: Record<SeasonElement, SeasonElement> = {
  WOOD: 'EARTH',
  FIRE: 'METAL',
  EARTH: 'WATER',
  METAL: 'WOOD',
  WATER: 'FIRE',
}

export const ELEMENT_RELATION_MODIFIERS: Record<ElementRelation, DomainScores> = {
  SUPPORT: { work: 2, money: 1, love: 2, social: 3, energy: 5 },
  RESONANCE: { work: 3, money: 3, love: 3, social: 3, energy: 3 },
  OUTPUT: { work: 5, money: 3, love: 0, social: 1, energy: 1 },
  CHALLENGE: { work: 4, money: 1, love: -3, social: -1, energy: -2 },
  PRESSURE: { work: -3, money: -1, love: -2, social: -2, energy: -5 },
}

export const RHYTHM_SYNC_MODIFIERS = {
  primary: { work: 3, money: 2, love: 2, social: 3, energy: 2 },
  secondary: { work: 2, money: 1, love: 1, social: 2, energy: 1 },
  none: { work: -1, money: -1, love: -1, social: -1, energy: -1 },
} as const

/**
 * Color-state → domain deltas, later clamped to ±8.
 * Coefficients are applied to 0–100 inputs / 100 so a full-scale axis is ~the coeff.
 */
export const COLOR_STATE_WEIGHTS: Record<
  DomainName,
  { conflict: number; impulse: Partial<ColorVector>; need: Partial<ColorVector> }
> = {
  work: { conflict: -0.04, impulse: { activation: 6, control: 3 }, need: { recovery: -3 } },
  money: { conflict: -0.03, impulse: { control: 5, expansion: 2 }, need: { recovery: -2 } },
  love: { conflict: -0.05, impulse: { relation: 4 }, need: { relation: 4, sensitivity: 2 } },
  social: { conflict: -0.03, impulse: { relation: 5, activation: 2 }, need: { relation: 2 } },
  energy: { conflict: -0.06, impulse: { activation: 3 }, need: { recovery: 6, sensitivity: -2 } },
}

/**
 * OVERRIDES the original spec rule "MBTI must not move scores".
 * MBTI is treated as the primary factor, so each type receives a ±8
 * affinity to each Cycle. Built from letter preferences, then clamped.
 */
const LETTER_CYCLE_PREF: Record<'E' | 'I' | 'S' | 'N' | 'T' | 'F' | 'J' | 'P', readonly number[]> = {
  E: [4, 2, 4, 0, 0, -3, 3, 4, 2, -4, -3, 2],
  I: [-4, -2, -3, 1, 0, 3, -2, -3, -2, 4, 3, -1],
  S: [0, 2, 0, 0, 4, 2, -2, 0, 4, 2, 2, 0],
  N: [2, 0, 2, 1, -3, -1, 4, 1, -3, -1, 2, 2],
  T: [2, 4, -2, 2, 3, 0, 4, -3, 5, -2, 3, 0],
  F: [-1, -3, 4, -1, -2, 1, -3, 5, -4, 2, -2, 2],
  J: [0, 4, 0, 2, 4, 2, 0, 0, 5, 2, 3, -2],
  P: [3, -2, 2, 0, -3, -1, 3, 2, -4, 0, -2, 3],
}

function clampAffinity(n: number): number {
  return Math.min(MBTI_AFFINITY_CLAMP, Math.max(-MBTI_AFFINITY_CLAMP, Math.round(n)))
}

const mbtiCycleAffinity: Record<MbtiType, readonly number[]> = {
  INTJ: [],
  INTP: [],
  ENTJ: [],
  ENTP: [],
  INFJ: [],
  INFP: [],
  ENFJ: [],
  ENFP: [],
  ISTJ: [],
  ISFJ: [],
  ESTJ: [],
  ESFJ: [],
  ISTP: [],
  ISFP: [],
  ESTP: [],
  ESFP: [],
}
for (const type of MBTI_TYPES) {
  mbtiCycleAffinity[type] = CYCLE_IDS.map((id) => {
    let sum = 0
    for (const letter of type) {
      sum += LETTER_CYCLE_PREF[letter as keyof typeof LETTER_CYCLE_PREF][id]!
    }
    return clampAffinity(sum)
  })
}
export const MBTI_CYCLE_AFFINITY: Record<MbtiType, readonly number[]> = mbtiCycleAffinity

export function isMbtiType(value: string): value is MbtiType {
  return (MBTI_TYPES as readonly string[]).includes(value)
}

export function isPrismColor(value: string): value is PrismColor {
  return (PRISM_COLORS as readonly string[]).includes(value)
}

export { ELEMENT_ORDER }
