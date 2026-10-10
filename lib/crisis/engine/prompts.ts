import { HAZARDS } from '../config/hazard-taxonomy'
import { HUNTER_MAX_HYPOTHESES } from './hunter-rules'
import { localLanguages } from './languages'
import { DEPARTMENTS, type Department, type EngineCard, type Horizon } from './schema'
import type { SearchItem } from './search-items'

/** Open-Meteo rain/river totals on the card are always 7-day, even when the run horizon is 30d. */
export const FORECAST_TOTALS_NOTE =
  'Rain and river forecast totals (sum_mm, peak_m3s) are 7-day (7일) forecasts. Never write them as 30-day or 30 days, even if the card horizon is 30d.'

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

export function analystSystem(department: Department, zone = false): string {
  return [
    SHARED_PREAMBLE,
    `You are the ${department} analyst. You see only that department's slice of the card.`,
    zone
      ? 'This card is a zone of several regions. Look for cross-border links: an upstream dam and the downstream country, conflict and refugee camps across the border, an outbreak spreading into the next country.'
      : '',
    'Write notes about what this slice can and cannot see. Do not invent numbers that are not in the slice.',
    'Return JSON: {"notes":"one paragraph","signals":["short signal"]}',
  ]
    .filter(Boolean)
    .join('\n')
}

export function analystUser(card: EngineCard, department: Department): string {
  const view = departmentView(card, department)
  return JSON.stringify({
    department,
    region: view.name,
    country: view.country,
    iso3: view.iso3,
    horizon: view.horizon,
    forecast_totals: '7-day (7일)',
    components: view.components,
    fragility: view.fragility,
    cascades: view.cascades,
    context: [...view.context, FORECAST_TOTALS_NOTE],
  })
}

export function departmentSliceEmpty(card: EngineCard, department: Department): boolean {
  const view = departmentView(card, department)
  return view.components.length === 0 && view.fragility.length === 0 && view.cascades.length === 0 && view.context.length === 0
}

export function fallbackQueries(card: EngineCard): string[] {
  const name = card.name
  const country = card.country
  const queries = [
    `${name} ${country} flood dam health conflict`,
    `${name} landslide hospital reservoir`,
  ]
  if (card.iso3 === 'LKA' || localLanguages(card.iso3).includes('si')) {
    queries.push(`${name} ගංවතුර වේල්ල`)
  }
  if (card.iso3 === 'LKA' || localLanguages(card.iso3).includes('ta')) {
    queries.push(`${name} வெள்ளம் அணை`)
  }
  queries.push(`${name} ${country} protest internet hospital`)
  return queries.slice(0, 5)
}

export function queryWriterSystem(card: EngineCard): string {
  const langs = localLanguages(card.iso3)
  return [
    SHARED_PREAMBLE,
    `Write 3 to 5 web search queries. You must return at least 3.`,
    `Include English and every local language (${langs.join(', ')}).`,
    card.iso3 === 'LKA'
      ? 'For Sri Lanka you MUST include at least one query in Sinhala script and at least one in Tamil script, plus English. Do not return a single generic English query.'
      : 'Do not return a single generic English query.',
    'The queries should look for the crossed-department possibility, not a generic news recap.',
    'Return JSON: {"queries":["..."]}',
  ].join('\n')
}

export function ensureQueries(card: EngineCard, parsed: string[]): string[] {
  const queries = [...parsed]
  if (card.iso3 === 'LKA') {
    if (!queries.some((query) => /[\u0D80-\u0DFF]/.test(query))) queries.unshift(`${card.name} ගංවතුර වේල්ල`)
    if (!queries.some((query) => /[\u0B80-\u0BFF]/.test(query))) queries.unshift(`${card.name} வெள்ளம் அணை`)
  }
  for (const query of fallbackQueries(card)) {
    if (queries.length >= 5) break
    if (!queries.includes(query)) queries.push(query)
  }
  return [...new Set(queries.filter((query) => query.trim()))].slice(0, 5)
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
    'Search the queries. Write a short brief of what you find.',
    'Do not return JSON. Citations are taken from the API (url, title, date).',
    'Keep the brief compact. At most 8 sources.',
  ].join('\n')
}

export function searchUser(queries: string[]): string {
  return JSON.stringify({ queries })
}

export const HUNTER_WANTED_EXAMPLES = [
  'Dam spill releases displace downstream communities — a controlled spill is not classed as failure, so villages are not warned.',
  'Downstream evacuation routes across the Mahaweli basin may be cut off before warnings reach people.',
]

export const HUNTER_UNWANTED_EXAMPLE = 'Heavy rain causes landslides (rain → landslide).'

export function hunterSystem(zone = false): string {
  return [
    SHARED_PREAMBLE,
    'You are one independent hunter. You do not see any other hunter.',
    `Propose at most ${HUNTER_MAX_HYPOTHESES} possibilities a single department would miss. Keep a thin one if it might be the true hit.`,
    'Code rejects a possibility unless it has all six:',
    `1. departments: at least 2 of ${DEPARTMENTS.join(', ')}, and the chain really crosses them.`,
    '2. entities: at least one SPECIFIC named thing copied from the card or the search items (a named dam, road, bridge, hospital, estate, camp, river, plant, or agency). The region or country name alone does not count.',
    '3. mechanism: the hidden mechanism, the reason the link is not seen. "A causes B" is not a mechanism.',
    '4. lead_time_days: {"min":N,"max":M}, when it could unfold, in days from today.',
    '5. early_indicators: one or two things a person could see 2 to 10 days before it happens.',
    '6. falsifier: one observation that would show the possibility is wrong.',
    'obvious_list holds the textbook outcomes for this card. Do NOT propose these unless you add a specific non-obvious twist, and put the twist in mechanism.',
    'already_reported holds what ReliefWeb, GDACS, Metaculus, and the news already cover. Do not restate it.',
    'Wanted, the kind of possibility we look for:',
    ...HUNTER_WANTED_EXAMPLES.map((line) => `- "${line}"`),
    `Not wanted: "${HUNTER_UNWANTED_EXAMPLE}" It is in every forecast already and names no hidden mechanism.`,
    `hazards uses these keys: ${HAZARDS.join(', ')}.`,
    'Each text field is at most 60 words. what_to_do is at most 3 bullets.',
    'evidence.type should be a component key such as rain, dam, conflict, food, health_attention.',
    'what_to_do is a plain-language list for residents, local language and English.',
    'official_links only when the url is already in the card or the search items.',
    zone
      ? 'This is one zone, not one region. Prefer a cross-border link (upstream dam → downstream country, conflict → camps across the border, outbreak spread) over a single-country restatement. Tag regions with the member names from the card: "regions":[{"region_id":0,"name":"","iso3":""}].'
      : '',
    'Return JSON: {"hypotheses":[{"title":"","hazards":["dam"],"departments":["natural-hydro","health"],"entities":[""],"mechanism":"","lead_time_days":{"min":3,"max":14},"early_indicators":[""],"falsifier":"","chain":[{"step":"","cascade_id":null}],"why_humans_miss":"","evidence":[{"type":"rain","ref":""}],"what_to_do":[""],"official_links":[{"label":"","url":""}],"regions":[{"region_id":0,"name":"","iso3":null}]}]}',
  ]
    .filter(Boolean)
    .join('\n')
}

export interface HunterExtras {
  obvious?: string[]
  alreadyReported?: Array<{ source: string; title: string; url: string; date: string | null }>
}

export function hunterUser(card: EngineCard, notes: string[], items: SearchItem[], extras: HunterExtras = {}): string {
  return JSON.stringify({
    card: {
      region: card.name,
      country: card.country,
      iso3: card.iso3,
      lat: card.lat,
      lon: card.lon,
      horizon: card.horizon,
      forecast_totals: '7-day (7일)',
      components: card.components,
      fragility: card.fragility,
      cascades: card.cascades,
      context: [...card.context, FORECAST_TOTALS_NOTE],
      urban: card.urban,
      zone_key: card.zone_key,
      members: card.members,
      neighbors: card.neighbors,
    },
    analyst_notes: notes,
    search_items: items.slice(0, 8).map((item) => ({
      title: item.title,
      url: item.url,
      published: item.undated ? 'undated' : item.published,
      past: item.past,
      snippet: item.snippet?.slice(0, 300),
    })),
    obvious_list: extras.obvious ?? [],
    already_reported: (extras.alreadyReported ?? []).slice(0, 12),
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
    'You are the judge. Merge near-duplicate hypotheses into groups and score each group. Put every id in exactly one group. You may not drop any.',
    'suggested_groups is a code pre-merge by shared hazard and named entity. Start from it; split a group when the mechanisms differ, merge further when two say the same thing.',
    'non_obviousness is 0 to 1. It is 0 when the group is on obvious_list without a specific twist, or when the same thing is already reported in search_items or already_reported (ReliefWeb, GDACS, Metaculus, news). It is near 1 when a well-informed local official reading one department alone would not think of it.',
    'on_obvious_list is true when the core claim matches an obvious_list line. twist is the specific non-obvious addition, or "".',
    'reported_as_news is the url of the item that already reports the same thing, or "".',
    'Entity names in titles and text must match evidence wording exactly. Do not rename facilities (for example do not turn "Spring Valley Regional Hospital" into "referral hospital" or "the hospital").',
    'If evidence older than 60 days says closed, blocked, or evacuated, write "reported <status> on <date>, current status unverified". Never state that status as current.',
    FORECAST_TOTALS_NOTE,
    'Stage and confidence are computed in code from how many independent hunters proposed the group, its departments, its weakness notes, and its evidence. Do not score them.',
    'Only for the 3 groups with the highest non_obviousness write headline_ko and headline_en (a news line or a short, at most 16 words) and brief_ko and brief_en (at most 2 sentences). Leave them "" for every other group.',
    'headline_ko and brief_ko are always Korean (한국어, Hangul), whatever the local language. headline_en and brief_en are English.',
    'what_to_do is plain language, at most 4 lines: local language and English. official_links only from the hypotheses, the card, or the search items.',
    'Return JSON: {"groups":[...],"baseline_risks":[{"title":"","stage":2,"possibility":"medium","what_to_do":[""],"reason":""}]}',
    'baseline_risks must list 3 to 5 well-known standard risks for this region (rain, dam, landslide, dengue, etc.), each with stage 1-5, possibility, and what_to_do pairs (local language + English).',
    'groups JSON shape: {"ids":["h0","h3"],"title":"","why_humans_miss":"","what_to_do":[""],"official_links":[{"label":"","url":""}],"non_obviousness":0.7,"on_obvious_list":false,"twist":"","reported_as_news":"","headline_ko":"","headline_en":"","brief_ko":"","brief_en":""}',
    'Also return 1 to 3 falsifiable predictions. A prediction is a consequence (dam spill, road cut, outbreak, displacement, collapse, eruption), not the forecast itself.',
    'Reject your own draft if it only restates a public rain, river, or cyclone forecast.',
    'window_start and window_end are YYYY-MM-DD, inside 90 days. Use the hazard lead-time band as a guide: dam failure and quakes 1–3 days, flood and landslide 3–7 days, outbreak and eruption 7–14 days, slow crises up to 90 days.',
    'predictions JSON: {"what":"dam spill","where":"named place","window_start":"YYYY-MM-DD","window_end":"YYYY-MM-DD","probability":0.6,"observable":"how anyone verifies it","counts_as_hit":"one sentence"}',
  ].join('\n')
}

export function judgeUser(packet: unknown): string {
  return JSON.stringify(packet)
}

export function cacheKey(regionId: number, horizon: Horizon, now: Date, zoneKey?: string | null): string {
  const day = now.toISOString().slice(0, 10)
  if (zoneKey) return `zone|${zoneKey}|${horizon}|${day}`
  return `${regionId}|${horizon}|${day}`
}
