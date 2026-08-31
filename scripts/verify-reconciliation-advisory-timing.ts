/**
 * One-shot live timing of the multi-AI advisory roster (ADVISORY_MODELS).
 *
 * Creates a throwaway user, one card amount_mismatch, POSTs
 * /explain-discrepancy once, prints per-model votes + timings, then deletes
 * the user. Stops on the first unexpected failure. Does NOT patch engine.
 *
 * Run (dev server must already be up on localhost:3000):
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/verify-reconciliation-advisory-timing.ts
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
  console.log(
    `\n${method} ${pathName}\nHTTP ${response.status} (client wall ${elapsedMs}ms)\n${JSON.stringify(body, null, 2)}`
  )
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

const anon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

async function main() {
  let userId: string | null = null
  try {
    const email = `recon-advisory-timing-${Date.now()}@example.com`
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
      name: 'Card-AdvisoryTiming',
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
      notes: 'advisory-timing 2.5% T+2',
    })
    requireResult(rule.status === 201, 'create card rule failed', rule)

    const saleDate = '2026-07-10'
    const settle = addDays(saleDate, 2)
    const sale = await request('/api/reconciliation/sales', token, 'POST', {
      sale_date: saleDate,
      gross_amount: 100000,
      channel_id: cardId,
      sale_kind: 'card',
      entry_source: 'manual',
    })
    requireResult(sale.status === 201, 'create sale failed', sale)

    const dep = await request('/api/reconciliation/deposits', token, 'POST', {
      deposit_date: settle,
      actual_amount: 100000,
      channel_hint: cardId,
      confirm_status: 'confirmed',
    })
    requireResult(dep.status === 201, 'create deposit failed', dep)

    const recon = await request('/api/reconciliation/reconcile-card', token, 'POST', {
      channel_id: cardId,
    })
    requireResult(recon.status === 201, 'reconcile-card failed', recon)
    const mismatch = recon.body.created?.find((row: any) =>
      row.matches?.some((m: any) => m.sales_record_id === sale.body.id)
    )
    requireResult(mismatch?.status === 'amount_mismatch', 'expected amount_mismatch', recon)
    const reconId = mismatch.id as string
    console.log(`reconciliation_id=${reconId} discrepancy_amount=${mismatch.discrepancy_amount}`)

    const explain = await request('/api/reconciliation/explain-discrepancy', token, 'POST', {
      reconciliation_id: reconId,
    })
    requireResult(explain.status === 200, 'explain-discrepancy failed', explain)
    requireResult(explain.body.status === 'amount_mismatch', 'status changed away from amount_mismatch', explain)
    requireResult(explain.body.cached !== true, 'unexpected cache hit on first call', explain)

    const { data: dbRow, error: dbErr } = await supabaseAdmin
      .from('reconciliations')
      .select('id, status, discrepancy_advisory, resolved')
      .eq('id', reconId)
      .eq('user_id', userId)
      .maybeSingle()
    requireResult(!dbErr && dbRow, 'DB recon read failed', dbErr)
    requireResult(dbRow.status === 'amount_mismatch', 'DB status is not amount_mismatch', dbRow)

    const a = explain.body.advisory
    const timings = Array.isArray(explain.body.model_timings) ? explain.body.model_timings : []
    const votes = Array.isArray(a?.per_model) ? a.per_model : []

    console.log('\n========== PER-MODEL VOTES ==========')
    votes.forEach((v: any, i: number) => {
      console.log(`  [${i}] model=${v.model}  cause=${v.cause}  confidence=${v.confidence}`)
    })

    console.log('\n========== PER-MODEL TIMINGS (verbatim) ==========')
    timings.forEach((t: any) => {
      console.log(`  model=${t.model}  elapsed_ms=${t.elapsed_ms}  ok=${t.ok}`)
    })
    console.log(`  wall_clock_ms (server Promise.all)=${explain.body.wall_clock_ms}`)
    console.log(`  wall_clock_ms (HTTP client)=${explain.elapsedMs}`)

    console.log('\n========== CONSENSUS ==========')
    console.log(`  consensus_cause=${a?.consensus_cause ?? a?.estimated_cause}`)
    console.log(`  final_confidence=${a?.final_confidence ?? a?.confidence}`)
    console.log(`  agreement=${a?.agreement}`)
    console.log(`  models_responded=${a?.models_responded}/${a?.models_requested}`)
    console.log(`  status=${explain.body.status} (DB ${dbRow.status})`)
    console.log(`  resolved=${dbRow.resolved}`)

    requireResult(timings.length === 3, 'expected 3 model_timings entries', timings)
    requireResult(
      typeof explain.body.wall_clock_ms === 'number',
      'wall_clock_ms missing from response',
      explain.body
    )
    console.log('\n========== TIMING RUN COMPLETE ==========')
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
