/**
 * Diagnose claude-sonnet-5 ok:false on the baemin 7500-gap advisory.
 * Runs explain-discrepancy 3× with force:true. Does not stop on a missing vote.
 *
 * Run (dev server must already be up on localhost:3000):
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/verify-reconciliation-baemin-advisory-3x.ts
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

const anon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

async function main() {
  let userId: string | null = null
  try {
    const email = `recon-baemin-3x-${Date.now()}@example.com`
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

    const chan = await request('/api/reconciliation/channels', token, 'POST', { preset: 'baemin' })
    requireResult(chan.status === 201, 'preset baemin failed', chan)
    const baeminId = chan.body.id as string

    const saleDate = '2026-07-10'
    const settle = addDays(saleDate, 3)
    const sale = await request('/api/reconciliation/sales', token, 'POST', {
      sale_date: saleDate,
      gross_amount: 100000,
      channel_id: baeminId,
      sale_kind: 'card',
      entry_source: 'manual',
    })
    requireResult(sale.status === 201 && Number(sale.body.expected_net_amount) === 72500, 'sale failed', sale)

    const dep = await request('/api/reconciliation/deposits', token, 'POST', {
      deposit_date: settle,
      actual_amount: 65000,
      channel_hint: baeminId,
      confirm_status: 'confirmed',
    })
    requireResult(dep.status === 201, 'deposit failed', dep)

    const recon = await request('/api/reconciliation/reconcile-card', token, 'POST', {
      channel_id: baeminId,
    })
    requireResult(recon.status === 201, 'reconcile-card failed', recon)
    const mismatch = recon.body.created?.find((row: any) =>
      row.matches?.some((m: any) => m.sales_record_id === sale.body.id)
    )
    requireResult(mismatch?.status === 'amount_mismatch', 'expected amount_mismatch', recon)
    const reconId = mismatch.id as string
    console.log(`reconciliation_id=${reconId} discrepancy_amount=${mismatch.discrepancy_amount}`)

    const claudeStats = { ok: 0, fail: 0 }

    for (let i = 1; i <= 3; i++) {
      const explain = await request('/api/reconciliation/explain-discrepancy', token, 'POST', {
        reconciliation_id: reconId,
        force: true,
      })
      requireResult(explain.status === 200, `explain run ${i} HTTP not 200`, explain)

      const a = explain.body.advisory
      const timings = Array.isArray(explain.body.model_timings) ? explain.body.model_timings : []
      const votes = Array.isArray(a?.per_model) ? a.per_model : []

      console.log(`\n======================================================`)
      console.log(`>>> RUN ${i}  HTTP ${explain.status}  client_wall=${explain.elapsedMs}ms  server_wall=${explain.body.wall_clock_ms}ms`)
      console.log(`======================================================`)
      console.log('--- TIMINGS ---')
      timings.forEach((t: any) => {
        console.log(`  model=${t.model}  elapsed_ms=${t.elapsed_ms}  ok=${t.ok}`)
      })
      console.log('--- VOTES ---')
      votes.forEach((v: any) => {
        console.log(`  model=${v.model}  confidence=${v.confidence}  cause=${v.cause}`)
        console.log(`    reasoning=${v.reasoning}`)
      })
      console.log(
        `  consensus=${a?.consensus_cause ?? a?.estimated_cause}  final_confidence=${a?.final_confidence ?? a?.confidence}  agreement=${a?.agreement}  responded=${a?.models_responded}/${a?.models_requested}`
      )

      const claude = timings.find((t: any) => t.model === 'claude-sonnet-5')
      if (claude?.ok) claudeStats.ok += 1
      else claudeStats.fail += 1
    }

    console.log('\n========== CLAUDE-SONNET-5 SUMMARY ==========')
    console.log(`  succeeded: ${claudeStats.ok}/3`)
    console.log(`  failed:    ${claudeStats.fail}/3`)
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
