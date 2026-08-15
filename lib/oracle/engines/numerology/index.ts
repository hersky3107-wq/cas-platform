/**
 * Pure Pythagorean numerology. No DB, network, LLM, or implicit clock.
 * Does not transliterate non-Latin names.
 */
import { CORE_VOWELS, MASTER_NUMBERS, NUMEROLOGY_ENGINE_VERSION, PYTHAGOREAN_VALUES } from './conventions'
import type { NumerologyInput, NumerologyResult } from './types'

export { NUMEROLOGY_ENGINE_VERSION }
export { MASTER_NUMBERS, PYTHAGOREAN_VALUES } from './tables'
export type { NumerologyInput, NumerologyResult } from './types'

function parseYmd(value: string, label: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new RangeError(`numerology: ${label} must be YYYY-MM-DD`)
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (m < 1 || m > 12 || d < 1 || d > 31) throw new RangeError(`numerology: invalid ${label}`)
  return { y, m, d }
}

function isMaster(n: number): boolean {
  return (MASTER_NUMBERS as readonly number[]).includes(n)
}

/** Reduce by digit sum, preserving 11 / 22 / 33. */
export function reducePythagorean(n: number): number {
  if (!Number.isFinite(n) || n < 0) throw new RangeError('numerology: cannot reduce a negative number')
  let current = Math.trunc(n)
  while (current > 9 && !isMaster(current)) {
    current = String(current)
      .split('')
      .reduce((sum, digit) => sum + Number(digit), 0)
  }
  return current
}

function sumDigits(n: number): number {
  return String(Math.abs(Math.trunc(n)))
    .split('')
    .reduce((sum, digit) => sum + Number(digit), 0)
}

function letterValue(ch: string): number | null {
  return PYTHAGOREAN_VALUES[ch] ?? null
}

/**
 * Y is a vowel only when the word has no A/E/I/O/U.
 * See conventions.ts for the school choice.
 */
function isVowelInWord(letter: string, word: string): boolean {
  if (CORE_VOWELS.has(letter)) return true
  if (letter !== 'Y') return false
  const letters = word.toUpperCase().replace(/[^A-Z]/g, '')
  return ![...letters].some((ch) => CORE_VOWELS.has(ch))
}

function nameNumbers(latinName: string): { expression: number; soulUrge: number; personality: number } {
  const words = latinName
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(Boolean)
  if (words.length === 0) {
    throw new RangeError('numerology: latinName contains no A–Z letters')
  }

  let expression = 0
  let soulUrge = 0
  let personality = 0
  for (const word of words) {
    for (const letter of word) {
      const value = letterValue(letter)
      if (value === null) continue
      expression += value
      if (isVowelInWord(letter, word)) soulUrge += value
      else personality += value
    }
  }
  return {
    expression: reducePythagorean(expression),
    soulUrge: reducePythagorean(soulUrge),
    personality: reducePythagorean(personality),
  }
}

export function numerology(input: NumerologyInput): NumerologyResult {
  const birth = parseYmd(input.birthDate, 'birthDate')
  const at = parseYmd(input.atDate, 'atDate')

  const lifePath = reducePythagorean(
    reducePythagorean(birth.m) + reducePythagorean(birth.d) + reducePythagorean(sumDigits(birth.y)),
  )
  const birthdayNumber = reducePythagorean(birth.d)
  const personalYear = reducePythagorean(
    reducePythagorean(birth.m) + reducePythagorean(birth.d) + reducePythagorean(sumDigits(at.y)),
  )
  const personalMonth = reducePythagorean(personalYear + reducePythagorean(at.m))

  const latin = input.latinName?.trim() ?? ''
  const hasLatinLetters = /[A-Za-z]/.test(latin)
  if (!hasLatinLetters) {
    return {
      lifePath,
      birthdayNumber,
      personalYear,
      personalMonth,
      expression: null,
      soulUrge: null,
      personality: null,
      limitations: ['no_latin_name'],
    }
  }

  const names = nameNumbers(latin)
  return {
    lifePath,
    birthdayNumber,
    personalYear,
    personalMonth,
    ...names,
    limitations: [],
  }
}
