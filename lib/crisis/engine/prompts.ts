import { localLanguages } from './languages'
import type { Department, EngineCard, Horizon } from './schema'
import type { SearchItem } from './search-items'

export const SHARED_PREAMBLE = [
  'You are looking for what people miss when departments do not talk to each other: a trigger, a hidden fragility, and the people in the way.',
  'One true hit matters more than five misses. A range of voices matters more than strict verification.',
  'Call these possibility and signals. Do not call them warnings or alerts.',
  'Always say what residents can do, in plain language, in the local language and in English, and point at official sources.',
].join('\n')

export const DEPARTMENT_KEYS: Record<Department, string[]> = {
  'natural-hydro': ['rain', 'river', 'cyclone', 'cyclone_formation'],
  'natural-geo': ['quake', 'volcano', 'fire', 'gdacs'],
  health: ['health_attention'],
  'conflict-political': ['conflict', 'silence', 'advisory', 'internet', 'escalation', 'slow_burn'],
  'infrastructure-economy': ['food'],
}

const FRAGILITY_KINDS: Record<Department, string[]> = {
  'natural-hydro': ['dam'],
  'natural-geo': ['volcano'],
  health: ['camp', 'wash'],
  'conflict-political': [],
  'infrastructure-economy': ['dam', 'nuclear', 'camp', 'chemical_plant', 'port'],
}

const CASCADE_TRIGGERS: Record<Department, string[]> = {
  'natural-hydro': ['cyclone', 'flood', 'dam_failure', 'storm_surge'],
  'natural-geo': ['earthquake', 'wildfire', 'glacial_lake'],
  health: ['wash_breakdown'],
  'conflict-political': ['conflict'],
  'infrastructure-economy': ['dam_failure'],
}

const CONTEXT_PATTERN: Record<Department, RegExp> = {
  'natural-hydro': /rain|river|flood|cyclone|dam|enso|storm|hydro/i,
  'natural-geo': /quake|seismic|volcano|fire|landslide|gdacs|geo/i,
  health: /health|disease|vector|cholera|dengue|malaria|wiki/i,
  'conflict-political': /conflict|gdelt|advisory|internet|slow|escalat|protest|curfew/i,
  'infrastructure-economy': /dam|nuclear|camp|food|enso|ipc|economy|infra/i,
}

export function departmentView(card: EngineCard, department: Department): EngineCard {
  const keys = new Set(DEPARTMENT_KEYS[department])
  const kinds = new Set(FRAGILITY_KINDS[department])
  const triggers = new Set(CASCADE_TRIGGERS[department])
  return {
    ...card,
    components: card.components.filter((row) => keys.has(row.key)),
    fragility: card.fragility.filter((item) => kinds.has(item.kind)),
    cascades: card.cascades.filter((row) => triggers.has(row.trigger)),
    context: card.context.filter((line) => CONTEXT_PATTERN[department].test(line)),
    urban: department === 'infrastructure-economy' || department === 'health' ? card.urban : [],
  }
}

export function analystSystem(department: Department): string {
  return [
    SHARED_PREAMBLE,
    `You are the ${department} analyst. You see only that department's slice of the card.`,
    'Write notes about what this slice can and cannot see. Do not invent numbers that are not in the slice.',
    'Return JSON: {"notes":"one paragraph","signals":["short signal"]}',
  ].join('\n')
}

export function analystUser(card: EngineCard, department: Department): string {
  const view = departmentView(card, department)
  return JSON.stringify({
    department,
    region: view.name,
    country: view.country,
    iso3: view.iso3,
    horizon: view.horizon,
    components: view.components,
    fragility: view.fragility,
    cascades: view.cascades,
    context: view.context,
  })
}

export function queryWriterSystem(card: EngineCard): string {
  const langs = localLanguages(card.iso3)
  return [
    SHARED_PREAMBLE,
    `Write 3 to 5 web search queries in the local language(s) (${langs.join(', ')}) and in English.`,
    'The queries should look for the crossed-department possibility, not a generic news recap.',
    'Return JSON: {"queries":["..."]}',
  ].join('\n')
}

export function queryWriterUser(card: EngineCard, notes: string[]): string {
  return JSON.stringify({
    region: card.name,
    country: card.country,
    iso3: card.iso3,
    languages: localLanguages(card.iso3),
    horizon: card.horizon,
    analyst_notes: notes,
  })
}

export function searchSystem(): string {
  return [
    SHARED_PREAMBLE,
    'Search and return items that have a url and a published date. Drop anything missing either.',
    'Return JSON: {"items":[{"title":"","url":"","published":"YYYY-MM-DD"}]}',
  ].join('\n')
}

export function searchUser(queries: string[]): string {
  return JSON.stringify({ queries })
}

export function hunterSystem(): string {
  return [
    SHARED_PREAMBLE,
    'You are one independent hunter. You do not see any other hunter.',
    'Propose possibilities a single department would miss. Keep a thin one if it might be the true hit.',
    'evidence.type should be a component key such as rain, dam, conflict, food, health_attention.',
    'what_to_do is a plain-language list for residents, local language and English.',
    'official_links only when the url is already in the card or the search items.',
    'Return JSON: {"hypotheses":[{"title":"","chain":[{"step":"","cascade_id":null}],"why_humans_miss":"","evidence":[{"type":"rain","ref":""}],"what_to_do":[""],"official_links":[{"label":"","url":""}]}]}',
  ].join('\n')
}

export function hunterUser(card: EngineCard, notes: string[], items: SearchItem[]): string {
  return JSON.stringify({
    card: {
      region: card.name,
      country: card.country,
      iso3: card.iso3,
      lat: card.lat,
      lon: card.lon,
      horizon: card.horizon,
      components: card.components,
      fragility: card.fragility,
      cascades: card.cascades,
      context: card.context,
      urban: card.urban,
    },
    analyst_notes: notes,
    search_items: items.map((item) => ({
      title: item.title,
      url: item.url,
      published: item.published,
      past: item.past,
    })),
  })
}

export function redTeamSystem(): string {
  return [
    SHARED_PREAMBLE,
    'Attach one weakness_note to each hypothesis. You may not delete, merge, or skip any.',
    'severity is low, medium, or high.',
    'Return JSON: {"notes":[{"id":"h0","note":"","severity":"medium"}]} with one entry per hypothesis, same order.',
  ].join('\n')
}

export function redTeamUser(hypotheses: Array<{ id: string; title: string; why_humans_miss: string; evidence: unknown }>): string {
  return JSON.stringify({ hypotheses })
}

export function judgeSystem(): string {
  return [
    SHARED_PREAMBLE,
    'You merge duplicate hypotheses and rank the rest. You may not drop any. A hypothesis you do not keep in a group is an outsider and must still be listed.',
    'Low-ranked possibilities go on the outsider list. They stay in the result.',
    'Stage and confidence are recomputed from structure: how many independent hunters proposed it, how many departments are in the evidence, how severe the weakness note is, and how many evidence items it has. Do not invent a higher stage than that structure supports.',
    'novelty is also_seen_elsewhere when the same risk is in the search items from a mainstream outlet, GDACS, or Metaculus. Otherwise only_us.',
    'Write the brief in Korean and English: summary_ko, summary_en, headline_ko, headline_en. Headlines are usable as a news line or a short.',
    'Return JSON: {"groups":[{"ids":["h0"],"rank":1,"outsider":false,"title":"","why_humans_miss":"","what_to_do":[""],"official_links":[{"label":"","url":""}]}],"summary_ko":"","summary_en":"","headline_ko":"","headline_en":""}',
  ].join('\n')
}

export function judgeUser(packet: unknown): string {
  return JSON.stringify(packet)
}

export function cacheKey(regionId: number, horizon: Horizon, now: Date): string {
  return `${regionId}|${horizon}|${now.toISOString().slice(0, 10)}`
}
