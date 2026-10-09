export interface SearchItem {
  title: string
  url: string
  published: string
  past: boolean
  source: string
  snippet?: string
  /** The API gave no date; published is the fetch day and cannot count as recent coverage. */
  undated?: true
}

type CitationRecord = { title: string; url: string; published: string; snippet?: string; undated?: true }

const PAST_MS = 14 * 24 * 60 * 60 * 1000
const DEFAULT_SNIPPET = 300

function hostnameTitle(url: string): string {
  try {
    const parsed = new URL(url)
    const slug = parsed.pathname
      .split('/')
      .map((part) => decodeURIComponent(part).replace(/\.(html?|php|aspx?)$/i, ''))
      .filter((part) => /[a-z]{3}/i.test(part) && /[-_]/.test(part))
      .sort((a, b) => b.length - a.length)[0]
    const words = slug?.split(/[-_]+/).filter((word) => /[a-z]/i.test(word)) ?? []
    if (words.length >= 3) return words.join(' ').slice(0, 160)
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return url.slice(0, 80)
  }
}

/** News urls often carry the date: /2025/12/18/ or /2025-12-18-. */
export function urlDate(url: string): string {
  const match = /\/(20\d{2})[/-](\d{1,2})[/-](\d{1,2})(?=[/-]|$)/.exec(url)
  if (!match) return ''
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (month < 1 || month > 12 || day < 1 || day > 31) return ''
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Grok annotations carry the citation marker ("1", "[2]") as the title. */
function realTitle(title: string): string {
  return /^\[?\d{1,3}\]?$/.test(title.trim()) ? '' : title
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
): CitationRecord[] {
  const items: CitationRecord[] = []
  const seen = new Map<string, { item: CitationRecord; titled: boolean; dated: boolean }>()
  const today = now.toISOString().slice(0, 10)
  const push = (url: string, rawTitle: string, apiDate: string, snippet?: string) => {
    if (!url) return
    const title = realTitle(rawTitle)
    const published = apiDate || urlDate(url)
    const known = seen.get(url)
    if (known) {
      if (title && !known.titled) {
        known.item.title = title
        known.titled = true
      }
      if (published && !known.dated) {
        known.item.published = published
        delete known.item.undated
        known.dated = true
      }
      if (snippet && !known.item.snippet) known.item.snippet = clip(snippet, snippetMax)
      return
    }
    if (items.length >= max) return
    const item: CitationRecord = {
      url,
      title: title || hostnameTitle(url),
      published: published || today,
      snippet: clip(snippet, snippetMax),
    }
    if (!published) item.undated = true
    seen.set(url, { item, titled: Boolean(title), dated: Boolean(published) })
    items.push(item)
  }
  const walk = (value: unknown): void => {
    if (!value || items.length >= max) return
    if (typeof value === 'string') {
      if (/^https?:\/\//i.test(value)) push(value, '', '')
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
      ...(record.undated === true ? { undated: true as const } : {}),
    })
  }
  return items
}
