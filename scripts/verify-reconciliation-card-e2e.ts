/**
 * STAGE-2c CARD-TYPE — E2E VERIFICATION (real HTTP + live remote DB).
 *
 * Cases C-A (net matched, expected_* persisted), C-B (gross must NOT match),
 * C-C (batch N:M with fee), C-D (no cross-contamination). Stops on the first
 * unexpected failure. Does NOT patch schema, engine, or DAL.
 *
 * Run (dev server must already be up on localhost:3000):
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/verify-reconciliation-card-e2e.ts
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

async function dbDeposit(id: string) {
  const { data, error } = await supabaseAdmin
    .from('deposit_records')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId!)
    .maybeSingle()
  if (error) throw new Error(`DB deposit read failed: ${error.message}`)
  console.log(`DB deposit: ${JSON.stringify(data)}`)
  return data as Record<string, unknown> | null
}

async function dbRule(channelId: string) {
  const { data, error } = await supabaseAdmin
    .from('reconciliation_rules')
    .select('*')
    .eq('channel_id', channelId)
  if (error) throw new Error(`DB rules read failed: ${error.message}`)
  console.log(`DB rules for channel: ${JSON.stringify(data)}`)
  return (data ?? []) as Record<string, unknown>[]
}

async function main() {
  try {
    const email = `recon-card-verify-${Date.now()}@example.com`
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

    console.log('\n========== CASE C-A: card matched on NET ==========')

    const cardChan = await request('/api/reconciliation/channels', token, 'POST', {
      name: 'Card-CA',
      channel_type: 'card',
    })
    requireResult(cardChan.status === 201, 'create card channel failed', cardChan)
    const cardId = cardChan.body.id as string

    const rulesBefore = await request(`/api/reconciliation/rules?channel_id=${cardId}`, token)
    requireResult(rulesBefore.status === 200, 'list rules failed', rulesBefore)
    console.log(
      Array.isArray(rulesBefore.body) && rulesBefore.body.length === 0
        ? 'No stored rule yet — CARD_RULE in-code default (2.5%, T+2) should apply.'
        : `Stored rules already present: ${JSON.stringify(rulesBefore.body)}`
    )

    const explicitRule = await request('/api/reconciliation/rules', token, 'POST', {
      channel_id: cardId,
      fee_type: 'percent',
      fee_rate: 2.5,
      settlement_days: 2,
      tolerance_won: 1,
      tolerance_days: 0,
      notes: 'C-A explicit card rule for live verify',
    })
    requireResult(explicitRule.status === 201, 'create explicit card rule failed', explicitRule)
    requireResult(
      Number(explicitRule.body.fee_rate) === 2.5 && Number(explicitRule.body.settlement_days) === 2,
      'explicit rule is not 2.5% / T+2',
      explicitRule
    )
    console.log(`DB rules after POST: ${JSON.stringify(await dbRule(cardId))}`)

    const saleDateCA = '2026-07-01'
    const settleCA = addDays(saleDateCA, 2)
    const saleCA = await request('/api/reconciliation/sales', token, 'POST', {
      sale_date: saleDateCA,
      gross_amount: 100000,
      channel_id: cardId,
      sale_kind: 'card',
      entry_source: 'manual',
    })
    requireResult(saleCA.status === 201, 'create C-A sale failed', saleCA)
    const saleCAId = saleCA.body.id as string
    const saleCAGet = await request(`/api/reconciliation/sales/${saleCAId}`, token)
    requireResult(saleCAGet.status === 200, 'GET C-A sale failed', saleCAGet)
    const saleCADb = await dbSale(saleCAId)
    requireResult(saleCADb, 'C-A sale missing in DB', saleCADb)
    requireResult(saleCADb.sale_kind === 'card', 'C-A sale_kind is not card', saleCADb)
    requireResult(Number(saleCADb.expected_net_amount) === 97500, 'C-A expected_net_amount not 97500', saleCADb)
    requireResult(
      saleCADb.expected_deposit_date === settleCA,
      `C-A expected_deposit_date not ${settleCA}`,
      saleCADb
    )
    console.log('CONFIRMED C-A.2: expected_net_amount=97500 and expected_deposit_date=sale_date+2 persisted')

    const depCA = await request('/api/reconciliation/deposits', token, 'POST', {
      deposit_date: settleCA,
      actual_amount: 97500,
      channel_hint: cardId,
      confirm_status: 'confirmed',
    })
    requireResult(depCA.status === 201, 'create C-A net deposit failed', depCA)
    const depCAId = depCA.body.id as string
    await dbDeposit(depCAId)

    const reconCA = await request('/api/reconciliation/reconcile-card', token, 'POST', {
      channel_id: cardId,
    })
    requireResult(reconCA.status === 201, 'reconcile-card C-A failed', reconCA)
    const matchedCA = reconCA.body.created?.find((row: any) =>
      row.matches?.some((m: any) => m.sales_record_id === saleCAId)
    )
    requireResult(matchedCA?.status === 'matched', 'C-A expected status matched', reconCA)
    requireResult(
      matchedCA.matches.some(
        (m: any) => m.sales_record_id === saleCAId && m.deposit_record_id === depCAId
      ),
      'C-A sale/deposit pair missing',
      matchedCA
    )
    console.log('CONFIRMED C-A: status=matched on NET 97500')

    console.log('\n========== CASE C-B: gross deposit must NOT match ==========')

    const saleDateCB = '2026-07-10'
    const settleCB = addDays(saleDateCB, 2)
    const saleCB = await request('/api/reconciliation/sales', token, 'POST', {
      sale_date: saleDateCB,
      gross_amount: 100000,
      channel_id: cardId,
      sale_kind: 'card',
      entry_source: 'manual',
    })
    requireResult(saleCB.status === 201, 'create C-B sale failed', saleCB)
    const saleCBId = saleCB.body.id as string
    const saleCBDb = await dbSale(saleCBId)
    requireResult(Number(saleCBDb?.expected_net_amount) === 97500, 'C-B expected_net not persisted', saleCBDb)

    const depCB = await request('/api/reconciliation/deposits', token, 'POST', {
      deposit_date: settleCB,
      actual_amount: 100000,
      channel_hint: cardId,
      confirm_status: 'confirmed',
    })
    requireResult(depCB.status === 201, 'create C-B gross deposit failed', depCB)
    const depCBId = depCB.body.id as string
    await dbDeposit(depCBId)

    const reconCB = await request('/api/reconciliation/reconcile-card', token, 'POST', {
      channel_id: cardId,
    })
    requireResult(reconCB.status === 201, 'reconcile-card C-B failed', reconCB)
    const mismatchCB = reconCB.body.created?.find((row: any) =>
      row.matches?.some((m: any) => m.sales_record_id === saleCBId)
    )
    requireResult(mismatchCB?.status === 'amount_mismatch', 'C-B expected amount_mismatch, NOT matched', reconCB)
    const disc = Number(mismatchCB.discrepancy_amount)
    console.log(`C-B signed discrepancy_amount=${disc} (engine = expected_net − actual; 97500 − 100000 = -2500)`)
    requireResult(
      mismatchCB.status !== 'matched' && Math.abs(disc) === 2500,
      'C-B discrepancy magnitude is not 2500',
      mismatchCB
    )
    requireResult(
      mismatchCB.matches.some(
        (m: any) => m.sales_record_id === saleCBId && m.deposit_record_id === depCBId
      ),
      'C-B pair missing',
      mismatchCB
    )
    console.log('CONFIRMED C-B: gross deposit is amount_mismatch')

    console.log('\n========== CASE C-C: batch N:M with fee ==========')

    const saleDateCC = '2026-07-20'
    const settleCC = addDays(saleDateCC, 2)
    const saleCC1 = await request('/api/reconciliation/sales', token, 'POST', {
      sale_date: saleDateCC,
      gross_amount: 60000,
      channel_id: cardId,
      sale_kind: 'card',
    })
    requireResult(saleCC1.status === 201, 'create C-C sale 60000 failed', saleCC1)
    const saleCC2 = await request('/api/reconciliation/sales', token, 'POST', {
      sale_date: saleDateCC,
      gross_amount: 40000,
      channel_id: cardId,
      sale_kind: 'card',
    })
    requireResult(saleCC2.status === 201, 'create C-C sale 40000 failed', saleCC2)
    const cc1Db = await dbSale(saleCC1.body.id)
    const cc2Db = await dbSale(saleCC2.body.id)
    requireResult(Number(cc1Db?.expected_net_amount) === 58500, 'C-C 60000 net not 58500', cc1Db)
    requireResult(Number(cc2Db?.expected_net_amount) === 39000, 'C-C 40000 net not 39000', cc2Db)

    const depCC = await request('/api/reconciliation/deposits', token, 'POST', {
      deposit_date: settleCC,
      actual_amount: 97500,
      channel_hint: cardId,
      confirm_status: 'confirmed',
    })
    requireResult(depCC.status === 201, 'create C-C batched deposit failed', depCC)
    await dbDeposit(depCC.body.id)

    const reconCC = await request('/api/reconciliation/reconcile-card', token, 'POST', {
      channel_id: cardId,
    })
    requireResult(reconCC.status === 201, 'reconcile-card C-C failed', reconCC)
    const batchCC = reconCC.body.created?.find(
      (row: any) =>
        row.matches?.some((m: any) => m.sales_record_id === saleCC1.body.id) &&
        row.matches?.some((m: any) => m.sales_record_id === saleCC2.body.id)
    )
    requireResult(batchCC?.status === 'matched', 'C-C expected batch matched', reconCC)
    requireResult(
      batchCC.matches.some(
        (m: any) => m.sales_record_id === saleCC1.body.id && m.deposit_record_id === depCC.body.id
      ) &&
        batchCC.matches.some(
          (m: any) => m.sales_record_id === saleCC2.body.id && m.deposit_record_id === depCC.body.id
        ),
      'C-C both sales not cross-linked to the one deposit',
      batchCC
    )
    console.log('CONFIRMED C-C: batch matched, both sales linked to one net deposit')

    console.log('\n========== CASE C-D: no cross-contamination ==========')

    const transferChan = await request('/api/reconciliation/channels', token, 'POST', {
      name: 'Transfer-CD',
      channel_type: 'transfer',
    })
    requireResult(transferChan.status === 201, 'create transfer channel failed', transferChan)
    const voucherChan = await request('/api/reconciliation/channels', token, 'POST', {
      name: '탐나는전',
      channel_type: 'app_voucher',
    })
    requireResult(voucherChan.status === 201, 'create voucher channel failed', voucherChan)

    const dateCD = '2026-08-05'
    const settleCD = addDays(dateCD, 2)

    const saleT = await request('/api/reconciliation/sales', token, 'POST', {
      sale_date: dateCD,
      gross_amount: 50000,
      channel_id: transferChan.body.id,
      sale_kind: 'card',
    })
    requireResult(saleT.status === 201, 'create transfer sale failed', saleT)
    const saleTDb = await dbSale(saleT.body.id)
    requireResult(
      Number(saleTDb?.expected_net_amount) === 50000 && saleTDb?.expected_deposit_date === dateCD,
      'C-D transfer sale expected_net should equal gross / same-day',
      saleTDb
    )

    const saleV = await request('/api/reconciliation/sales', token, 'POST', {
      sale_date: dateCD,
      gross_amount: 30000,
      channel_id: voucherChan.body.id,
      sale_kind: 'app_voucher',
    })
    requireResult(saleV.status === 201, 'create voucher sale failed', saleV)
    const saleVDb = await dbSale(saleV.body.id)
    requireResult(
      Number(saleVDb?.expected_net_amount) === 30000 && saleVDb?.expected_deposit_date === dateCD,
      'C-D voucher sale expected_net should equal gross / same-day',
      saleVDb
    )

    const saleC = await request('/api/reconciliation/sales', token, 'POST', {
      sale_date: dateCD,
      gross_amount: 100000,
      channel_id: cardId,
      sale_kind: 'card',
    })
    requireResult(saleC.status === 201, 'create card sale C-D failed', saleC)
    const saleCDb = await dbSale(saleC.body.id)
    requireResult(
      Number(saleCDb?.expected_net_amount) === 97500 && saleCDb?.expected_deposit_date === settleCD,
      'C-D card sale expected_* not persisted',
      saleCDb
    )

    const depT = await request('/api/reconciliation/deposits', token, 'POST', {
      deposit_date: dateCD,
      actual_amount: 50000,
      channel_hint: transferChan.body.id,
      confirm_status: 'confirmed',
    })
    requireResult(depT.status === 201, 'create transfer deposit failed', depT)
    const depV = await request('/api/reconciliation/deposits', token, 'POST', {
      deposit_date: dateCD,
      actual_amount: 30000,
      channel_hint: voucherChan.body.id,
      confirm_status: 'confirmed',
    })
    requireResult(depV.status === 201, 'create voucher deposit failed', depV)
    const depC = await request('/api/reconciliation/deposits', token, 'POST', {
      deposit_date: settleCD,
      actual_amount: 97500,
      channel_hint: cardId,
      confirm_status: 'confirmed',
    })
    requireResult(depC.status === 201, 'create card deposit C-D failed', depC)

    const reconT = await request('/api/reconciliation/reconcile', token, 'POST', {
      channel_id: transferChan.body.id,
    })
    requireResult(reconT.status === 201, 'reconcile transfer C-D failed', reconT)
    const reconV = await request('/api/reconciliation/reconcile-app-voucher', token, 'POST', {})
    requireResult(reconV.status === 201, 'reconcile-app-voucher C-D failed', reconV)
    const reconC = await request('/api/reconciliation/reconcile-card', token, 'POST', {
      channel_id: cardId,
    })
    requireResult(reconC.status === 201, 'reconcile-card C-D failed', reconC)

    const results = await request('/api/reconciliation/results', token)
    requireResult(results.status === 200, 'GET results C-D failed', results)
    const list = Array.isArray(results.body) ? results.body : []

    function reconForSale(saleId: string) {
      return list.find((r: any) => r.matches?.some((m: any) => m.sales_record_id === saleId))
    }

    const rT = reconForSale(saleT.body.id)
    const rV = reconForSale(saleV.body.id)
    const rC = reconForSale(saleC.body.id)
    console.log(`recon(transfer sale): ${JSON.stringify(rT)}`)
    console.log(`recon(voucher sale): ${JSON.stringify(rV)}`)
    console.log(`recon(card sale): ${JSON.stringify(rC)}`)

    requireResult(rT?.status === 'matched', 'C-D transfer sale not matched', rT)
    requireResult(rV?.status === 'matched', 'C-D voucher sale not matched', rV)
    requireResult(rC?.status === 'matched', 'C-D card sale not matched', rC)

    const tPaired = rT.matches.some(
      (m: any) => m.sales_record_id === saleT.body.id && m.deposit_record_id === depT.body.id
    )
    const vPaired = rV.matches.some(
      (m: any) => m.sales_record_id === saleV.body.id && m.deposit_record_id === depV.body.id
    )
    const cPaired = rC.matches.some(
      (m: any) => m.sales_record_id === saleC.body.id && m.deposit_record_id === depC.body.id
    )
    requireResult(tPaired && vPaired && cPaired, 'C-D each engine did not pair its own deposit', {
      tPaired,
      vPaired,
      cPaired,
    })
    requireResult(
      !rC.matches.some((m: any) => m.deposit_record_id === depT.body.id) &&
        !rC.matches.some((m: any) => m.deposit_record_id === depV.body.id),
      'C-D card engine stole another channel deposit',
      rC
    )
    requireResult(
      !rT.matches.some((m: any) => m.deposit_record_id === depC.body.id),
      'C-D transfer engine stole card deposit',
      rT
    )
    requireResult(
      !rV.matches.some((m: any) => m.deposit_record_id === depC.body.id),
      'C-D voucher engine stole card deposit',
      rV
    )

    const createdTIds = new Set((reconT.body.created ?? []).map((r: any) => r.id))
    const createdVIds = new Set((reconV.body.created ?? []).map((r: any) => r.id))
    const createdCIds = new Set((reconC.body.created ?? []).map((r: any) => r.id))
    requireResult(createdTIds.has(rT.id) && !createdTIds.has(rC.id) && !createdTIds.has(rV.id), 'C-D transfer reconcilers mixed channels', reconT)
    requireResult(createdVIds.has(rV.id) && !createdVIds.has(rC.id) && !createdVIds.has(rT.id), 'C-D voucher reconcilers mixed channels', reconV)
    requireResult(createdCIds.has(rC.id) && !createdCIds.has(rT.id) && !createdCIds.has(rV.id), 'C-D card reconcilers mixed channels', reconC)

    console.log('CONFIRMED C-D: each reconciler matched only its own channel')
    console.log('\n========== ALL LIVE CARD CHECKS PASSED ==========')
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
