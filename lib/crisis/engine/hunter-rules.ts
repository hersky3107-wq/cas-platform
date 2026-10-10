import { hazardsOf, isHazard, type Hazard } from '../config/hazard-taxonomy'
import { entityNamedInEvidence, type EntityMatchContext } from './fact-precision'
import { normalizeName } from '../ingest/iso'
import { DEPARTMENTS, type Department, type EngineCard, type Horizon } from './schema'
import type { SearchItem } from './search-items'
import type { Weakness } from './structure'

export const HUNTER_MAX_HYPOTHESES = 2

export interface Draft {
  id: string
  title: string
  chain: Array<{ step: string; cascade_id: string | null }>
  why_humans_miss: string
  evidence: Array<{ type: string; ref: string; url?: string; date?: string; language?: string }>
  what_to_do: string[]
  official_links: Array<{ label: string; url: string }>
  proposed_by: string[]
  weakness_notes: string[]
  weakness: Weakness
  hazards: Hazard[]
  departments: Department[]
  entities: string[]
  mechanism: string
  lead_time_days: { min: number; max: number }
  early_indicators: string[]
  falsifier: string
  regions?: Array<{ region_id: number; name: string; iso3: string | null }>
}

export interface ObviousEntry {
  line: string
  trigger: string
  hazards: Hazard[]
}

const TEXTBOOK: Record<string, Array<[string, Hazard[]]>> = {
  rain: [
    ['rain → flood', ['flood']],
    ['rain → landslide', ['landslide']],
    ['rain → dam overtopping or dam failure', ['dam']],
    ['rain → waterborne disease (cholera, diarrhoea)', ['cholera']],
    ['rain → dengue and other mosquito-borne disease', ['dengue', 'malaria']],
    ['rain → crop damage', ['food_insecurity']],
    ['rain → people displaced from flooded homes', ['displacement']],
  ],
  river: [
    ['river rise → flood', ['flood']],
    ['flood → displacement', ['displacement']],
    ['flood → cholera and waterborne disease', ['cholera']],
    ['flood → leptospirosis', ['leptospirosis']],
  ],
  cyclone: [
    ['cyclone → storm surge', ['storm_surge']],
    ['cyclone → flood', ['flood']],
    ['cyclone → power cuts', ['power_outage']],
    ['cyclone → evacuation and displacement', ['displacement']],
  ],
  quake: [
    ['earthquake → building collapse and casualties', ['earthquake']],
    ['earthquake → landslide', ['landslide']],
    ['earthquake → dam damage', ['dam']],
  ],
  volcano: [
    ['eruption → ash fall and evacuation', ['volcano', 'displacement']],
    ['eruption → lahar', ['volcano']],
  ],
  fire: [
    ['fire → smoke and respiratory illness', ['wildfire']],
    ['fire → evacuation', ['displacement']],
  ],
  gdacs: [['disaster alert → humanitarian response', []]],
  conflict: [
    ['conflict → displacement', ['displacement']],
    ['conflict → casualties', ['conflict']],
    ['conflict → food insecurity', ['food_insecurity']],
  ],
  escalation: [['escalation → violence spreads', ['conflict']]],
  slow_burn: [['tension → unrest or clashes', ['conflict', 'unrest']]],
  internet: [['internet outage → communication blackout', ['internet_outage']]],
  advisory: [['travel advisory change → travel disruption', ['unrest']]],
  food: [
    ['food insecurity → malnutrition', ['food_insecurity']],
    ['drought → crop failure', ['drought', 'food_insecurity']],
  ],
  health_attention: [['outbreak → spread to nearby districts', ['disease']]],
}

/** Direct textbook cascades from the fired components, the card cascades, and fragility. */
export function obviousList(card: EngineCard): ObviousEntry[] {
  const out: ObviousEntry[] = []
  const seen = new Set<string>()
  const add = (line: string, trigger: string, hazards: Hazard[]) => {
    if (seen.has(line)) return
    seen.add(line)
    out.push({ line, trigger, hazards })
  }
  const fired = card.components.filter((row) => row.value > 0)
  for (const row of fired) for (const [line, hazards] of TEXTBOOK[row.key] ?? []) add(line, row.key, hazards)
  const wet = fired.some((row) => row.key === 'rain' || row.key === 'river' || row.key === 'cyclone')
  if (wet && card.fragility.some((item) => item.kind === 'dam')) {
    for (const item of card.fragility.filter((row) => row.kind === 'dam').slice(0, 3)) {
      add(`rain → ${item.name} overtopping or failure`, 'rain', ['dam', 'flood'])
    }
  }
  if (wet && card.fragility.some((item) => item.kind === 'camp' || item.kind === 'refugee_camp')) {
    add('flood → disease in camps', 'rain', ['disease', 'displacement'])
  }
  for (const row of card.cascades) {
    const effect = row.effect.replace(/_/g, ' ')
    add(`${row.trigger.replace(/_/g, ' ')} → ${effect}`, row.trigger, hazardsOf(effect))
  }
  return out.slice(0, 24)
}

const GENERIC = new Set([
  'dam', 'dams', 'river', 'rivers', 'road', 'roads', 'town', 'towns', 'city', 'camp', 'camps', 'clinic', 'clinics',
  'hospital', 'hospitals', 'district', 'districts', 'province', 'provincial', 'reservoir', 'reservoirs', 'lake', 'valley',
  'village', 'villages', 'bridge', 'bridges', 'highway', 'school', 'schools', 'station', 'power', 'plant', 'market',
  'region', 'regional', 'area', 'areas', 'north', 'south', 'east', 'west', 'central', 'upper', 'lower', 'national',
  'local', 'office', 'ministry', 'department', 'authority', 'centre', 'center', 'general', 'base', 'hydro', 'water',
  'board', 'health', 'public', 'rural', 'urban', 'main', 'line', 'network', 'system', 'project', 'scheme', 'basin',
  'catchment', 'downstream', 'upstream', 'estate', 'estates', 'tea', 'route', 'routes', 'unit', 'committee', 'council',
  'medical', 'officer', 'division', 'secretariat', 'with', 'from', 'into', 'over', 'under', 'that', 'this', 'their',
])

/** Card, search, and coverage text an entity must come from. Normalized, padded with spaces. */
export function entityCorpus(card: EngineCard, items: SearchItem[], extra: string[] = []): string {
  const parts = [
    ...card.fragility.map((row) => row.name),
    ...card.urban.map((row) => row.name),
    ...card.context,
    ...card.cascades.map((row) => `${row.trigger} ${row.effect}`),
    ...card.components.map((row) => JSON.stringify(row.raw)),
    ...items.map((item) => `${item.title} ${item.snippet ?? ''}`),
    ...extra,
  ]
  return ` ${normalizeName(parts.join(' '))} `
}

const NAME_FILLER = new Set(['the', 'of', 'in', 'at', 'and', 'district', 'general', 'teaching', 'base', 'provincial', 'national', 'main'])
const NEAR_WINDOW = 6

/** Every required word appears within NEAR_WINDOW tokens of the others ("Badulla Hospital" ~ "hospital in Badulla"). */
function wordsNear(words: string[], tokens: string[]): boolean {
  if (words.length < 2) return false
  const first = words[0]
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i] !== first) continue
    const window = new Set(tokens.slice(Math.max(0, i - NEAR_WINDOW), i + NEAR_WINDOW + 1))
    if (words.every((word) => window.has(word))) return true
  }
  return false
}

/**
 * An entity is grounded when its full name is in the corpus, one specific word of it is, or a
 * facility named by place ("Badulla Hospital") appears with those words close together.
 */
export function entityGrounded(entity: string, corpus: string, card: Pick<EngineCard, 'name' | 'country'>): boolean {
  const phrase = normalizeName(entity)
  if (!phrase) return false
  const place = new Set([...normalizeName(card.name).split(' '), ...normalizeName(card.country).split(' ')])
  if (phrase === normalizeName(card.name) || phrase === normalizeName(card.country)) return false
  if (phrase.length >= 6 && corpus.includes(` ${phrase} `)) return true
  const words = phrase.split(' ')
  if (words.filter((word) => word.length >= 4 && !GENERIC.has(word) && !place.has(word)).some((word) => corpus.includes(` ${word} `))) {
    return true
  }
  const required = words.filter((word) => word.length >= 3 && !NAME_FILLER.has(word))
  const named = required.some((word) => place.has(word)) && required.some((word) => GENERIC.has(word) && !place.has(word))
  return named && wordsNear(required, corpus.trim().split(' '))
}

const DEPARTMENT_ALIASES: Array<[RegExp, Department]> = [
  [/hydro|rain|flood|river|water|weather|cyclone|dam/i, 'natural-hydro'],
  [/geo|quake|seism|landslide|volcan|fire/i, 'natural-geo'],
  [/health|medical|disease|clinic|wash/i, 'health'],
  [/conflict|politic|security|police|governance|advisory/i, 'conflict-political'],
  [/infra|econom|road|transport|power|energy|telecom|food|market|supply/i, 'infrastructure-economy'],
]

const EVIDENCE_DEPARTMENT: Record<string, Department> = {
  rain: 'natural-hydro', river: 'natural-hydro', cyclone: 'natural-hydro', cyclone_formation: 'natural-hydro', dam: 'natural-hydro',
  quake: 'natural-geo', volcano: 'natural-geo', fire: 'natural-geo', gdacs: 'natural-geo', landslide: 'natural-geo',
  health_attention: 'health', disease: 'health', camp: 'health', wash: 'health',
  conflict: 'conflict-political', silence: 'conflict-political', advisory: 'conflict-political', internet: 'conflict-political',
  escalation: 'conflict-political', slow_burn: 'conflict-political',
  food: 'infrastructure-economy', nuclear: 'infrastructure-economy', road: 'infrastructure-economy', power: 'infrastructure-economy',
  enso: 'infrastructure-economy', oil: 'infrastructure-economy',
}

export function normalizeDepartments(value: unknown, evidence: Array<{ type: string }>): Department[] {
  const found = new Set<Department>()
  for (const item of Array.isArray(value) ? value : []) {
    if (typeof item !== 'string') continue
    if ((DEPARTMENTS as readonly string[]).includes(item)) {
      found.add(item as Department)
      continue
    }
    const alias = DEPARTMENT_ALIASES.find(([pattern]) => pattern.test(item))
    if (alias) found.add(alias[1])
  }
  for (const item of evidence) {
    const dept = EVIDENCE_DEPARTMENT[item.type]
    if (dept) found.add(dept)
  }
  return [...found]
}

const HORIZON_DAYS: Record<Horizon, number> = { '7d': 7, '30d': 30, '180d': 180 }

export function parseLeadTime(value: unknown, horizon: Horizon): { min: number; max: number } | null {
  let min: number | null = null
  let max: number | null = null
  if (typeof value === 'number' && Number.isFinite(value)) {
    min = value
    max = value
  } else if (Array.isArray(value) && value.length >= 1) {
    min = Number(value[0])
    max = Number(value[value.length - 1])
  } else if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>
    min = Number(rec.min ?? rec.from ?? rec.start)
    max = Number(rec.max ?? rec.to ?? rec.end ?? rec.min)
  } else if (typeof value === 'string') {
    const nums = value.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? []
    if (nums.length) {
      min = nums[0]
      max = nums[nums.length - 1]
    }
  }
  if (min == null || max == null || !Number.isFinite(min) || !Number.isFinite(max)) return null
  if (min > max) [min, max] = [max, min]
  if (max < 1 || min < 0 || max > Math.max(HORIZON_DAYS[horizon] * 2, 30)) return null
  return { min: Math.round(min), max: Math.round(max) }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function strings(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
}

function wordCount(value: string): number {
  return value.split(/\s+/).filter(Boolean).length
}

export interface HunterCheck {
  title: string
  model: string
  reasons: string[]
  draft: Draft | null
}

/** Rejects a hunter hypothesis unless all six requirements are present. */
export function checkHunterRow(
  row: unknown,
  opts: { model: string; id: string; card: EngineCard; corpus: string; entityCtx: EntityMatchContext },
): HunterCheck {
  const record = row && typeof row === 'object' && !Array.isArray(row) ? (row as Record<string, unknown>) : null
  const title = text(record?.title)
  if (!record || !title) return { title: title || '(no title)', model: opts.model, reasons: ['no title'], draft: null }
  const reasons: string[] = []

  const chain = (Array.isArray(record.chain) ? record.chain : [])
    .map((step) => {
      const item = step && typeof step === 'object' ? (step as Record<string, unknown>) : null
      const label = text(item?.step)
      return label ? { step: label, cascade_id: typeof item?.cascade_id === 'string' ? item.cascade_id : null } : null
    })
    .filter((step): step is { step: string; cascade_id: string | null } => step !== null)
  const evidence = (Array.isArray(record.evidence) ? record.evidence : [])
    .map((item) => {
      const entry = item && typeof item === 'object' ? (item as Record<string, unknown>) : null
      const type = text(entry?.type)
      const url = text(entry?.url)
      const ref = text(entry?.ref) || url
      const date = text(entry?.date)
      const language = text(entry?.language)
      if (!type || !ref) return null
      return {
        type,
        ref,
        ...(url ? { url } : {}),
        ...(date ? { date } : {}),
        ...(language ? { language } : {}),
      }
    })
    .filter((item): item is { type: string; ref: string; url?: string; date?: string; language?: string } => item !== null)

  const departments = normalizeDepartments(record.departments, evidence)
  if (departments.length < 2) reasons.push('crosses fewer than 2 departments')

  const named = strings(record.entities ?? record.entity)
  const grounded = named.filter((entity) => entityGrounded(entity, opts.corpus, opts.card))
  const entities = grounded.filter((entity) => entityNamedInEvidence(entity, evidence, opts.entityCtx))
  if (!entities.length) {
    if (grounded.length) reasons.push(`entity not named in evidence (${grounded.slice(0, 2).join(', ')})`)
    else reasons.push(named.length ? `entity not in card or search items (${named.slice(0, 2).join(', ')})` : 'no specific entity')
  }

  const mechanism = text(record.mechanism ?? record.hidden_mechanism)
  if (wordCount(mechanism) < 5) reasons.push('no hidden mechanism')

  const lead = parseLeadTime(record.lead_time_days ?? record.lead_time, opts.card.horizon)
  if (!lead) reasons.push('no lead-time window in days')

  const indicators = strings(record.early_indicators ?? record.early_indicator).slice(0, 2)
  if (!indicators.length) reasons.push('no early indicator')

  const falsifier = text(record.falsifier)
  if (wordCount(falsifier) < 3) reasons.push('no falsifier')

  if (reasons.length) return { title, model: opts.model, reasons, draft: null }

  const declared = strings(record.hazards ?? record.hazard).filter(isHazard)
  const hazards = [...new Set([...declared, ...hazardsOf(title)])]
  return {
    title,
    model: opts.model,
    reasons,
    draft: {
      id: opts.id,
      title,
      chain: chain.length ? chain : [{ step: title, cascade_id: null }],
      why_humans_miss: text(record.why_humans_miss) || mechanism,
      evidence,
      what_to_do: strings(record.what_to_do).length
        ? strings(record.what_to_do)
        : ['Check the official links and local radio before you travel, and keep drinking water in the house.'],
      official_links: (Array.isArray(record.official_links) ? record.official_links : []).flatMap((item) => {
        const link = item && typeof item === 'object' ? (item as Record<string, unknown>) : null
        const label = text(link?.label)
        const url = text(link?.url)
        return label && url ? [{ label, url }] : []
      }),
      proposed_by: [opts.model],
      weakness_notes: [],
      weakness: 'low',
      hazards,
      departments,
      entities,
      mechanism,
      lead_time_days: lead!,
      early_indicators: indicators,
      falsifier,
    },
  }
}

function titleWords(value: string): Set<string> {
  return new Set(normalizeName(value).split(' ').filter((word) => word.length > 3 && !GENERIC.has(word)))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let shared = 0
  for (const word of a) if (b.has(word)) shared += 1
  return shared / (a.size + b.size - shared)
}

/** Specific words from a draft's named entities, without generic words or the place name. */
export function entityWords(draft: Pick<Draft, 'entities'>, card: Pick<EngineCard, 'name' | 'country'>): Set<string> {
  const place = new Set([...normalizeName(card.name).split(' '), ...normalizeName(card.country).split(' ')])
  return new Set(
    draft.entities.flatMap((entity) => normalizeName(entity).split(' ')).filter((word) => word.length >= 4 && !GENERIC.has(word) && !place.has(word)),
  )
}

/** Near-duplicates: a shared hazard and a shared specific entity word, or title word overlap >= 0.4. */
export function clusterDrafts(drafts: Draft[], card: Pick<EngineCard, 'name' | 'country'>): string[][] {
  const parent = new Map(drafts.map((draft) => [draft.id, draft.id]))
  const find = (id: string): string => {
    let cur = id
    while (parent.get(cur) !== cur) cur = parent.get(cur)!
    return cur
  }
  const words = new Map(drafts.map((draft) => [draft.id, titleWords(draft.title)]))
  const keys = new Map(drafts.map((draft) => [draft.id, entityWords(draft, card)]))
  for (let i = 0; i < drafts.length; i += 1) {
    for (let j = i + 1; j < drafts.length; j += 1) {
      const a = drafts[i]
      const b = drafts[j]
      const sharedHazard = a.hazards.some((hazard) => hazard !== 'disease' && b.hazards.includes(hazard))
      const sharedEntity = [...keys.get(a.id)!].some((word) => keys.get(b.id)!.has(word))
      const similar = jaccard(words.get(a.id)!, words.get(b.id)!) >= 0.4
      if ((sharedHazard && sharedEntity) || similar) parent.set(find(a.id), find(b.id))
    }
  }
  const groups = new Map<string, string[]>()
  for (const draft of drafts) {
    const root = find(draft.id)
    groups.set(root, [...(groups.get(root) ?? []), draft.id])
  }
  return [...groups.values()]
}
