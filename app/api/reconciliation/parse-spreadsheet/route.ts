import { NextResponse } from 'next/server'
import { createDeposit, createDocument, createSale, listChannels, updateDocument } from '@/lib/reconciliation/db'
import { parseSpreadsheet, SPREADSHEET_KIND, type SpreadsheetKind } from '@/lib/reconciliation/spreadsheet-parse'
import { readSpreadsheet, SPREADSHEET_MAX_DATA_ROWS } from '@/lib/reconciliation/spreadsheet-read'
import { fromDal, withOwnedScope } from '@/lib/reconciliation/scope'
import { SPREADSHEET_MAX_BYTES, storeSpreadsheetFile } from '@/lib/reconciliation/storage'
import { HITL_CONFIDENCE_THRESHOLD } from '@/lib/reconciliation/parser'

/**
 * POST /api/reconciliation/parse-spreadsheet
 *
 * Body (JSON, fits withOwnedScope):
 *   { file: data-URL or base64, kind: 'deposits'|'sales' (required),
 *     media_type?: string, filename?: string }
 *
 * Stores the raw file in the private `reconciliation-deposits` bucket, records
 * raw_documents (source_type='excel'), maps arbitrary columns via one AI call,
 * and bulk-inserts pending deposit_records or sales_records. Does NOT run
 * reconcile.
 *
 * Cap: SPREADSHEET_MAX_DATA_ROWS (300) non-header data rows per upload.
 * Unreadable / zero recognizable rows → 422, parse_status='failed', nothing inserted.
 */
export const runtime = 'nodejs'
export const maxDuration = 60

function parseFilePayload(
  raw: string,
  mediaTypeHint?: string
): { data: string; mediaType: string } | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const dataUrl = trimmed.match(/^data:([^;,]+);base64,([\s\S]+)$/)
  if (dataUrl) {
    return { mediaType: dataUrl[1]!.trim(), data: dataUrl[2]!.replace(/\s/g, '') }
  }
  const mediaType =
    typeof mediaTypeHint === 'string' && mediaTypeHint.length > 0 ? mediaTypeHint : 'text/csv'
  return { mediaType, data: trimmed.replace(/\s/g, '') }
}

export async function POST(req: Request) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  const { scope, body } = gate

  const kindRaw =
    typeof body.kind === 'string'
      ? body.kind
      : typeof body.record_kind === 'string'
        ? body.record_kind
        : ''
  const kind = kindRaw.trim().toLowerCase() as SpreadsheetKind
  if (!SPREADSHEET_KIND.includes(kind)) {
    return NextResponse.json(
      { error: "kind is required and must be 'deposits' or 'sales'" },
      { status: 400 }
    )
  }

  const fileRaw = typeof body.file === 'string' ? body.file : ''
  const parsedFile = parseFilePayload(
    fileRaw,
    typeof body.media_type === 'string' ? body.media_type : undefined
  )
  if (!parsedFile) {
    return NextResponse.json({ error: 'file (data URL or base64) is required' }, { status: 400 })
  }

  let bytes: Uint8Array
  try {
    bytes = Uint8Array.from(Buffer.from(parsedFile.data, 'base64'))
  } catch {
    return NextResponse.json({ error: 'file is not valid base64' }, { status: 400 })
  }
  if (bytes.byteLength === 0 || bytes.byteLength > SPREADSHEET_MAX_BYTES) {
    return NextResponse.json(
      { error: 'file must be a non-empty spreadsheet of 8MB or smaller' },
      { status: 400 }
    )
  }

  const filename = typeof body.filename === 'string' ? body.filename : undefined
  const read = await readSpreadsheet({
    bytes,
    filename,
    mediaType: parsedFile.mediaType,
  })
  if (!read.ok && read.ext === null) {
    return NextResponse.json({ error: read.error }, { status: 400 })
  }
  const storeExt = read.ok ? read.ext : read.ext ?? 'csv'
  const stored = await storeSpreadsheetFile(scope, bytes, storeExt === 'xlsx' ? 'xlsx' : storeExt)
  if (!stored.ok) return fromDal(stored)

  const created = await createDocument(scope, {
    source_type: 'excel',
    storage_path: stored.data.storagePath,
    raw_text: null,
  })
  if (!created.ok) return fromDal(created)
  const documentId = created.data.id

  await updateDocument(scope, documentId, { parse_status: 'parsing', parse_error: null })

  if (!read.ok) {
    await updateDocument(scope, documentId, {
      parse_status: 'failed',
      parse_error: read.error,
    })
    return NextResponse.json(
      {
        error: read.error,
        document_id: documentId,
        storage_path: stored.data.storagePath,
        parsed_count: 0,
        needs_review_count: 0,
        failed_rows: [],
      },
      { status: 422 }
    )
  }

  const nonEmpty = read.grid.rows.length
  if (nonEmpty > SPREADSHEET_MAX_DATA_ROWS + 1) {
    const message = `Spreadsheet has ${nonEmpty} rows; the limit is ${SPREADSHEET_MAX_DATA_ROWS} data rows per upload. Split the file and retry.`
    await updateDocument(scope, documentId, { parse_status: 'failed', parse_error: message })
    return NextResponse.json(
      {
        error: message,
        document_id: documentId,
        storage_path: stored.data.storagePath,
        row_cap: SPREADSHEET_MAX_DATA_ROWS,
      },
      { status: 400 }
    )
  }

  const channels = await listChannels(scope)
  if (!channels.ok) {
    await updateDocument(scope, documentId, {
      parse_status: 'failed',
      parse_error: channels.error,
    })
    return fromDal(channels)
  }

  const parsed = await parseSpreadsheet({
    userId: scope.userId,
    grid: read.grid,
    kind,
    channels: channels.data,
  })

  if (parsed.rows.length === 0) {
    const message =
      parsed.column_map == null
        ? 'Spreadsheet is unreadable: no date and amount columns could be recognized. Nothing was inserted.'
        : 'Spreadsheet had zero recognizable rows (date + amount). Nothing was inserted, and values were not guessed.'
    await updateDocument(scope, documentId, { parse_status: 'failed', parse_error: message })
    return NextResponse.json(
      {
        error: message,
        document_id: documentId,
        storage_path: stored.data.storagePath,
        sheet_name: read.grid.sheetName,
        column_map: parsed.column_map,
        parsed_count: 0,
        needs_review_count: 0,
        failed_rows: parsed.failed_rows,
        row_cap: SPREADSHEET_MAX_DATA_ROWS,
      },
      { status: 422 }
    )
  }

  const inserted: Array<{
    id: string
    row_index: number
    date: string
    amount: number
    confidence: number
    needs_review: boolean
    sale_kind?: string
  }> = []
  const failedRows = [...parsed.failed_rows]

  for (const row of parsed.rows) {
    if (kind === 'deposits') {
      const deposit = await createDeposit(scope, {
        raw_document_id: documentId,
        deposit_date: row.date,
        actual_amount: row.amount,
        confidence: row.confidence,
        confirm_status: 'pending',
        channel_hint: row.channel_id ?? undefined,
      })
      if (!deposit.ok) {
        failedRows.push({
          row_index: row.row_index,
          reason: `Could not insert deposit: ${deposit.error}`,
          cells: [row.date, String(row.amount)],
        })
        continue
      }
      inserted.push({
        id: deposit.data.id,
        row_index: row.row_index,
        date: deposit.data.deposit_date,
        amount: deposit.data.actual_amount,
        confidence: row.confidence,
        needs_review: row.needs_review,
      })
    } else {
      const sale = await createSale(scope, {
        raw_document_id: documentId,
        sale_date: row.date,
        gross_amount: row.amount,
        confidence: row.confidence,
        confirm_status: 'pending',
        sale_kind: row.sale_kind ?? 'card',
        channel_id: row.channel_id ?? undefined,
        entry_source: 'pos_import',
      })
      if (!sale.ok) {
        failedRows.push({
          row_index: row.row_index,
          reason: `Could not insert sale: ${sale.error}`,
          cells: [row.date, String(row.amount)],
        })
        continue
      }
      inserted.push({
        id: sale.data.id,
        row_index: row.row_index,
        date: sale.data.sale_date,
        amount: sale.data.gross_amount,
        confidence: row.confidence,
        needs_review: row.needs_review,
        sale_kind: sale.data.sale_kind,
      })
    }
  }

  if (inserted.length === 0) {
    const message = 'Every recognizable row failed to insert. Nothing was saved.'
    await updateDocument(scope, documentId, { parse_status: 'failed', parse_error: message })
    return NextResponse.json(
      {
        error: message,
        document_id: documentId,
        storage_path: stored.data.storagePath,
        sheet_name: read.grid.sheetName,
        column_map: parsed.column_map,
        parsed_count: 0,
        needs_review_count: 0,
        failed_rows: failedRows,
        row_cap: SPREADSHEET_MAX_DATA_ROWS,
      },
      { status: 422 }
    )
  }

  await updateDocument(scope, documentId, { parse_status: 'parsed', parse_error: null })

  const needsReviewCount = inserted.filter((r) => r.needs_review).length
  return NextResponse.json(
    {
      document_id: documentId,
      storage_path: stored.data.storagePath,
      kind,
      sheet_name: read.grid.sheetName,
      extra_sheet_count: read.grid.extraSheetCount,
      column_map: parsed.column_map,
      row_cap: SPREADSHEET_MAX_DATA_ROWS,
      parsed_count: inserted.length,
      needs_review_count: needsReviewCount,
      failed_count: failedRows.length,
      inserted,
      failed_rows: failedRows,
      hitl_threshold: HITL_CONFIDENCE_THRESHOLD,
      needs_confirm: true,
    },
    { status: 201 }
  )
}
