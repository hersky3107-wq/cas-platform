import type { AspectType, HouseSystem } from './conventions'
import type { AstroBodyName, Element, Modality, SignName } from './tables'

export type AstroDateTime = {
  /** YYYY-MM-DD local calendar date. */
  date: string
  /** HH:mm local wall-clock time. Ignored when timeKnown=false. */
  time: string | null
  /** IANA timezone, e.g. America/Los_Angeles. */
  tz: string
}

export type NatalChartInput = AstroDateTime & {
  lat: number
  /** East-positive longitude; west is negative. */
  lng: number
  timeKnown: boolean
}

export type AstroBodyPosition = {
  longitude: number
  sign: SignName
  degreeInSign: number
  /** Apparent geocentric tropical longitude speed, degrees/day. */
  speed: number
  retrograde: boolean
  house: number | null
  /** Present only for the Moon when timeKnown=false. */
  uncertaintyDegrees?: number
}

export type AstroBodies = Record<AstroBodyName, AstroBodyPosition>

export type ChartAngles = {
  ascendant: number
  midheaven: number
  descendant: number
  imumCoeli: number
}

export type Aspect = {
  a: AstroBodyName
  b: AstroBodyName
  type: AspectType
  exactDegrees: number
  orb: number
  applying: boolean
}

export type CrossAspect = Aspect & {
  /** `transit`/`A` for side A, `natal`/`B` for side B. */
  aSide: 'transit' | 'A'
  bSide: 'natal' | 'B'
}

export type ElementBalance = Record<Element, number>
export type ModalityBalance = Record<Modality, number>

export type ChartShape = 'BUNDLE' | 'BOWL' | 'LOCOMOTIVE' | 'SPLAY' | 'SPLASH'

export type NatalChart = {
  /** Explicit instant used by the calculation. Unknown time uses local noon. */
  instantUtc: string
  timeKnown: boolean
  bodies: AstroBodies
  angles: ChartAngles | null
  houses: number[] | null
  houseSystemUsed: HouseSystem
  aspects: Aspect[]
  elementBalance: ElementBalance
  modalityBalance: ModalityBalance
  chartShape: ChartShape | null
  limitations: Array<'no_houses' | 'no_angles' | 'moon_approximate'>
}

export type TransitResult = {
  atUtc: string
  bodies: AstroBodies
  /** Transit-to-natal only. No transit-to-transit aspects. */
  aspects: CrossAspect[]
}

export type SynastryResult = {
  /** Chart A to chart B only. No intra-chart aspects. */
  aspects: CrossAspect[]
}
