import { NextResponse } from 'next/server'
import { createDeposit, createDocument, updateDocument } from '@/lib/reconciliation/db'
import { parseDepositImage, HITL_CONFIDENCE_THRESHOLD } from '@/lib/reconciliation/parser'
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
 * Body (JSON, fits withOwnedScope):
 *   { image: data-URL or bare base64, media_type?: 'image/jpeg'|...,
 *     channel_hint?: uuid }
 *
 * Stores the file in the private `reconciliation-deposits` bucket, records
 * raw_documents (source_type='receipt_image'), vision-parses date+amount via
 * openai/gpt-4o (sessionId=null), and inserts a deposit_records row with
 * confirm_status='pending'. Unreadable images 422 — no guess, no deposit row.
 *
 * Confidence is capped below 0.7 so the existing HITL review flags it.
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

  if (parsed.unreadable || parsed.amount == null || parsed.date == null) {
    await updateDocument(scope, documentId, {
      parse_status: 'failed',
      parse_error: 'Image unreadable — could not extract both date and amount',
    })
    return NextResponse.json(
      {
        error: 'Image unreadable. Take another photo in better light — values were not guessed.',
        document_id: documentId,
        storage_path: stored.data.storagePath,
        parsed,
      },
      { status: 422 }
    )
  }

  const deposit = await createDeposit(scope, {
    raw_document_id: documentId,
    deposit_date: parsed.date,
    actual_amount: parsed.amount,
    confidence: parsed.confidence,
    confirm_status: 'pending',
    channel_hint: typeof body.channel_hint === 'string' ? body.channel_hint : undefined,
  })
  if (!deposit.ok) {
    await updateDocument(scope, documentId, {
      parse_status: 'failed',
      parse_error: deposit.error,
    })
    return fromDal(deposit)
  }

  await updateDocument(scope, documentId, { parse_status: 'parsed', parse_error: null })

  return NextResponse.json(
    {
      document_id: documentId,
      storage_path: stored.data.storagePath,
      deposit: deposit.data,
      parsed,
      needs_confirm: parsed.confidence < HITL_CONFIDENCE_THRESHOLD,
    },
    { status: 201 }
  )
}
