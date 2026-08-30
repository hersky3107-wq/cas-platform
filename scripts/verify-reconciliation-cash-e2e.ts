/**
 * CASH SALES — E2E VERIFICATION (real HTTP + live remote DB).
 *
 * Cash is revenue-only: stored on sales_records, never deposit-matched.
 * Confirms (a) stored with expected_net=gross and expected_deposit_date null,
 * (b) no reconciler flags missing_deposit, (c) gross is included in a revenue
 * sum. Also smokes transfer / card / app_voucher matched paths so those
 * engines are unchanged.
 *
 * Requires the sale_kind='cash' CHECK widen (paste
 * supabase/migrations/20260830000004_sales_records_sale_kind_cash.sql first).
 *
 * Run (dev server must already be up on localhost:3000):
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/verify-reconciliation-cash-e2e.ts
 */
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '../lib/supabase/server'

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000'

type Probe = { status: number; body: any }

async function request(
  path: string,
  token: string,
  method = 'GET',
  json?: Record<string, unknown>
): Promise<Probe> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  if (json) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: json ? JSON.stringify(json) : undefined,
  })
  const text = await response.text()
  let body: any
  try {
    body = JSON.parse(text)
  } catch {
    body = { raw: text.slice(0, 800) }
  }
  console.log(`\n${method} ${path}\nHTTP ${response.status}\n${JSON.stringify(body)}`)
  return { status: response.status, body }
}

function requireResult(condition: unknown, label: string, detail: unknown): asserts condition {
  if (!condition) {
    console.error(`\nSTOP — ${label}\n${JSON.stringify(detail, null, 2)}`)
    throw new Error(label)
  }
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const anon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

let userId: string | null = null

async function dbSale(id: string) {
  const { data, error } = await supabaseAdmin
    .from('sales_records')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId!)
    .maybeSingle()
  if (error) throw new Error(`DB sale read failed: ${error.message}`)
  console.log(`DB sale: ${JSON.stringify(data)}`)
  return data as Record<string, unknown> | null
}

async function main() {
  try {
    const email = `recon-cash-verify-${Date.now()}@example.com`
    const password = `Vf-${Math.random().toString(36).slice(2)}-${Date.now()}`
    const created = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    requireResult(!created.error && created.data.user, 'create throwaway user failed', created.error)
    userId = created.data.user.id
    const signed = await anon.auth.signInWithPassword({ email, password })
    requireResult(!signed.error && signed.data.session, 'sign-in failed', signed.error)
    const token = signed.data.session.access_token
    console.log(`Throwaway user: ${email} (${userId})`)

    const cashChan = await request('/api/reconciliation/channels', token, 'POST', {
      name: 'Cash',
      channel_type: 'cash',
    })
    requireResult(cashChan.status === 201, 'create cash channel failed', cashChan)
    requireResult(cashChan.body.channel_type === 'cash', 'channel_type is not cash', cashChan)
    const cashId = cashChan.body.id as string

    const transferChan = await request('/api/reconciliation/channels', token, 'POST', {
      name: 'Transfer-CashE2E',
      channel_type: 'transfer',
    })
    requireResult(transferChan.status === 201, 'create transfer channel failed', transferChan)
    const cardChan = await request('/api/reconciliation/channels', token, 'POST', {
      name: 'Card-CashE2E',
      channel_type: 'card',
    })
    requireResult(cardChan.status === 201, 'create card channel failed', cardChan)
    const voucherChan = await request('/api/reconciliation/channels', token, 'POST', {
      name: '탐나는전',
      channel_type: 'app_voucher',
    })
    requireResult(voucherChan.status === 201, 'create voucher channel failed', voucherChan)

    console.log('\n========== (a) cash sale is stored ==========')
    const cashDate = '2026-08-10'
    const cashGross = 30000
    const cashSale = await request('/api/reconciliation/sales', token, 'POST', {
      sale_date: cashDate,
      gross_amount: cashGross,
      channel_id: cashId,
      sale_kind: 'cash',
      entry_source: 'manual',
    })
    requireResult(cashSale.status === 201, 'create cash sale failed (paste sale_kind CHECK SQL if 400)', cashSale)
    const cashSaleId = cashSale.body.id as string
    const cashDb = await dbSale(cashSaleId)
    requireResult(cashDb, 'cash sale missing in DB', cashDb)
    requireResult(cashDb.sale_kind === 'cash', 'sale_kind is not cash', cashDb)
    requireResult(Number(cashDb.gross_amount) === cashGross, 'gross_amount not persisted', cashDb)
    requireResult(Number(cashDb.expected_net_amount) === cashGross, 'expected_net_amount should equal gross', cashDb)
    requireResult(
      cashDb.expected_deposit_date == null,
      'expected_deposit_date should be null (no deposit expected)',
      cashDb
    )
    console.log('CONFIRMED (a): cash sale stored, expected_net=gross, expected_deposit_date=null')

    // Deposit-settling counterparts so other engines still match.
    const transferSale = await request('/api/reconciliation/sales', token, 'POST', {
      sale_date: cashDate,
      gross_amount: 30000,
      channel_id: transferChan.body.id,
    })
    requireResult(transferSale.status === 201, 'create transfer sale failed', transferSale)
    const transferDep = await request('/api/reconciliation/deposits', token, 'POST', {
      deposit_date: cashDate,
      actual_amount: 30000,
      channel_hint: transferChan.body.id,
      confirm_status: 'confirmed',
    })
    requireResult(transferDep.status === 201, 'create transfer deposit failed', transferDep)

    const cardSale = await request('/api/reconciliation/sales', token, 'POST', {
      sale_date: cashDate,
      gross_amount: 100000,
      channel_id: cardChan.body.id,
      sale_kind: 'card',
    })
    requireResult(cardSale.status === 201, 'create card sale failed', cardSale)
    const cardDep = await request('/api/reconciliation/deposits', token, 'POST', {
      deposit_date: addDays(cashDate, 2),
      actual_amount: 97500,
      channel_hint: cardChan.body.id,
      confirm_status: 'confirmed',
    })
    requireResult(cardDep.status === 201, 'create card deposit failed', cardDep)

    const voucherSale = await request('/api/reconciliation/sales', token, 'POST', {
      sale_date: cashDate,
      gross_amount: 20000,
      channel_id: voucherChan.body.id,
      sale_kind: 'app_voucher',
    })
    requireResult(voucherSale.status === 201, 'create voucher sale failed', voucherSale)
    const voucherDep = await request('/api/reconciliation/deposits', token, 'POST', {
      deposit_date: cashDate,
      actual_amount: 20000,
      channel_hint: voucherChan.body.id,
      confirm_status: 'confirmed',
    })
    requireResult(voucherDep.status === 201, 'create voucher deposit failed', voucherDep)

    console.log('\n========== (b) no reconciler flags cash missing_deposit ==========')
    const reconT = await request('/api/reconciliation/reconcile', token, 'POST', {})
    requireResult(reconT.status === 201, 'reconcile transfer failed', reconT)
    const reconC = await request('/api/reconciliation/reconcile-card', token, 'POST', {})
    requireResult(reconC.status === 201, 'reconcile-card failed', reconC)
    const reconV = await request('/api/reconciliation/reconcile-app-voucher', token, 'POST', {})
    requireResult(reconV.status === 201, 'reconcile-app-voucher failed', reconV)

    const results = await request('/api/reconciliation/results', token)
    requireResult(results.status === 200, 'GET results failed', results)
    const list = Array.isArray(results.body) ? results.body : []

    function reconForSale(saleId: string) {
      return list.find((r: any) => r.matches?.some((m: any) => m.sales_record_id === saleId))
    }

    const cashRecon = reconForSale(cashSaleId)
    requireResult(!cashRecon, 'cash sale was pulled into a reconciliation (must be skipped)', cashRecon)
    const anyCashMissing = list.some(
      (r: any) =>
        r.status === 'missing_deposit' &&
        r.matches?.some((m: any) => m.sales_record_id === cashSaleId)
    )
    requireResult(!anyCashMissing, 'cash sale flagged missing_deposit', list)

    const rT = reconForSale(transferSale.body.id)
    const rC = reconForSale(cardSale.body.id)
    const rV = reconForSale(voucherSale.body.id)
    requireResult(rT?.status === 'matched', 'transfer sale should still match', rT)
    requireResult(rC?.status === 'matched', 'card sale should still match on net', rC)
    requireResult(rV?.status === 'matched', 'app_voucher sale should still match', rV)
    console.log('CONFIRMED (b): cash skipped by all matchers; transfer/card/voucher still matched')

    console.log('\n========== (c) cash included in revenue sum ==========')
    const salesList = await request('/api/reconciliation/sales', token)
    requireResult(salesList.status === 200 && Array.isArray(salesList.body), 'GET sales failed', salesList)
    const revenue = (salesList.body as any[]).reduce((sum, row) => sum + Number(row.gross_amount), 0)
    const expectedRevenue = cashGross + 30000 + 100000 + 20000
    console.log(`revenue sum of GET /sales = ${revenue} (expected ${expectedRevenue})`)
    requireResult(revenue === expectedRevenue, 'revenue sum does not include cash', { revenue, expectedRevenue })
    requireResult(
      (salesList.body as any[]).some((row) => row.id === cashSaleId),
      'cash sale missing from GET /sales',
      salesList
    )
    console.log('CONFIRMED (c): cash gross is included in the sales revenue sum')

    console.log('\n========== ALL LIVE CASH CHECKS PASSED ==========')
  } finally {
    if (userId) {
      const cleanup = await supabaseAdmin.auth.admin.deleteUser(userId)
      console.log(
        `\nCleanup ${userId}: ${cleanup.error ? `ERROR ${cleanup.error.message}` : 'OK (rows cascaded)'}`
      )
      if (cleanup.error) process.exitCode = 1
    }
  }
}

main().catch((error) => {
  console.error(
    `\nVERIFICATION STOPPED: ${error instanceof Error ? error.stack ?? error.message : String(error)}`
  )
  process.exit(1)
})
