import 'server-only'

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import type { ExtractedContent, ExtractInput } from '@/lib/extract/types'

const MAX_TEXT_LENGTH = 20_000
const MAX_ROWS_PER_SHEET = 100

/** Builds a failed result without throwing. */
function fail(sourceLabel: string, error: string): ExtractedContent {
  return {
    sourceType: 'xlsx',
    title: null,
    text: '',
    fetchedAt: new Date().toISOString(),
    sourceLabel,
    truncated: false,
    ok: false,
    error,
  }
}

/** Formats a cell value for use in a markdown table cell. */
function mdCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    // ExcelJS rich-text objects expose a .richText array
    const rt = (value as { richText?: Array<{ text?: unknown }> }).richText
    if (Array.isArray(rt)) {
      return rt
        .map((r) => String(r.text ?? ''))
        .join('')
        .replace(/\r?\n/g, ' ')
        .replace(/\|/g, '\\|')
        .trim()
    }
    try {
      return JSON.stringify(value).replace(/\|/g, '\\|')
    } catch {
      return ''
    }
  }
  return String(value).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
}

/**
 * Converts one worksheet's rows into a markdown table with a `### Name` heading.
 * ExcelJS row.values is 1-indexed sparse; index 0 is always undefined.
 */
function sheetToMarkdown(
  sheetName: string,
  rows: ExcelJS.Row[],
  colCount: number
): string | null {
  const nonEmpty = rows.filter((r) => r.hasValues)
  if (nonEmpty.length < 2) return null // need at least a header + 1 data row

  const headerRow = nonEmpty[0]
  const dataRows = nonEmpty.slice(1)

  const headers = Array.from({ length: colCount }, (_, i) => {
    const v = (headerRow.values as ExcelJS.CellValue[])[i + 1]
    const h = mdCell(v)
    return h !== '' ? h : `col${i + 1}`
  })

  const headerLine = `| ${headers.join(' | ')} |`
  const divider = `| ${headers.map(() => '---').join(' | ')} |`

  const rendered = dataRows.slice(0, MAX_ROWS_PER_SHEET)
  const rowLines = rendered.map((r) => {
    const cells = Array.from({ length: colCount }, (_, i) =>
      mdCell((r.values as ExcelJS.CellValue[])[i + 1])
    )
    return `| ${cells.join(' | ')} |`
  })

  const lines = [`### ${sheetName}`, '', headerLine, divider, ...rowLines]

  const omitted = dataRows.length - rendered.length
  if (omitted > 0) {
    lines.push(
      `\n... and ${omitted} more row${omitted === 1 ? '' : 's'} (${dataRows.length} data rows total).`
    )
  }

  return lines.join('\n')
}

/**
 * Extracts a readable markdown-table representation from a local .xlsx/.xls file.
 *
 * Each non-empty worksheet becomes a `### SheetName` heading + table, capped at
 * MAX_ROWS_PER_SHEET data rows with a "… and N more rows" note when exceeded.
 * Overall text is truncated at MAX_TEXT_LENGTH with the `truncated` flag set.
 *
 * Returns ok:false (never throws) for file-not-found, unreadable files, parse
 * errors, and workbooks with no sheets or no data.
 */
export async function extractXlsx(input: ExtractInput): Promise<ExtractedContent> {
  const filePath = input.value
  if (!filePath || typeof filePath !== 'string' || filePath.trim() === '') {
    return fail('xlsx', 'Empty file path')
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

  let workbook: ExcelJS.Workbook
  try {
    workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer.buffer as ArrayBuffer)
  } catch (e: unknown) {
    return fail(sourceLabel, `XLSX parse error: ${e instanceof Error ? e.message : 'unknown error'}`)
  }

  const sheets = workbook.worksheets
  if (!sheets || sheets.length === 0) {
    return fail(sourceLabel, 'Workbook has no sheets')
  }

  const sections: string[] = []
  for (const sheet of sheets) {
    const rows: ExcelJS.Row[] = []
    sheet.eachRow((row) => rows.push(row))
    const colCount = sheet.columnCount || 0
    if (colCount === 0) continue
    const md = sheetToMarkdown(sheet.name, rows, colCount)
    if (md) sections.push(md)
  }

  if (sections.length === 0) {
    return fail(sourceLabel, 'No data found in any sheet')
  }

  const fullText = sections.join('\n\n')
  const truncated = fullText.length > MAX_TEXT_LENGTH
  const text = truncated ? fullText.slice(0, MAX_TEXT_LENGTH) : fullText

  return {
    sourceType: 'xlsx',
    title,
    text,
    fetchedAt,
    sourceLabel,
    truncated,
    ok: true,
  }
}
