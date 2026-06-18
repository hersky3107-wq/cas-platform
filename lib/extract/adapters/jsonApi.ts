import 'server-only'

import { extractCsv } from '@/lib/extract/adapters/csv'
import { extractXml } from '@/lib/extract/adapters/xml'
import type { ExtractedContent, ExtractInput } from '@/lib/extract/types'

const MAX_TEXT_LENGTH = 20_000
const FETCH_TIMEOUT_MS = 10_000

type ApiFormat = 'json' | 'xml' | 'csv'

/** Builds a failed result without throwing. */
function fail(sourceLabel: string, error: string): ExtractedContent {
  return {
    sourceType: 'json-api',
    title: null,
    text: '',
    fetchedAt: new Date().toISOString(),
    sourceLabel,
    truncated: false,
    ok: false,
    error,
  }
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function renderCell(value: unknown): string {
  const scalar = asString(value)
  if (scalar !== null) return scalar.replace(/\s+/g, ' ').trim()
  if (value === null || value === undefined) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

/** Renders an array of row objects into a markdown table (union of keys, first-seen order). */
function itemsToTable(items: Record<string, unknown>[]): string {
  const columns: string[] = []
  const seen = new Set<string>()
  for (const item of items) {
    for (const key of Object.keys(item)) {
      if (!seen.has(key)) {
        seen.add(key)
        columns.push(key)
      }
    }
  }
  if (columns.length === 0) return ''

  const header = `| ${columns.join(' | ')} |`
  const divider = `| ${columns.map(() => '---').join(' | ')} |`
  const rows = items.map(
    (item) => `| ${columns.map((c) => renderCell(item[c])).join(' | ')} |`
  )
  return [header, divider, ...rows].join('\n')
}

/** Recursively searches a parsed JSON value for the first array of objects (items/rows). */
function findItemsArray(value: unknown, depth = 0): Record<string, unknown>[] | null {
  if (depth > 6 || value === null || typeof value !== 'object') return null

  if (Array.isArray(value)) {
    const objs = value.filter(
      (v): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
    )
    return objs.length > 0 ? objs : null
  }

  const obj = value as Record<string, unknown>
  // Prefer common container keys first.
  const preferredKeys = ['items', 'item', 'rows', 'row', 'data', 'list', 'records', 'results']
  for (const key of preferredKeys) {
    if (key in obj) {
      const found = findItemsArray(obj[key], depth + 1)
      if (found) return found
    }
  }
  for (const key of Object.keys(obj)) {
    const found = findItemsArray(obj[key], depth + 1)
    if (found) return found
  }
  return null
}

function buildResult(
  text: string,
  title: string | null,
  sourceLabel: string,
  fetchedAt: string
): ExtractedContent {
  const truncated = text.length > MAX_TEXT_LENGTH
  return {
    sourceType: 'json-api',
    title,
    text: truncated ? text.slice(0, MAX_TEXT_LENGTH) : text,
    fetchedAt,
    sourceLabel,
    truncated,
    ok: true,
  }
}

function sniffFormat(contentType: string, body: string): ApiFormat {
  const ct = contentType.toLowerCase()
  if (ct.includes('json')) return 'json'
  if (ct.includes('xml')) return 'xml'
  if (ct.includes('csv')) return 'csv'

  const firstChar = body.trimStart()[0]
  if (firstChar === '{' || firstChar === '[') return 'json'
  if (firstChar === '<') return 'xml'
  return 'json'
}

/**
 * Fetching layer for external public-data APIs (KPX, KAMIS, data.go.kr, etc).
 *
 * Fetches `input.value` server-side, determines the response format
 * (meta.format → Content-Type → body sniff), and routes into the right parser:
 *   - xml  → extractXml (reuses resultCode-00 handling for Korean public APIs)
 *   - csv  → extractCsv (raw mode)
 *   - json → markdown table when an items/rows array is found, else pretty JSON
 *
 * Never throws — network errors, timeouts, non-200, and parse failures all
 * return ExtractedContent with ok:false.
 */
export async function extractJsonApi(input: ExtractInput): Promise<ExtractedContent> {
  const meta = input.meta ?? {}
  const sourceLabel = asString(meta.sourceLabel) ?? input.value
  const title = asString(meta.title)
  const fetchedAt = new Date().toISOString()
  const formatHint = asString(meta.format) as ApiFormat | null

  let url: URL
  try {
    url = new URL(input.value)
  } catch {
    return fail(sourceLabel, `Invalid URL: ${input.value}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return fail(sourceLabel, `Unsupported protocol: ${url.protocol}`)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AIMANI-Extractor/1.0)',
        Accept: 'application/json,text/xml,application/xml,text/csv,*/*;q=0.8',
      },
    })
  } catch (e: unknown) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    return fail(
      sourceLabel,
      aborted
        ? `Request timed out after ${FETCH_TIMEOUT_MS}ms`
        : `Network error: ${e instanceof Error ? e.message : 'unknown error'}`
    )
  } finally {
    clearTimeout(timeout)
  }

  if (!res.ok) {
    return fail(sourceLabel, `Fetch failed: HTTP ${res.status} ${res.statusText}`.trim())
  }

  let raw: string
  try {
    raw = await res.text()
  } catch (e: unknown) {
    return fail(
      sourceLabel,
      `Could not read response body: ${e instanceof Error ? e.message : 'unknown error'}`
    )
  }

  if (raw.trim() === '') {
    return fail(sourceLabel, 'Empty response body')
  }

  const contentType = res.headers.get('content-type') ?? ''
  const format: ApiFormat = formatHint ?? sniffFormat(contentType, raw)

  // Delegate XML/CSV to the existing parsers, then re-stamp as json-api origin.
  if (format === 'xml') {
    const delegated = await extractXml({ type: 'xml', value: raw, meta: input.meta })
    return { ...delegated, sourceType: 'json-api' }
  }

  if (format === 'csv') {
    const delegated = await extractCsv({
      type: 'csv',
      value: raw,
      meta: { ...meta, raw: true },
    })
    return { ...delegated, sourceType: 'json-api' }
  }

  // JSON.
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e: unknown) {
    return fail(sourceLabel, `JSON parse error: ${e instanceof Error ? e.message : 'unknown error'}`)
  }

  const items = findItemsArray(parsed)
  if (items && items.length > 0) {
    const table = itemsToTable(items)
    if (table.trim() !== '') {
      return buildResult(table, title, sourceLabel, fetchedAt)
    }
  }

  // Fall back to pretty-printed JSON.
  let pretty: string
  try {
    pretty = JSON.stringify(parsed, null, 2)
  } catch {
    pretty = raw
  }
  return buildResult(pretty.trim(), title, sourceLabel, fetchedAt)
}
