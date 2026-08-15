import type { SeasonElement, WeekdayIndex } from '../calendar'
import type { DomainStar } from './conventions'
import type {
  ColorVector,
  CoreVector,
  CycleId,
  DomainName,
  DomainScores,
  ElementRelation,
  MbtiType,
  PrismColor,
  StackAxis,
} from './tables'

export type MicroCheck = readonly [number, number, number, number]

export type PrismColors = {
  impulse: PrismColor
  need: PrismColor
  identity: PrismColor
}

export type PrismInput = {
  birthDate: string
  mbti: MbtiType | string
  colors: PrismColors
  microCheck?: MicroCheck
  atDate: string
}

export type { ColorVector, CoreVector, DomainScores }

export type MindBody = {
  activation: number | null
  tension: number | null
  recoveryNeed: number | null
  mentalLoad: number | null
}

export type CycleSnapshot = {
  id: CycleId
  name: string
  luckyAction: string
  tabooAction: string
}

export type BirthAnchor = {
  cycle: CycleSnapshot
  seasonElement: SeasonElement
  weekday: WeekdayIndex
}

export type StackHit = {
  axis: StackAxis
  signals: string[]
  count: number
}

export type PrismFlags = {
  identicalTriad: boolean
  extremeFatigue: boolean
  noMicroCheck: boolean
}

export type PrismLimitation = 'no_micro_check'

export type DomainStarInfo = {
  star: DomainStar
  peak: boolean
}

export type PrismResult = {
  coreMatrix: CoreVector
  identityProjected: CoreVector
  currentConflict: number
  concordance: number
  shadowPressure: number
  mindBody: MindBody
  birthAnchor: BirthAnchor
  annualCycle: CycleSnapshot
  monthlyCycle: CycleSnapshot
  elementRelation: ElementRelation
  domainScores: DomainScores
  /** Per-domain star rating, replacing the v1.0.0 averaged overall star. */
  domainStars: Record<DomainName, DomainStarInfo>
  /** Highest domain score — maps to OPPORTUNITY. */
  opportunityDomain: DomainName
  /** Lowest domain score — maps to WARNING. */
  warningDomain: DomainName
  /** @deprecated Use `opportunityDomain`. Alias kept for backward compatibility. */
  headlineDomain: DomainName
  stacks: StackHit[]
  flags: PrismFlags
  limitations: PrismLimitation[]
}
