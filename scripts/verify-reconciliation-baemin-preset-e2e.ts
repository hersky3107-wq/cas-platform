/**
 * Live-verify a delivery-preset (baemin) channel end-to-end, including
 * the multi-AI advisory. Verification only — stops on first unexpected
 * failure. Does NOT patch schema, engine, or DAL.
 *
 * Run (dev server must already be up on localhost:3000):
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/verify-reconciliation-baemin-preset-e2e.ts
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
    const email = `recon-baemin-preset-${Date.now()}@example.com`
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

    // ── 1. POST /channels {preset: baemin} ────────────────────────────────
    const chan = await request('/api/reconciliation/channels', token, 'POST', {
      preset: 'baemin',
    })
    requireResult(chan.status === 201, 'POST /channels preset=baemin failed', chan)
    requireResult(chan.body.channel_type === 'card', 'channel_type is not card', chan.body)
    requireResult(chan.body.name === '배달의민족', 'channel name is not 배달의민족', chan.body)
    const baeminId = chan.body.id as string

    const { data: dbChan, error: chanErr } = await supabaseAdmin
      .from('payment_channels')
      .select('*')
      .eq('id', baeminId)
      .eq('user_id', userId)
      .maybeSingle()
    requireResult(!chanErr && dbChan, 'DB channel read failed', chanErr)
    console.log(`\nDB payment_channels: ${JSON.stringify(dbChan, null, 2)}`)

    const { data: dbRules, error: rulesErr } = await supabaseAdmin
      .from('reconciliation_rules')
      .select('*')
      .eq('channel_id', baeminId)
    requireResult(!rulesErr, 'DB rules read failed', rulesErr)
    requireResult(Array.isArray(dbRules) && dbRules.length === 1, 'expected exactly 1 seeded rule', dbRules)
    const rule = dbRules[0]
    console.log(`\nDB reconciliation_rules: ${JSON.stringify(rule, null, 2)}`)
    requireResult(Number(rule.fee_rate) === 27.5, 'seeded fee_rate is not 27.5', rule)
    requireResult(Number(rule.settlement_days) === 3, 'seeded settlement_days is not 3', rule)
    requireResult(rule.fee_type === 'percent', 'seeded fee_type is not percent', rule)

    // ── 2. Sale gross 100000 → expected_net ≈ 72500, date = sale+3 ────────
    const saleDate = '2026-07-10'
    const settle = addDays(saleDate, 3)
    const sale = await request('/api/reconciliation/sales', token, 'POST', {
      sale_date: saleDate,
      gross_amount: 100000,
      channel_id: baeminId,
      sale_kind: 'card',
      entry_source: 'manual',
    })
    requireResult(sale.status === 201, 'create baemin sale failed', sale)
    requireResult(Number(sale.body.expected_net_amount) === 72500, 'expected_net_amount is not 72500 (seeded 27.5% not applied — maybe 2.5% card default?)', sale.body)
    requireResult(
      sale.body.expected_deposit_date === settle,
      `expected_deposit_date is not sale_date+3 (${settle})`,
      sale.body
    )
    requireResult(sale.body.expected_deposit_date !== addDays(saleDate, 2), 'looks like CARD_RULE D+2 leaked in', sale.body)

    const { data: dbSale, error: saleErr } = await supabaseAdmin
      .from('sales_records')
      .select('*')
      .eq('id', sale.body.id)
      .eq('user_id', userId)
      .maybeSingle()
    requireResult(!saleErr && dbSale, 'DB sale read failed', saleErr)
    console.log(`\nDB sales_records: ${JSON.stringify(dbSale, null, 2)}`)
    requireResult(Number(dbSale.expected_net_amount) === 72500, 'DB expected_net_amount is not 72500', dbSale)
    requireResult(dbSale.expected_deposit_date === settle, 'DB expected_deposit_date is not sale+3', dbSale)

    // ── 3. Deposit 65000 (not 72500) on D+3, hinted at 배민 → mismatch ────
    const dep = await request('/api/reconciliation/deposits', token, 'POST', {
      deposit_date: settle,
      actual_amount: 65000,
      channel_hint: baeminId,
      confirm_status: 'confirmed',
    })
    requireResult(dep.status === 201, 'create baemin deposit failed', dep)
    requireResult(dep.body.channel_hint === baeminId, 'deposit not hinted at baemin channel', dep.body)

    const recon = await request('/api/reconciliation/reconcile-card', token, 'POST', {
      channel_id: baeminId,
    })
    requireResult(recon.status === 201, 'reconcile-card failed', recon)
    const mismatch = recon.body.created?.find((row: any) =>
      row.matches?.some((m: any) => m.sales_record_id === sale.body.id)
    )
    requireResult(mismatch?.status === 'amount_mismatch', 'expected amount_mismatch', recon)
    requireResult(
      Number(mismatch.discrepancy_amount) === 7500,
      'discrepancy_amount is not 7500 (72500 expected vs 65000 received)',
      mismatch
    )
    const reconId = mismatch.id as string
    console.log(`reconciliation_id=${reconId} discrepancy_amount=${mismatch.discrepancy_amount}`)

    // ── 4. Multi-AI advisory ──────────────────────────────────────────────
    const explain = await request('/api/reconciliation/explain-discrepancy', token, 'POST', {
      reconciliation_id: reconId,
    })
    requireResult(explain.status === 200, 'explain-discrepancy failed', explain)
    requireResult(explain.body.status === 'amount_mismatch', 'status changed away from amount_mismatch', explain)
    requireResult(explain.body.cached !== true, 'unexpected cache hit on first call', explain)

    const a = explain.body.advisory
    const timings = Array.isArray(explain.body.model_timings) ? explain.body.model_timings : []
    const votes = Array.isArray(a?.per_model) ? a.per_model : []
    const models = votes.map((v: any) => v.model)
    requireResult(votes.length === 3, 'expected 3 per_model votes', votes)
    requireResult(models.includes('gpt-5.6-terra'), 'gpt-5.6-terra missing from votes', models)
    requireResult(models.includes('claude-sonnet-5'), 'claude-sonnet-5 missing from votes', models)
    requireResult(models.includes('HCX-007'), 'HCX-007 missing from votes', models)
    requireResult(a?.models_responded === 3, 'models_responded is not 3', a)
    requireResult(timings.length === 3, 'expected 3 model_timings', timings)

    const { data: dbRow, error: dbErr } = await supabaseAdmin
      .from('reconciliations')
      .select('id, status, discrepancy_advisory, resolved, discrepancy_amount')
      .eq('id', reconId)
      .eq('user_id', userId)
      .maybeSingle()
    requireResult(!dbErr && dbRow, 'DB recon read failed', dbErr)
    requireResult(dbRow.status === 'amount_mismatch', 'DB status is not amount_mismatch', dbRow)
    console.log(`\nDB reconciliations: ${JSON.stringify(dbRow, null, 2)}`)

    console.log('\n========== PER-MODEL VOTES ==========')
    votes.forEach((v: any, i: number) => {
      console.log(`[${i + 1}] Model: ${v.model}`)
      console.log(`    Cause:      ${v.cause}`)
      console.log(`    Confidence: ${v.confidence}`)
      console.log(`    Reasoning:  ${v.reasoning}`)
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

    // ── 5. No cross-contamination ─────────────────────────────────────────
    const reconT = await request('/api/reconciliation/reconcile', token, 'POST', {})
    requireResult(reconT.status === 201, 'reconcile (transfer) failed', reconT)
    const reconV = await request('/api/reconciliation/reconcile-app-voucher', token, 'POST', {})
    requireResult(reconV.status === 201, 'reconcile-app-voucher failed', reconV)

    const tCreated = Array.isArray(reconT.body.created) ? reconT.body.created : []
    const vCreated = Array.isArray(reconV.body.created) ? reconV.body.created : []
    const tStole = tCreated.some((row: any) =>
      row.matches?.some((m: any) => m.deposit_record_id === dep.body.id || m.sales_record_id === sale.body.id)
    )
    const vStole = vCreated.some((row: any) =>
      row.matches?.some((m: any) => m.deposit_record_id === dep.body.id || m.sales_record_id === sale.body.id)
    )
    requireResult(!tStole, 'transfer reconciler pulled the 배민 sale or deposit', reconT.body)
    requireResult(!vStole, 'app_voucher reconciler pulled the 배민 sale or deposit', reconV.body)
    requireResult(
      (reconT.body.summary?.created ?? tCreated.length) === 0,
      'transfer reconciler created rows (expected 0 — nothing to match)',
      reconT.body
    )
    requireResult(
      (reconV.body.summary?.created ?? vCreated.length) === 0,
      'app_voucher reconciler created rows (expected 0 — nothing to match)',
      reconV.body
    )

    const { data: matches, error: matchErr } = await supabaseAdmin
      .from('reconciliation_matches')
      .select('*')
      .eq('deposit_record_id', dep.body.id)
    requireResult(!matchErr, 'DB matches read failed', matchErr)
    console.log(`\nDB matches for baemin deposit: ${JSON.stringify(matches, null, 2)}`)
    requireResult(
      Array.isArray(matches) && matches.length === 1 && matches[0].reconciliation_id === reconId,
      'baemin deposit is not exclusively on the card mismatch',
      matches
    )

    console.log('\n========== BAEMIN PRESET E2E COMPLETE ==========')
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
