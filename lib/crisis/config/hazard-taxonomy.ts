import { HAZARD_TERMS, type HazardConcept } from './hazard-terms'

/**
 * One hazard vocabulary for coverage matching (ReliefWeb, GDACS, Metaculus,
 * search items) and for engine hypotheses. English patterns are an AI draft.
 * Status: ai_seed_unverified
 */
export const HAZARDS = [
  'flood',
  'landslide',
  'cyclone',
  'storm_surge',
  'dam',
  'drought',
  'heat',
  'cold',
  'earthquake',
  'tsunami',
  'volcano',
  'wildfire',
  'disease',
  'cholera',
  'dengue',
  'malaria',
  'leptospirosis',
  'mpox',
  'measles',
  'food_insecurity',
  'conflict',
  'unrest',
  'displacement',
  'internet_outage',
  'power_outage',
  'fuel_price',
  'nuclear',
] as const

export type Hazard = (typeof HAZARDS)[number]

/** Specific diseases. Two different ones do not count as the same hazard through the 'disease' umbrella. */
const DISEASES = new Set<Hazard>(['cholera', 'dengue', 'malaria', 'leptospirosis', 'mpox', 'measles'])

const PATTERNS: Array<{ hazard: Hazard; pattern: RegExp }> = [
  { hazard: 'flood', pattern: /\bflood(s|ing|ed)?\b|flash[- ]flood|inundat|overflow(ed|ing)? (river|bank)|waterlogg/i },
  { hazard: 'landslide', pattern: /land ?slides?|mud ?slides?|slope failure|debris flow|earth ?slips?|rock ?fall|avalanche/i },
  { hazard: 'cyclone', pattern: /cyclone|typhoon|hurricane|tropical storm|tropical depression|deep depression/i },
  { hazard: 'storm_surge', pattern: /storm surge|coastal surge/i },
  { hazard: 'dam', pattern: /\bdams?\b|reservoir|spillway|spill gates?|sluice|barrage|embankment|levee|tank breach|bund breach/i },
  { hazard: 'drought', pattern: /drought|dry spell|water shortage|water scarcity/i },
  { hazard: 'heat', pattern: /heat ?wave|extreme heat|heat stress/i },
  { hazard: 'cold', pattern: /cold wave|cold spell|\bfrost\b|blizzard/i },
  { hazard: 'earthquake', pattern: /earthquake|\bquake|seismic|tremor/i },
  { hazard: 'tsunami', pattern: /tsunami/i },
  { hazard: 'volcano', pattern: /volcan|eruption|lahar|ash ?fall/i },
  { hazard: 'wildfire', pattern: /wild ?fires?|forest fires?|bush ?fires?|grass ?fires?/i },
  { hazard: 'disease', pattern: /epidemic|outbreak|disease|infection|virus|pandemic|illness|public health emergency/i },
  { hazard: 'cholera', pattern: /cholera|acute watery diarrh|diarrh(o)?ea/i },
  { hazard: 'dengue', pattern: /dengue/i },
  { hazard: 'malaria', pattern: /malaria/i },
  { hazard: 'leptospirosis', pattern: /leptospirosis|rat fever/i },
  { hazard: 'mpox', pattern: /\bmpox|monkeypox/i },
  { hazard: 'measles', pattern: /measles/i },
  { hazard: 'food_insecurity', pattern: /food insecurity|food crisis|famine|hunger|malnutrition|ipc phase|crop (failure|loss|damage)|locust|insect infestation/i },
  { hazard: 'conflict', pattern: /armed conflict|\bclash(es)?\b|\battacks?\b|violence|fighting|insurgen|militant|\bwar\b|air ?strikes?|shelling|\bcoup\b|ceasefire|complex emergency/i },
  { hazard: 'unrest', pattern: /protests?|unrest|\briots?\b|curfew|general strike|state of emergency/i },
  { hazard: 'displacement', pattern: /displace|refugee|\bidps?\b|evacuat|relief camp|safety cent(re|er)s?/i },
  { hazard: 'internet_outage', pattern: /internet (shutdown|outage|blackout|disruption)|network outage|connectivity (loss|outage)/i },
  { hazard: 'power_outage', pattern: /power (cut|outage|failure)|blackout|electricity (cut|outage)|grid failure|load ?shedding/i },
  { hazard: 'fuel_price', pattern: /fuel (shortage|price|queue)|petrol|diesel|kerosene|oil price|brent/i },
  { hazard: 'nuclear', pattern: /nuclear|radiation|radioactive/i },
]

const CONCEPT_HAZARD: Partial<Record<HazardConcept, Hazard>> = {
  flood: 'flood',
  landslide: 'landslide',
  cholera: 'cholera',
  outbreak: 'disease',
  earthquake: 'earthquake',
  cyclone: 'cyclone',
  evacuation: 'displacement',
  mobilization: 'conflict',
  curfew: 'unrest',
  coup: 'conflict',
  airstrike: 'conflict',
  dam: 'dam',
  drought: 'drought',
  famine: 'food_insecurity',
  plague: 'disease',
  radiation: 'nuclear',
  refugee: 'displacement',
}

/** Latin-script local terms are skipped: short ones such as 'sel' match inside English words. */
const LOCAL_TERMS = HAZARD_TERMS
  .filter((row) => row.lang !== 'en' && CONCEPT_HAZARD[row.concept] && /[^\u0000-\u024f]/.test(row.term))
  .map((row) => ({ needle: row.term.normalize('NFKC').toLowerCase(), hazard: CONCEPT_HAZARD[row.concept] as Hazard }))
  .filter((row) => row.needle.length >= 3)

const RELIEFWEB_TYPE: Record<string, Hazard[]> = {
  flood: ['flood'],
  'flash flood': ['flood'],
  'land slide': ['landslide'],
  'mud slide': ['landslide'],
  'snow avalanche': ['landslide'],
  'tropical cyclone': ['cyclone'],
  'extratropical cyclone': ['cyclone'],
  'storm surge': ['storm_surge'],
  'severe local storm': ['cyclone'],
  epidemic: ['disease'],
  drought: ['drought'],
  earthquake: ['earthquake'],
  tsunami: ['tsunami'],
  volcano: ['volcano'],
  'wild fire': ['wildfire'],
  fire: ['wildfire'],
  'heat wave': ['heat'],
  'cold wave': ['cold'],
  'insect infestation': ['food_insecurity'],
  'complex emergency': ['conflict', 'displacement'],
}

const GDACS_TYPE: Record<string, Hazard[]> = {
  EQ: ['earthquake'],
  TC: ['cyclone'],
  FL: ['flood'],
  VO: ['volcano'],
  DR: ['drought'],
  WF: ['wildfire'],
  TS: ['tsunami'],
}

export function isHazard(value: unknown): value is Hazard {
  return typeof value === 'string' && (HAZARDS as readonly string[]).includes(value)
}

export function hazardsOf(text: string | null | undefined): Hazard[] {
  const hay = (text ?? '').normalize('NFKC')
  if (!hay.trim()) return []
  const found = new Set<Hazard>()
  for (const row of PATTERNS) if (row.pattern.test(hay)) found.add(row.hazard)
  const lower = hay.toLowerCase()
  for (const row of LOCAL_TERMS) if (lower.includes(row.needle)) found.add(row.hazard)
  for (const hazard of found) if (DISEASES.has(hazard)) found.add('disease')
  return [...found]
}

export function hazardsFromReliefwebTypes(names: string[]): Hazard[] {
  const found = new Set<Hazard>()
  for (const name of names) for (const hazard of RELIEFWEB_TYPE[name.trim().toLowerCase()] ?? []) found.add(hazard)
  return [...found]
}

export function hazardsFromGdacsType(code: string | null | undefined): Hazard[] {
  return GDACS_TYPE[(code ?? '').trim().toUpperCase()] ?? []
}

/**
 * Same hazard: any shared specific hazard. A shared 'disease' umbrella counts
 * only when one side does not name a specific disease, or both name the same one.
 */
export function sameHazard(a: Iterable<Hazard>, b: Iterable<Hazard>): Hazard | null {
  const left = new Set(a)
  const right = new Set(b)
  for (const hazard of left) {
    if (hazard === 'disease' || !right.has(hazard)) continue
    return hazard
  }
  if (left.has('disease') && right.has('disease')) {
    const leftSpecific = [...left].filter((hazard) => DISEASES.has(hazard))
    const rightSpecific = [...right].filter((hazard) => DISEASES.has(hazard))
    if (!leftSpecific.length || !rightSpecific.length) return 'disease'
  }
  return null
}
