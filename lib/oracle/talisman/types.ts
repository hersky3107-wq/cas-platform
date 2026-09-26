/**
 * 부적 calculation contract. SVG consumes this shape; this module does not
 * draw. Native findings are each system's own language — never a second vote
 * on the centre 오행.
 *
 * 촐킨 / 숙요 / 룬 have no native finding (feasibility: not S). They
 * contribute FORM ONLY. 룬 reversed positions are still seal targets.
 * 수비 now has a native judgement: missing / repeated birth-date digits.
 */

import type { SystemId } from '../axes/types'
import { SYSTEM_IDS } from '../axes/types'
import type {
  CompassDirection,
  EokbuResult,
  FiveElement,
  FourPillars,
  NineStarResult,
  SukuyouResult,
  TenGodsResult,
  TzolkinResult,
} from '../engines/calendar'
import type { NatalChart } from '../engines/astro/types'
import type { IchingDrawResult, RuneDrawResult, TarotDrawResult } from '../engines/draw/types'
import type { SixRelative, TarotSuit } from '../engines/draw/tables'
import type { NameResult, SuriLabel } from '../engines/name/types'
import type { NumerologyResult } from '../engines/numerology/types'
import type { PrismResult } from '../engines/prism/types'
import type { DomainName } from '../engines/prism/tables'
import type { PalaceName as ZiweiPalaceName, ZiweiChart } from '../engines/ziwei/types'
import type { Element as ClassicalElement } from '../engines/astro/tables'

export const TALISMAN_CALC_VERSION = '1.0.0'

export type { FiveElement, CompassDirection, SystemId, ClassicalElement, ZiweiPalaceName, DomainName, SixRelative }

export const TALISMAN_LAYER_KIND: Record<SystemId, 'native' | 'form-only'> = {
  saju: 'native',
  astro: 'native',
  prism: 'native',
  ziwei: 'native',
  numerology: 'native',
  name: 'native',
  iching: 'native',
  tarot: 'native',
  runes: 'form-only',
  ninestar: 'native',
  sukuyou: 'form-only',
  tzolkin: 'form-only',
}

export type IndependenceCensus = {
  native: number
  formOnly: number
  nativeIds: SystemId[]
  formOnlyIds: SystemId[]
}

export function independenceCensus(): IndependenceCensus {
  const nativeIds = SYSTEM_IDS.filter((id) => TALISMAN_LAYER_KIND[id] === 'native')
  const formOnlyIds = SYSTEM_IDS.filter((id) => TALISMAN_LAYER_KIND[id] === 'form-only')
  return { native: nativeIds.length, formOnly: formOnlyIds.length, nativeIds, formOnlyIds }
}

export type CentreMode = 'fill' | 'drain' | 'follow'
export type CentreSource = 'eokbu' | 'eokbu-lean' | 'jonggyeok' | 'consensus'
export type CentreIntensity = 'full' | 'soft'

/**
 * One native judgement for the core. `source` is internal — never present
 * consensus as twelve systems agreeing. `drain` means the SVG draws a hollow
 * core (신강 식상); `fill` is a solid 인성 core (신약) or the fallback 결핍.
 * `follow` is 종격: fill the dominant element with a spiral marker.
 */
export type TalismanCentre =
  | {
      source: 'eokbu'
      mode: 'fill' | 'drain'
      element: FiveElement
      strength: 'weak' | 'strong'
      intensity: 'full'
    }
  | {
      source: 'eokbu-lean'
      mode: 'fill' | 'drain'
      element: FiveElement
      strength: 'balanced'
      intensity: 'soft'
    }
  | {
      source: 'jonggyeok'
      mode: 'follow'
      element: FiveElement
      intensity: 'full'
    }
  | {
      source: 'consensus'
      mode: 'fill'
      element: FiveElement | null
      intensity: 'full'
    }

export type TenGodGroupName = '비겁' | '식상' | '재성' | '관성' | '인성'

export type SajuNative = {
  zeroGroups: TenGodGroupName[]
  groupCounts: Record<TenGodGroupName, number>
  gisin: FiveElement | null
}

export type AstroNative = {
  emptyElements: ClassicalElement[]
  housesMissing: boolean
}

export type PrismNative = {
  warningDomain: DomainName
}

export type ZiweiPalaceHit = {
  name: ZiweiPalaceName
  index: number
  branchIndex: number
}

export type ZiweiNative = {
  palacesUnavailable: boolean
  palaces: ZiweiPalaceHit[]
  emptyPalaces: ZiweiPalaceHit[]
  maleficPalaces: Array<ZiweiPalaceHit & { stars: string[] }>
  huaJiPalace: (ZiweiPalaceHit & { star: string }) | null
}

export type IchingNative = {
  hiddenRelatives: SixRelative[]
}

export type TarotNative = {
  missingSuits: Array<Exclude<TarotSuit, null>>
  reversed: Array<{ index: number; name: string; positionLabel: string }>
}

export type GyeokSeat = 'cheon' | 'in' | 'ji' | 'oe' | 'chong'

export type NameGyeokHit = {
  seat: GyeokSeat
  number: number
  label: SuriLabel
  keyword: string
}

export type NameNative = {
  supported: boolean
  hyung: NameGyeokHit[]
  daehyung: NameGyeokHit[]
}

export type KillingName = '오황살' | '암검살' | '본명살' | '본명적살' | '세파' | '월파'

export type NinestarNative = {
  killings: Array<{ name: KillingName; direction: CompassDirection }>
  gilbang: CompassDirection[]
  gilbangYear: CompassDirection[]
  gilbangMonth: CompassDirection[]
}

/** Explicit: this system has no native finding. SVG may still use it as form. */
export type FormOnlyLayer = {
  kind: 'form-only'
  system: 'sukuyou' | 'tzolkin' | 'runes'
  reason: string
}

export const FORM_ONLY_LAYERS: Record<FormOnlyLayer['system'], FormOnlyLayer> = {
  sukuyou: {
    kind: 'form-only',
    system: 'sukuyou',
    reason: '숙요는 부적 네이티브 소견이 없다. 형태만 기여한다.',
  },
  tzolkin: {
    kind: 'form-only',
    system: 'tzolkin',
    reason: '촐킨은 부적 네이티브 소견이 없다. 형태만 기여한다.',
  },
  runes: {
    kind: 'form-only',
    system: 'runes',
    reason: '룬은 부적 네이티브 소견이 없다. 형태만 기여한다. 역배는 제자리 회전이지 봉인이 아니다.',
  },
}

export type NumerologyNative = {
  missing: readonly number[]
  repeated: readonly number[]
}

export type NativeFindings = {
  saju: SajuNative | null
  astro: AstroNative | null
  prism: PrismNative | null
  ziwei: ZiweiNative | null
  iching: IchingNative | null
  tarot: TarotNative | null
  name: NameNative | null
  ninestar: NinestarNative | null
  numerology: NumerologyNative | null
  sukuyou: FormOnlyLayer
  tzolkin: FormOnlyLayer
  runes: FormOnlyLayer
}

export type TalismanCharts = {
  saju: { eokbu: EokbuResult; tenGods: TenGodsResult; pillars: FourPillars | null } | null
  ziwei: ZiweiChart | null
  astro: NatalChart | null
  iching: IchingDrawResult | null
  tarot: TarotDrawResult | null
  prism: PrismResult | null
  name: NameResult | null
  ninestar: NineStarResult | null
  runes: RuneDrawResult | null
  /** Native: missing / repeated birth-date digits. Not 오행. */
  numerology: NumerologyResult | null
  sukuyou: SukuyouResult | null
  tzolkin: TzolkinResult | null
}

export type TalismanSector =
  | { frame: 'luoshu'; direction: CompassDirection }
  | { frame: 'ziwei'; palace: ZiweiPalaceName; branchIndex: number }
  | { frame: 'gyeok'; seat: GyeokSeat }
  | { frame: 'spread'; system: 'tarot' | 'runes'; index: number; label: string }

export type SealKind = 'ninestar-killing' | 'ziwei-malefic' | 'ziwei-huaji' | 'name-daehyung'

export type SealTarget = {
  id: string
  kind: SealKind
  rule: string
  sector: TalismanSector
}

export type TalismanPurpose = 'wealth' | 'love' | 'promotion' | 'health' | 'exorcism'

export const FUDAN_GLYPH: Record<TalismanPurpose, string> = {
  wealth: '財',
  love: '和合',
  promotion: '登科',
  health: '康寧',
  exorcism: '鎭',
}

export type FudanSpec =
  | { kind: 'hanja'; purpose: TalismanPurpose; glyph: string }
  | { kind: 'bindrune'; purpose: null; glyph: 'BINDRUNE' }

/** System has no basis for this purpose — do not invent one. */
export type PurposeCell<T> = { status: 'hit'; value: T } | { status: 'none' }

export type PurposeTable = {
  purpose: TalismanPurpose
  fudan: FudanSpec
  ziwei: PurposeCell<ZiweiPalaceHit & { malefics: string[]; empty: boolean; huaJi: boolean }>
  saju: PurposeCell<{ group: TenGodGroupName; count: number }>
  prism: PurposeCell<{ domain: DomainName; isWarning: boolean; score: number }>
  iching: PurposeCell<Array<{ relative: SixRelative; state: 'present' | 'bokjang' }>>
  ninestar: PurposeCell<NinestarNative['killings']>
  name: PurposeCell<NameGyeokHit[]>
}

export type PurposeBundle = {
  active: TalismanPurpose | null
  tables: Record<TalismanPurpose, PurposeTable>
}

export type TalismanPrismColors = {
  impulse: string
  need: string
  identity: string
}

export type TalismanAccessInput = {
  status: string
  promptVersion: string | null
  hasConsensus: boolean
}

/**
 * Shape the SVG consumes. Preview variants remain hard-coded; session mode
 * fills this from computeTalisman.
 */
export type TalismanComputation = {
  centre: TalismanCentre
  /** Layers after sealed sectors are stripped (draw, do not lock). */
  layers: NativeFindings
  /** Covered rather than drawn. SVG places a lock at each sector. */
  seals: SealTarget[]
  purpose: PurposeBundle
  fudan: FudanSpec
  independence: IndependenceCensus
  /** session_inputs.prism colour ids. Not drawn. Not sent to a model. */
  prismColors: TalismanPrismColors | null
  /**
   * Natal pillar character with count 0, excluding the centre 오행.
   * Null when every counted element is present, or there are no pillars.
   */
  secondary: { element: FiveElement; source: 'saju-absent' } | null
  /** Every natal element with count 0 (木火土金水). Empty when none. */
  absentElements: readonly FiveElement[]
}
