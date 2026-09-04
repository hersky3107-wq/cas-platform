import { NextResponse } from 'next/server'
import { createDeposit } from '@/lib/reconciliation/db'
import { fromDal, withOwnedScope } from '@/lib/reconciliation/scope'

/**
 * Insert confirmed deposit rows from the HITL review table.
 *
 * The client sends only rows the user chose to keep (skipped 중복 의심 rows
 * are omitted). This route never auto-drops a row — if it is in the body,
 * it is inserted, even when it matches an existing (date, amount, memo).
 */
export async function POST(req: Request) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  const { scope, body } = gate

  const rawRows = body.rows
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    return NextResponse.json({ error: 'rows must be a non-empty array' }, { status: 400 })
  }

  const documentId = typeof body.document_id === 'string' ? body.document_id : undefined
  const batchHint = typeof body.channel_hint === 'string' ? body.channel_hint : undefined

  const created = []
  for (const raw of rawRows) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return NextResponse.json(
        { error: 'each row must be an object', created },
        { status: 400 }
      )
    }
    const row = raw as Record<string, unknown>
    const deposit = await createDeposit(scope, {
      raw_document_id: typeof row.raw_document_id === 'string' ? row.raw_document_id : documentId,
      deposit_date: row.deposit_date,
      actual_amount: row.actual_amount,
      memo: row.memo,
      confidence: row.confidence,
      confirm_status: row.confirm_status ?? 'confirmed',
      channel_hint:
        typeof row.channel_hint === 'string' ? row.channel_hint : batchHint,
    })
    if (!deposit.ok) {
      return NextResponse.json(
        { error: deposit.error, created },
        { status: deposit.status }
      )
    }
    created.push(deposit.data)
  }

  return fromDal({ ok: true, data: { created } }, 201)
}
