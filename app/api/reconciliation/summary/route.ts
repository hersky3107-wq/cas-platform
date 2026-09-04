import { NextResponse } from 'next/server'
import { getMonthlySummary } from '@/lib/reconciliation/db'
import { fromDal, queryParams, withOwnedScope } from '@/lib/reconciliation/scope'

export async function GET(req: Request) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  const q = queryParams(req)
  const month = q.get('month')
  if (!month) {
    return NextResponse.json({ error: 'month (YYYY-MM) is required' }, { status: 400 })
  }
  return fromDal(await getMonthlySummary(gate.scope, month))
}
