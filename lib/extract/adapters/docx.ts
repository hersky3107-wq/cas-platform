import 'server-only'

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import mammoth from 'mammoth'
import type { ExtractedContent, ExtractInput } from '@/lib/extract/types'

const MAX_TEXT_LENGTH = 20_000
const MIN_EXTRACTABLE_CHARS = 20

/** Builds a failed result without throwing. */
function fail(sourceLabel: string, error: string): ExtractedContent {
  return {
    sourceType: 'docx',
    title: null,
    text: '',
    fetchedAt: new Date().toISOString(),
    sourceLabel,
    truncated: false,
    ok: false,
    error,
  }
}

/**
 * Extracts plain text from a local .docx file path using mammoth.
 *
 * Returns ok:false (never throws) for file-not-found, unreadable files,
 * parse errors, and documents with no extractable text.
 */
export async function extractDocx(input: ExtractInput): Promise<ExtractedContent> {
  const filePath = input.value
  if (!filePath || typeof filePath !== 'string' || filePath.trim() === '') {
    return fail('docx', 'Empty file path')
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

  let raw: string
  try {
    const result = await mammoth.extractRawText({ buffer })
    raw = result.value ?? ''
  } catch (e: unknown) {
    return fail(sourceLabel, `DOCX parse error: ${e instanceof Error ? e.message : 'unknown error'}`)
  }

  const fullText = raw.replace(/\r/g, '').trim()
  if (fullText.length < MIN_EXTRACTABLE_CHARS) {
    return fail(sourceLabel, 'no extractable text')
  }

  const truncated = fullText.length > MAX_TEXT_LENGTH
  const text = truncated ? fullText.slice(0, MAX_TEXT_LENGTH) : fullText

  return {
    sourceType: 'docx',
    title,
    text,
    fetchedAt,
    sourceLabel,
    truncated,
    ok: true,
  }
}
