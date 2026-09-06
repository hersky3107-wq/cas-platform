import { NextResponse } from 'next/server'
import { classifyText } from '@/lib/reconciliation/classify'
import { createDocument, updateDocument } from '@/lib/reconciliation/db'
import { sheetGridToText, transcribeLedgerImage } from '@/lib/reconciliation/ingest-extract'
import { readSpreadsheet } from '@/lib/reconciliation/spreadsheet-read'
import { fromDal, withOwnedScope } from '@/lib/reconciliation/scope'
import {
  DEPOSIT_IMAGE_MAX_BYTES,
  DEPOSIT_IMAGE_MIME,
  IMAGE_JSON_MAX_CHARS,
  IMAGE_TOO_LARGE_KO,
  SPREADSHEET_MAX_BYTES,
  storeDepositImage,
  storeSpreadsheetFile,
} from '@/lib/reconciliation/storage'

/**
 * UNIFIED INGEST (넣기) — the ONE box. The owner throws in anything and the
 * AI classifies each row: sale or deposit, method, card issuer, date, signed
 * amount (refund = negative). She pre-declares NOTHING.
 *
 * Body, one of:
 *   { raw_text: string, source_type?: 'manual' | 'sms' }       pasted/typed text
 *   { image: dataURL|base64, media_type?: string }              photo → vision
 *     transcription (verbatim lines) → the SAME two-model classifier
 *   { file: dataURL|base64, media_type?: string, filename?: string }
 *     spreadsheet (csv/xlsx) → rows serialized to lines → same classifier
 *
 * Provenance: every ingest stores a raw_document (text encrypted; files in
 * the private bucket). NOTHING is committed — candidate rows come back for
 * the review UI, which commits via POST /sales and /deposits. Unreadable
 * photos 422 with no guessed values.
 */
export const runtime = 'nodejs'
export const maxDuration = 60

function parseB64Payload(
  raw: string,
  mediaTypeHint: string | undefined,
  fallbackMediaType: string
): { data: string; mediaType: string } | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const dataUrl = trimmed.match(/^data:([^;,]+);base64,([\s\S]+)$/)
  if (dataUrl) {
    return { mediaType: dataUrl[1]!.trim(), data: dataUrl[2]!.replace(/\s/g, '') }
  }
  const mediaType =
    typeof mediaTypeHint === 'string' && mediaTypeHint.length > 0 ? mediaTypeHint : fallbackMediaType
  return { mediaType, data: trimmed.replace(/\s/g, '') }
}

function decodeB64(data: string): Uint8Array | null {
  try {
    const bytes = Uint8Array.from(Buffer.from(data, 'base64'))
    return bytes.byteLength > 0 ? bytes : null
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  const contentLength = Number(req.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > IMAGE_JSON_MAX_CHARS) {
    return NextResponse.json({ error: IMAGE_TOO_LARGE_KO }, { status: 413 })
  }

  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  const { scope, body } = gate

  const mediaTypeHint = typeof body.media_type === 'string' ? body.media_type : undefined

  // ── derive classifiable text from whichever input form arrived ────────────
  let rawText = ''
  let documentId: string | null = null
  let sourceKind: 'text' | 'image' | 'spreadsheet' = 'text'

  if (typeof body.image === 'string' && body.image.trim()) {
    sourceKind = 'image'
    const img = parseB64Payload(body.image, mediaTypeHint, 'image/jpeg')
    if (!img) return NextResponse.json({ error: 'image (data URL or base64) is required' }, { status: 400 })
    if (!(DEPOSIT_IMAGE_MIME as readonly string[]).includes(img.mediaType)) {
      return NextResponse.json({ error: 'image must be jpeg, png, webp, or gif' }, { status: 400 })
    }
    const bytes = decodeB64(img.data)
    if (!bytes) return NextResponse.json({ error: 'image is not valid base64' }, { status: 400 })
    if (bytes.byteLength > DEPOSIT_IMAGE_MAX_BYTES || body.image.length > IMAGE_JSON_MAX_CHARS) {
      return NextResponse.json({ error: IMAGE_TOO_LARGE_KO }, { status: 413 })
    }

    const stored = await storeDepositImage(scope, bytes, img.mediaType)
    if (!stored.ok) return fromDal(stored)
    const doc = await createDocument(scope, {
      source_type: 'receipt_image',
      storage_path: stored.data.storagePath,
      raw_text: null,
    })
    if (!doc.ok) return fromDal(doc)
    documentId = doc.data.id
    await updateDocument(scope, documentId, { parse_status: 'parsing', parse_error: null })

    const transcribed = await transcribeLedgerImage({
      userId: scope.userId,
      imageBase64: img.data,
      mediaType: img.mediaType,
    })
    if (!transcribed.ok) {
      await updateDocument(scope, documentId, {
        parse_status: 'failed',
        parse_error: '사진에서 거래 내용을 읽지 못했습니다',
      })
      return NextResponse.json(
        {
          error: '사진을 읽지 못했어요. 밝은 곳에서 다시 찍어 주세요 — 값을 추측하지 않았습니다.',
          document_id: documentId,
        },
        { status: 422 }
      )
    }
    rawText = transcribed.text
  } else if (typeof body.file === 'string' && body.file.trim()) {
    sourceKind = 'spreadsheet'
    const file = parseB64Payload(body.file, mediaTypeHint, 'text/csv')
    if (!file) return NextResponse.json({ error: 'file (data URL or base64) is required' }, { status: 400 })
    const bytes = decodeB64(file.data)
    if (!bytes) return NextResponse.json({ error: 'file is not valid base64' }, { status: 400 })
    if (bytes.byteLength > SPREADSHEET_MAX_BYTES) {
      return NextResponse.json({ error: '파일이 너무 큽니다. 더 작은 파일을 올려 주세요.' }, { status: 413 })
    }
    const filename = typeof body.filename === 'string' ? body.filename : undefined

    const read = await readSpreadsheet({ bytes, filename, mediaType: file.mediaType })
    if (!read.ok) {
      return NextResponse.json({ error: read.error }, { status: 422 })
    }
    const stored = await storeSpreadsheetFile(scope, bytes, read.ext)
    if (!stored.ok) return fromDal(stored)
    const doc = await createDocument(scope, {
      source_type: 'excel',
      storage_path: stored.data.storagePath,
      raw_text: null,
    })
    if (!doc.ok) return fromDal(doc)
    documentId = doc.data.id
    await updateDocument(scope, documentId, { parse_status: 'parsing', parse_error: null })

    rawText = sheetGridToText(read.grid)
  } else {
    const text = typeof body.raw_text === 'string' ? body.raw_text.trim() : ''
    if (!text) {
      return NextResponse.json(
        { error: 'raw_text, image, or file 중 하나가 필요합니다' },
        { status: 400 }
      )
    }
    const sourceType = body.source_type === 'sms' ? 'sms' : 'manual'
    const doc = await createDocument(scope, { source_type: sourceType, raw_text: text })
    if (!doc.ok) return fromDal(doc)
    documentId = doc.data.id
    await updateDocument(scope, documentId, { parse_status: 'parsing', parse_error: null })
    rawText = text
  }

  // ── the SAME two-model classifier for every input form ─────────────────────
  const classified = await classifyText(scope, rawText)
  if (!classified.ok) {
    await updateDocument(scope, documentId, {
      parse_status: 'failed',
      parse_error: classified.error,
    })
    return fromDal(classified)
  }

  await updateDocument(scope, documentId, {
    parse_status: classified.data.rows.length > 0 ? 'parsed' : 'failed',
    parse_error: classified.data.rows.length > 0 ? null : '분류 가능한 행이 없습니다',
  })

  return NextResponse.json({
    document_id: documentId,
    source_kind: sourceKind,
    ...classified.data,
  })
}
