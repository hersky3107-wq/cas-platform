import { NextResponse } from 'next/server'
import { createDeposit, createDocument, getDocument, updateDocument } from '@/lib/reconciliation/db'
import { parseDeposit, TRANSFER_PARSE_SPEC } from '@/lib/reconciliation/parser'
import { fromDal, withOwnedScope } from '@/lib/reconciliation/scope'

/**
 * Parse a pasted bank deposit-alert into a deposit_records row.
 *
 * Body (one of raw_document_id / raw_text required):
 *   { raw_document_id?: uuid, raw_text?: string, source_type?: 'sms'|'manual',
 *     channel_hint?: uuid }
 *
 * STAGE 1: bank-transfer spec only. Goes through withOwnedScope + the owned DAL,
 * so the document, deposit, and any channel_hint are all scoped to the session user.
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
    spec: TRANSFER_PARSE_SPEC,
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
    { document_id: documentId, deposit: deposit.data, parsed },
    { status: 201 }
  )
}
