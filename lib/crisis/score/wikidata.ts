import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

export interface WikiYearCache {
  [title: string]: { year: number | null }
}

const CACHE_PATH = path.resolve(process.cwd(), 'data', 'crisis', 'wiki-wikidata-cache.json')

export function loadWikiYearCache(): WikiYearCache {
  try {
    const parsed = JSON.parse(readFileSync(CACHE_PATH, 'utf8')) as WikiYearCache
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function saveWikiYearCache(cache: WikiYearCache): void {
  mkdirSync(path.dirname(CACHE_PATH), { recursive: true })
  writeFileSync(CACHE_PATH, JSON.stringify(cache))
}

/** Wikidata time values look like +1346-00-00T00:00:00Z. */
export function wikidataYear(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null
  const time = (value as { time?: unknown }).time
  if (typeof time !== 'string') return null
  const match = /^([+-]?\d{1,6})/.exec(time)
  if (!match) return null
  const year = Number(match[1])
  return Number.isFinite(year) ? year : null
}

export function claimYear(claims: unknown): number | null {
  if (!claims || typeof claims !== 'object') return null
  const bag = claims as Record<string, unknown>
  for (const prop of ['P580', 'P585']) {
    const rows = bag[prop]
    if (!Array.isArray(rows) || !rows.length) continue
    const snak = (rows[0] as { mainsnak?: { datavalue?: { value?: unknown } } })?.mainsnak
    const year = wikidataYear(snak?.datavalue?.value)
    if (year != null) return year
  }
  return null
}

export function eventIsOlderThan(year: number | null, nowYear: number, gapYears = 2): boolean {
  if (year == null) return false
  return year < nowYear - gapYears
}

interface SearchHit {
  id?: string
}

export async function lookupWikiEventYear(
  title: string,
  cache: WikiYearCache,
  fetchJson: (url: string) => Promise<unknown>,
): Promise<number | null> {
  if (Object.prototype.hasOwnProperty.call(cache, title)) return cache[title].year
  const searchUrl =
    'https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&limit=1&language=en&search=' +
    encodeURIComponent(title)
  const search = await fetchJson(searchUrl) as { search?: SearchHit[] }
  const id = search.search?.[0]?.id
  if (!id) {
    cache[title] = { year: null }
    return null
  }
  const entityUrl =
    `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=${encodeURIComponent(id)}`
  const entity = await fetchJson(entityUrl) as { entities?: Record<string, { claims?: unknown }> }
  const year = claimYear(entity.entities?.[id]?.claims)
  cache[title] = { year }
  return year
}
