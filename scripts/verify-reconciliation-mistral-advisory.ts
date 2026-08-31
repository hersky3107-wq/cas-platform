/**
 * Live-verify Mistral Medium 3.5 as the 3rd advisory model.
 * Cases: (a) baemin extra 7500 deduction, (b) normal card fee −2500,
 * (c) 59% anomaly. Throwaway user, clean up.
 *
 * Run (dev server must already be up on localhost:3000):
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/verify-reconciliation-mistral-advisory.ts
 */
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '../lib/supabase/server'

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000'

type Probe = { status: number; body: any; elapsedMs: number }

async function request(
  pathName: string,
  token: string,
  method = 'GET',
  json?: Record<string, unknown>
): Promise<Probe> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  if (json) headers['Content-Type'] = 'application/json'
  const t0 = Date.now()
  const response = await fetch(`${BASE}${pathName}`, {
    method,
    headers,
    body: json ? JSON.stringify(json) : undefined,
  })
  const elapsedMs = Date.now() - t0
  const text = await response.text()
  let body: any
  try {
    body = JSON.parse(text)
  } catch {
    body = { raw: text.slice(0, 800) }
  }
  return { status: response.status, body, elapsedMs }
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

function printReport(title: string, explain: Probe) {
  const a = explain.body.advisory
  const timings = Array.isArray(explain.body.model_timings) ? explain.body.model_timings : []
  const votes = Array.isArray(a?.per_model) ? a.per_model : []

  console.log(`\n======================================================`)
  console.log(`>>> ${title}`)
  console.log(`======================================================`)
  console.log(
    `HTTP ${explain.status}  client_wall=${explain.elapsedMs}ms  server_wall=${explain.body.wall_clock_ms}ms  cached=${explain.body.cached}`
  )
  console.log('\n--- PER-MODEL VOTES ---')
  votes.forEach((v: any, i: number) => {
    console.log(`[${i + 1}] Model: ${v.model}`)
    console.log(`    Cause:      ${v.cause}`)
    console.log(`    Confidence: ${v.confidence}`)
    console.log(`    Reasoning:  ${v.reasoning}`)
  })
  console.log('\n--- PER-MODEL TIMINGS (verbatim) ---')
  timings.forEach((t: any) => {
    console.log(`  model=${t.model}  elapsed_ms=${t.elapsed_ms}  ok=${t.ok}`)
  })
  console.log(`  wall_clock_ms (server Promise.all)=${explain.body.wall_clock_ms}`)
  console.log(`  wall_clock_ms (HTTP client)=${explain.elapsedMs}`)
  console.log('\n--- CONSENSUS ---')
  console.log(`  consensus_cause=${a?.consensus_cause ?? a?.estimated_cause}`)
  console.log(`  final_confidence=${a?.final_confidence ?? a?.confidence}`)
  console.log(`  agreement=${a?.agreement}`)
  console.log(`  models_responded=${a?.models_responded}/${a?.models_requested}`)
  console.log(`  status=${explain.body.status}`)
}

const anon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

async function main() {
  let userId: string | null = null
  try {
    const email = `recon-mistral-adv-${Date.now()}@example.com`
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

    // ── a. KEY: baemin extra 7500 beyond 27.5% ────────────────────────────
    const baemin = await request('/api/reconciliation/channels', token, 'POST', { preset: 'baemin' })
    requireResult(baemin.status === 201, 'baemin preset failed', baemin)
    const baeminId = baemin.body.id as string
    const saleDateA = '2026-07-10'
    const settleA = addDays(saleDateA, 3)
    const saleA = await request('/api/reconciliation/sales', token, 'POST', {
      sale_date: saleDateA,
      gross_amount: 100000,
      channel_id: baeminId,
      sale_kind: 'card',
      entry_source: 'manual',
    })
    requireResult(
      saleA.status === 201 && Number(saleA.body.expected_net_amount) === 72500,
      'baemin sale expected_net not 72500',
      saleA
    )
    const depA = await request('/api/reconciliation/deposits', token, 'POST', {
      deposit_date: settleA,
      actual_amount: 65000,
      channel_hint: baeminId,
      confirm_status: 'confirmed',
    })
    requireResult(depA.status === 201, 'baemin deposit failed', depA)
    const reconA = await request('/api/reconciliation/reconcile-card', token, 'POST', {
      channel_id: baeminId,
    })
    requireResult(reconA.status === 201, 'reconcile-card A failed', reconA)
    const mismatchA = reconA.body.created?.find((row: any) =>
      row.matches?.some((m: any) => m.sales_record_id === saleA.body.id)
    )
    requireResult(mismatchA?.status === 'amount_mismatch', 'A expected amount_mismatch', reconA)
    requireResult(Number(mismatchA.discrepancy_amount) === 7500, 'A discrepancy not 7500', mismatchA)
    const explainA = await request('/api/reconciliation/explain-discrepancy', token, 'POST', {
      reconciliation_id: mismatchA.id,
    })
    requireResult(explainA.status === 200, 'explain A failed', explainA)
    requireResult(explainA.body.status === 'amount_mismatch', 'A status changed', explainA)
    printReport('A. BAEMIN EXTRA 7500 (expected 72500, deposit 65000)', explainA)

    // ── b. Normal fee −2500 ───────────────────────────────────────────────
    const card = await request('/api/reconciliation/channels', token, 'POST', {
      name: 'Card-MistralSanity',
      channel_type: 'card',
    })
    requireResult(card.status === 201, 'card channel failed', card)
    const cardId = card.body.id as string
    const rule = await request('/api/reconciliation/rules', token, 'POST', {
      channel_id: cardId,
      fee_type: 'percent',
      fee_rate: 2.5,
      settlement_days: 2,
      tolerance_won: 1,
      tolerance_days: 0,
      notes: 'mistral sanity 2.5% T+2',
    })
    requireResult(rule.status === 201, 'card rule failed', rule)
    const saleDateB = '2026-07-20'
    const settleB = addDays(saleDateB, 2)
    const saleB = await request('/api/reconciliation/sales', token, 'POST', {
      sale_date: saleDateB,
      gross_amount: 100000,
      channel_id: cardId,
      sale_kind: 'card',
      entry_source: 'manual',
    })
    requireResult(saleB.status === 201, 'sale B failed', saleB)
    const depB = await request('/api/reconciliation/deposits', token, 'POST', {
      deposit_date: settleB,
      actual_amount: 100000,
      channel_hint: cardId,
      confirm_status: 'confirmed',
    })
    requireResult(depB.status === 201, 'deposit B failed', depB)
    const reconB = await request('/api/reconciliation/reconcile-card', token, 'POST', {
      channel_id: cardId,
    })
    requireResult(reconB.status === 201, 'reconcile-card B failed', reconB)
    const mismatchB = reconB.body.created?.find((row: any) =>
      row.matches?.some((m: any) => m.sales_record_id === saleB.body.id)
    )
    requireResult(mismatchB?.status === 'amount_mismatch', 'B expected amount_mismatch', reconB)
    const explainB = await request('/api/reconciliation/explain-discrepancy', token, 'POST', {
      reconciliation_id: mismatchB.id,
    })
    requireResult(explainB.status === 200, 'explain B failed', explainB)
    printReport('B. NORMAL FEE (−2500: expected 97500, deposit 100000)', explainB)

    // ── c. Anomaly 59% gap ────────────────────────────────────────────────
    const saleDateC = '2026-07-25'
    const settleC = addDays(saleDateC, 2)
    const saleC = await request('/api/reconciliation/sales', token, 'POST', {
      sale_date: saleDateC,
      gross_amount: 100000,
      channel_id: cardId,
      sale_kind: 'card',
      entry_source: 'manual',
    })
    requireResult(saleC.status === 201, 'sale C failed', saleC)
    const depC = await request('/api/reconciliation/deposits', token, 'POST', {
      deposit_date: settleC,
      actual_amount: 40000,
      channel_hint: cardId,
      confirm_status: 'confirmed',
    })
    requireResult(depC.status === 201, 'deposit C failed', depC)
    const reconC = await request('/api/reconciliation/reconcile-card', token, 'POST', {
      channel_id: cardId,
    })
    requireResult(reconC.status === 201, 'reconcile-card C failed', reconC)
    const mismatchC = reconC.body.created?.find((row: any) =>
      row.matches?.some((m: any) => m.sales_record_id === saleC.body.id)
    )
    requireResult(mismatchC?.status === 'amount_mismatch', 'C expected amount_mismatch', reconC)
    const explainC = await request('/api/reconciliation/explain-discrepancy', token, 'POST', {
      reconciliation_id: mismatchC.id,
    })
    requireResult(explainC.status === 200, 'explain C failed', explainC)
    printReport('C. ANOMALY (expected 97500, deposit 40000, ~59% gap)', explainC)

    console.log('\n========== MISTRAL ADVISORY LIVE-VERIFY COMPLETE ==========')
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
