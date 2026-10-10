import { hazardsFromGdacsType, hazardsOf, sameHazard, type Hazard } from '../config/hazard-taxonomy'
import { ISO2_TO_ISO3, normalizeName } from '../ingest/iso'
import { entityWords } from './hunter-rules'
import type { Draft } from './hunter-rules'
import type { EngineCard } from './schema'
import type { SearchItem } from './search-items'

const DISEASES = new Set<Hazard>(['cholera', 'dengue', 'malaria', 'leptospirosis', 'mpox', 'measles'])

export const COVERAGE_DAYS = 30
export const COVERAGE_SOURCES = ['reliefweb', 'gdacs', 'metaculus', 'mainstream'] as const
export type CoverageSource = (typeof COVERAGE_SOURCES)[number]

export interface CoverageItem {
  source: CoverageSource
  title: string
  url: string
  date: string | null
  country_iso3: string | null
  hazards: Hazard[]
  region_match: boolean
}

export interface NoveltyMatch {
  source: CoverageSource
  title: string
  url: string
  date: string | null
  scope: 'region' | 'country'
  hazard: Hazard
  matched_span: string
}

export interface BackgroundCoverageItem {
  source: CoverageSource
  title: string
  url: string
  hazard: Hazard
  matched_span: string
}

export interface NoveltyContext {
  card: Pick<EngineCard, 'name' | 'country'>
  entities: string[]
  mechanism?: string
  title?: string
  hazards: Hazard[]
}

/** Global wires and agencies, plus national outlets for the countries we test on. */
export const MAINSTREAM_DOMAINS = [
  'reuters.com', 'apnews.com', 'afp.com', 'bbc.com', 'bbc.co.uk', 'aljazeera.com', 'theguardian.com',
  'nytimes.com', 'washingtonpost.com', 'cnn.com', 'bloomberg.com', 'ft.com', 'economist.com', 'dw.com',
  'france24.com', 'npr.org', 'xinhuanet.com', 'scmp.com', 'thehindu.com', 'hindustantimes.com',
  'timesofindia.indiatimes.com', 'ndtv.com', 'dawn.com', 'thedailystar.net', 'kathmandupost.com',
  'reliefweb.int', 'gdacs.org', 'metaculus.com', 'who.int', 'unicef.org', 'ifrc.org', 'ocha.org', 'unocha.org',
  'adaderana.lk', 'dailymirror.lk', 'newsfirst.lk', 'sundaytimes.lk', 'dailynews.lk', 'island.lk', 'ft.lk',
  'economynext.com', 'newswire.lk', 'colombogazette.com', 'lankadeepa.lk', 'virakesari.lk', 'hirunews.lk',
]

const SOURCE_PRIORITY: Record<CoverageSource, number> = { reliefweb: 0, gdacs: 1, metaculus: 2, mainstream: 3 }

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

function hostIn(host: string, domains: string[]): boolean {
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

const ISO3_TO_ISO2 = new Map(Object.entries(ISO2_TO_ISO3).map(([iso2, iso3]) => [iso3, iso2.toLowerCase()]))

export function regionMentioned(text: string, card: Pick<EngineCard, 'name'>): boolean {
  const name = normalizeName(card.name)
  if (!name || name.length < 3) return false
  return ` ${normalizeName(text)} `.includes(` ${name} `)
}

export function countryMentioned(text: string, card: Pick<EngineCard, 'country' | 'iso3'>): boolean {
  const country = normalizeName(card.country)
  return Boolean(country) && ` ${normalizeName(text)} `.includes(` ${country} `)
}

export function withinDays(date: string | null, now: Date, days = COVERAGE_DAYS): boolean {
  if (!date) return false
  const t = Date.parse(date)
  return Number.isFinite(t) && now.getTime() - t <= days * 86_400_000
}

export interface CoverageSignalRow {
  source: string
  signal_type: string
  title: string | null
  url: string | null
  country_iso3: string | null
  region_id: number | null
  event_time: string | null
  value_raw: unknown
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function storedHazards(raw: Record<string, unknown>): Hazard[] {
  return Array.isArray(raw.hazards) ? (raw.hazards.filter((item) => typeof item === 'string') as Hazard[]) : []
}

/** ReliefWeb, GDACS, and Metaculus rows for the card's country in the last 30 days. */
export function coverageFromSignals(rows: CoverageSignalRow[], card: EngineCard, now: Date): CoverageItem[] {
  const out: CoverageItem[] = []
  for (const row of rows) {
    const raw = record(row.value_raw)
    const title = row.title ?? ''
    if (!title || !row.url) continue
    if (row.source === 'reliefweb') {
      const ongoing = raw.kind === 'disaster' && (raw.status === 'alert' || raw.status === 'ongoing')
      if (!ongoing && !withinDays(row.event_time, now)) continue
      const countries = Array.isArray(raw.countries) ? raw.countries.map(String) : []
      if (row.country_iso3 !== card.iso3 && !countries.includes(card.iso3 ?? '')) continue
      out.push({
        source: 'reliefweb',
        title,
        url: row.url,
        date: row.event_time,
        country_iso3: row.country_iso3,
        hazards: [...new Set([...storedHazards(raw), ...hazardsOf(title)])],
        region_match: regionMentioned(title, card),
      })
    } else if (row.source === 'gdacs') {
      if (!withinDays(row.event_time, now)) continue
      if (row.country_iso3 !== card.iso3 && row.region_id !== card.region_id) continue
      out.push({
        source: 'gdacs',
        title,
        url: row.url,
        date: row.event_time,
        country_iso3: row.country_iso3,
        hazards: [...new Set([...hazardsFromGdacsType(row.signal_type), ...hazardsOf(title)])],
        region_match: row.region_id === card.region_id || regionMentioned(title, card),
      })
    } else if (row.source === 'metaculus') {
      const close = typeof raw.close_time === 'string' ? raw.close_time : null
      if (close && Date.parse(close) < now.getTime() - COVERAGE_DAYS * 86_400_000) continue
      const countries = Array.isArray(raw.countries) ? raw.countries.map(String) : []
      if (!card.iso3 || !countries.includes(card.iso3)) continue
      out.push({
        source: 'metaculus',
        title,
        url: row.url,
        date: row.event_time,
        country_iso3: card.iso3,
        hazards: [...new Set([...storedHazards(raw), ...hazardsOf(title)])],
        region_match: regionMentioned(title, card),
      })
    }
  }
  return out
}

/**
 * Search items from a mainstream outlet (or ReliefWeb / GDACS / Metaculus pages) in the last 30 days
 * that are about this region or country: the text names it, or the outlet is national (ccTLD).
 * Items the search API returned without a date are skipped.
 */
export function mainstreamFromSearch(items: SearchItem[], card: EngineCard, now: Date): CoverageItem[] {
  const iso2 = card.iso3 ? ISO3_TO_ISO2.get(card.iso3) ?? null : null
  const out: CoverageItem[] = []
  const seen = new Set<string>()
  for (const item of items) {
    if (item.undated || seen.has(item.url) || !withinDays(item.published, now)) continue
    const host = hostOf(item.url)
    if (!hostIn(host, MAINSTREAM_DOMAINS)) continue
    const text = `${item.title.replace(/^\[past\]\s*/, '')} ${item.snippet ?? ''}`
    const region = regionMentioned(text, card)
    const national = Boolean(iso2 && host.endsWith(`.${iso2}`))
    if (!region && !national && !countryMentioned(text, card)) continue
    seen.add(item.url)
    const source: CoverageSource = host.endsWith('reliefweb.int') ? 'reliefweb' : host.endsWith('gdacs.org') ? 'gdacs' : host.endsWith('metaculus.com') ? 'metaculus' : 'mainstream'
    out.push({
      source,
      title: item.title.replace(/^\[past\]\s*/, '').slice(0, 200),
      url: item.url,
      date: item.published,
      country_iso3: card.iso3,
      hazards: hazardsOf(text),
      region_match: region,
    })
  }
  return out
}

export function coverageCounts(items: CoverageItem[]): Record<CoverageSource, number> {
  const counts = { reliefweb: 0, gdacs: 0, metaculus: 0, mainstream: 0 }
  for (const item of items) counts[item.source] += 1
  return counts
}

function specificSharedHazard(hypothesis: Hazard[], item: CoverageItem): Hazard | null {
  const text = item.title
  const itemHazards = [...new Set([...item.hazards, ...hazardsOf(text)])]
  const shared = sameHazard(hypothesis, itemHazards)
  if (!shared) return null
  const hypSpecific = hypothesis.filter((hazard) => DISEASES.has(hazard))
  if (hypSpecific.length) {
    const named = hypSpecific.find((hazard) => itemHazards.includes(hazard) || hazardsOf(text).includes(hazard))
    return named ?? null
  }
  if (shared === 'disease') {
    const itemSpecific = itemHazards.filter((hazard) => DISEASES.has(hazard))
    if (itemSpecific.length) return null
  }
  const mechanism = hypothesis.includes('dam') && itemHazards.includes('dam') ? 'dam' : shared
  if (mechanism === 'dam' || shared === 'dam') {
    if (!/\b(dam|reservoir|spill|spillway|sluice|barrage|embankment)\b/i.test(text)) return null
  }
  return shared
}

function anchoredToHypothesis(text: string, card: Pick<EngineCard, 'name' | 'country'>, draft: Pick<Draft, 'entities'>): boolean {
  if (regionMentioned(text, card)) return true
  const norm = ` ${normalizeName(text)} `
  const words = entityWords({ entities: draft.entities }, card)
  for (const word of words) {
    if (word.length >= 4 && norm.includes(` ${word} `)) return true
  }
  const facility = /\b(hospital|district|road|bridge|reservoir|spillway|general hospital)\b/i
  if (facility.test(text) && draft.entities.some((entity) => normalizeName(entity).split(' ').some((part) => part.length >= 4 && norm.includes(` ${part} `)))) {
    return true
  }
  return false
}

export function matchedSpan(text: string, card: Pick<EngineCard, 'name'>, hazard: Hazard, draft: Pick<Draft, 'entities'>): string {
  const raw = text.trim()
  const region = normalizeName(card.name)
  if (region.length >= 3 && raw.toLowerCase().includes(region)) {
    const index = raw.toLowerCase().indexOf(region)
    return raw.slice(Math.max(0, index - 20), Math.min(raw.length, index + region.length + 40)).trim()
  }
  for (const entity of draft.entities) {
    const phrase = entity.trim()
    if (phrase.length >= 4 && raw.toLowerCase().includes(phrase.toLowerCase())) {
      const index = raw.toLowerCase().indexOf(phrase.toLowerCase())
      return raw.slice(Math.max(0, index - 15), Math.min(raw.length, index + phrase.length + 35)).trim()
    }
  }
  const hazardLabel = hazard.replace(/_/g, ' ')
  if (raw.toLowerCase().includes(hazardLabel)) return raw.slice(0, 120)
  return raw.slice(0, 120)
}

/**
 * also_seen_elsewhere only when coverage names the same specific hazard (not a broad country disease
 * bulletin) and names the region or a hypothesis entity. Other overlaps go to background_coverage.
 */
export function noveltyFor(
  context: NoveltyContext,
  items: CoverageItem[],
): {
  novelty: 'only_us' | 'also_seen_elsewhere'
  match: NoveltyMatch | null
  matches: number
  background: BackgroundCoverageItem[]
} {
  const draft = { entities: context.entities, hazards: context.hazards, title: context.title ?? '' }
  const hits: Array<{ item: CoverageItem; hazard: Hazard }> = []
  const background: BackgroundCoverageItem[] = []
  for (const item of items) {
    const hazard = specificSharedHazard(context.hazards, item)
    if (!hazard) continue
    const text = item.title
    const span = matchedSpan(text, context.card, hazard, draft)
    if (!anchoredToHypothesis(text, context.card, draft)) {
      background.push({ source: item.source, title: item.title, url: item.url, hazard, matched_span: span })
      continue
    }
    hits.push({ item, hazard })
  }
  if (!hits.length) return { novelty: 'only_us', match: null, matches: 0, background }
  hits.sort((a, b) =>
    Number(b.item.region_match) - Number(a.item.region_match) ||
    SOURCE_PRIORITY[a.item.source] - SOURCE_PRIORITY[b.item.source] ||
    (b.item.date ?? '').localeCompare(a.item.date ?? ''),
  )
  const best = hits[0]
  const span = matchedSpan(best.item.title, context.card, best.hazard, draft)
  return {
    novelty: 'also_seen_elsewhere',
    matches: hits.length,
    background,
    match: {
      source: best.item.source,
      title: best.item.title,
      url: best.item.url,
      date: best.item.date,
      scope: best.item.region_match ? 'region' : 'country',
      hazard: best.hazard,
      matched_span: span,
    },
  }
}
