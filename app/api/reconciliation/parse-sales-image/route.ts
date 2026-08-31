import { NextResponse } from 'next/server'
import { createDocument, createSale, updateDocument } from '@/lib/reconciliation/db'
import { parseSalesImage, HITL_CONFIDENCE_THRESHOLD } from '@/lib/reconciliation/parser'
import { fromDal, withOwnedScope } from '@/lib/reconciliation/scope'
import {
  DEPOSIT_IMAGE_MAX_BYTES,
  DEPOSIT_IMAGE_MIME,
  storeDepositImage,
} from '@/lib/reconciliation/storage'
import type { SaleKind } from '@/lib/reconciliation/types'

/**
 * POST /api/reconciliation/parse-sales-image
 *
 * Body (JSON, fits withOwnedScope):
 *   { image: data-URL or bare base64, media_type?: 'image/jpeg'|... }
 *
 * Same private-bucket + receipt_image document flow as parse-deposit-image.
 * Vision (openai/gpt-4o, sessionId=null) extracts date, amount, and an
 * advisory sale_kind_guess. Inserts a pending sales_records row
 * (entry_source='pos_import'). Unreadable images 422 — no sale, no guessed
 * amount. If tender is unclear, persists sale_kind='manual_total' (review
 * required) — never silently assumes 'card'.
 *
 * Confidence is capped below 0.7 so the existing HITL review flags it.
 */
export const runtime = 'nodejs'
export const maxDuration = 60

/** CHECK-legal stand-in when vision cannot tell card vs cash vs voucher. */
const UNKNOWN_SALE_KIND: SaleKind = 'manual_total'

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
  if (bytes.byteLength === 0 || bytes.byteLength > DEPOSIT_IMAGE_MAX_BYTES) {
    return NextResponse.json(
      { error: 'image must be a non-empty file of 8MB or smaller' },
      { status: 400 }
    )
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

  const parsed = await parseSalesImage({
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

  const kindGuessed = parsed.sale_kind_guess != null
  const saleKind = parsed.sale_kind_guess ?? UNKNOWN_SALE_KIND

  const sale = await createSale(scope, {
    raw_document_id: documentId,
    sale_date: parsed.date,
    gross_amount: parsed.amount,
    confidence: parsed.confidence,
    confirm_status: 'pending',
    sale_kind: saleKind,
    entry_source: 'pos_import',
  })
  if (!sale.ok) {
    await updateDocument(scope, documentId, {
      parse_status: 'failed',
      parse_error: sale.error,
    })
    return fromDal(sale)
  }

  await updateDocument(scope, documentId, { parse_status: 'parsed', parse_error: null })

  return NextResponse.json(
    {
      document_id: documentId,
      storage_path: stored.data.storagePath,
      sale: sale.data,
      parsed,
      sale_kind_guessed: kindGuessed,
      sale_kind_needs_review: true,
      needs_confirm: parsed.confidence < HITL_CONFIDENCE_THRESHOLD || !kindGuessed,
    },
    { status: 201 }
  )
}
