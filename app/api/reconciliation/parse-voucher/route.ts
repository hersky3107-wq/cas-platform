import { NextResponse } from 'next/server'
import { createDeposit, createDocument, findOrCreateChannel, getDocument, updateDocument } from '@/lib/reconciliation/db'
import { parseDeposit, VOUCHER_PARSE_SPEC } from '@/lib/reconciliation/parser'
import { fromDal, withOwnedScope } from '@/lib/reconciliation/scope'

/**
 * Parse a pasted bank deposit-alert for an APP/BARCODE-TYPE LOCAL VOUCHER
 * (탐나는전 앱, 온누리 앱) into a deposit_records row.
 *
 * Body (one of raw_document_id / raw_text required):
 *   { raw_document_id?: uuid, raw_text?: string, source_type?: 'sms'|'manual',
 *     channel_hint?: uuid }
 *
 * STAGE 2 sibling of POST /api/reconciliation/parse — SAME shape, just
 * VOUCHER_PARSE_SPEC injected instead of TRANSFER_PARSE_SPEC. Kept as its own
 * route (rather than branching the existing one) so the working transfer
 * path is untouched.
 *
 * The one extra step: when the caller doesn't supply channel_hint, the
 * voucher_type VOUCHER_PARSE_SPEC extracted ('탐나는전' | '온누리') is used to
 * find-or-create that user's app_voucher channel of that name and hint the
 * new deposit at it, so reconcileAppVouchers() can find it without the user
 * having to create the channel by hand first. If voucher_type couldn't be
 * determined, the deposit is still recorded, just without a channel_hint.
 *
 * Goes through withOwnedScope + the owned DAL, so the document, deposit, and
 * any channel_hint (supplied or resolved) are all scoped to the session user.
 */
export async function POST(req: Request) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  const { scope, body } = gate

  let documentId: string
  let rawText: string

  const rawDocId = body.raw_document_id
  if (typeof rawDocId === 'string' && rawDocId) {
    const doc = await getDocument(scope, rawDocId)
    if (!doc.ok) return fromDal(doc)
    documentId = doc.data.id
    rawText = doc.data.raw_text ?? ''
  } else {
    const text = typeof body.raw_text === 'string' ? body.raw_text.trim() : ''
    if (!text) {
      return NextResponse.json(
        { error: 'raw_text or raw_document_id is required' },
        { status: 400 }
      )
    }
    const sourceType = body.source_type === 'manual' ? 'manual' : 'sms'
    const created = await createDocument(scope, { source_type: sourceType, raw_text: text })
    if (!created.ok) return fromDal(created)
    documentId = created.data.id
    rawText = created.data.raw_text ?? text
  }

  await updateDocument(scope, documentId, { parse_status: 'parsing', parse_error: null })

  const parsed = await parseDeposit({
    userId: scope.userId,
    rawText,
    spec: VOUCHER_PARSE_SPEC,
  })

  if (parsed.amount == null || parsed.date == null) {
    await updateDocument(scope, documentId, {
      parse_status: 'failed',
      parse_error: 'Could not extract both date and amount',
    })
    return NextResponse.json(
      { error: 'Parse incomplete', document_id: documentId, parsed },
      { status: 422 }
    )
  }

  const voucherType = parsed.extra?.voucher_type ?? null
  let channelHint = typeof body.channel_hint === 'string' ? body.channel_hint : undefined
  if (!channelHint && voucherType) {
    const channel = await findOrCreateChannel(scope, voucherType, 'app_voucher')
    // Find-or-create failure is non-fatal: the deposit is still recorded,
    // just without a channel_hint (same as an ordinary un-hinted deposit).
    if (channel.ok) channelHint = channel.data.id
  }

  const deposit = await createDeposit(scope, {
    raw_document_id: documentId,
    deposit_date: parsed.date,
    actual_amount: parsed.amount,
    confidence: parsed.confidence,
    confirm_status: 'pending',
    channel_hint: channelHint,
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
    { document_id: documentId, deposit: deposit.data, parsed, voucher_type: voucherType },
    { status: 201 }
  )
}
