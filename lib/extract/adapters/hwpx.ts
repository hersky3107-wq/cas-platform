import 'server-only'

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import type { ExtractedContent, ExtractInput } from '@/lib/extract/types'

const MAX_TEXT_LENGTH = 20_000
const MIN_EXTRACTABLE_CHARS = 20

/** Builds a failed result without throwing. */
function fail(sourceLabel: string, error: string): ExtractedContent {
  return {
    sourceType: 'hwpx',
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
    return NAMED_ENTITIES[body.toLowerCase()] ?? match
  })
}

/**
 * Extracts paragraph text from a single HWPX section XML string.
 * Text lives in <hp:t> elements; paragraph boundaries are <hp:p>.
 */
function textFromSectionXml(xml: string): string {
  const parts: string[] = []
  let current = ''
  // Match either an <hp:t> text run or a paragraph close tag, in document order.
  const re = /<hp:t[^>]*>([\s\S]*?)<\/hp:t>|<\/hp:p>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    if (m[1] !== undefined) {
      current += decodeEntities(m[1])
    } else {
      parts.push(current)
      current = ''
    }
  }
  if (current) parts.push(current)

  return parts
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p !== '')
    .join('\n')
}

/** Sorts section file names by their numeric suffix (section0, section1, ...). */
function sectionSortKey(name: string): number {
  const match = name.match(/section(\d+)\.xml$/i)
  return match ? parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER
}

/**
 * Extracts text from a local HWPX file (modern XML-based zip format).
 *
 * Legacy binary .hwp (an OLE compound file, not a zip) is explicitly rejected.
 * Returns ok:false (never throws) for file-not-found, unreadable files, legacy
 * binary HWP, corrupt archives, and documents with no extractable text.
 */
export async function extractHwpx(input: ExtractInput): Promise<ExtractedContent> {
  const filePath = input.value
  if (!filePath || typeof filePath !== 'string' || filePath.trim() === '') {
    return fail('hwpx', 'Empty file path')
  }

  const sourceLabel = path.basename(filePath)
  const title = path.basename(filePath, path.extname(filePath)).trim() || null
  const fetchedAt = new Date().toISOString()

  let buffer: Buffer
  try {
    buffer = await readFile(filePath)
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code
    const msg = e instanceof Error ? e.message : 'unknown error'
    if (code === 'ENOENT') return fail(sourceLabel, `File not found: ${filePath}`)
    return fail(sourceLabel, `Could not read file: ${msg}`)
  }

  // A valid zip (HWPX) begins with the "PK" local-file-header signature.
  // Legacy binary .hwp is an OLE compound file (magic D0 CF 11 E0) — reject it.
  const isZip = buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b
  if (!isZip) {
    return fail(
      sourceLabel,
      'legacy .hwp binary not supported — please convert to HWPX or PDF'
    )
  }

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    return fail(
      sourceLabel,
      'legacy .hwp binary not supported — please convert to HWPX or PDF'
    )
  }

  const sectionNames = Object.keys(zip.files)
    .filter((name) => /Contents\/section\d+\.xml$/i.test(name))
    .sort((a, b) => sectionSortKey(a) - sectionSortKey(b))

  if (sectionNames.length === 0) {
    return fail(sourceLabel, 'No section XML found — not a valid HWPX document')
  }

  const chunks: string[] = []
  try {
    for (const name of sectionNames) {
      const file = zip.file(name)
      if (!file) continue
      const xml = await file.async('string')
      const sectionText = textFromSectionXml(xml)
      if (sectionText) chunks.push(sectionText)
    }
  } catch (e: unknown) {
    return fail(sourceLabel, `HWPX parse error: ${e instanceof Error ? e.message : 'unknown error'}`)
  }

  const fullText = chunks.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  if (fullText.length < MIN_EXTRACTABLE_CHARS) {
    return fail(sourceLabel, 'no extractable text')
  }

  const truncated = fullText.length > MAX_TEXT_LENGTH
  const text = truncated ? fullText.slice(0, MAX_TEXT_LENGTH) : fullText

  return {
    sourceType: 'hwpx',
    title,
    text,
    fetchedAt,
    sourceLabel,
    truncated,
    ok: true,
  }
}
