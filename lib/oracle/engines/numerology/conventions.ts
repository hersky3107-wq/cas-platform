/**
 * Pythagorean numerology conventions.
 *
 * Y: treated as a vowel only when the word contains no A/E/I/O/U.
 * Syllable-level "sole vowel sound" is ambiguous in Latin orthography
 * (rhythm / yellow / Lynn), so this engine uses the word-level fallback
 * stated in the spec: if ambiguous, Y is a consonant. A word with any
 * A/E/I/O/U therefore counts every Y as a consonant; a word whose only
 * vowel-letter is Y (Lynn, Sky, My) counts those Ys as vowels.
 */
export const NUMEROLOGY_ENGINE_VERSION = '1.0.0'

export const MASTER_NUMBERS = [11, 22, 33] as const

export const PYTHAGOREAN_VALUES: Record<string, number> = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
  G: 7,
  H: 8,
  I: 9,
  J: 1,
  K: 2,
  L: 3,
  M: 4,
  N: 5,
  O: 6,
  P: 7,
  Q: 8,
  R: 9,
  S: 1,
  T: 2,
  U: 3,
  V: 4,
  W: 5,
  X: 6,
  Y: 7,
  Z: 8,
}

export const CORE_VOWELS = new Set(['A', 'E', 'I', 'O', 'U'])
