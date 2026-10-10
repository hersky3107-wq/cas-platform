import { normalizeName } from '../ingest/iso'
import type { Draft } from './hunter-rules'
import type { EngineCard, Hypothesis } from './schema'
import type { SearchItem } from './search-items'
import { urlDate } from './search-items'

const STATUS_WORDS = /\b(closed|blocked|evacuated|shut down|sealed off)\b/i
const STALE_DAYS = 60

const GENERIC_ENTITY_WORDS = new Set([
  'dam',
  'reservoir',
  'hospital',
  'road',
  'bridge',
  'river',
  'plant',
  'camp',
  'the',
  'general',
  'referral',
  'regional',
  'district',
  'town',
  'city',
  'main',
  'base',
  'spillway',
  'authority',
  'station',
])

export type EvidenceDates = Map<string, string>

export interface EntityMatchContext {
  fragilityNames: string[]
  searchTextByUrl: Map<string, string>
  card: Pick<EngineCard, 'name' | 'country'>
}

export function entityMatchContext(card: EngineCard, items: SearchItem[]): EntityMatchContext {
  return {
    fragilityNames: card.fragility.map((row) => row.name),
    searchTextByUrl: new Map(items.map((item) => [item.url, `${item.title} ${item.snippet ?? ''}`.trim()])),
    card: { name: card.name, country: card.country },
  }
}

function placeTokens(card: Pick<EngineCard, 'name' | 'country'>): Set<string> {
  return new Set([...normalizeName(card.name).split(' '), ...normalizeName(card.country).split(' ')].filter((word) => word.length >= 3))
}

/** Drop generic facility words; keep the named core (Victoria, Spring, Valley, …). */
export function coreTokens(name: string): string[] {
  return normalizeName(name)
    .split(' ')
    .filter((word) => word.length >= 3 && !GENERIC_ENTITY_WORDS.has(word))
}

function nonPlaceCore(entity: string, card: Pick<EngineCard, 'name' | 'country'>): string[] {
  const place = placeTokens(card)
  return coreTokens(entity).filter((word) => !place.has(word))
}

function evidenceHaystack(item: { ref: string; url?: string }, ctx: EntityMatchContext): string {
  const linked = item.url ? ctx.searchTextByUrl.get(item.url) ?? '' : ''
  return `${item.ref} ${item.url ?? ''} ${linked}`.toLowerCase().replace(/\s+/g, ' ')
}

function verbatimInHaystack(entity: string, hay: string): boolean {
  const needle = entity.trim().toLowerCase().replace(/\s+/g, ' ')
  return needle.length >= 3 && hay.includes(needle)
}

function coreInHaystack(entity: string, hay: string, card: Pick<EngineCard, 'name' | 'country'>): boolean {
  const need = nonPlaceCore(entity, card)
  if (!need.length) return false
  const found = new Set(coreTokens(hay))
  return need.every((token) => found.has(token))
}

function matchesFragilityAtlas(entity: string, atlasName: string): boolean {
  const entityNorm = normalizeName(entity)
  const atlasNorm = normalizeName(atlasName)
  if (entityNorm === atlasNorm) return true
  const eCore = coreTokens(entity)
  const aCore = coreTokens(atlasName)
  if (!eCore.length || !aCore.length) return false
  if (eCore.every((token) => aCore.includes(token))) return true
  if (aCore.every((token) => eCore.includes(token))) return true
  return false
}

/**
 * Entity is backed by evidence or atlas data. Never accept a generic relabel or a different facility.
 */
export function entityNamedInEvidence(
  entity: string,
  evidence: Array<{ ref: string; url?: string }>,
  ctx: EntityMatchContext,
): boolean {
  const trimmed = entity.trim()
  if (trimmed.length < 3) return false
  if (!nonPlaceCore(trimmed, ctx.card).length && !ctx.fragilityNames.some((name) => matchesFragilityAtlas(trimmed, name))) {
    return false
  }

  for (const item of evidence) {
    const hay = evidenceHaystack(item, ctx)
    if (verbatimInHaystack(trimmed, hay)) return true
    if (coreInHaystack(trimmed, hay, ctx.card)) return true
  }

  return ctx.fragilityNames.some((name) => matchesFragilityAtlas(trimmed, name))
}

export function filterEvidencePreciseEntities(
  draft: Pick<Draft, 'entities' | 'evidence'>,
  ctx: EntityMatchContext,
): string[] {
  return draft.entities.filter((entity) => entityNamedInEvidence(entity, draft.evidence, ctx))
}

export function entityEvidencePrecise(draft: Pick<Draft, 'entities' | 'evidence'>, ctx: EntityMatchContext): boolean {
  if (!draft.entities.length) return false
  if (!draft.evidence.length) {
    return draft.entities.every((entity) => ctx.fragilityNames.some((name) => matchesFragilityAtlas(entity, name)))
  }
  return draft.entities.every((entity) => entityNamedInEvidence(entity, draft.evidence, ctx))
}

export function evidenceItemDate(item: { url?: string }, dates: EvidenceDates): string {
  if (item.url) {
    const fromSearch = dates.get(item.url)
    if (fromSearch) return fromSearch
    const fromUrl = urlDate(item.url)
    if (fromUrl) return fromUrl
  }
  return ''
}

function olderThanDays(date: string, now: Date, days: number): boolean {
  const t = Date.parse(date)
  return Number.isFinite(t) && now.getTime() - t > days * 86_400_000
}

export interface StaleStatusFact {
  status: string
  date: string
}

export function staleStatusFacts(draft: Pick<Draft, 'evidence'>, dates: EvidenceDates, now: Date): StaleStatusFact[] {
  const facts: StaleStatusFact[] = []
  for (const item of draft.evidence) {
    const date = evidenceItemDate(item, dates)
    if (!date || !olderThanDays(date, now, STALE_DAYS)) continue
    const blob = `${item.ref} ${item.url ?? ''}`
    const match = STATUS_WORDS.exec(blob)
    if (match) facts.push({ status: match[1].toLowerCase(), date })
  }
  return facts.sort((a, b) => b.date.localeCompare(a.date))
}

export function hedgeStaleStatusText(text: string, facts: StaleStatusFact[]): string {
  if (!facts.length || !text.trim()) return text
  if (/current status unverified/i.test(text)) return text
  if (!STATUS_WORDS.test(text)) return text
  const fact = facts[0]
  const phrase = `reported ${fact.status} on ${fact.date}, current status unverified`
  let out = text.replace(/\b(is|was|already|remains|still|stay(s)?)\s+(closed|blocked|evacuated|shut down|sealed off)\b/gi, phrase)
  out = out.replace(/\b(closed|blocked|evacuated)\s+(for|due to|because|by|after)\b/gi, `${phrase}; formerly $2`)
  if (out === text) out = `${text.replace(/\.\s*$/, '')} (${phrase})`
  return out
}

export function applyFactPrecisionToDraft(
  draft: Draft,
  dates: EvidenceDates,
  now: Date,
  ctx: EntityMatchContext,
): Draft {
  const facts = staleStatusFacts(draft, dates, now)
  const entities = filterEvidencePreciseEntities(draft, ctx)
  return {
    ...draft,
    entities: entities.length ? entities : draft.entities,
    title: hedgeStaleStatusText(draft.title, facts),
    why_humans_miss: hedgeStaleStatusText(draft.why_humans_miss, facts),
    mechanism: hedgeStaleStatusText(draft.mechanism, facts),
    chain: draft.chain.map((step) => ({ ...step, step: hedgeStaleStatusText(step.step, facts) })),
  }
}

export function headlineRootKey(h: Pick<Hypothesis, 'entities' | 'hazards'>): string {
  const entity = normalizeName((h.entities ?? [])[0] ?? '')
  const hazard = (h.hazards ?? [])[0] ?? ''
  return `${entity}|${hazard}`
}

export function pickDiverseHeadlines<T>(rows: T[], score: (row: T) => number, root: (row: T) => string, limit = 3): T[] {
  const sorted = [...rows].sort((a, b) => score(b) - score(a))
  const picked: T[] = []
  const roots = new Set<string>()
  for (const row of sorted) {
    const key = root(row)
    if (picked.length > 0 && roots.has(key)) continue
    picked.push(row)
    roots.add(key)
    if (picked.length >= limit) return picked
  }
  for (const row of sorted) {
    if (picked.length >= limit) break
    if (picked.includes(row)) continue
    const key = root(row)
    if (roots.has(key)) continue
    picked.push(row)
    roots.add(key)
  }
  return picked
}
