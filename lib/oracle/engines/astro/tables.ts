import { Body } from 'astronomy-engine'
import type { AspectType } from './conventions'

export type Element = 'fire' | 'earth' | 'air' | 'water'
export type Modality = 'cardinal' | 'fixed' | 'mutable'

export const SIGNS = [
  { name: 'Aries', element: 'fire', modality: 'cardinal', traditionalRuler: 'Mars', modernRuler: 'Mars' },
  { name: 'Taurus', element: 'earth', modality: 'fixed', traditionalRuler: 'Venus', modernRuler: 'Venus' },
  { name: 'Gemini', element: 'air', modality: 'mutable', traditionalRuler: 'Mercury', modernRuler: 'Mercury' },
  { name: 'Cancer', element: 'water', modality: 'cardinal', traditionalRuler: 'Moon', modernRuler: 'Moon' },
  { name: 'Leo', element: 'fire', modality: 'fixed', traditionalRuler: 'Sun', modernRuler: 'Sun' },
  { name: 'Virgo', element: 'earth', modality: 'mutable', traditionalRuler: 'Mercury', modernRuler: 'Mercury' },
  { name: 'Libra', element: 'air', modality: 'cardinal', traditionalRuler: 'Venus', modernRuler: 'Venus' },
  { name: 'Scorpio', element: 'water', modality: 'fixed', traditionalRuler: 'Mars', modernRuler: 'Pluto' },
  { name: 'Sagittarius', element: 'fire', modality: 'mutable', traditionalRuler: 'Jupiter', modernRuler: 'Jupiter' },
  { name: 'Capricorn', element: 'earth', modality: 'cardinal', traditionalRuler: 'Saturn', modernRuler: 'Saturn' },
  { name: 'Aquarius', element: 'air', modality: 'fixed', traditionalRuler: 'Saturn', modernRuler: 'Uranus' },
  { name: 'Pisces', element: 'water', modality: 'mutable', traditionalRuler: 'Jupiter', modernRuler: 'Neptune' },
] as const satisfies readonly {
  name: string
  element: Element
  modality: Modality
  traditionalRuler: string
  modernRuler: string
}[]

export type SignName = (typeof SIGNS)[number]['name']

export const ASPECT_DEFINITIONS: readonly {
  type: AspectType
  exactDegrees: number
}[] = [
  { type: 'conjunction', exactDegrees: 0 },
  { type: 'sextile', exactDegrees: 60 },
  { type: 'square', exactDegrees: 90 },
  { type: 'trine', exactDegrees: 120 },
  { type: 'opposition', exactDegrees: 180 },
] as const

export const CLASSICAL_BODY_NAMES = [
  'Sun',
  'Moon',
  'Mercury',
  'Venus',
  'Mars',
  'Jupiter',
  'Saturn',
  'Uranus',
  'Neptune',
  'Pluto',
] as const

export type ClassicalBodyName = (typeof CLASSICAL_BODY_NAMES)[number]
export type AstroBodyName = ClassicalBodyName | 'TrueNode' | 'SouthNode'

export const ASTRONOMY_BODY_BY_NAME: Record<ClassicalBodyName, Body> = {
  Sun: Body.Sun,
  Moon: Body.Moon,
  Mercury: Body.Mercury,
  Venus: Body.Venus,
  Mars: Body.Mars,
  Jupiter: Body.Jupiter,
  Saturn: Body.Saturn,
  Uranus: Body.Uranus,
  Neptune: Body.Neptune,
  Pluto: Body.Pluto,
}

/** Explicit rulership lookup, exported for downstream interpretive engines. */
export const RULERSHIPS = Object.fromEntries(
  SIGNS.map((sign) => [
    sign.name,
    {
      traditional: sign.traditionalRuler,
      modern: sign.modernRuler,
    },
  ]),
) as Record<SignName, { traditional: string; modern: string }>
