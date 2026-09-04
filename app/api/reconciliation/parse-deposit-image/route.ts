import { NextResponse } from 'next/server'
import { createDocument, updateDocument } from '@/lib/reconciliation/db'
import { attachDuplicateFlags } from '@/lib/reconciliation/deposit-parse-response'
import { parseDepositImage, VISION_CONFIDENCE_CAP } from '@/lib/reconciliation/parser'
import { fromDal, withOwnedScope } from '@/lib/reconciliation/scope'
import {
  DEPOSIT_IMAGE_MAX_BYTES,
  DEPOSIT_IMAGE_MIME,
  IMAGE_JSON_MAX_CHARS,
  IMAGE_TOO_LARGE_KO,
  storeDepositImage,
} from '@/lib/reconciliation/storage'

/**
 * POST /api/reconciliation/parse-deposit-image
 *
 * Stores the file in the private `reconciliation-deposits` bucket, records
 * raw_documents (source_type='receipt_image'), vision-parses EVERY visible
 * deposit row. Does NOT insert deposit_records — review UI commits confirmed
 * rows. Unreadable images 422 — no guess, no deposit row.
 *
 * Each vision row is capped at 0.65.
 */
export const runtime = 'nodejs'
export const maxDuration = 60

function parseImagePayload(
  raw: string,
  mediaTypeHint?: string
): { data: string; mediaType: string } | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const dataUrl = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/)
  if (dataUrl) {
    return { mediaType: dataUrl[1]!, data: dataUrl[2]!.replace(/\s/g, '') }
  }
  const mediaType =
    typeof mediaTypeHint === 'string' && mediaTypeHint.startsWith('image/')
      ? mediaTypeHint
      : 'image/jpeg'
  return { mediaType, data: trimmed.replace(/\s/g, '') }
}

export async function POST(req: Request) {
  const contentLength = Number(req.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > IMAGE_JSON_MAX_CHARS) {
    return NextResponse.json({ error: IMAGE_TOO_LARGE_KO }, { status: 413 })
  }

  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  const { scope, body } = gate

  const imageRaw = typeof body.image === 'string' ? body.image : ''
  const parsedImage = parseImagePayload(
    imageRaw,
    typeof body.media_type === 'string' ? body.media_type : undefined
  )
  if (!parsedImage) {
    return NextResponse.json({ error: 'image (data URL or base64) is required' }, { status: 400 })
  }
  if (!(DEPOSIT_IMAGE_MIME as readonly string[]).includes(parsedImage.mediaType)) {
    return NextResponse.json(
      { error: 'image must be jpeg, png, webp, or gif' },
      { status: 400 }
    )
  }

  let bytes: Uint8Array
  try {
    bytes = Uint8Array.from(Buffer.from(parsedImage.data, 'base64'))
  } catch {
    return NextResponse.json({ error: 'image is not valid base64' }, { status: 400 })
  }
  if (bytes.byteLength === 0) {
    return NextResponse.json(
      { error: 'image must be a non-empty file of 8MB or smaller' },
      { status: 400 }
    )
  }
  if (bytes.byteLength > DEPOSIT_IMAGE_MAX_BYTES || imageRaw.length > IMAGE_JSON_MAX_CHARS) {
    return NextResponse.json({ error: IMAGE_TOO_LARGE_KO }, { status: 413 })
  }

  const stored = await storeDepositImage(scope, bytes, parsedImage.mediaType)
  if (!stored.ok) return fromDal(stored)

  const created = await createDocument(scope, {
    source_type: 'receipt_image',
    storage_path: stored.data.storagePath,
    raw_text: null,
  })
  if (!created.ok) return fromDal(created)
  const documentId = created.data.id

  await updateDocument(scope, documentId, { parse_status: 'parsing', parse_error: null })

  const parsed = await parseDepositImage({
    userId: scope.userId,
    imageBase64: parsedImage.data,
    mediaType: parsedImage.mediaType,
  })

  const readable = parsed.rows.filter((row) => row.amount != null && row.amount > 0)
  if (parsed.unreadable || readable.length === 0) {
    await updateDocument(scope, documentId, {
      parse_status: 'failed',
      parse_error: 'Image unreadable — could not extract any deposit row',
    })
    return NextResponse.json(
      {
        error: 'Image unreadable. Take another photo in better light — values were not guessed.',
        document_id: documentId,
        storage_path: stored.data.storagePath,
        parsed: { ...parsed, rows: [], unreadable: true },
        rows: [],
      },
      { status: 422 }
    )
  }

  const bodyHint = typeof body.channel_hint === 'string' ? body.channel_hint : null
  const flagged = await attachDuplicateFlags(
    scope,
    readable.map((row) => ({
      ...row,
      confidence: Math.min(row.confidence, VISION_CONFIDENCE_CAP),
      channel_hint: bodyHint,
    }))
  )
  if (!flagged.ok) {
    await updateDocument(scope, documentId, {
      parse_status: 'failed',
      parse_error: flagged.error,
    })
    return fromDal(flagged)
  }

  await updateDocument(scope, documentId, { parse_status: 'parsed', parse_error: null })

  return NextResponse.json({
    document_id: documentId,
    storage_path: stored.data.storagePath,
    parsed: { ...parsed, rows: flagged.data.rows, unreadable: false },
    rows: flagged.data.rows,
    fingerprints: flagged.data.fingerprints,
  })
}
