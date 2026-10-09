export interface SearchItem {
  title: string
  url: string
  published: string
  past: boolean
  source: string
  snippet?: string
}

const PAST_MS = 14 * 24 * 60 * 60 * 1000
const DEFAULT_SNIPPET = 300

function hostnameTitle(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url.slice(0, 80)
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function pickString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function clip(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined
  return value.length <= max ? value : value.slice(0, max)
}

/** Flatten citations / search_results / annotations into url/title/date/snippet rows. */
export function citationRecords(
  sources: unknown[],
  now: Date = new Date(),
  max = 8,
  snippetMax = DEFAULT_SNIPPET,
): Array<{ title: string; url: string; published: string; snippet?: string }> {
  const items: Array<{ title: string; url: string; published: string; snippet?: string }> = []
  const seen = new Set<string>()
  const today = now.toISOString().slice(0, 10)
  const push = (url: string, title: string, published: string, snippet?: string) => {
    if (!url || seen.has(url) || items.length >= max) return
    seen.add(url)
    items.push({
      url,
      title: title || hostnameTitle(url),
      published: published || today,
      snippet: clip(snippet, snippetMax),
    })
  }
  const walk = (value: unknown): void => {
    if (!value || items.length >= max) return
    if (typeof value === 'string') {
      if (/^https?:\/\//i.test(value)) push(value, '', today)
      return
    }
    if (Array.isArray(value)) {
      for (const row of value) walk(row)
      return
    }
    const record = asRecord(value)
    if (!record) return
    const url = pickString(record, ['url', 'link', 'uri', 'href'])
    const title = pickString(record, ['title', 'name', 'headline'])
    const published = pickString(record, ['published', 'date', 'published_date', 'publishedAt', 'last_updated'])
    const snippet = pickString(record, ['snippet', 'text', 'excerpt', 'description'])
    if (url) push(url, title, published, snippet)
    if (record.citations) walk(record.citations)
    if (record.search_results) walk(record.search_results)
    if (record.annotations) walk(record.annotations)
    if (record.results) walk(record.results)
    if (record.url_citation) walk(record.url_citation)
  }
  for (const source of sources) walk(source)
  return items
}

export function normalizeSearchItems(raw: unknown, source: string, now: Date): SearchItem[] {
  const rows = Array.isArray(raw) ? raw : []
  const items: SearchItem[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const record = row as Record<string, unknown>
    const url = typeof record.url === 'string' ? record.url.trim() : ''
    const published = typeof record.published === 'string' ? record.published.trim() : ''
    const title = typeof record.title === 'string' ? record.title.trim() : ''
    if (!url || !published || !title) continue
    const parsed = Date.parse(published)
    if (!Number.isFinite(parsed)) continue
    const past = now.getTime() - parsed > PAST_MS
    const snippet = typeof record.snippet === 'string' ? clip(record.snippet, DEFAULT_SNIPPET) : undefined
    items.push({
      title: past ? `[past] ${title.replace(/^\[past\]\s*/, '')}` : title,
      url,
      published,
      past,
      source,
      snippet,
    })
  }
  return items
}
