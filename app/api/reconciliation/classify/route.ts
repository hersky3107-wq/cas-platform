import { NextResponse } from 'next/server'
import { classifyText } from '@/lib/reconciliation/classify'
import { createDocument, updateDocument } from '@/lib/reconciliation/db'
import { fromDal, withOwnedScope } from '@/lib/reconciliation/scope'

/**
 * UNIFIED INGEST — the owner pastes ANYTHING (SMS, bank app copy, typed
 * day list, POS text) and the AI classifies each row: sale or deposit,
 * method, card issuer, date, signed amount (refund = negative). Two models
 * cross-check; solo-model rows come back needs_review.
 *
 * NOTHING is committed: the raw text is stored as a raw_document
 * (provenance, encrypted) and candidate rows are returned for the review
 * UI, which commits via the existing POST /sales and /deposits endpoints
 * (deposits accept issuer_id/issuer_source, sales accept issuer_id).
 *
 * Body: { raw_text: string, source_type?: 'manual' | 'sms' }
 * Images keep their dedicated AI routes (parse-sales-image / parse-deposit-image).
 */
export async function POST(req: Request) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  const { scope, body } = gate

  const rawText = typeof body.raw_text === 'string' ? body.raw_text.trim() : ''
  if (!rawText) {
    return NextResponse.json({ error: 'raw_text is required' }, { status: 400 })
  }

  const sourceType = body.source_type === 'sms' ? 'sms' : 'manual'
  const doc = await createDocument(scope, { source_type: sourceType, raw_text: rawText })
  if (!doc.ok) return fromDal(doc)

  await updateDocument(scope, doc.data.id, { parse_status: 'parsing', parse_error: null })

  const classified = await classifyText(scope, rawText)
  if (!classified.ok) {
    await updateDocument(scope, doc.data.id, {
      parse_status: 'failed',
      parse_error: classified.error,
    })
    return fromDal(classified)
  }

  await updateDocument(scope, doc.data.id, {
    parse_status: classified.data.rows.length > 0 ? 'parsed' : 'failed',
    parse_error: classified.data.rows.length > 0 ? null : '분류 가능한 행이 없습니다',
  })

  return NextResponse.json({
    document_id: doc.data.id,
    ...classified.data,
  })
}
