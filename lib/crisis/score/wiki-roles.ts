import { hazardTermIsWholeWord } from './wiki'

/** Concepts that may amplify an already-fired natural component. */
export const WIKI_NATURAL_CONCEPTS = ['flood', 'landslide', 'earthquake', 'cyclone', 'dam'] as const

/** Concepts that may amplify an already-fired human/war component. */
export const WIKI_HUMAN_CONCEPTS = ['mobilization', 'curfew', 'coup', 'airstrike'] as const

const NATURAL_WORDS = [
  'storm', 'hurricane', 'typhoon', 'cyclone', 'flood', 'flooding', 'dam', 'landslide', 'quake', 'earthquake',
]

const HUMAN_WORDS = [
  'war', 'conflict', 'mobilization', 'mobilisation', 'mobilização', 'mobilizacao',
  'coup', 'invasion', 'conscription', 'curfew', 'airstrike', 'battle',
]

/**
 * Standing institutional pages. They are not a storm or a flood.
 * They amplify a human component only when one has already fired.
 */
export const WIKI_INSTITUTION_TITLES = [
  'Mobilização Nacional',
  'Mobilizacao Nacional',
  'National Mobilization',
  'National Mobilisation',
  'Mobilisation nationale',
  'Movilización Nacional',
  'Movilizacion Nacional',
]

function fold(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
}

export function isInstitutionWikiTitle(title: string): boolean {
  const hay = fold(title)
  if (!hay) return false
  return WIKI_INSTITUTION_TITLES.some((needle) => {
    const folded = fold(needle)
    return hay === folded || hay.includes(folded)
  })
}

export type WikiAmplifyRole = 'natural' | 'human' | 'other'

function hits(title: string, term: string, words: string[]): boolean {
  return words.some((word) => hazardTermIsWholeWord(title, word) || hazardTermIsWholeWord(term, word))
}

/** Natural titles amplify weather and geology. Human titles amplify conflict. Institutions stay on the human side. */
export function wikiTitleRole(title: string, term: string, concept = ''): WikiAmplifyRole {
  if (isInstitutionWikiTitle(title)) return 'human'
  const key = concept.trim().toLowerCase()
  if ((WIKI_NATURAL_CONCEPTS as readonly string[]).includes(key)) return 'natural'
  if ((WIKI_HUMAN_CONCEPTS as readonly string[]).includes(key)) return 'human'
  if (hits(title, term, NATURAL_WORDS)) return 'natural'
  if (hits(title, term, HUMAN_WORDS)) return 'human'
  return 'other'
}
