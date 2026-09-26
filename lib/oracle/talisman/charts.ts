/**
 * oracle_computations.result → TalismanCharts.
 *
 * Reads stored engine JSON (the computation row), never axis votes.
 * 구성 흉방 is not stored: extractNativeFindings calls nineStarDirections
 * from year/month boards inside computeTalisman (same function the 구성
 * chart uses in the browser). Chosen: server-side, once, during
 * computeTalisman — not in the SVG, not persisted.
 */

import { sanitizeCalculation } from '../runner/public-computation'
import type { JsonObject } from '../runner/types'
import type { EokbuResult, FourPillars, NineStarResult, SukuyouResult, TenGodsResult, TzolkinResult } from '../engines/calendar'
import type { NatalChart } from '../engines/astro/types'
import type { IchingDrawResult, RuneDrawResult, TarotDrawResult } from '../engines/draw/types'
import type { NameResult } from '../engines/name/types'
import type { NumerologyResult } from '../engines/numerology/types'
import type { PrismResult } from '../engines/prism/types'
import type { ZiweiChart } from '../engines/ziwei/types'
import type { TalismanCharts } from './types'

export type ComputationRow = {
  system: string
  result: unknown
}

export type FieldArrival = {
  system: string
  needed: string[]
  arrived: string[]
  missing: string[]
}

export type ArrivalReport = {
  fields: FieldArrival[]
  /** Fields the eight native extractors need that did not arrive. */
  nativeMissing: Array<{ system: string; field: string }>
}

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asRecord(value: unknown): JsonObject | null {
  return isRecord(value) ? value : null
}

function hasPath(root: unknown, path: string): boolean {
  const parts = path.split('.')
  let cur: unknown = root
  for (const part of parts) {
    if (part.endsWith('[]')) {
      const key = part.slice(0, -2)
      if (!isRecord(cur) || !(key in cur)) return false
      const arr = cur[key]
      if (!Array.isArray(arr) || arr.length === 0) return false
      cur = arr[0]
      continue
    }
    if (!isRecord(cur) || !(part in cur) || cur[part] === undefined) return false
    cur = cur[part]
  }
  return cur !== undefined
}

function arrivalFor(system: string, root: unknown, needed: string[]): FieldArrival {
  const arrived = needed.filter((field) => hasPath(root, field))
  const missing = needed.filter((field) => !arrived.includes(field))
  return { system, needed, arrived, missing }
}

const SAJU_FIELDS = [
  'eokbu.yongsin',
  'eokbu.strength',
  'eokbu.gisin',
  'tenGods.year.stem',
  'tenGods.year.branch',
  'tenGods.month.stem',
  'tenGods.month.branch',
  'tenGods.day.branch',
] as const

const ZIWEI_FIELDS = ['chart.palaces', 'chart.siHua.ji'] as const
const ASTRO_FIELDS = ['natal.elementBalance', 'natal.limitations', 'natal.bodies'] as const
const PRISM_FIELDS = ['prism.warningDomain', 'prism.domainScores', 'prism.coreMatrix'] as const
const ICHING_FIELDS = ['draw.hiddenRelatives', 'draw.lines'] as const
const TAROT_FIELDS = ['draw.cards'] as const
const NAME_FIELDS = ['reading.supported', 'reading.numerology81'] as const
const NINESTAR_FIELDS = [
  'natal.yearBoard.cells',
  'natal.monthBoard.cells',
  'natal.year.number',
  'natal.yearBranchIndex',
  'natal.monthBranchIndex',
] as const
const RUNES_FIELDS = ['draw.runes'] as const

function rowOf(rows: readonly ComputationRow[], system: string): unknown {
  return rows.find((row) => row.system === system)?.result ?? null
}

function parseSaju(result: unknown): TalismanCharts['saju'] {
  const root = asRecord(result)
  const eokbu = asRecord(root?.eokbu)
  const tenGods = asRecord(root?.tenGods)
  if (!eokbu || !tenGods) return null
  const strength = eokbu.strength
  if (strength !== 'weak' && strength !== 'balanced' && strength !== 'strong' && strength !== null) return null
  return {
    eokbu: eokbu as unknown as EokbuResult,
    tenGods: tenGods as unknown as TenGodsResult,
    pillars: (asRecord(root?.pillars) as unknown as FourPillars) ?? null,
  }
}

function parseZiwei(result: unknown): ZiweiChart | null {
  const chart = asRecord(asRecord(result)?.chart)
  if (!chart || !asRecord(chart.siHua) || !Array.isArray(chart.palaces)) return null
  return chart as unknown as ZiweiChart
}

function parseAstro(result: unknown): NatalChart | null {
  const natal = asRecord(asRecord(result)?.natal)
  if (!natal || !asRecord(natal.elementBalance) || !asRecord(natal.bodies)) return null
  return natal as unknown as NatalChart
}

function parsePrism(result: unknown): PrismResult | null {
  const prism = asRecord(asRecord(result)?.prism)
  if (!prism || typeof prism.warningDomain !== 'string') return null
  return prism as unknown as PrismResult
}

function parseIching(result: unknown): IchingDrawResult | null {
  const draw = asRecord(asRecord(result)?.draw)
  if (!draw || !Array.isArray(draw.hiddenRelatives) || !Array.isArray(draw.lines)) return null
  return draw as unknown as IchingDrawResult
}

function parseTarot(result: unknown): TarotDrawResult | null {
  const draw = asRecord(asRecord(result)?.draw)
  if (!draw || !Array.isArray(draw.cards)) return null
  return draw as unknown as TarotDrawResult
}

function parseName(result: unknown): NameResult | null {
  const reading = asRecord(asRecord(result)?.reading)
  if (!reading || typeof reading.supported !== 'boolean') return null
  return reading as unknown as NameResult
}

function parseNinestar(result: unknown): NineStarResult | null {
  const natal = asRecord(asRecord(result)?.natal)
  if (!natal || !asRecord(natal.yearBoard) || !asRecord(natal.monthBoard) || !asRecord(natal.year)) return null
  if (typeof natal.yearBranchIndex !== 'number' || typeof natal.monthBranchIndex !== 'number') return null
  return natal as unknown as NineStarResult
}

function parseRunes(result: unknown): RuneDrawResult | null {
  const draw = asRecord(asRecord(result)?.draw)
  if (!draw || !Array.isArray(draw.runes)) return null
  return draw as unknown as RuneDrawResult
}

function parseNumerology(result: unknown): NumerologyResult | null {
  const numbers = asRecord(asRecord(result)?.numbers)
  if (!numbers || typeof numbers.lifePath !== 'number') return null
  return numbers as unknown as NumerologyResult
}

function parseSukuyou(result: unknown): SukuyouResult | null {
  const natal = asRecord(asRecord(result)?.natal)
  if (!natal || typeof natal.index !== 'number') return null
  return natal as unknown as SukuyouResult
}

function parseTzolkin(result: unknown): TzolkinResult | null {
  const natal = asRecord(asRecord(result)?.natal)
  if (!natal || typeof natal.tone !== 'number' || typeof natal.nawal !== 'number') return null
  return natal as unknown as TzolkinResult
}

export function chartsFromComputations(rows: readonly ComputationRow[]): {
  charts: TalismanCharts
  arrival: ArrivalReport
} {
  const sanitized = rows.map((row) => ({
    system: row.system,
    result: row.result ? sanitizeCalculation(row.result, row.system) : null,
  }))

  const fields: FieldArrival[] = [
    arrivalFor('saju', asRecord(rowOf(sanitized, 'saju')), [...SAJU_FIELDS]),
    arrivalFor('ziwei', asRecord(rowOf(sanitized, 'ziwei')), [...ZIWEI_FIELDS]),
    arrivalFor('astro', asRecord(rowOf(sanitized, 'astro')), [...ASTRO_FIELDS]),
    arrivalFor('prism', asRecord(rowOf(sanitized, 'prism')), [...PRISM_FIELDS]),
    arrivalFor('iching', asRecord(rowOf(sanitized, 'iching')), [...ICHING_FIELDS]),
    arrivalFor('tarot', asRecord(rowOf(sanitized, 'tarot')), [...TAROT_FIELDS]),
    arrivalFor('name', asRecord(rowOf(sanitized, 'name')), [...NAME_FIELDS]),
    arrivalFor('ninestar', asRecord(rowOf(sanitized, 'ninestar')), [...NINESTAR_FIELDS]),
    arrivalFor('runes', asRecord(rowOf(sanitized, 'runes')), [...RUNES_FIELDS]),
  ]

  const nativeSystems = new Set(['saju', 'ziwei', 'astro', 'prism', 'iching', 'tarot', 'name', 'ninestar'])
  const nativeMissing = fields
    .filter((entry) => nativeSystems.has(entry.system))
    .flatMap((entry) => entry.missing.map((field) => ({ system: entry.system, field })))

  return {
    charts: {
      saju: parseSaju(rowOf(sanitized, 'saju')),
      ziwei: parseZiwei(rowOf(sanitized, 'ziwei')),
      astro: parseAstro(rowOf(sanitized, 'astro')),
      iching: parseIching(rowOf(sanitized, 'iching')),
      tarot: parseTarot(rowOf(sanitized, 'tarot')),
      prism: parsePrism(rowOf(sanitized, 'prism')),
      name: parseName(rowOf(sanitized, 'name')),
      ninestar: parseNinestar(rowOf(sanitized, 'ninestar')),
      runes: parseRunes(rowOf(sanitized, 'runes')),
      numerology: parseNumerology(rowOf(sanitized, 'numerology')),
      sukuyou: parseSukuyou(rowOf(sanitized, 'sukuyou')),
      tzolkin: parseTzolkin(rowOf(sanitized, 'tzolkin')),
    },
    arrival: { fields, nativeMissing },
  }
}
