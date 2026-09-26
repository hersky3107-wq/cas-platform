/**
 * Throwaway 부적 preview — hard-coded sample charts only.
 * Delete or rewire with this route; do not import from engines.
 */

export const ELEMENT_KEYS = ['wood', 'fire', 'earth', 'metal', 'water'] as const
export type ElementKey = (typeof ELEMENT_KEYS)[number]

export type TalismanMode = 'fill' | 'drain' | 'follow'

export type SajuChar = {
  hanja: string
  isDayMaster: boolean
}

export type PlanetMark = {
  id: string
  longitude: number
}

/** 主星 묘왕리함 collapsed for fill opacity. */
export type PalaceBrightness = 'solid' | 'mid' | 'faint'

export type PalaceMark = {
  name: string
  empty: boolean
  sealed: boolean
  /** 살성 count. 0 = hairline, 1 = light hatch, 2+ = heavier. Not a lock. */
  maleficCount: number
  brightness: PalaceBrightness
  /** 化忌 in this palace, and the palace is not already locked. */
  huaJi: boolean
  /** Current 大限 sits here. Drawn even on a 空宮. */
  daXian: boolean
}

export type NameSeal = 'ok' | 'hyung' | 'empty'

export type PurposeFilter = {
  purpose: 'wealth' | 'love' | 'promotion' | 'health' | 'exorcism'
  ziwei: string | null
  saju: boolean
  prism: boolean
  iching: boolean
  ninestar: boolean
  name: boolean
}

export type TalismanSpec = {
  id: string
  title: string
  note: string
  /** Null when consensus deficiency has no leader. The SVG draws a balanced core. */
  element: ElementKey | null
  mode: TalismanMode
  intensity?: 'full' | 'soft'
  purposeWealth: boolean
  numerology: readonly number[]
  /** Missing birth-date digits 1–9. Empty polygons in the numerology band. */
  numerologyMissing?: readonly number[]
  /** Natal 오행 with count 0, excluding the centre. Null when none. */
  secondaryElement?: ElementKey | null
  /** Full natal absence list (木火土金水). */
  absentElements?: readonly ElementKey[]
  /** Null when the session has no PRISM coreMatrix. Do not invent a dent. */
  prismDentAxis: 0 | 1 | 2 | 3 | 4 | 5 | null
  /**
   * session_inputs.prism colour ids. Identity wash / need stroke / impulse dent.
   * Missing → dashed blank seat. Never forwarded to a model payload.
   */
  prismColors?: { impulse: string; need: string; identity: string } | null
  luoshuSealed: readonly number[]
  ichingLines: readonly boolean[]
  bokjangEmpty: readonly number[]
  sajuChars: readonly SajuChar[]
  sajuHap: readonly [number, number][]
  sajuChung: readonly [number, number][]
  nameSeals: readonly NameSeal[]
  planets: readonly PlanetMark[]
  /** Tropical longitude of the ascendant. Null = birth time unknown. */
  ascendant: number | null
  palaces: readonly PalaceMark[] | null
  sukuyouIndex: number
  tzolkinTone: number
  tzolkinNawal: number
  bindrune: boolean
  /** Stored Elder Futhark draw. Null/omitted → bare stave, no invented runes. */
  bindruneRunes?: readonly { name: string; reversed: boolean }[] | null
  /** 符膽 on the spine. Kept readable next to the bindrune. */
  fudanGlyph?: string | null
  /** Active purpose table applied as brightness / stroke only. Null = deficiency. */
  purposeFilter?: PurposeFilter | null
  /** Suits still present in the spread; omitted = draw all four. */
  tarotSuits?: readonly ('wands' | 'cups' | 'swords' | 'pentacles')[]
  /** Suits whose drawn card landed reversed — rotate the glyph, do not lock. */
  tarotReversedSuits?: readonly ('wands' | 'cups' | 'swords' | 'pentacles')[]
  /** When true, the house band is cut even if palaces exist. */
  housesMissing?: boolean
  spreadLocks?: readonly number[]
  dateLabel: string
  sessionId: string
  /** Non-reversible image serial. Rendered as "No. xxxxxx". */
  serial?: string
  /**
   * Explanation-screen caption. Preview page only — never drawn inside the SVG.
   */
  physicsCaption?: string
}

export const PHYSICS_CAPTION =
  '오행-물리 대응: 수 G 중력 · 목 ds² 시공간 · 토 W Z 약한 핵력 · 금 SU(3) 강한 핵력 · 화 γ 전자기력 — 동양 오행 해석 계열의 상징적 대응이며 물리학적 주장이 아닙니다.'

export const ELEMENT_META: Record<
  ElementKey,
  { hanja: string; guardian: string; numbers: string; accent: string }
> = {
  wood: { hanja: '木', guardian: '靑龍', numbers: '3 · 8', accent: '#7dba6a' },
  fire: { hanja: '火', guardian: '朱雀', numbers: '2 · 7', accent: '#8f4e24' },
  earth: { hanja: '土', guardian: '黃龍', numbers: '5 · 10', accent: '#c4a35a' },
  metal: { hanja: '金', guardian: '白虎', numbers: '4 · 9', accent: '#d4c7a1' },
  water: { hanja: '水', guardian: '玄武', numbers: '1 · 6', accent: '#6a9bb8' },
}

const SAJU_WEB: readonly SajuChar[] = [
  { hanja: '甲', isDayMaster: false },
  { hanja: '子', isDayMaster: false },
  { hanja: '己', isDayMaster: false },
  { hanja: '卯', isDayMaster: false },
  { hanja: '壬', isDayMaster: true },
  { hanja: '午', isDayMaster: false },
  { hanja: '丁', isDayMaster: false },
  { hanja: '酉', isDayMaster: false },
]

const PLANETS: readonly PlanetMark[] = [
  { id: 'sun', longitude: 132.4 },
  { id: 'moon', longitude: 32.1 },
  { id: 'mercury', longitude: 158.8 },
  { id: 'venus', longitude: 112.0 },
  { id: 'mars', longitude: 10.6 },
  { id: 'jupiter', longitude: 64.2 },
  { id: 'saturn', longitude: 348.7 },
]

const PALACE_NAMES = ['命', '兄', '夫', '子', '財', '疾', '遷', '友', '官', '田', '福', '父'] as const

function palaces(emptyIdx: readonly number[], sealedIdx: readonly number[]): PalaceMark[] {
  return PALACE_NAMES.map((name, index) => ({
    name,
    empty: emptyIdx.includes(index),
    sealed: sealedIdx.includes(index),
    maleficCount: 0,
    brightness: 'mid',
    huaJi: false,
    daXian: false,
  }))
}

const BASE: Pick<
  TalismanSpec,
  | 'numerology'
  | 'prismDentAxis'
  | 'prismColors'
  | 'ichingLines'
  | 'bokjangEmpty'
  | 'sajuChars'
  | 'sajuHap'
  | 'sajuChung'
  | 'planets'
  | 'sukuyouIndex'
  | 'tzolkinTone'
  | 'tzolkinNawal'
  | 'dateLabel'
  | 'sessionId'
  | 'serial'
> = {
  numerology: [3, 4, 7, 11],
  prismDentAxis: 4,
  prismColors: { impulse: 'crimson', need: 'gold', identity: 'indigo' },
  ichingLines: [true, false, true, true, false, true],
  bokjangEmpty: [2],
  sajuChars: SAJU_WEB,
  sajuHap: [[0, 2]],
  sajuChung: [
    [1, 5],
    [3, 7],
  ],
  planets: PLANETS,
  sukuyouIndex: 8,
  tzolkinTone: 9,
  tzolkinNawal: 7,
  dateLabel: '2026.09.26',
  sessionId: 'ORC-7F2A-19C4',
  serial: '7f2a19',
}

export const TALISMAN_VARIANTS: readonly TalismanSpec[] = [
  {
    ...BASE,
    id: 'fire-few',
    title: '1 · 화 결핍, 봉인 적음',
    note: '채우는 중심. 흉방 하나, 살성 하나.',
    element: 'fire',
    mode: 'fill',
    purposeWealth: false,
    luoshuSealed: [5],
    nameSeals: ['ok', 'ok', 'ok', 'empty', 'ok'],
    ascendant: 228.4,
    palaces: palaces([], [5]),
    bindrune: true,
  },
  {
    ...BASE,
    id: 'water-seals',
    title: '2 · 수 결핍, 흉방 4 · 대흉 3',
    note: '봉인이 중심 밀도를 이긴다.',
    element: 'water',
    mode: 'fill',
    purposeWealth: false,
    luoshuSealed: [2, 5, 6, 8],
    nameSeals: ['hyung', 'ok', 'hyung', 'hyung', 'ok'],
    bokjangEmpty: [1, 3],
    ascendant: 228.4,
    palaces: palaces([7], [2, 5, 8]),
    bindrune: true,
  },
  {
    ...BASE,
    id: 'metal-drain',
    title: '3 · 금 과다 (신강 · 설기)',
    note: '중심이 비어 바깥으로 빠진다. 채움과 다른 핵.',
    element: 'metal',
    mode: 'drain',
    purposeWealth: false,
    luoshuSealed: [5],
    nameSeals: ['ok', 'ok', 'ok', 'ok', 'ok'],
    numerology: [8, 8, 4, 2],
    prismDentAxis: 1,
    ascendant: 174.0,
    palaces: palaces([], [11]),
    bindrune: true,
  },
  {
    ...BASE,
    id: 'ziwei-empty',
    title: '4 · 자미 공궁 절반',
    note: '12궁 중 6이 빈 칸. 살성 봉인은 남은 궁에만.',
    element: 'wood',
    mode: 'fill',
    purposeWealth: false,
    luoshuSealed: [2, 5],
    nameSeals: ['ok', 'empty', 'ok', 'ok', 'empty'],
    ascendant: 96.2,
    palaces: palaces([1, 3, 6, 7, 9, 11], [5]),
    bindrune: true,
  },
  {
    ...BASE,
    id: 'untimed',
    title: '5 · 출생 시각 없음',
    note: '하우스 밴드·ASC·자미 궁이 빠진다. 자리만 남긴다.',
    element: 'earth',
    mode: 'fill',
    purposeWealth: false,
    luoshuSealed: [5, 6],
    nameSeals: ['ok', 'ok', 'empty', 'ok', 'ok'],
    ascendant: null,
    palaces: null,
    bindrune: true,
  },
  {
    ...BASE,
    id: 'wealth',
    title: '6 · 재물 부담 (財)',
    note: '세로축에 財. 변두리는 비우고 재백궁만 강조.',
    element: 'water',
    mode: 'fill',
    purposeWealth: true,
    luoshuSealed: [2, 8],
    nameSeals: ['ok', 'ok', 'ok', 'ok', 'ok'],
    bokjangEmpty: [],
    ascendant: 228.4,
    palaces: palaces([1, 3, 6, 9], [5]),
    bindrune: false,
  },
]

export type FrameId = 'phone' | 'wallet' | 'square' | 'desktop'

export type FrameLayout = 'tall' | 'circle'

export type FrameSpec = {
  id: FrameId
  label: string
  sub: string
  viewBox: readonly [number, number, number, number]
  /** CSS width/height. */
  aspect: number
  layout: FrameLayout
}

/** Tall master. Phone and wallet crop this whole sheet. */
export const MASTER_W = 1000
export const MASTER_H = 2166
export const CIRCLE_CX = 500
export const CIRCLE_CY = 1100
export const CIRCLE_D = 900
export const CIRCLE_R = CIRCLE_D / 2
/** Local 1000×1000 drawing (core at 500,500) scaled into the 900 circle. */
export const CIRCLE_SCALE = CIRCLE_D / 1000

/**
 * Phone 9:19.5 — the 1000×2166 master, circle unclipped.
 * Wallet — same vertical sheet, meet-fit so top/bottom stay filled.
 * Square / 16:9 — the circle only, plus a corner seal.
 */
export const TALISMAN_FRAMES: readonly FrameSpec[] = [
  {
    id: 'phone',
    label: '9 : 19.5',
    sub: 'phone wallpaper',
    viewBox: [0, 0, MASTER_W, MASTER_H],
    aspect: 9 / 19.5,
    layout: 'tall',
  },
  {
    id: 'wallet',
    label: '54 × 85.6 mm',
    sub: 'wallet card · fully contained',
    viewBox: [0, 0, MASTER_W, MASTER_H],
    aspect: 54 / 85.6,
    layout: 'tall',
  },
  {
    id: 'square',
    label: '1 : 1',
    sub: 'avatar crop',
    viewBox: [CIRCLE_CX - CIRCLE_R, CIRCLE_CY - CIRCLE_R, CIRCLE_D, CIRCLE_D],
    aspect: 1,
    layout: 'circle',
  },
  {
    id: 'desktop',
    label: '16 : 9',
    sub: 'desktop',
    viewBox: [CIRCLE_CX - (CIRCLE_D * 16) / 18, CIRCLE_CY - CIRCLE_R, (CIRCLE_D * 16) / 9, CIRCLE_D],
    aspect: 16 / 9,
    layout: 'circle',
  },
]
