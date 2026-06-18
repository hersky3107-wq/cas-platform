import 'server-only'

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { PDFParse } from 'pdf-parse'
import type { ExtractedContent, ExtractInput } from '@/lib/extract/types'

const MAX_TEXT_LENGTH = 20_000
/**
 * PDFs with fewer extractable characters than this threshold are considered
 * scanned/image-based and returned as ok:false. Avoids silently feeding
 * empty content to AI modules.
 */
const MIN_EXTRACTABLE_CHARS = 20

/** Builds a failed result without throwing. */
function fail(sourceLabel: string, error: string): ExtractedContent {
  return {
    sourceType: 'pdf',
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
 * Extracts text from a local PDF file path.
 *
 * `input.value` must be an absolute or CWD-relative file path saved by the
 * upload pipeline. This adapter does NOT fetch URLs — a separate adapter
 * handles HTTP fetching.
 *
 * Returns ok:false (never throws) for: file-not-found, corrupt PDFs,
 * encrypted PDFs, parse errors, and scanned/image-based PDFs with no
 * extractable text.
 */
export async function extractPdf(input: ExtractInput): Promise<ExtractedContent> {
  const filePath = input.value
  if (!filePath || typeof filePath !== 'string' || filePath.trim() === '') {
    const label = 'pdf'
    return fail(label, 'Empty file path')
  }

  const sourceLabel = path.basename(filePath)
  const fetchedAt = new Date().toISOString()

  // Read file bytes — surface a clear error for missing/unreadable files.
  let buffer: Buffer
  try {
    buffer = await readFile(filePath)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown error'
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return fail(sourceLabel, `File not found: ${filePath}`)
    }
    return fail(sourceLabel, `Could not read file: ${msg}`)
  }

  // Parse the PDF.
  let textResult: Awaited<ReturnType<InstanceType<typeof PDFParse>['getText']>>
  let infoResult: Awaited<ReturnType<InstanceType<typeof PDFParse>['getInfo']>> | null = null
  try {
    const parser = new PDFParse({ data: new Uint8Array(buffer) })
    textResult = await parser.getText()
    try {
      infoResult = await parser.getInfo()
    } catch {
      // Info is optional — ignore failures here.
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown error'
    // PasswordException and InvalidPDFException both surface here.
    if (/password/i.test(msg)) {
      return fail(sourceLabel, 'PDF is password-protected (encrypted PDFs are not supported)')
    }
    return fail(sourceLabel, `PDF parse error: ${msg}`)
  }

  const fullText = (textResult.text ?? '').replace(/\r/g, '').trim()

  // Detect scanned/image-based PDFs that yield no usable text.
  if (fullText.length < MIN_EXTRACTABLE_CHARS) {
    return fail(
      sourceLabel,
      'no extractable text — PDF may be scanned/image-based (OCR not supported)'
    )
  }

  // Best-effort title: PDF metadata title → filename without extension.
  const metaTitle: string | null =
    typeof infoResult?.info?.Title === 'string' && infoResult.info.Title.trim()
      ? infoResult.info.Title.trim()
      : null
  const title =
    metaTitle ?? (path.basename(filePath, path.extname(filePath)).trim() || null)

  const truncated = fullText.length > MAX_TEXT_LENGTH
  const text = truncated ? fullText.slice(0, MAX_TEXT_LENGTH) : fullText

  return {
    sourceType: 'pdf',
    title,
    text,
    fetchedAt,
    sourceLabel,
    truncated,
    ok: true,
  }
}
