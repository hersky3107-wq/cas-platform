/**
 * 사주 projector. Traits / elements / phase are all native (direct).
 * Unknown birth time drops the hour pillar and 대운 — those two spaces
 * stay readable from three pillars + 세운, but the basis becomes degraded.
 */
import { CALENDAR_ENGINE_VERSION, fiveElementBalance, fourPillars, greatLuck, tenGods } from '../../engines/calendar'
import { overcomes, producedBy, TEN_GOD_MATRIX } from '../../engines/calendar/tables'
import type { BranchInfo, FourPillars, StemInfo, TenGodName } from '../../engines/calendar/types'
import { DIRECT_WEIGHT, HALF_WEIGHT } from '../conventions'
import { clampTraits, emptyTraits, normalizeElements, normalizePhase } from '../math'
import {
  TEN_GOD_GROUP,
  TEN_GOD_GROUP_REASON,
  TEN_GOD_GROUP_TRAITS,
  TEN_GOD_PHASE,
  type TenGodGroup,
} from '../tables'
import { TRAIT_AXES, type AxisVote, type PhaseVector, type SpaceConfidence, type TraitVector } from '../types'

export type SajuProjectorInput = {
  date: string
  time: string | null
  timezone: string
  sex: 'male' | 'female'
  asOfDate: string
}

function tenGodOf(dayStem: StemInfo, target: StemInfo | BranchInfo): TenGodName {
  const same = target.yinYang === dayStem.yinYang
  if (target.element === dayStem.element) return TEN_GOD_MATRIX.same[same ? 'same' : 'diff']
  if (target.element === producedBy(dayStem.element)) return TEN_GOD_MATRIX.produces[same ? 'same' : 'diff']
  if (target.element === overcomes(dayStem.element)) return TEN_GOD_MATRIX.dominates[same ? 'same' : 'diff']
  if (dayStem.element === overcomes(target.element)) return TEN_GOD_MATRIX.dominatedBy[same ? 'same' : 'diff']
  return TEN_GOD_MATRIX.producedBy[same ? 'same' : 'diff']
}

function collectTenGods(pillars: FourPillars): TenGodName[] {
  const labeled = tenGods(pillars.day.stem, pillars)
  const names: TenGodName[] = [
    labeled.year.stem,
    labeled.year.branch,
    labeled.month.stem,
    labeled.month.branch,
    labeled.day.branch,
  ]
  if (labeled.hour) {
    names.push(labeled.hour.stem, labeled.hour.branch)
  }
  return names
}

function traitsFromTenGods(names: TenGodName[]): { traits: TraitVector; dominant: TenGodGroup } {
  const counts: Record<TenGodGroup, number> = {
    peer: 0,
    output: 0,
    wealth: 0,
    officer: 0,
    resource: 0,
  }
  for (const name of names) counts[TEN_GOD_GROUP[name]] += 1

  const raw = emptyTraits()
  const total = names.length || 1
  for (const group of Object.keys(counts) as TenGodGroup[]) {
    const share = counts[group] / total
    const mix = TEN_GOD_GROUP_TRAITS[group]
    for (const axis of TRAIT_AXES) raw[axis] += mix[axis] * share * 100
  }

  let dominant: TenGodGroup = 'peer'
  let best = -1
  for (const group of Object.keys(counts) as TenGodGroup[]) {
    if (counts[group] > best) {
      best = counts[group]
      dominant = group
    }
  }
  return { traits: clampTraits(raw), dominant }
}

function phaseFromGods(names: TenGodName[]): PhaseVector | null {
  const raw = { advance: 0, hold: 0, release: 0 }
  for (const name of names) raw[TEN_GOD_PHASE[name]] += 1
  return normalizePhase(raw)
}

function asOfYearPillar(asOfDate: string, timezone: string, dayStem: StemInfo): TenGodName[] {
  const asOf = fourPillars({ date: asOfDate, time: '12:00', timezone })
  return [tenGodOf(dayStem, asOf.year.stem), tenGodOf(dayStem, asOf.year.branch)]
}

function currentDaewoonGods(
  input: SajuProjectorInput,
  dayStem: StemInfo,
): { gods: TenGodName[]; reason: string | null } {
  if (input.time === null) return { gods: [], reason: 'saju.hour_unknown' }
  try {
    const luck = greatLuck({
      date: input.date,
      time: input.time,
      timezone: input.timezone,
      sex: input.sex,
    })
    const year = Number(input.asOfDate.slice(0, 4))
    const period = luck.periods.find((row) => year >= row.startYear && year <= row.endYear)
    if (!period) return { gods: [], reason: 'saju.no_current_daewoon' }
    return { gods: [tenGodOf(dayStem, period.stem), tenGodOf(dayStem, period.branch)], reason: null }
  } catch {
    return { gods: [], reason: 'saju.daewoon_unavailable' }
  }
}

function conf(degraded: boolean): SpaceConfidence {
  return degraded
    ? { weight: HALF_WEIGHT, basis: 'degraded' }
    : { weight: DIRECT_WEIGHT, basis: 'direct' }
}

export function projectSaju(input: SajuProjectorInput): AxisVote {
  const pillars = fourPillars({ date: input.date, time: input.time, timezone: input.timezone })
  const hourUnknown = pillars.hourUnknown || input.time === null
  const names = collectTenGods(pillars)
  const { traits, dominant } = traitsFromTenGods(names)
  const elements = normalizeElements(fiveElementBalance(pillars))

  const sewoon = asOfYearPillar(input.asOfDate, input.timezone, pillars.day.stem)
  const daewoon = currentDaewoonGods(input, pillars.day.stem)
  const phaseGods = [...daewoon.gods, ...sewoon]
  const phase = phaseFromGods(phaseGods)
  const phaseDegraded = hourUnknown || daewoon.gods.length === 0

  const unreadable: AxisVote['unreadable'] = []
  if (!elements) unreadable.push({ space: 'elements', code: 'saju.no_element_reading' })
  if (!phase) unreadable.push({ space: 'phase', code: 'saju.no_phase_reading' })

  const reasons: AxisVote['reasons'] = {
    traits: [TEN_GOD_GROUP_REASON[dominant]],
    elements: hourUnknown ? ['saju.elements.three_pillars'] : ['saju.elements.four_pillars'],
    phase: ['saju.phase.daewoon_sewoon'],
  }
  if (hourUnknown) {
    reasons.traits = [...(reasons.traits ?? []), 'saju.hour_unknown']
    reasons.elements = [...(reasons.elements ?? []), 'saju.hour_unknown']
    reasons.phase = [...(reasons.phase ?? []), 'saju.hour_unknown']
  }
  if (daewoon.reason && daewoon.reason !== 'saju.hour_unknown') {
    reasons.phase = [...(reasons.phase ?? []), daewoon.reason]
  }

  return {
    system: 'saju',
    traits,
    elements,
    phase,
    confidence: {
      traits: conf(hourUnknown),
      elements: elements ? conf(hourUnknown) : null,
      phase: phase ? conf(phaseDegraded) : null,
    },
    unreadable,
    reasons,
    engineVersion: CALENDAR_ENGINE_VERSION,
  }
}
