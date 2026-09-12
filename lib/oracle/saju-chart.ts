/**
 * Reader for the 사주 팔자표 chart, parsed from `oracle_computations.result`
 * as it arrives over the poll DTO.
 *
 * The DTO hands the browser a plain JSON object (PII already stripped by
 * public-computation), so the chart cannot rely on the engine's interfaces at
 * runtime. Everything is narrowed here, once, and the component renders a
 * typed structure — a missing or malformed field degrades one cell instead of
 * throwing inside React.
 *
 * Pure: no React, no DOM, no clock.
 */
import { eokbuNativeChart } from './display-copy'

export const SAJU_ELEMENT_KEYS = ['wood', 'fire', 'earth', 'metal', 'water'] as const
export type SajuElementKey = (typeof SAJU_ELEMENT_KEYS)[number]

export const SAJU_ELEMENT_LABELS: Record<SajuElementKey, string> = {
  wood: '목',
  fire: '화',
  earth: '토',
  metal: '금',
  water: '수',
}

export type SajuPillarKey = 'year' | 'month' | 'day' | 'hour'

/** 년월일시, the order a Korean 팔자표 is read left to right. */
export const SAJU_PILLAR_ORDER: readonly SajuPillarKey[] = ['year', 'month', 'day', 'hour']

export const SAJU_PILLAR_LABELS: Record<SajuPillarKey, string> = {
  year: '년주',
  month: '월주',
  day: '일주',
  hour: '시주',
}

export type SajuChartChar = {
  hanja: string
  hangul: string
  element: SajuElementKey | null
  yinYang: 'yang' | 'yin' | null
  /** 십신 for this character; 일간 for the day stem itself. */
  tenGod: string | null
  /** 십이지 animal, branches only. */
  animal: string | null
}

export type SajuChartColumn = {
  key: SajuPillarKey
  label: string
  stem: SajuChartChar | null
  branch: SajuChartChar | null
  ganzhi: string | null
  /** True for the hour pillar when the birth time is unknown. */
  missing: boolean
}

export type SajuElementCount = {
  key: SajuElementKey
  label: string
  count: number
}

export type SajuChart = {
  columns: SajuChartColumn[]
  elements: SajuElementCount[]
  /** Total counted characters — 8 with an hour pillar, 6 without. */
  charCount: number
  hourUnknown: boolean
  /** 일간, the reference character every 십신 is measured against. */
  dayStem: SajuChartChar | null
  eokbu: SajuEokbu | null
}

export type SajuEokbu = {
  strength: string
  summary: string
  yongsin: string
  huisin: string
  gisin: string
  deukryeong: { has: boolean; score: number; monthBranch: string; relation: string }
  deukji: { score: number; roots: string[] }
  deukse: { score: number; helpers: string[] }
  inapplicable: string | null
  hourUnknownNote: string | null
}

type Json = Record<string, unknown>

function asObject(value: unknown): Json | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function asElement(value: unknown): SajuElementKey | null {
  return typeof value === 'string' && (SAJU_ELEMENT_KEYS as readonly string[]).includes(value)
    ? (value as SajuElementKey)
    : null
}

function asYinYang(value: unknown): 'yang' | 'yin' | null {
  return value === 'yang' || value === 'yin' ? value : null
}

function readChar(raw: unknown, tenGod: string | null): SajuChartChar | null {
  const source = asObject(raw)
  if (!source) return null
  const hanja = asString(source.hanja)
  const hangul = asString(source.hangul)
  if (!hanja && !hangul) return null
  return {
    hanja: hanja ?? '',
    hangul: hangul ?? '',
    element: asElement(source.element),
    yinYang: asYinYang(source.yinYang),
    tenGod,
    animal: asString(source.animal),
  }
}

function readColumn(key: SajuPillarKey, pillars: Json, tenGods: Json | null): SajuChartColumn {
  const pillar = asObject(pillars[key])
  const gods = asObject(tenGods?.[key])
  return {
    key,
    label: SAJU_PILLAR_LABELS[key],
    stem: pillar ? readChar(pillar.stem, asString(gods?.stem)) : null,
    branch: pillar ? readChar(pillar.branch, asString(gods?.branch)) : null,
    ganzhi: pillar ? asString(pillar.ganzhi) : null,
    missing: pillar === null,
  }
}

function readElements(raw: unknown): SajuElementCount[] {
  const source = asObject(raw)
  return SAJU_ELEMENT_KEYS.map((key) => {
    const value = source?.[key]
    return {
      key,
      label: SAJU_ELEMENT_LABELS[key],
      count: typeof value === 'number' && Number.isFinite(value) ? value : 0,
    }
  })
}

/**
 * Returns null only when there is no pillar data at all — that is the signal
 * to show the "calculation unavailable" state rather than an empty grid.
 */
export function parseSajuChart(calculation: unknown): SajuChart | null {
  const root = asObject(calculation)
  const pillars = asObject(root?.pillars)
  if (!pillars) return null

  const tenGods = asObject(root?.tenGods)
  const columns = SAJU_PILLAR_ORDER.map((key) => readColumn(key, pillars, tenGods))
  if (columns.every((column) => column.stem === null && column.branch === null)) return null

  const elements = readElements(root?.fiveElements)
  const hourColumn = columns.find((column) => column.key === 'hour')
  const hourUnknown =
    pillars.hourUnknown === true || hourColumn?.missing === true || hourColumn?.stem === null

  return {
    columns,
    elements,
    charCount: elements.reduce((sum, entry) => sum + entry.count, 0),
    hourUnknown,
    dayStem: columns.find((column) => column.key === 'day')?.stem ?? null,
    eokbu: readEokbu(root?.eokbu),
  }
}

function readEokbu(raw: unknown): SajuEokbu | null {
  const ko = eokbuNativeChart(raw)
  if (!ko) return null
  return {
    strength: ko.강약,
    summary: ko.요약,
    yongsin: ko.용신,
    huisin: ko.희신,
    gisin: ko.기신,
    deukryeong: {
      has: ko.득령.여부,
      score: ko.득령.점수,
      monthBranch: ko.득령.월지,
      relation: ko.득령.관계,
    },
    deukji: { score: ko.득지.점수, roots: ko.득지.통근 },
    deukse: { score: ko.득세.점수, helpers: ko.득세.조력 },
    inapplicable: ko.판정불가 === '없음' ? null : ko.판정불가,
    hourUnknownNote: ko.시주없음 ? ko.시주없음약화 : null,
  }
}
