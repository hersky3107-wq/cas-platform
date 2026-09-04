import { NextResponse } from 'next/server'
import { createDocument, findOrCreateChannel, getDocument, updateDocument } from '@/lib/reconciliation/db'
import { attachDuplicateFlags } from '@/lib/reconciliation/deposit-parse-response'
import { parseDeposit, VOUCHER_PARSE_SPEC } from '@/lib/reconciliation/parser'
import { fromDal, withOwnedScope } from '@/lib/reconciliation/scope'

/**
 * Parse pasted app/barcode voucher deposit-alert text into candidate rows.
 * Does NOT insert deposit_records — HITL commit inserts confirmed rows.
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

  const readable = parsed.rows.filter((row) => row.amount != null && row.amount > 0)
  if (readable.length === 0) {
    await updateDocument(scope, documentId, {
      parse_status: 'failed',
      parse_error: 'Could not extract any deposit row',
    })
    return NextResponse.json(
      {
        error: 'Parse incomplete',
        document_id: documentId,
        parsed,
        rows: [],
      },
      { status: 422 }
    )
  }

  const bodyHint = typeof body.channel_hint === 'string' ? body.channel_hint : null
  const withHints = []
  for (const row of readable) {
    const voucherType = row.extra?.voucher_type ?? null
    let channelHint = bodyHint
    if (!channelHint && voucherType) {
      const channel = await findOrCreateChannel(scope, voucherType, 'app_voucher')
      if (channel.ok) channelHint = channel.data.id
    }
    withHints.push({ ...row, channel_hint: channelHint })
  }

  const flagged = await attachDuplicateFlags(scope, withHints)
  if (!flagged.ok) {
    await updateDocument(scope, documentId, {
      parse_status: 'failed',
      parse_error: flagged.error,
    })
    return fromDal(flagged)
  }

  await updateDocument(scope, documentId, { parse_status: 'parsed', parse_error: null })

  const voucherTypes = [
    ...new Set(flagged.data.rows.map((row) => row.extra?.voucher_type).filter(Boolean)),
  ]

  return NextResponse.json({
    document_id: documentId,
    parsed: { ...parsed, rows: flagged.data.rows },
    rows: flagged.data.rows,
    fingerprints: flagged.data.fingerprints,
    voucher_type: voucherTypes.length === 1 ? voucherTypes[0] : null,
  })
}
