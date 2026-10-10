import { normalizeName } from '../ingest/iso'
import type { Draft } from './hunter-rules'
import type { Hypothesis } from './schema'
import { urlDate } from './search-items'

const STATUS_WORDS = /\b(closed|blocked|evacuated|shut down|sealed off)\b/i
const STALE_DAYS = 60

export type EvidenceDates = Map<string, string>

/** Entity strings must appear verbatim (case-insensitive) in an evidence ref or url. */
export function entityNamedInEvidence(entity: string, evidence: Array<{ ref: string; url?: string }>): boolean {
  const needle = entity.trim().toLowerCase().replace(/\s+/g, ' ')
  if (needle.length < 3) return false
  return evidence.some((item) => {
    const hay = `${item.ref} ${item.url ?? ''}`.toLowerCase().replace(/\s+/g, ' ')
    return hay.includes(needle)
  })
}

export function filterEvidencePreciseEntities(draft: Pick<Draft, 'entities' | 'evidence'>): string[] {
  return draft.entities.filter((entity) => entityNamedInEvidence(entity, draft.evidence))
}

/** Every listed entity is named in evidence; at least one entity remains. */
export function entityEvidencePrecise(draft: Pick<Draft, 'entities' | 'evidence'>): boolean {
  if (!draft.entities.length || !draft.evidence.length) return false
  return draft.entities.every((entity) => entityNamedInEvidence(entity, draft.evidence))
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

/** Status claims backed by evidence older than 60 days must not read as current. */
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

export function applyFactPrecisionToDraft(draft: Draft, dates: EvidenceDates, now: Date): Draft {
  const facts = staleStatusFacts(draft, dates, now)
  const entities = filterEvidencePreciseEntities(draft)
  return {
    ...draft,
    entities: entities.length ? entities : draft.entities,
    title: hedgeStaleStatusText(draft.title, facts),
    why_humans_miss: hedgeStaleStatusText(draft.why_humans_miss, facts),
    mechanism: hedgeStaleStatusText(draft.mechanism, facts),
    chain: draft.chain.map((step) => ({ ...step, step: hedgeStaleStatusText(step.step, facts) })),
  }
}

/** Primary entity (or title lead-in) for headline de-duplication. */
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
