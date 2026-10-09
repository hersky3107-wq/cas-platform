export interface SearchItem {
  title: string
  url: string
  published: string
  past: boolean
  source: string
}

const PAST_MS = 14 * 24 * 60 * 60 * 1000

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
    items.push({
      title: past ? `[past] ${title.replace(/^\[past\]\s*/, '')}` : title,
      url,
      published,
      past,
      source,
    })
  }
  return items
}
