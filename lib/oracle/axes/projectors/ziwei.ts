/**
 * 紫微斗數 projector.
 *
 * Traits   — derived, from the 主星 (major stars) seated in 命宮 and 身宮,
 *            weighted by 廟旺利陷 brightness.
 * Elements — direct (birth-time known): 五行局 anchors it, tilted by the
 *            elemental nature of the same palace stars.
 *            degraded (birth-time unknown): year-stem element only.
 * Phase    — direct, from the current 大限's own 四化 + this year's
 *            流年四化, each transformation weighted by its target star's
 *            brightness where it currently sits.
 *
 * Unknown birth time → no 命宮/身宮 → traits and phase unreadable
 * (`ziwei.no_birth_time`).
 */
import { palaceStem, siHuaForStem, ziweiChart, ZIWEI_ENGINE_VERSION } from '../../engines/ziwei'
import type { Palace, PlacedStar, SiHua, StarBrightness, ZiweiSex } from '../../engines/ziwei'
import { stemByHanja } from '../../engines/calendar/tables'
import { DIRECT_WEIGHT, HALF_WEIGHT, phaseConfidence } from '../conventions'
import { clampTraits, emptyElements, emptyTraits, normalizeElements, normalizePhase } from '../math'
import {
  ZIWEI_BRIGHTNESS_WEIGHT,
  ZIWEI_JU_ELEMENT,
  ZIWEI_PALACE_WEIGHT,
  ZIWEI_STAR_ELEMENT,
  ZIWEI_STAR_TRAITS,
} from '../tables'
import { TRAIT_AXES, type AxisVote, type ElementAxis, type ElementVector, type PhaseVector, type TraitVector } from '../types'

export type ZiweiProjectorInput = {
  birthDate: string
  birthTime: string | null
  tz: string
  sex: ZiweiSex
  atDate: string
}

function brightnessWeight(brightness: StarBrightness | '' | undefined): number {
  return ZIWEI_BRIGHTNESS_WEIGHT[brightness ?? '']
}

/** Weighted-average trait mix of the 主星 in one palace, in [0,1] per axis. Null when the palace is 空宮 (no major star). */
function palaceMajorStarMix(palace: Palace): TraitVector | null {
  const raw = emptyTraits()
  let weight = 0
  for (const star of palace.stars) {
    if (star.category !== 'major') continue
    const mix = ZIWEI_STAR_TRAITS[star.name]
    if (!mix) continue
    const w = brightnessWeight(star.brightness)
    weight += w
    for (const axis of TRAIT_AXES) raw[axis] += mix[axis] * w
  }
  if (weight <= 0) return null
  const out = emptyTraits()
  for (const axis of TRAIT_AXES) out[axis] = raw[axis] / weight
  return out
}

function traitsFromPalaces(mingPalace: Palace, shenPalace: Palace): TraitVector {
  const mingMix = palaceMajorStarMix(mingPalace)
  const shenMix = palaceMajorStarMix(shenPalace)
  const raw = emptyTraits()
  let totalWeight = 0
  if (mingMix) {
    totalWeight += ZIWEI_PALACE_WEIGHT.ming
    for (const axis of TRAIT_AXES) raw[axis] += mingMix[axis] * ZIWEI_PALACE_WEIGHT.ming
  }
  if (shenMix) {
    totalWeight += ZIWEI_PALACE_WEIGHT.shen
    for (const axis of TRAIT_AXES) raw[axis] += shenMix[axis] * ZIWEI_PALACE_WEIGHT.shen
  }
  // Both seats 空宮 (no major star) is a real, if uncommon, classical
  // outcome. We fall back to a flat vector rather than inventing emphasis.
  if (totalWeight <= 0) return emptyTraits()
  for (const axis of TRAIT_AXES) raw[axis] = (raw[axis] / totalWeight) * 100
  return clampTraits(raw)
}

function addStarElement(raw: ElementVector, star: PlacedStar, paletteWeight: number): void {
  if (star.category !== 'major') return
  const element = ZIWEI_STAR_ELEMENT[star.name]
  if (!element) return
  raw[element] += 10 * brightnessWeight(star.brightness) * paletteWeight
}

/** 五行局 anchors the element read; palace stars' native 五行 tilt it. */
function elementsFromJuAndPalaces(juElement: ElementAxis, mingPalace: Palace, shenPalace: Palace): ElementVector | null {
  const raw = emptyElements()
  raw[juElement] += 70
  for (const star of mingPalace.stars) addStarElement(raw, star, ZIWEI_PALACE_WEIGHT.ming)
  for (const star of shenPalace.stars) addStarElement(raw, star, ZIWEI_PALACE_WEIGHT.shen)
  return normalizeElements(raw)
}

function elementsFromYearStemOnly(stemElement: ElementAxis): ElementVector | null {
  const raw = emptyElements(12)
  raw[stemElement] += 40
  return normalizeElements(raw)
}

function findStarBrightnessWeight(palaces: Palace[], starName: string): number {
  for (const palace of palaces) {
    const found = palace.stars.find((s) => s.name === starName)
    if (found) return brightnessWeight(found.brightness)
  }
  return brightnessWeight(undefined)
}

function addSiHuaVotes(raw: { advance: number; hold: number; release: number }, sihua: SiHua, palaces: Palace[]): void {
  raw.advance += findStarBrightnessWeight(palaces, sihua.lu)
  raw.advance += findStarBrightnessWeight(palaces, sihua.quan)
  raw.hold += findStarBrightnessWeight(palaces, sihua.ke)
  raw.release += findStarBrightnessWeight(palaces, sihua.ji)
}

function phaseFromDecadeAndYear(
  yearStemIndex: number,
  decadePalaceIndex: number,
  liuNianSiHua: SiHua,
  palaces: Palace[],
): PhaseVector | null {
  const raw = { advance: 0, hold: 0, release: 0 }
  const decadeSiHua = siHuaForStem(palaceStem(yearStemIndex, decadePalaceIndex))
  addSiHuaVotes(raw, decadeSiHua, palaces)
  addSiHuaVotes(raw, liuNianSiHua, palaces)
  return normalizePhase(raw)
}

export function projectZiwei(input: ZiweiProjectorInput): AxisVote {
  const chart = ziweiChart({
    birthDate: input.birthDate,
    birthTime: input.birthTime,
    tz: input.tz,
    sex: input.sex,
    atDate: input.atDate,
  })
  const yearStemIndex = stemByHanja(chart.lunar.yearStem).index

  if (chart.mingGong === null) {
    const elements = elementsFromYearStemOnly(stemByHanja(chart.lunar.yearStem).element)
    return {
      system: 'ziwei',
      traits: null,
      elements,
      phase: null,
      confidence: {
        traits: null,
        elements: elements ? { weight: HALF_WEIGHT, basis: 'degraded' } : null,
        phase: null,
      },
      unreadable: [
        { space: 'traits', code: 'ziwei.no_birth_time' },
        { space: 'phase', code: 'ziwei.no_birth_time' },
      ],
      reasons: { elements: ['ziwei.elements.year_stem_only', 'ziwei.no_birth_time'] },
      engineVersion: ZIWEI_ENGINE_VERSION,
    }
  }

  const mingPalace = chart.palaces[chart.mingGong.index]!
  const shenPalace = chart.palaces[chart.shenGong.index]!
  const traits = traitsFromPalaces(mingPalace, shenPalace)
  const juElement = ZIWEI_JU_ELEMENT[chart.wuXingJu.name]
  const elements = elementsFromJuAndPalaces(juElement, mingPalace, shenPalace)

  const currentDaXian = chart.daXian.currentDaXian
  const liuNian = chart.liuNian
  const phase =
    currentDaXian && liuNian
      ? phaseFromDecadeAndYear(yearStemIndex, currentDaXian.palaceIndex, liuNian.liuNianSiHua, chart.palaces)
      : null

  const unreadable: AxisVote['unreadable'] = []
  if (!phase) unreadable.push({ space: 'phase', code: 'ziwei.no_current_daxian' })

  return {
    system: 'ziwei',
    traits,
    elements,
    phase,
    confidence: {
      traits: { weight: HALF_WEIGHT, basis: 'derived' },
      elements: elements ? { weight: DIRECT_WEIGHT, basis: 'direct' } : null,
      phase: phase ? phaseConfidence('ziwei', DIRECT_WEIGHT, 'direct') : null,
    },
    unreadable,
    reasons: {
      traits: ['ziwei.traits.ming_shen_major_stars'],
      elements: ['ziwei.elements.wuxingju_and_palace_stars'],
      phase: phase ? ['ziwei.phase.daxian_and_liunian_sihua'] : undefined,
    },
    engineVersion: ZIWEI_ENGINE_VERSION,
  }
}
