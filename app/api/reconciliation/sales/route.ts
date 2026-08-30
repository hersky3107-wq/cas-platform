import { NextResponse } from 'next/server'
import { createSale, listSales } from '@/lib/reconciliation/db'
import { fromDal, queryParams, withOwnedScope } from '@/lib/reconciliation/scope'
import { ENTRY_SOURCES, SALE_KINDS } from '@/lib/reconciliation/types'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(req: Request) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  const q = queryParams(req)
  return fromDal(
    await listSales(gate.scope, {
      from: q.get('from'),
      to: q.get('to'),
      confirm_status: q.get('confirm_status'),
      channel_id: q.get('channel_id'),
    })
  )
}

export async function POST(req: Request) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  const { body } = gate

  let saleKind: string | undefined
  if (body.sale_kind != null && body.sale_kind !== '') {
    if (typeof body.sale_kind !== 'string' || !SALE_KINDS.includes(body.sale_kind as (typeof SALE_KINDS)[number])) {
      return NextResponse.json(
        { error: `sale_kind must be one of: ${SALE_KINDS.join(', ')}` },
        { status: 400 }
      )
    }
    saleKind = body.sale_kind
  }

  const entrySource = body.entry_source ?? 'manual'
  if (
    typeof entrySource !== 'string' ||
    !ENTRY_SOURCES.includes(entrySource as (typeof ENTRY_SOURCES)[number])
  ) {
    return NextResponse.json(
      { error: `entry_source must be one of: ${ENTRY_SOURCES.join(', ')}` },
      { status: 400 }
    )
  }

  let saleGroupId: string | null = null
  if (body.sale_group_id != null && body.sale_group_id !== '') {
    if (typeof body.sale_group_id !== 'string' || !UUID_RE.test(body.sale_group_id)) {
      return NextResponse.json({ error: 'sale_group_id must be a uuid' }, { status: 400 })
    }
    saleGroupId = body.sale_group_id
  }

  return fromDal(
    await createSale(gate.scope, {
      ...body,
      sale_kind: saleKind,
      entry_source: entrySource,
      sale_group_id: saleGroupId,
    }),
    201
  )
}
