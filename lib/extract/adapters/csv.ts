import 'server-only'

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import Papa from 'papaparse'
import type { ExtractedContent, ExtractInput } from '@/lib/extract/types'

const MAX_TEXT_LENGTH = 20_000
const MAX_RENDERED_ROWS = 100

/** Builds a failed result without throwing. */
function fail(sourceLabel: string, error: string): ExtractedContent {
  return {
    sourceType: 'csv',
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
 * Escapes pipe characters inside a cell so they don't break the markdown table.
 * Also collapses internal newlines to a space for readability.
 */
function mdCell(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
}

/**
 * Renders a header row + data rows as a GitHub-flavoured markdown table.
 * Caps at MAX_RENDERED_ROWS data rows; appends a note when there are more.
 */
function rowsToMarkdownTable(
  headers: string[],
  dataRows: string[][],
  totalDataRows: number
): string {
  const headerLine = `| ${headers.map(mdCell).join(' | ')} |`
  const divider = `| ${headers.map(() => '---').join(' | ')} |`

  const rendered = dataRows.slice(0, MAX_RENDERED_ROWS)
  const rowLines = rendered.map(
    (row) => `| ${headers.map((_, i) => mdCell(row[i] ?? '')).join(' | ')} |`
  )

  const lines: string[] = [headerLine, divider, ...rowLines]

  const omitted = totalDataRows - rendered.length
  if (omitted > 0) {
    lines.push(`\n... and ${omitted} more row${omitted === 1 ? '' : 's'} (${totalDataRows} total).`)
  }

  return lines.join('\n')
}

/**
 * Parses CSV or TSV content (raw string or local file path) into ExtractedContent.
 *
 * - Pass `input.meta.raw = true` to treat `input.value` as raw CSV/TSV text.
 * - Otherwise `input.value` is treated as a local file path read with fs/promises.
 *
 * Auto-detects delimiter (comma vs tab). Uses the first row as headers when it
 * does not look like purely numeric data.
 *
 * Never throws — empty files, missing files, and unparseable content all return
 * ok:false with a clear error.
 */
export async function extractCsv(input: ExtractInput): Promise<ExtractedContent> {
  const isRaw = input.meta?.raw === true
  const fetchedAt = new Date().toISOString()

  let rawText: string
  let sourceLabel: string
  let titleFromPath: string | null = null

  if (isRaw) {
    rawText = input.value
    sourceLabel = typeof input.meta?.sourceLabel === 'string' ? input.meta.sourceLabel : 'csv'
    titleFromPath = typeof input.meta?.title === 'string' ? input.meta.title : null
  } else {
    const filePath = input.value
    if (!filePath || typeof filePath !== 'string' || filePath.trim() === '') {
      return fail('csv', 'Empty file path')
    }
    sourceLabel = path.basename(filePath)
    titleFromPath = path.basename(filePath, path.extname(filePath)).trim() || null

    try {
      const buf = await readFile(filePath)
      rawText = buf.toString('utf8')
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException).code
      const msg = e instanceof Error ? e.message : 'unknown error'
      if (code === 'ENOENT') return fail(sourceLabel, `File not found: ${filePath}`)
      return fail(sourceLabel, `Could not read file: ${msg}`)
    }
  }

  if (!rawText || rawText.trim() === '') {
    return fail(sourceLabel, 'Empty CSV content')
  }

  // Auto-detect delimiter: prefer tab if there are more tabs per line than commas.
  const firstLine = rawText.split(/\r?\n/)[0] ?? ''
  const tabCount = (firstLine.match(/\t/g) ?? []).length
  const commaCount = (firstLine.match(/,/g) ?? []).length
  const delimiter = tabCount > commaCount ? '\t' : ','

  let parseResult: Papa.ParseResult<string[]>
  try {
    parseResult = Papa.parse<string[]>(rawText, {
      delimiter,
      skipEmptyLines: true,
      header: false,
    })
  } catch (e: unknown) {
    return fail(sourceLabel, `CSV parse error: ${e instanceof Error ? e.message : 'unknown error'}`)
  }

  if (parseResult.errors.length > 0 && parseResult.data.length === 0) {
    const firstErr = parseResult.errors[0]
    return fail(sourceLabel, `CSV parse error: ${firstErr?.message ?? 'unknown'}`)
  }

  const rows = parseResult.data
  if (rows.length === 0) {
    return fail(sourceLabel, 'No rows found in CSV')
  }

  const headerRow = rows[0]
  if (!headerRow || headerRow.length === 0) {
    return fail(sourceLabel, 'No columns found in CSV header row')
  }

  const dataRows = rows.slice(1)
  if (dataRows.length === 0) {
    return fail(sourceLabel, 'CSV has a header row but no data rows')
  }

  const fullText = rowsToMarkdownTable(headerRow, dataRows, dataRows.length)

  const truncated = fullText.length > MAX_TEXT_LENGTH
  const text = truncated ? fullText.slice(0, MAX_TEXT_LENGTH) : fullText

  return {
    sourceType: 'csv',
    title: titleFromPath,
    text,
    fetchedAt,
    sourceLabel,
    truncated,
    ok: true,
  }
}
