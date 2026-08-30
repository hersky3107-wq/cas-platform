import 'server-only'

import ExcelJS from 'exceljs'
import Papa from 'papaparse'

/**
 * Read a POS/hand-kept spreadsheet into a rectangular cell grid.
 * Uses the repo's exceljs + papaparse. Does not use the extract adapters
 * (those cap at 100 rows and emit markdown for a different pipeline).
 */

export const SPREADSHEET_MAX_DATA_ROWS = 300

export type SpreadsheetExt = 'csv' | 'xlsx' | 'xls'

export type SheetCell = {
  text: string
  raw: unknown
}

export type SheetGrid = {
  sheetName: string
  extraSheetCount: number
  rows: SheetCell[][]
}

export type ReadSpreadsheetResult =
  | { ok: true; ext: SpreadsheetExt; grid: SheetGrid }
  | { ok: false; error: string; ext: SpreadsheetExt | null }

function isXlsxZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}

function isOleCompound(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0
  )
}

function extFromFilename(filename: string | undefined): SpreadsheetExt | null {
  if (!filename) return null
  const m = filename.trim().toLowerCase().match(/\.([a-z0-9]+)$/)
  const ext = m?.[1]
  if (ext === 'csv' || ext === 'xlsx' || ext === 'xls') return ext
  return null
}

function extFromMime(mime: string | undefined): SpreadsheetExt | null {
  if (!mime) return null
  const m = mime.toLowerCase().split(';')[0]!.trim()
  if (
    m === 'text/csv' ||
    m === 'application/csv' ||
    m === 'text/plain' ||
    m === 'text/tab-separated-values'
  ) {
    return 'csv'
  }
  if (m === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx'
  if (m === 'application/vnd.ms-excel') return 'xls'
  return null
}

/** Sniff csv / xlsx / legacy-xls from magic bytes, then filename, then MIME. */
export function sniffSpreadsheetExt(
  bytes: Uint8Array,
  filename?: string,
  mime?: string
): SpreadsheetExt | null {
  if (isXlsxZip(bytes)) return 'xlsx'
  if (isOleCompound(bytes)) return 'xls'
  return extFromFilename(filename) ?? extFromMime(mime)
}

function dateToIso(d: Date): string {
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${day}`
}

function unwrapExcelValue(value: ExcelJS.CellValue): unknown {
  if (value == null) return null
  if (typeof value === 'object') {
    if (value instanceof Date) return value
    const formula = value as ExcelJS.CellFormulaValue
    if ('formula' in value && formula.result !== undefined) return unwrapExcelValue(formula.result as ExcelJS.CellValue)
    const rich = value as ExcelJS.CellRichTextValue
    if (Array.isArray(rich.richText)) {
      return rich.richText.map((r) => String(r.text ?? '')).join('')
    }
    const hyper = value as ExcelJS.CellHyperlinkValue
    if ('text' in value && typeof hyper.text === 'string') return hyper.text
    if ('error' in value) return null
  }
  return value
}

function toCell(raw: unknown): SheetCell {
  if (raw == null || raw === '') return { text: '', raw: null }
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return { text: dateToIso(raw), raw }
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return { text: String(raw), raw }
  }
  if (typeof raw === 'boolean') return { text: raw ? 'true' : 'false', raw }
  const text = String(raw).replace(/\r?\n/g, ' ').trim()
  return { text, raw: text }
}

function trimGrid(rows: SheetCell[][]): SheetCell[][] {
  const nonEmpty = rows.filter((row) => row.some((c) => c.text !== ''))
  if (nonEmpty.length === 0) return []
  let lastCol = 0
  for (const row of nonEmpty) {
    for (let i = row.length - 1; i >= 0; i--) {
      if (row[i]!.text !== '') {
        lastCol = Math.max(lastCol, i)
        break
      }
    }
  }
  return nonEmpty.map((row) => {
    const slice = row.slice(0, lastCol + 1)
    while (slice.length <= lastCol) slice.push({ text: '', raw: null })
    return slice
  })
}

function decodeCsvText(bytes: Uint8Array): string {
  let text = Buffer.from(bytes).toString('utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  return text
}

function readCsvGrid(bytes: Uint8Array): SheetGrid | { error: string } {
  const rawText = decodeCsvText(bytes)
  if (!rawText.trim()) return { error: 'CSV is empty' }

  const firstLine = rawText.split(/\r?\n/)[0] ?? ''
  const tabCount = (firstLine.match(/\t/g) ?? []).length
  const commaCount = (firstLine.match(/,/g) ?? []).length
  const delimiter = tabCount > commaCount ? '\t' : ','

  const parsed = Papa.parse<string[]>(rawText, {
    delimiter,
    skipEmptyLines: 'greedy',
    header: false,
  })
  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    return { error: `CSV parse error: ${parsed.errors[0]?.message ?? 'unknown'}` }
  }
  const rows = trimGrid(
    (parsed.data ?? []).map((line) => (Array.isArray(line) ? line.map((c) => toCell(c)) : []))
  )
  if (rows.length === 0) return { error: 'CSV has no rows' }
  return { sheetName: 'Sheet1', extraSheetCount: 0, rows }
}

async function readXlsxGrid(bytes: Uint8Array): Promise<SheetGrid | { error: string }> {
  const workbook = new ExcelJS.Workbook()
  try {
    const buffer = Buffer.from(bytes)
    await workbook.xlsx.load(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
    )
  } catch (e) {
    return { error: `XLSX parse error: ${e instanceof Error ? e.message : 'unknown error'}` }
  }
  const sheets = workbook.worksheets ?? []
  if (sheets.length === 0) return { error: 'Workbook has no sheets' }

  let extraSheetCount = 0
  for (const sheet of sheets) {
    if (sheet.state === 'hidden' || sheet.state === 'veryHidden') continue
    const collected: SheetCell[][] = []
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: SheetCell[] = []
      const values = row.values as ExcelJS.CellValue[]
      const count = Math.max(sheet.columnCount || 0, values.length - 1)
      for (let i = 1; i <= count; i++) {
        const cell = row.getCell(i)
        cells.push(toCell(unwrapExcelValue(cell.value)))
      }
      collected.push(cells)
    })
    const rows = trimGrid(collected)
    if (rows.length === 0) {
      extraSheetCount += 1
      continue
    }
    const remaining = sheets.filter((s) => s !== sheet && s.state !== 'hidden' && s.state !== 'veryHidden').length
    return { sheetName: sheet.name || 'Sheet1', extraSheetCount: remaining, rows }
  }
  return { error: 'No data found in any sheet' }
}

export async function readSpreadsheet(params: {
  bytes: Uint8Array
  filename?: string
  mediaType?: string
}): Promise<ReadSpreadsheetResult> {
  const ext = sniffSpreadsheetExt(params.bytes, params.filename, params.mediaType)
  if (!ext) {
    return { ok: false, ext: null, error: 'File must be .csv, .xlsx, or .xls' }
  }
  if (ext === 'xls' && isOleCompound(params.bytes)) {
    return {
      ok: false,
      ext,
      error:
        'Old Excel 97-2003 (.xls) files are not readable here. Save the sheet as .xlsx or CSV and retry.',
    }
  }
  if (ext === 'xlsx' || (ext === 'xls' && isXlsxZip(params.bytes))) {
    const grid = await readXlsxGrid(params.bytes)
    if ('error' in grid) return { ok: false, ext: 'xlsx', error: grid.error }
    return { ok: true, ext: 'xlsx', grid }
  }
  if (ext === 'xls') {
    const asCsv = readCsvGrid(params.bytes)
    if ('error' in asCsv) {
      return {
        ok: false,
        ext,
        error:
          'This .xls file is not a readable spreadsheet. Save it as .xlsx or CSV and retry.',
      }
    }
    return { ok: true, ext: 'csv', grid: asCsv }
  }
  const grid = readCsvGrid(params.bytes)
  if ('error' in grid) return { ok: false, ext: 'csv', error: grid.error }
  return { ok: true, ext: 'csv', grid }
}
