/**
 * Live measurement of HyperCLOVA X (HCX-007) + GPT-5.6 Terra + Claude Sonnet 5
 * multi-AI advisory on card amount_mismatch.
 *
 * Runs:
 * 1. Normal fee case (-2500 mismatch) — Run 1
 * 2. Normal fee case (-2500 mismatch) — Run 2 (force: true)
 * 3. Anomaly case (57500 gap, expected net 97500 vs deposit 40000)
 *
 * Clean up throwaway user after run.
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

function printReport(title: string, explain: Probe, dbStatus: string) {
  const a = explain.body.advisory
  const timings = Array.isArray(explain.body.model_timings) ? explain.body.model_timings : []
  const votes = Array.isArray(a?.per_model) ? a.per_model : []

  console.log(`\n======================================================`)
  console.log(`>>> ${title}`)
  console.log(`======================================================`)
  console.log(`HTTP ${explain.status} (client wall ${explain.elapsedMs}ms, server wall ${explain.body.wall_clock_ms}ms)`)

  console.log('\n--- PER-MODEL VOTES ---')
  votes.forEach((v: any, i: number) => {
    console.log(`[${i + 1}] Model: ${v.model}`)
    console.log(`    Cause:      ${v.cause}`)
    console.log(`    Confidence: ${v.confidence}`)
    console.log(`    Reasoning:  ${v.reasoning}`)
  })

  console.log('\n--- PER-MODEL TIMINGS (verbatim) ---')
  timings.forEach((t: any) => {
    console.log(`  model: ${t.model.padEnd(20)} | elapsed_ms: ${String(t.elapsed_ms).padStart(6)} ms | ok: ${t.ok}`)
  })
  console.log(`  wall_clock_ms (server Promise.all) : ${explain.body.wall_clock_ms} ms`)
  console.log(`  wall_clock_ms (HTTP client total)  : ${explain.elapsedMs} ms`)

  console.log('\n--- CONSENSUS & OUTCOME ---')
  console.log(`  consensus_cause  : ${a?.consensus_cause ?? a?.estimated_cause}`)
  console.log(`  final_confidence : ${a?.final_confidence ?? a?.confidence}`)
  console.log(`  agreement        : ${a?.agreement}`)
  console.log(`  models_responded : ${a?.models_responded}/${a?.models_requested}`)
  console.log(`  recon status     : ${explain.body.status} (DB: ${dbStatus})`)
}

const anon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

async function main() {
  let userId: string | null = null
  try {
    const email = `recon-hcx-timing-${Date.now()}@example.com`
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

    const chan = await request('/api/reconciliation/channels', token, 'POST', {
      name: 'Card-HCXTiming',
      channel_type: 'card',
    })
    requireResult(chan.status === 201, 'create card channel failed', chan)
    const cardId = chan.body.id as string

    const rule = await request('/api/reconciliation/rules', token, 'POST', {
      channel_id: cardId,
      fee_type: 'percent',
      fee_rate: 2.5,
      settlement_days: 2,
      tolerance_won: 1,
      tolerance_days: 0,
      notes: 'hcx-timing 2.5% T+2',
    })
    requireResult(rule.status === 201, 'create card rule failed', rule)

    // ==========================================
    // CASE 1: Normal fee mismatch (-2500)
    // ==========================================
    const saleDate1 = '2026-07-10'
    const settle1 = addDays(saleDate1, 2)
    const sale1 = await request('/api/reconciliation/sales', token, 'POST', {
      sale_date: saleDate1,
      gross_amount: 100000,
      channel_id: cardId,
      sale_kind: 'card',
      entry_source: 'manual',
    })
    requireResult(sale1.status === 201, 'create sale1 failed', sale1)

    const dep1 = await request('/api/reconciliation/deposits', token, 'POST', {
      deposit_date: settle1,
      actual_amount: 100000,
      channel_hint: cardId,
      confirm_status: 'confirmed',
    })
    requireResult(dep1.status === 201, 'create deposit1 failed', dep1)

    const recon1 = await request('/api/reconciliation/reconcile-card', token, 'POST', {
      channel_id: cardId,
    })
    requireResult(recon1.status === 201, 'reconcile-card failed', recon1)
    const mismatch1 = recon1.body.created?.find((row: any) =>
      row.matches?.some((m: any) => m.sales_record_id === sale1.body.id)
    )
    requireResult(mismatch1?.status === 'amount_mismatch', 'expected amount_mismatch for case 1', recon1)
    const reconId1 = mismatch1.id as string

    // Run 1 on normal mismatch
    const explain1 = await request('/api/reconciliation/explain-discrepancy', token, 'POST', {
      reconciliation_id: reconId1,
    })
    requireResult(explain1.status === 200, 'explain-discrepancy run 1 failed', explain1)

    const { data: dbRow1 } = await supabaseAdmin
      .from('reconciliations')
      .select('id, status, discrepancy_advisory, resolved')
      .eq('id', reconId1)
      .eq('user_id', userId)
      .maybeSingle()

    printReport('RUN 1: NORMAL FEE MISMATCH (-2,500 KRW gap)', explain1, dbRow1?.status)

    // Run 2 on normal mismatch with force: true
    const explain2 = await request('/api/reconciliation/explain-discrepancy', token, 'POST', {
      reconciliation_id: reconId1,
      force: true,
    })
    requireResult(explain2.status === 200, 'explain-discrepancy run 2 failed', explain2)

    const { data: dbRow2 } = await supabaseAdmin
      .from('reconciliations')
      .select('id, status, discrepancy_advisory, resolved')
      .eq('id', reconId1)
      .eq('user_id', userId)
      .maybeSingle()

    printReport('RUN 2 (FORCE: TRUE): NORMAL FEE MISMATCH (-2,500 KRW gap)', explain2, dbRow2?.status)

    // ==========================================
    // CASE 2: Anomaly case (57,500 gap ~ 59%)
    // Expected net 97,500, deposit only 40,000
    // ==========================================
    const saleDate2 = '2026-07-20'
    const settle2 = addDays(saleDate2, 2)
    const sale2 = await request('/api/reconciliation/sales', token, 'POST', {
      sale_date: saleDate2,
      gross_amount: 100000,
      channel_id: cardId,
      sale_kind: 'card',
      entry_source: 'manual',
    })
    requireResult(sale2.status === 201, 'create sale2 failed', sale2)

    const dep2 = await request('/api/reconciliation/deposits', token, 'POST', {
      deposit_date: settle2,
      actual_amount: 40000,
      channel_hint: cardId,
      confirm_status: 'confirmed',
    })
    requireResult(dep2.status === 201, 'create deposit2 failed', dep2)

    const recon2 = await request('/api/reconciliation/reconcile-card', token, 'POST', {
      channel_id: cardId,
    })
    requireResult(recon2.status === 201, 'reconcile-card case 2 failed', recon2)
    const mismatch2 = recon2.body.created?.find((row: any) =>
      row.matches?.some((m: any) => m.sales_record_id === sale2.body.id)
    )
    requireResult(mismatch2?.status === 'amount_mismatch', 'expected amount_mismatch for case 2', recon2)
    const reconId2 = mismatch2.id as string

    const explainAnomaly = await request('/api/reconciliation/explain-discrepancy', token, 'POST', {
      reconciliation_id: reconId2,
    })
    requireResult(explainAnomaly.status === 200, 'explain-discrepancy anomaly failed', explainAnomaly)

    const { data: dbRowAnomaly } = await supabaseAdmin
      .from('reconciliations')
      .select('id, status, discrepancy_advisory, resolved')
      .eq('id', reconId2)
      .eq('user_id', userId)
      .maybeSingle()

    printReport('ANOMALY CASE: 57,500 KRW GAP (~59% anomaly, deposit 40,000 vs net 97,500)', explainAnomaly, dbRowAnomaly?.status)

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
