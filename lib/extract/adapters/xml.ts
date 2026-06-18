import 'server-only'

import { XMLParser } from 'fast-xml-parser'
import type { ExtractedContent, ExtractInput } from '@/lib/extract/types'

const MAX_TEXT_LENGTH = 20_000

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

/** Builds a failed result without throwing. */
function fail(sourceLabel: string, error: string): ExtractedContent {
  return {
    sourceType: 'xml',
    title: null,
    text: '',
    fetchedAt: new Date().toISOString(),
    sourceLabel,
    truncated: false,
    ok: false,
    error,
  }
}

/** Renders a scalar cell value; nested objects/arrays are JSON-stringified. */
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

/**
 * Converts a list of item objects into a markdown table using the union of
 * field names (first-seen order) as columns. Falls back to labeled lines when
 * items aren't uniform plain objects.
 */
function itemsToText(items: Record<string, unknown>[]): string {
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

  if (columns.length === 0) {
    return ''
  }

  const header = `| ${columns.join(' | ')} |`
  const divider = `| ${columns.map(() => '---').join(' | ')} |`
  const rows = items.map((item) => {
    const cells = columns.map((col) => renderCell(item[col]))
    return `| ${cells.join(' | ')} |`
  })

  return [header, divider, ...rows].join('\n')
}

/** Normalizes a value that may be a single object or an array into an array of objects. */
function toItemArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is Record<string, unknown> => v !== null && typeof v === 'object')
  }
  if (value !== null && typeof value === 'object') {
    return [value as Record<string, unknown>]
  }
  return []
}

/**
 * Parses a Korean public-data API (data.go.kr / KPX style) XML string into
 * ExtractedContent. Does NOT fetch — `input.value` is the full XML text.
 *
 * Detects dead/unregistered keys via the header resultCode: anything other
 * than '00' is returned as ok:false rather than parsed.
 *
 * Never throws — all failures come back as ExtractedContent with ok:false.
 */
export async function extractXml(input: ExtractInput): Promise<ExtractedContent> {
  const meta = input.meta ?? {}
  const sourceLabel = asString(meta.sourceLabel) ?? 'xml'
  const title = asString(meta.title)
  const fetchedAt = new Date().toISOString()

  if (typeof input.value !== 'string' || input.value.trim() === '') {
    return fail(sourceLabel, 'Empty XML input')
  }

  let parsed: Record<string, unknown>
  try {
    const parser = new XMLParser({
      ignoreAttributes: true,
      // Keep tag values as raw strings so codes like "00" are not coerced to 0.
      parseTagValue: false,
      trimValues: true,
    })
    parsed = parser.parse(input.value) as Record<string, unknown>
  } catch (e: unknown) {
    return fail(sourceLabel, `XML parse error: ${e instanceof Error ? e.message : 'unknown error'}`)
  }

  if (!parsed || typeof parsed !== 'object') {
    return fail(sourceLabel, 'XML did not parse into an object')
  }

  // Root is usually <response>, but tolerate the response fields being at top level.
  const root =
    parsed.response && typeof parsed.response === 'object'
      ? (parsed.response as Record<string, unknown>)
      : parsed

  const header =
    root.header && typeof root.header === 'object'
      ? (root.header as Record<string, unknown>)
      : null

  // resultCode lives under header for data.go.kr; tolerate it at root too.
  const resultCode =
    asString(header?.resultCode) ?? asString(root.resultCode)
  const resultMsg =
    asString(header?.resultMsg) ?? asString(root.resultMsg) ?? ''

  if (resultCode === null) {
    return fail(sourceLabel, 'Missing resultCode in XML header')
  }

  if (resultCode.trim() !== '00') {
    return fail(sourceLabel, `API error ${resultCode.trim()}: ${resultMsg || 'no message'}`)
  }

  const body =
    root.body && typeof root.body === 'object'
      ? (root.body as Record<string, unknown>)
      : root

  const itemsContainer =
    body.items && typeof body.items === 'object'
      ? (body.items as Record<string, unknown>)
      : null

  const items = toItemArray(itemsContainer ? itemsContainer.item : body.item)

  if (items.length === 0) {
    return fail(sourceLabel, 'No items found in XML body')
  }

  const fullText = itemsToText(items)
  if (fullText.trim() === '') {
    return fail(sourceLabel, 'Items contained no readable fields')
  }

  const truncated = fullText.length > MAX_TEXT_LENGTH
  const text = truncated ? fullText.slice(0, MAX_TEXT_LENGTH) : fullText

  return {
    sourceType: 'xml',
    title,
    text,
    fetchedAt,
    sourceLabel,
    truncated,
    ok: true,
  }
}
