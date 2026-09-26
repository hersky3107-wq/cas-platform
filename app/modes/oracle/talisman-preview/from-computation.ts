/**
 * Map computeTalisman + stored charts onto the SVG's TalismanSpec.
 * Hard-coded variants stay in variants.ts; this is the real-session path.
 */

import { branchPairRelation } from '@/lib/oracle/engines/calendar'
import { LUOSHU_PALACES, type CompassDirection } from '@/lib/oracle/engines/calendar/luoshu'
import { SIX_RELATIVES } from '@/lib/oracle/engines/draw/tables'
import { centrePathLabel } from '@/lib/oracle/talisman'
import type { TalismanCharts, TalismanComputation, TalismanPurpose } from '@/lib/oracle/talisman'
import type { GyeokSeat, SealTarget } from '@/lib/oracle/talisman/types'
import type { PalaceName, PlacedStar, StarBrightness, ZiweiChart } from '@/lib/oracle/engines/ziwei/types'
import { CORE_AXES } from '@/lib/oracle/engines/prism/tables'
import {
  ELEMENT_KEYS,
  type ElementKey,
  type NameSeal,
  type PalaceBrightness,
  type PalaceMark,
  type PlanetMark,
  type SajuChar,
  type TalismanSpec,
} from './variants'

const PALACE_SHORT: Record<string, string> = {
  命: '命',
  兄弟: '兄',
  夫妻: '夫',
  子女: '子',
  財帛: '財',
  疾厄: '疾',
  遷移: '遷',
  交友: '友',
  官祿: '官',
  田宅: '田',
  福德: '福',
  父母: '父',
}

const PALACE_ORDER = ['命', '兄弟', '夫妻', '子女', '財帛', '疾厄', '遷移', '交友', '官祿', '田宅', '福德', '父母'] as const

const GYEOK_ORDER: GyeokSeat[] = ['cheon', 'in', 'ji', 'oe', 'chong']

const PLANET_IDS: Array<{ body: string; id: string }> = [
  { body: 'Sun', id: 'sun' },
  { body: 'Moon', id: 'moon' },
  { body: 'Mercury', id: 'mercury' },
  { body: 'Venus', id: 'venus' },
  { body: 'Mars', id: 'mars' },
  { body: 'Jupiter', id: 'jupiter' },
  { body: 'Saturn', id: 'saturn' },
]

function palaceNumber(direction: CompassDirection): number {
  return LUOSHU_PALACES.find((cell) => cell.direction === direction)?.palace ?? 5
}

function asElement(value: string | null | undefined): ElementKey | null {
  if (value == null) return null
  return (ELEMENT_KEYS as readonly string[]).includes(value) ? (value as ElementKey) : 'earth'
}

function sajuWeb(charts: TalismanCharts): { chars: SajuChar[]; hap: [number, number][]; chung: [number, number][] } {
  const pillars = charts.saju?.pillars
  if (!pillars) return { chars: [], hap: [], chung: [] }
  const slots = [
    pillars.year.stem,
    pillars.year.branch,
    pillars.month.stem,
    pillars.month.branch,
    pillars.day.stem,
    pillars.day.branch,
    pillars.hour?.stem ?? null,
    pillars.hour?.branch ?? null,
  ]
  const chars: SajuChar[] = slots.map((slot, i) => ({
    hanja: slot?.hanja ?? '空',
    isDayMaster: i === 4,
  }))
  const branchIdx = [1, 3, 5, 7] as const
  const indexes = [pillars.year.branch.index, pillars.month.branch.index, pillars.day.branch.index, pillars.hour?.branch.index ?? null]
  const hap: [number, number][] = []
  const chung: [number, number][] = []
  for (let a = 0; a < 4; a += 1) {
    for (let b = a + 1; b < 4; b += 1) {
      const ia = indexes[a]
      const ib = indexes[b]
      if (ia == null || ib == null) continue
      const rel = branchPairRelation(ia, ib)
      if (rel.yukhap) hap.push([branchIdx[a], branchIdx[b]])
      if (rel.chung) chung.push([branchIdx[a], branchIdx[b]])
    }
  }
  return { chars, hap, chung }
}

function luoshuSealed(seals: SealTarget[]): number[] {
  const nums = new Set<number>()
  for (const seal of seals) {
    if (seal.sector.frame === 'luoshu') nums.add(palaceNumber(seal.sector.direction))
  }
  return [...nums]
}

const BRIGHTNESS_RANK: Record<StarBrightness, number> = {
  庙: 6,
  旺: 5,
  得: 4,
  利: 3,
  平: 2,
  不: 1,
  陷: 0,
}

function majorBrightness(stars: readonly PlacedStar[]): PalaceBrightness {
  const majors = stars.filter((star) => star.category === 'major')
  let dimmest: StarBrightness | null = null
  for (const star of majors) {
    const value = star.brightness
    if (!value) continue
    if (dimmest == null || BRIGHTNESS_RANK[value] < BRIGHTNESS_RANK[dimmest]) dimmest = value
  }
  if (dimmest === '庙' || dimmest === '旺') return 'solid'
  if (dimmest === '不' || dimmest === '陷') return 'faint'
  return 'mid'
}

function currentDaXianName(chart: ZiweiChart): PalaceName | null {
  if (!chart.daXian) return null
  return chart.daXian.currentDaXian?.palaceName ?? null
}

/** Palace marks from the sanitized chart, not the seal-subtracted layer. */
export function palacesFrom(computation: TalismanComputation, charts: TalismanCharts): PalaceMark[] | null {
  const chart = charts.ziwei
  if (!chart || chart.palaces.length === 0) return null
  const sealed = new Set(
    computation.seals
      .filter((seal) => seal.sector.frame === 'ziwei')
      .map((seal) => (seal.sector.frame === 'ziwei' ? seal.sector.palace : '')),
  )
  const ji = chart.siHua.ji
  const daXian = currentDaXianName(chart)
  return PALACE_ORDER.map((name) => {
    const palace = chart.palaces.find((entry) => entry.name === name)
    const stars = palace?.stars ?? []
    const empty = !stars.some((star) => star.category === 'major')
    const isSealed = sealed.has(name)
    return {
      name: PALACE_SHORT[name] ?? name,
      empty,
      sealed: isSealed,
      maleficCount: stars.filter((star) => star.category === 'malefic').length,
      brightness: empty ? 'mid' : majorBrightness(stars),
      huaJi: !isSealed && stars.some((star) => star.name === ji),
      daXian: daXian === name,
    }
  })
}

function nameSealsFrom(computation: TalismanComputation): NameSeal[] {
  const name = computation.layers.name
  if (!name?.supported) return ['ok', 'ok', 'ok', 'ok', 'ok']
  return GYEOK_ORDER.map((seat) => {
    if (name.daehyung.some((hit) => hit.seat === seat)) return 'hyung'
    if (name.hyung.some((hit) => hit.seat === seat)) return 'empty'
    return 'ok'
  })
}

function planetsFrom(charts: TalismanCharts): PlanetMark[] {
  const bodies = charts.astro?.bodies
  if (!bodies) return []
  const out: PlanetMark[] = []
  for (const { body, id } of PLANET_IDS) {
    const pos = bodies[body as keyof typeof bodies]
    if (pos && typeof pos.longitude === 'number') out.push({ id, longitude: pos.longitude })
  }
  return out
}

function prismDent(charts: TalismanCharts): 0 | 1 | 2 | 3 | 4 | 5 | null {
  const core = charts.prism?.coreMatrix
  if (!core) return null
  let min = Infinity
  let idx = 4
  CORE_AXES.forEach((axis, i) => {
    const value = core[axis]
    if (typeof value === 'number' && value < min) {
      min = value
      idx = i
    }
  })
  return idx as 0 | 1 | 2 | 3 | 4 | 5
}

function bokjangSeats(computation: TalismanComputation): number[] {
  const hidden = computation.layers.iching?.hiddenRelatives ?? []
  return hidden
    .map((rel) => SIX_RELATIVES.indexOf(rel))
    .filter((i) => i >= 0)
}

function reversedSuitsFrom(charts: TalismanCharts): Array<'wands' | 'cups' | 'swords' | 'pentacles'> {
  const suits = new Set<'wands' | 'cups' | 'swords' | 'pentacles'>()
  for (const card of charts.tarot?.cards ?? []) {
    if (!card.reversed) continue
    if (card.suit === 'wands' || card.suit === 'cups' || card.suit === 'swords' || card.suit === 'pentacles') {
      suits.add(card.suit)
    }
  }
  return [...suits]
}

export function talismanStats(computation: TalismanComputation, charts?: TalismanCharts) {
  const emptyPalaces = charts
    ? (palacesFrom(computation, charts)?.filter((palace) => palace.empty).length ?? 0)
    : (computation.layers.ziwei?.emptyPalaces.length ?? 0)
  const hyungbang = computation.seals.filter((seal) => seal.kind === 'ninestar-killing').length
  return {
    seals: computation.seals.length,
    emptyPalaces,
    hyungbang,
    centreSource: computation.centre.source,
    centreMode: computation.centre.mode,
    centreElement: computation.centre.element,
    centrePath: centrePathLabel(computation.centre),
    centreIntensity: computation.centre.intensity,
  }
}

export function specFromComputation(
  computation: TalismanComputation,
  charts: TalismanCharts,
  meta: { sessionId: string; dateLabel: string; title?: string; note?: string },
): TalismanSpec {
  const element = asElement(computation.centre.element)
  const saju = sajuWeb(charts)
  const lines = charts.iching?.lines.map((line) => line.yang) ?? [true, false, true, true, false, true]
  const presentSuits = new Set(
    (charts.tarot?.cards ?? []).map((card) => card.suit).filter((suit): suit is 'wands' | 'cups' | 'swords' | 'pentacles' => suit != null),
  )
  const fudanGlyph = computation.fudan.kind === 'hanja' ? computation.fudan.glyph : null
  const housesMissing = computation.layers.astro?.housesMissing ?? charts.astro?.houses == null
  return {
    id: meta.sessionId,
    title: meta.title ?? 'session',
    note: meta.note ?? '',
    element,
    mode: computation.centre.mode === 'follow' ? 'follow' : computation.centre.mode,
    intensity: computation.centre.intensity,
    prismColors: computation.prismColors,
    purposeWealth: computation.fudan.kind === 'hanja' && (computation.fudan.purpose as TalismanPurpose) === 'wealth',
    fudanGlyph,
    tarotSuits: (['wands', 'cups', 'swords', 'pentacles'] as const).filter((suit) => presentSuits.size === 0 || presentSuits.has(suit)),
    tarotReversedSuits: reversedSuitsFrom(charts),
    housesMissing,
    numerology: charts.numerology
      ? [charts.numerology.lifePath, charts.numerology.birthdayNumber, charts.numerology.personalYear, charts.numerology.personalMonth]
      : [3, 4, 7, 11],
    numerologyMissing: computation.layers.numerology?.missing ?? [],
    prismDentAxis: prismDent(charts),
    luoshuSealed: luoshuSealed(computation.seals),
    ichingLines: lines.length === 6 ? lines : [true, false, true, true, false, true],
    bokjangEmpty: bokjangSeats(computation),
    sajuChars: saju.chars.length ? saju.chars : [
      { hanja: '空', isDayMaster: false },
      { hanja: '空', isDayMaster: false },
      { hanja: '空', isDayMaster: false },
      { hanja: '空', isDayMaster: false },
      { hanja: '空', isDayMaster: true },
      { hanja: '空', isDayMaster: false },
      { hanja: '空', isDayMaster: false },
      { hanja: '空', isDayMaster: false },
    ],
    sajuHap: saju.hap,
    sajuChung: saju.chung,
    nameSeals: nameSealsFrom(computation),
    planets: planetsFrom(charts),
    ascendant: housesMissing ? null : (charts.astro?.angles?.ascendant ?? null),
    palaces: palacesFrom(computation, charts),
    sukuyouIndex: charts.sukuyou?.index ?? 8,
    tzolkinTone: charts.tzolkin?.tone ?? 9,
    tzolkinNawal: charts.tzolkin?.nawal ?? 7,
    bindrune: computation.fudan.kind === 'bindrune',
    dateLabel: meta.dateLabel,
    sessionId: meta.sessionId.slice(0, 8).toUpperCase(),
  }
}
