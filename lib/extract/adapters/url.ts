import 'server-only'

import type { ExtractedContent, ExtractInput } from '@/lib/extract/types'

const MAX_TEXT_LENGTH = 20_000
const FETCH_TIMEOUT_MS = 10_000

/** Builds a failed result without throwing. */
function fail(sourceLabel: string, error: string): ExtractedContent {
  return {
    sourceType: 'url',
    title: null,
    text: '',
    fetchedAt: new Date().toISOString(),
    sourceLabel,
    truncated: false,
    ok: false,
    error,
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/** Decodes a small set of common HTML entities plus numeric references. */
function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X'
      const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10)
      if (Number.isFinite(code) && code > 0) {
        try {
          return String.fromCodePoint(code)
        } catch {
          return match
        }
      }
      return match
    }
    const named = NAMED_ENTITIES[body.toLowerCase()]
    return named ?? match
  })
}

/** Extracts the document title from <title> or the first <h1>, if present. */
function extractTitle(html: string): string | null {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (titleMatch) {
    const title = decodeEntities(titleMatch[1]).replace(/\s+/g, ' ').trim()
    if (title) return title
  }

  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  if (h1Match) {
    const title = decodeEntities(h1Match[1].replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim()
    if (title) return title
  }

  return null
}

/**
 * Strips non-content markup (scripts, styles, nav, etc.) and converts the
 * remaining HTML to plain text. Dependency-light and best-effort by design.
 */
function htmlToText(html: string): string {
  let out = html

  // Drop entire non-content elements including their contents.
  out = out.replace(
    /<(script|style|noscript|template|svg|head|nav|header|footer|aside|form|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi,
    ' '
  )

  // Comments.
  out = out.replace(/<!--[\s\S]*?-->/g, ' ')

  // Treat block-level boundaries as line breaks for readability.
  out = out.replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote)>/gi, '\n')
  out = out.replace(/<br\s*\/?>/gi, '\n')

  // Remove all remaining tags.
  out = out.replace(/<[^>]+>/g, ' ')

  out = decodeEntities(out)

  // Normalize whitespace: collapse runs of spaces/tabs, cap consecutive blank lines.
  out = out
    .replace(/\r/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return out
}

/**
 * Fetches a URL server-side and extracts the main readable text.
 * Never throws: network errors, non-200 responses, and timeouts all come back
 * as an `ExtractedContent` with `ok: false`.
 */
export async function extractUrl(input: ExtractInput): Promise<ExtractedContent> {
  const sourceLabel = input.value
  const fetchedAt = new Date().toISOString()

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
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
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
    return fail(sourceLabel, `Could not read response body: ${e instanceof Error ? e.message : 'unknown error'}`)
  }

  const contentType = res.headers.get('content-type') ?? ''
  const isHtml = contentType.includes('html') || /<html[\s>]/i.test(raw)

  const title = isHtml ? extractTitle(raw) : null
  const fullText = isHtml ? htmlToText(raw) : raw.replace(/\r/g, '').trim()

  const truncated = fullText.length > MAX_TEXT_LENGTH
  const text = truncated ? fullText.slice(0, MAX_TEXT_LENGTH) : fullText

  return {
    sourceType: 'url',
    title,
    text,
    fetchedAt,
    sourceLabel,
    truncated,
    ok: true,
  }
}
