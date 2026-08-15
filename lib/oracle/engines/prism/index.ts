/**
 * Pure PRISM-5 engine. No DB, network, LLM, or implicit clock.
 * Season element and weekday come from the calendar engine.
 */
import { seasonElement, weekday } from '../calendar'
import type { SeasonElement } from '../calendar'
import type { WeekdayIndex } from '../calendar'
import {
  COLOR_STATE_CLAMP,
  CORE_WEIGHTS,
  DOMAIN_SCORE_MAX,
  DOMAIN_SCORE_MIN,
  PRISM_ENGINE_VERSION,
  PRISM_TIMEZONE,
  SHADOW_WEIGHTS,
  STACK_COLOR_HIGH,
  STACK_CONFLICT_HIGH,
  STACK_CORE_HIGH,
  STACK_RHYTHM_HIGH,
  STACK_SIGNAL_MIN,
  domainStarRating,
  isPeak,
} from './conventions'
import { PrismInputError } from './errors'
import {
  COLOR_AXES,
  COLOR_AXIS_STATS,
  COLOR_CONFLICT_BOUNDS,
  COLOR_PROFILES,
  COLOR_STATE_WEIGHTS,
  CORE_AXES,
  CYCLE_BY_ID,
  DOMAIN_NAMES,
  ELEMENT_OVERCOMES,
  ELEMENT_PRODUCES,
  ELEMENT_RELATION_MODIFIERS,
  MBTI_AXIS_STATS,
  MBTI_CYCLE_AFFINITY,
  MBTI_RAW,
  RHYTHM_SYNC_MODIFIERS,
  SEASON_VECTORS,
  WEEKDAY_VECTORS,
  isMbtiType,
  isPrismColor,
  normalizeCore,
  projectColorToCore,
  type ColorVector,
  type CoreVector,
  type CycleDef,
  type CycleId,
  type DomainName,
  type DomainScores,
  type ElementRelation,
  type MbtiType,
  type PrismColor,
  type StackAxis,
} from './tables'
import type {
  BirthAnchor,
  CycleSnapshot,
  DomainStarInfo,
  MicroCheck,
  MindBody,
  PrismInput,
  PrismLimitation,
  PrismResult,
  StackHit,
} from './types'

export { PRISM_ENGINE_VERSION }
export { PrismInputError } from './errors'
export { PRISM_TIMEZONE, domainStarRating, isPeak } from './conventions'
export {
  COLOR_CONFLICT_BOUNDS,
  COLOR_PROFILES,
  CYCLES,
  MBTI_CYCLE_AFFINITY,
  MBTI_RAW,
  MBTI_TYPES,
  PRISM_COLORS,
} from './tables'
export type { PrismInput, PrismResult, CoreVector, DomainScores } from './types'
export type { MbtiType, PrismColor, ElementRelation } from './tables'
export type { DomainStar } from './conventions'

function parseYmd(value: string, label: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new PrismInputError('invalid_date', `${label} must be YYYY-MM-DD`)
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (m < 1 || m > 12 || d < 1 || d > 31) {
    throw new PrismInputError('invalid_date', `invalid ${label}`)
  }
  return { y, m, d }
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function clampDay(year: number, month: number, day: number): number {
  return Math.min(day, daysInMonth(year, month))
}

function emptyCore(fill: number): CoreVector {
  return { drive: fill, stability: fill, relation: fill, control: fill, exploration: fill, reflection: fill }
}

function clamp100(n: number): number {
  return Math.min(100, Math.max(0, n))
}

function mixCore(
  a: CoreVector,
  wa: number,
  b: CoreVector,
  wb: number,
  c: CoreVector,
  wc: number,
  d: CoreVector,
  wd: number,
): CoreVector {
  const out = emptyCore(0)
  for (const axis of CORE_AXES) {
    out[axis] = clamp100(a[axis] * wa + b[axis] * wb + c[axis] * wc + d[axis] * wd)
  }
  return out
}

export function mbtiVector(mbti: MbtiType): CoreVector {
  return normalizeCore(MBTI_RAW[mbti], MBTI_AXIS_STATS)
}

export function identityColorProjection(color: PrismColor): CoreVector {
  return normalizeCore(projectColorToCore(COLOR_PROFILES[color]), COLOR_AXIS_STATS)
}

/** RMS over six axes, already in 0–100 when inputs are 0–100. */
export function colorDistance(a: ColorVector | CoreVector, b: ColorVector | CoreVector): number {
  const keys = Object.keys(a) as (keyof typeof a)[]
  const meanSq = keys.reduce((sum, key) => {
    const delta = (a[key] as number) - (b[key] as number)
    return sum + delta * delta
  }, 0) / keys.length
  return Math.sqrt(meanSq)
}

/** Min-max rescale into 0–100. Returns 50 (neutral) if the range is degenerate. */
export function rescale(value: number, min: number, max: number): number {
  if (max <= min) return 50
  return clamp100(((value - min) / (max - min)) * 100)
}

/**
 * Pearson correlation over the 6 paired core axis values. Invariant to
 * adding a constant to every axis of either vector (and to scaling by a
 * positive constant) — that is the point: it measures shape, not level.
 */
export function pearsonCorrelation(a: CoreVector, b: CoreVector): number {
  const xs = CORE_AXES.map((axis) => a[axis])
  const ys = CORE_AXES.map((axis) => b[axis])
  const n = xs.length
  const meanX = xs.reduce((sum, v) => sum + v, 0) / n
  const meanY = ys.reduce((sum, v) => sum + v, 0) / n
  let numerator = 0
  let denomX = 0
  let denomY = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX
    const dy = ys[i]! - meanY
    numerator += dx * dy
    denomX += dx * dx
    denomY += dy * dy
  }
  if (denomX === 0 || denomY === 0) return 0
  return numerator / Math.sqrt(denomX * denomY)
}

/** Shape-similarity concordance: Pearson correlation mapped from [-1,1] to [0,100]. */
export function concordance(identity: CoreVector, core: CoreVector): number {
  return clamp100((pearsonCorrelation(identity, core) + 1) * 50)
}

export function elementRelation(birthElement: SeasonElement, currentSeasonElement: SeasonElement): ElementRelation {
  if (birthElement === currentSeasonElement) return 'RESONANCE'
  if (ELEMENT_PRODUCES[currentSeasonElement] === birthElement) return 'SUPPORT'
  if (ELEMENT_PRODUCES[birthElement] === currentSeasonElement) return 'OUTPUT'
  if (ELEMENT_OVERCOMES[birthElement] === currentSeasonElement) return 'CHALLENGE'
  if (ELEMENT_OVERCOMES[currentSeasonElement] === birthElement) return 'PRESSURE'
  return 'RESONANCE'
}

function calendarNoon(date: string) {
  return { date, time: '12:00', timezone: PRISM_TIMEZONE }
}

function cycleSnapshot(id: CycleId): CycleSnapshot {
  const def = CYCLE_BY_ID[id]
  return { id: def.id, name: def.name, luckyAction: def.luckyAction, tabooAction: def.tabooAction }
}

function mod12(n: number): CycleId {
  return (((n % 12) + 12) % 12) as CycleId
}

export function ageYearsOn(birth: { y: number; m: number; d: number }, at: { y: number; m: number; d: number }): number {
  const anniversary = clampDay(at.y, birth.m, birth.d)
  let age = at.y - birth.y
  if (at.m < birth.m || (at.m === birth.m && at.d < anniversary)) age -= 1
  return age
}

export function ageMonthsOn(birth: { y: number; m: number; d: number }, at: { y: number; m: number; d: number }): number {
  let months = (at.y - birth.y) * 12 + (at.m - birth.m)
  const anniversary = clampDay(at.y, at.m, birth.d)
  if (at.d < anniversary) months -= 1
  return months
}

function birthAnchor(birthDate: string, birth: { y: number; m: number; d: number }): BirthAnchor {
  return {
    cycle: cycleSnapshot(mod12(birth.m - 1)),
    seasonElement: seasonElement(calendarNoon(birthDate)),
    weekday: weekday(calendarNoon(birthDate)),
  }
}

function annualCycle(birth: { y: number; m: number; d: number }, at: { y: number; m: number; d: number }): CycleSnapshot {
  return cycleSnapshot(mod12(ageYearsOn(birth, at)))
}

function monthlyCycle(birth: { y: number; m: number; d: number }, at: { y: number; m: number; d: number }): CycleSnapshot {
  return cycleSnapshot(mod12(ageMonthsOn(birth, at)))
}

function parseMicroCheck(raw: MicroCheck | undefined): { values: MicroCheck | null; limitations: PrismLimitation[] } {
  if (raw === undefined) return { values: null, limitations: ['no_micro_check'] }
  if (raw.length !== 4) {
    throw new PrismInputError('invalid_micro_check', 'microCheck must be four integers 1–5')
  }
  for (const q of raw) {
    if (!Number.isInteger(q) || q < 1 || q > 5) {
      throw new PrismInputError('invalid_micro_check', `microCheck values must be integers 1–5, got ${q}`)
    }
  }
  return { values: raw, limitations: [] }
}

function mindBody(micro: MicroCheck | null, colors: { impulse: ColorVector; need: ColorVector; identity: ColorVector }, conflict: number): MindBody {
  if (micro === null) {
    return { activation: null, tension: null, recoveryNeed: null, mentalLoad: null }
  }
  const q1 = micro[0]
  const q2 = micro[1]
  const q3 = micro[2]
  const q4 = micro[3]
  return {
    activation: clamp100(q1 * 12 + colors.impulse.activation * 0.4),
    tension: clamp100(q2 * 12 + conflict * 0.4),
    recoveryNeed: clamp100((6 - q3) * 12 + colors.need.recovery * 0.4),
    mentalLoad: clamp100(q4 * 12 + colors.identity.sensitivity * 0.4),
  }
}

function colorStateDelta(domain: DomainName, impulse: ColorVector, need: ColorVector, conflict: number): number {
  const spec = COLOR_STATE_WEIGHTS[domain]
  let raw = conflict * spec.conflict
  for (const axis of COLOR_AXES) {
    raw += ((impulse[axis] / 100) * (spec.impulse[axis] ?? 0)) + ((need[axis] / 100) * (spec.need[axis] ?? 0))
  }
  // v1.2.0 FIX 5: money color-state modifiers produce smaller raw values than
  // other domains; scale raw money by 1.4 before applying the ±13 clamp.
  if (domain === 'money') raw *= 1.4
  return Math.min(COLOR_STATE_CLAMP, Math.max(-COLOR_STATE_CLAMP, raw))
}

function rhythmSyncKey(cycle: CycleDef, weekdayIndex: WeekdayIndex): keyof typeof RHYTHM_SYNC_MODIFIERS {
  if (weekdayIndex === cycle.primaryWeekday) return 'primary'
  if (weekdayIndex === cycle.secondaryWeekday) return 'secondary'
  return 'none'
}

function mbtiCycleAffinity(mbti: MbtiType, cycleId: CycleId): number {
  return MBTI_CYCLE_AFFINITY[mbti][cycleId]!
}

function domainScores(input: {
  cycle: CycleDef
  relation: ElementRelation
  weekdayIndex: WeekdayIndex
  mbti: MbtiType
  impulse: ColorVector
  need: ColorVector
  conflict: number
}): DomainScores {
  const sync = RHYTHM_SYNC_MODIFIERS[rhythmSyncKey(input.cycle, input.weekdayIndex)]
  const element = ELEMENT_RELATION_MODIFIERS[input.relation]
  const affinity = mbtiCycleAffinity(input.mbti, input.cycle.id)
  const out = { ...input.cycle.base }
  for (const domain of DOMAIN_NAMES) {
    const color = colorStateDelta(domain, input.impulse, input.need, input.conflict)
    out[domain] = Math.min(
      DOMAIN_SCORE_MAX,
      Math.max(DOMAIN_SCORE_MIN, input.cycle.base[domain] + element[domain] + sync[domain] + color + affinity),
    )
  }
  return out
}

function detectStacks(input: {
  identity: ColorVector
  core: CoreVector
  cycle: CycleDef
  rhythm: CoreVector
  relation: ElementRelation
  conflict: number
  micro: MicroCheck | null
}): StackHit[] {
  const signals: Record<StackAxis, string[]> = {
    expansion: [],
    control: [],
    recovery: [],
    relation: [],
    competition: [],
  }

  if (input.identity.expansion >= STACK_COLOR_HIGH) signals.expansion.push('identity_color')
  if (input.core.exploration >= STACK_CORE_HIGH) signals.expansion.push('core_exploration')
  if (input.cycle.stackTags.includes('expansion')) signals.expansion.push('annual_cycle')
  if (input.rhythm.exploration >= STACK_RHYTHM_HIGH) signals.expansion.push('weekday_rhythm')
  if (input.micro && input.micro[0] >= 4) signals.expansion.push('micro_activation')

  if (input.identity.control >= STACK_COLOR_HIGH) signals.control.push('identity_color')
  if (input.core.control >= STACK_CORE_HIGH) signals.control.push('core_control')
  if (input.cycle.stackTags.includes('control')) signals.control.push('annual_cycle')
  if (input.rhythm.control >= STACK_RHYTHM_HIGH) signals.control.push('weekday_rhythm')

  if (input.identity.recovery >= STACK_COLOR_HIGH) signals.recovery.push('identity_color')
  if (input.core.stability >= STACK_CORE_HIGH) signals.recovery.push('core_stability')
  if (input.cycle.stackTags.includes('recovery')) signals.recovery.push('annual_cycle')
  if (input.rhythm.stability >= STACK_RHYTHM_HIGH) signals.recovery.push('weekday_rhythm')
  if (input.micro && input.micro[2] <= 2) signals.recovery.push('micro_recovery')

  if (input.identity.relation >= STACK_COLOR_HIGH) signals.relation.push('identity_color')
  if (input.core.relation >= STACK_CORE_HIGH) signals.relation.push('core_relation')
  if (input.cycle.stackTags.includes('relation')) signals.relation.push('annual_cycle')
  if (input.rhythm.relation >= STACK_RHYTHM_HIGH) signals.relation.push('weekday_rhythm')

  if (input.relation === 'CHALLENGE' || input.relation === 'PRESSURE') signals.competition.push('element_relation')
  if (input.core.drive >= STACK_CORE_HIGH && input.core.control >= 58) signals.competition.push('core_drive_control')
  if (input.cycle.stackTags.includes('competition')) signals.competition.push('annual_cycle')
  if (input.conflict >= STACK_CONFLICT_HIGH) signals.competition.push('impulse_need_conflict')

  const axes: StackAxis[] = ['expansion', 'control', 'recovery', 'relation', 'competition']
  return axes
    .filter((axis) => signals[axis].length >= STACK_SIGNAL_MIN)
    .map((axis) => ({ axis, signals: signals[axis], count: signals[axis].length }))
}

function computeDomainStars(scores: DomainScores): Record<DomainName, DomainStarInfo> {
  const out = {} as Record<DomainName, DomainStarInfo>
  for (const domain of DOMAIN_NAMES) {
    out[domain] = { star: domainStarRating(scores[domain]), peak: isPeak(scores[domain]) }
  }
  return out
}

function computeOpportunityDomain(scores: DomainScores): DomainName {
  let best: DomainName = DOMAIN_NAMES[0]
  let bestScore = scores[best]
  for (const domain of DOMAIN_NAMES) {
    if (scores[domain] > bestScore) {
      bestScore = scores[domain]
      best = domain
    }
  }
  return best
}

function computeWarningDomain(scores: DomainScores): DomainName {
  let worst: DomainName = DOMAIN_NAMES[0]
  let worstScore = scores[worst]
  for (const domain of DOMAIN_NAMES) {
    if (scores[domain] < worstScore) {
      worstScore = scores[domain]
      worst = domain
    }
  }
  return worst
}

function assertDistinctColors(colors: PrismInput['colors']): void {
  const { impulse, need, identity } = colors
  if (!isPrismColor(impulse) || !isPrismColor(need) || !isPrismColor(identity)) {
    throw new PrismInputError('invalid_color', 'impulse, need, and identity must be one of the 24 PRISM colors')
  }
  if (impulse === need || impulse === identity || need === identity) {
    throw new PrismInputError('duplicate_colors', 'impulse, need, and identity must be three distinct colors')
  }
}

export function prism(input: PrismInput): PrismResult {
  const birth = parseYmd(input.birthDate, 'birthDate')
  const at = parseYmd(input.atDate, 'atDate')
  if (daysInMonth(birth.y, birth.m) < birth.d) {
    throw new PrismInputError('invalid_date', `birthDate ${input.birthDate} is not a real civil day`)
  }
  if (daysInMonth(at.y, at.m) < at.d) {
    throw new PrismInputError('invalid_date', `atDate ${input.atDate} is not a real civil day`)
  }

  const mbti = input.mbti.toUpperCase()
  if (!isMbtiType(mbti)) throw new PrismInputError('invalid_mbti', `unknown MBTI type "${input.mbti}"`)
  assertDistinctColors(input.colors)

  const { values: micro, limitations } = parseMicroCheck(input.microCheck)
  const impulse = COLOR_PROFILES[input.colors.impulse]
  const need = COLOR_PROFILES[input.colors.need]
  const identity = COLOR_PROFILES[input.colors.identity]

  const mbtiNorm = mbtiVector(mbti)
  const identityProjected = identityColorProjection(input.colors.identity)
  const atWeekday = weekday(calendarNoon(input.atDate))
  const rhythmVector = WEEKDAY_VECTORS[atWeekday]!
  const atSeason = seasonElement(calendarNoon(input.atDate))
  const seasonVector = SEASON_VECTORS[atSeason]
  const coreMatrix = mixCore(
    mbtiNorm,
    CORE_WEIGHTS.mbti,
    identityProjected,
    CORE_WEIGHTS.identity,
    rhythmVector,
    CORE_WEIGHTS.rhythm,
    seasonVector,
    CORE_WEIGHTS.season,
  )

  const currentConflict = rescale(colorDistance(impulse, need), COLOR_CONFLICT_BOUNDS.min, COLOR_CONFLICT_BOUNDS.max)
  const concordanceValue = concordance(identityProjected, coreMatrix)
  const shadowPressure = clamp100(
    currentConflict * SHADOW_WEIGHTS.conflict + (100 - concordanceValue) * SHADOW_WEIGHTS.discord,
  )

  const anchor = birthAnchor(input.birthDate, birth)
  const annual = annualCycle(birth, at)
  const monthly = monthlyCycle(birth, at)
  const relation = elementRelation(anchor.seasonElement, atSeason)
  const annualDef = CYCLE_BY_ID[annual.id]
  const scores = domainScores({
    cycle: annualDef,
    relation,
    weekdayIndex: atWeekday,
    mbti,
    impulse,
    need,
    conflict: currentConflict,
  })

  const opportunityDomain = computeOpportunityDomain(scores)

  return {
    coreMatrix,
    identityProjected,
    currentConflict,
    concordance: concordanceValue,
    shadowPressure,
    mindBody: mindBody(micro, { impulse, need, identity }, currentConflict),
    birthAnchor: anchor,
    annualCycle: annual,
    monthlyCycle: monthly,
    elementRelation: relation,
    domainScores: scores,
    domainStars: computeDomainStars(scores),
    opportunityDomain,
    warningDomain: computeWarningDomain(scores),
    headlineDomain: opportunityDomain,
    stacks: detectStacks({
      identity,
      core: coreMatrix,
      cycle: annualDef,
      rhythm: rhythmVector,
      relation,
      conflict: currentConflict,
      micro,
    }),
    flags: {
      identicalTriad: false,
      extremeFatigue: micro !== null && micro[0] === 1 && micro[2] === 1 && micro[3] === 5,
      noMicroCheck: micro === null,
    },
    limitations,
  }
}
