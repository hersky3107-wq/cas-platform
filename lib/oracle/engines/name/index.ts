/**
 * 성명판단 (name divination). Pure functions only. No route wiring.
 * See conventions.ts for the full methodology write-up.
 */
import { NAME_ENGINE_VERSION } from './conventions'
import { NameInputError } from './errors'
import {
  CHOSEONG_TABLE,
  HANGUL_COMPLEX_JONGSEONG,
  HANGUL_CONSONANT_STROKES,
  HANGUL_VOWEL_STROKES,
  HANJA_STROKES,
  JONGSEONG_TABLE,
  JUNGSEONG_TABLE,
  elementForGyeok,
  elementRelation,
  suriFor,
} from './tables'
import type {
  FiveElementsResult,
  Gyeok,
  GyeokSuri,
  NameInput,
  NameReadingDetails,
  NameResult,
  StrokeConvention,
  YinYangResult,
} from './types'

export { NAME_ENGINE_VERSION }
export { NameInputError } from './errors'
export type { NameErrorCode } from './errors'
export {
  HANGUL_CONSONANT_STROKES,
  HANGUL_VOWEL_STROKES,
  HANJA_STROKES,
  RADICAL_RESTORATION,
  RADICAL_TEST_CASES,
  SURI81,
  restoreRadicalStrokes,
  modernRadicalStrokes,
  suriFor,
  elementForGyeok,
  elementRelation,
} from './tables'
export type { RadicalKey, RadicalTestCase } from './tables'
export type {
  NameInput,
  NameLocale,
  NameResult,
  NameReadingDetails,
  AlternateNameReading,
  StrokeConvention,
  Gyeok,
  GyeokSuri,
  YinYangResult,
  FiveElementsResult,
  FiveElement,
  ElementRelation,
  SuriEntry,
  SuriLabel,
} from './types'

const HANGUL_SYLLABLE_BASE = 0xac00
const HANGUL_SYLLABLE_LAST = 0xd7a3
const JUNGSEONG_COUNT = 21
const JONGSEONG_COUNT = 28

function jongseongStrokes(jong: string): number {
  if (jong === '') return 0
  const direct = HANGUL_CONSONANT_STROKES[jong]
  if (direct !== undefined) return direct
  const parts = HANGUL_COMPLEX_JONGSEONG[jong]
  if (!parts) throw new NameInputError('invalid_hangul', `unknown 종성 "${jong}"`)
  return HANGUL_CONSONANT_STROKES[parts[0]] + HANGUL_CONSONANT_STROKES[parts[1]]
}

/** 원획법 stroke count for a single Hangul syllable, via standard Unicode 초/중/종성 decomposition. */
function hangulSyllableStrokes(char: string): number {
  const code = char.codePointAt(0) ?? -1
  if (code < HANGUL_SYLLABLE_BASE || code > HANGUL_SYLLABLE_LAST) {
    throw new NameInputError('invalid_hangul', `"${char}" is not a complete Hangul syllable`)
  }
  const index = code - HANGUL_SYLLABLE_BASE
  const choIndex = Math.floor(index / (JUNGSEONG_COUNT * JONGSEONG_COUNT))
  const jungIndex = Math.floor((index % (JUNGSEONG_COUNT * JONGSEONG_COUNT)) / JONGSEONG_COUNT)
  const jongIndex = index % JONGSEONG_COUNT

  const cho = CHOSEONG_TABLE[choIndex]
  const jung = JUNGSEONG_TABLE[jungIndex]
  const jong = JONGSEONG_TABLE[jongIndex]

  return HANGUL_CONSONANT_STROKES[cho] + HANGUL_VOWEL_STROKES[jung] + jongseongStrokes(jong)
}

function hanjaCharStrokes(char: string, convention: StrokeConvention): number {
  const strokes = HANJA_STROKES[char]
  if (strokes === undefined) {
    throw new NameInputError('unknown_hanja', `"${char}" is not in the bundled hanja stroke table`)
  }
  return strokes[convention]
}

function isHangulLocale(locale: string): boolean {
  return locale === 'ko'
}

function isHanjaLocale(locale: string): boolean {
  return locale === 'ja' || locale.startsWith('zh')
}

function strokesForChar(char: string, locale: string, convention: StrokeConvention): number {
  return isHangulLocale(locale) ? hangulSyllableStrokes(char) : hanjaCharStrokes(char, convention)
}

function computeGyeok(surnameStrokes: number[], givenStrokes: number[]): Gyeok {
  const surnameSum = surnameStrokes.reduce((a, b) => a + b, 0)
  const givenSum = givenStrokes.reduce((a, b) => a + b, 0)

  // 天格: +1 (가성수) only for a single-character surname; a 2-character
  // surname (남궁, 선우, 諸葛) already sums two elements, no padding.
  const cheon = surnameStrokes.length === 1 ? surnameSum + 1 : surnameSum

  // 人格: last surname character + first given-name character, always —
  // this generalizes unchanged to 2-character surnames and 1/2/3-character
  // given names.
  const inGyeok = surnameStrokes[surnameStrokes.length - 1] + givenStrokes[0]

  // 地格: sum of every given-name character, no padding (unlike 天格,
  // per the task's literal formula — see conventions.ts).
  const ji = givenSum

  // 總格: everything, never padded.
  const chong = surnameSum + givenSum

  // 外格: 總格 − 人格, exactly as specified (no extra +1).
  const oe = chong - inGyeok

  return { cheon, in: inGyeok, ji, oe, chong }
}

function gyeokSuri(gyeok: Gyeok): GyeokSuri {
  return {
    cheon: suriFor(gyeok.cheon),
    in: suriFor(gyeok.in),
    ji: suriFor(gyeok.ji),
    oe: suriFor(gyeok.oe),
    chong: suriFor(gyeok.chong),
  }
}

function computeYinYang(strokes: number[]): YinYangResult {
  const pattern = strokes.map((n) => (n % 2 === 1 ? ('yang' as const) : ('yin' as const)))
  const allYang = pattern.every((t) => t === 'yang')
  const allYin = pattern.every((t) => t === 'yin')
  return { pattern, balanced: !allYang && !allYin }
}

function computeFiveElements(gyeok: Gyeok): FiveElementsResult {
  const cheon = elementForGyeok(gyeok.cheon)
  const inEl = elementForGyeok(gyeok.in)
  const ji = elementForGyeok(gyeok.ji)
  return {
    cheon,
    in: inEl,
    ji,
    cheonIn: elementRelation(cheon, inEl),
    inJi: elementRelation(inEl, ji),
  }
}

function splitChars(value: string): string[] {
  return Array.from(value)
}

function computeReading(
  surnameChars: string[],
  givenChars: string[],
  locale: string,
  strokeConvention: StrokeConvention,
): NameReadingDetails {
  const surnameStrokes = surnameChars.map((c) => strokesForChar(c, locale, strokeConvention))
  const givenStrokes = givenChars.map((c) => strokesForChar(c, locale, strokeConvention))
  const strokes = [...surnameStrokes, ...givenStrokes]
  const gyeok = computeGyeok(surnameStrokes, givenStrokes)

  return {
    strokeConvention,
    strokes,
    gyeok,
    numerology81: gyeokSuri(gyeok),
    yinYang: computeYinYang(strokes),
    fiveElements: computeFiveElements(gyeok),
  }
}

export function nameReading(input: NameInput): NameResult {
  const { locale } = input
  const strokeConvention = input.strokeConvention ?? 'kangxi'

  if (!isHangulLocale(locale) && !isHanjaLocale(locale)) {
    return {
      supported: false,
      strokeConvention: null,
      strokes: [],
      gyeok: null,
      numerology81: null,
      yinYang: null,
      fiveElements: null,
      alternate: null,
      axes: null,
      limitations: ['use_numerology_instead'],
    }
  }

  const surnameChars = splitChars(input.surname)
  const givenChars = splitChars(input.givenName)
  if (surnameChars.length === 0) throw new NameInputError('empty_surname', 'surname must not be empty')
  if (givenChars.length === 0) throw new NameInputError('empty_given_name', 'givenName must not be empty')

  const reading = computeReading(surnameChars, givenChars, locale, strokeConvention)
  const alternateConvention: StrokeConvention = strokeConvention === 'kangxi' ? 'modern' : 'kangxi'
  const alternateReading = isHanjaLocale(locale)
    ? computeReading(surnameChars, givenChars, locale, alternateConvention)
    : null

  return {
    supported: true,
    ...reading,
    alternate: alternateReading
      ? {
          strokeConvention: alternateReading.strokeConvention,
          gyeok: alternateReading.gyeok,
          numerology81: alternateReading.numerology81,
          yinYang: alternateReading.yinYang,
          fiveElements: alternateReading.fiveElements,
        }
      : null,
    axes: null,
    limitations: [],
  }
}
