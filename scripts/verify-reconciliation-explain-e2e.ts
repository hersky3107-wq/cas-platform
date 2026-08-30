/**
 * Single-AI discrepancy-explanation — LIVE E2E (real HTTP + remote DB + real AI).
 *
 * Verification only. Stops on the first unexpected failure. Does NOT patch
 * schema, matcher, or the explain layer.
 *
 * Run (dev server must already be up on localhost:3000):
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/verify-reconciliation-explain-e2e.ts
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
  console.log(`\n${method} ${path}\nHTTP ${response.status}\n${JSON.stringify(body, null, 2)}`)
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

function printAdvisory(label: string, advisory: unknown) {
  const a = advisory as Record<string, unknown> | null
  console.log(`\n----- ${label} ADVISORY (verbatim) -----`)
  console.log(`estimated_cause: ${a?.estimated_cause}`)
  console.log(`confidence:      ${a?.confidence}`)
  console.log(`reasoning:       ${a?.reasoning}`)
  console.log('----- end advisory -----')
}

const anon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

let userId: string | null = null

async function dbRecon(id: string) {
  const { data, error } = await supabaseAdmin
    .from('reconciliations')
    .select('id, status, discrepancy_amount, discrepancy_reason, discrepancy_advisory, resolved')
    .eq('id', id)
    .eq('user_id', userId!)
    .maybeSingle()
  if (error) throw new Error(`DB recon read failed: ${error.message}`)
  console.log(`DB recon: ${JSON.stringify(data)}`)
  return data as Record<string, unknown> | null
}

async function dbSale(id: string) {
  const { data, error } = await supabaseAdmin
    .from('sales_records')
    .select('id, gross_amount, expected_net_amount, expected_deposit_date, sale_date')
    .eq('id', id)
    .eq('user_id', userId!)
    .maybeSingle()
  if (error) throw new Error(`DB sale read failed: ${error.message}`)
  console.log(`DB sale: ${JSON.stringify(data)}`)
  return data as Record<string, unknown> | null
}

async function main() {
  try {
    const { data: col, error: colErr } = await supabaseAdmin
      .from('reconciliations')
      .select('discrepancy_advisory')
      .limit(1)
    requireResult(
      !colErr,
      'discrepancy_advisory column missing or unreadable — paste the SQL in SQL Editor first',
      colErr
    )
    console.log(`Column probe ok (sample row count ${Array.isArray(col) ? col.length : 0})`)

    const email = `recon-explain-verify-${Date.now()}@example.com`
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

    // ── 1. card mismatch: gross deposit vs 2.5% net ────────────────────────
    console.log('\n========== STEP 1: card amount_mismatch (gross deposit) ==========')

    const chan = await request('/api/reconciliation/channels', token, 'POST', {
      name: 'Card-Explain',
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
      notes: 'explain-e2e 2.5% T+2',
    })
    requireResult(rule.status === 201, 'create card rule failed', rule)

    const saleDate1 = '2026-07-10'
    const settle1 = addDays(saleDate1, 2)
    const sale1 = await request('/api/reconciliation/sales', token, 'POST', {
      sale_date: saleDate1,
      gross_amount: 100000,
      channel_id: cardId,
      sale_kind: 'card',
      entry_source: 'manual',
    })
    requireResult(sale1.status === 201, 'create step-1 sale failed', sale1)
    const sale1Db = await dbSale(sale1.body.id)
    requireResult(Number(sale1Db?.expected_net_amount) === 97500, 'expected_net not 97500', sale1Db)

    const dep1 = await request('/api/reconciliation/deposits', token, 'POST', {
      deposit_date: settle1,
      actual_amount: 100000,
      channel_hint: cardId,
      confirm_status: 'confirmed',
    })
    requireResult(dep1.status === 201, 'create step-1 gross deposit failed', dep1)

    const recon1 = await request('/api/reconciliation/reconcile-card', token, 'POST', {
      channel_id: cardId,
    })
    requireResult(recon1.status === 201, 'reconcile-card step-1 failed', recon1)
    const mismatch = recon1.body.created?.find((row: any) =>
      row.matches?.some((m: any) => m.sales_record_id === sale1.body.id)
    )
    requireResult(mismatch?.status === 'amount_mismatch', 'step-1 expected amount_mismatch', recon1)
    const disc = Number(mismatch.discrepancy_amount)
    console.log(
      `STEP 1 signed discrepancy_amount=${disc} (engine = expected_net − actual; 97500 − 100000 = -2500)`
    )
    requireResult(Math.abs(disc) === 2500, 'step-1 discrepancy magnitude is not 2500', mismatch)
    const mismatchId = mismatch.id as string
    console.log(`STEP 1 reconciliation_id=${mismatchId}`)

    // ── 2. explain ─────────────────────────────────────────────────────────
    console.log('\n========== STEP 2: POST explain-discrepancy ==========')
    const explain1 = await request('/api/reconciliation/explain-discrepancy', token, 'POST', {
      reconciliation_id: mismatchId,
    })
    requireResult(explain1.status === 200, 'explain-discrepancy step-2 failed', explain1)
    requireResult(explain1.body.status === 'amount_mismatch', 'AI changed status away from amount_mismatch', explain1)
    requireResult(explain1.body.advisory, 'no advisory object in response', explain1)
    printAdvisory('STEP 2', explain1.body.advisory)
    requireResult(
      typeof explain1.body.advisory.estimated_cause === 'string' &&
        explain1.body.advisory.estimated_cause.length > 0,
      'estimated_cause empty',
      explain1
    )
    requireResult(
      ['low', 'medium', 'high'].includes(explain1.body.advisory.confidence),
      'confidence not low|medium|high',
      explain1
    )
    requireResult(
      typeof explain1.body.advisory.reasoning === 'string' && explain1.body.advisory.reasoning.length > 0,
      'reasoning empty',
      explain1
    )

    const afterExplain = await dbRecon(mismatchId)
    requireResult(afterExplain?.status === 'amount_mismatch', 'DB status is no longer amount_mismatch', afterExplain)
    requireResult(afterExplain?.discrepancy_advisory != null, 'discrepancy_advisory jsonb not persisted', afterExplain)
    console.log('CONFIRMED STEP 2: status still amount_mismatch; discrepancy_advisory persisted')

    const getAfter = await request(`/api/reconciliation/results/${mismatchId}`, token)
    requireResult(getAfter.status === 200, 'GET recon after explain failed', getAfter)
    requireResult(getAfter.body.status === 'amount_mismatch', 'GET status changed', getAfter)

    // ── 3. cache ───────────────────────────────────────────────────────────
    console.log('\n========== STEP 3: second POST without force (cache) ==========')
    const t0 = Date.now()
    const explain2 = await request('/api/reconciliation/explain-discrepancy', token, 'POST', {
      reconciliation_id: mismatchId,
    })
    const elapsed = Date.now() - t0
    requireResult(explain2.status === 200, 'cached explain failed', explain2)
    requireResult(explain2.body.cached === true, 'expected cached:true (no second AI call)', explain2)
    requireResult(
      explain2.body.advisory?.estimated_cause === explain1.body.advisory.estimated_cause &&
        explain2.body.advisory?.reasoning === explain1.body.advisory.reasoning &&
        explain2.body.advisory?.confidence === explain1.body.advisory.confidence,
      'cached advisory does not match stored advisory',
      { first: explain1.body.advisory, second: explain2.body.advisory }
    )
    requireResult(explain2.body.status === 'amount_mismatch', 'cached call changed status', explain2)
    printAdvisory('STEP 3 (cached)', explain2.body.advisory)
    console.log(`CONFIRMED STEP 3: cached=true, elapsed=${elapsed}ms, advisory identical`)

    // ── 4. anomaly honesty: 57500 gap ──────────────────────────────────────
    console.log('\n========== STEP 4: anomaly honesty (deposit 40000 vs expected 97500) ==========')
    const saleDate4 = '2026-07-20'
    const settle4 = addDays(saleDate4, 2)
    const sale4 = await request('/api/reconciliation/sales', token, 'POST', {
      sale_date: saleDate4,
      gross_amount: 100000,
      channel_id: cardId,
      sale_kind: 'card',
      entry_source: 'manual',
    })
    requireResult(sale4.status === 201, 'create step-4 sale failed', sale4)
    const sale4Db = await dbSale(sale4.body.id)
    requireResult(Number(sale4Db?.expected_net_amount) === 97500, 'step-4 expected_net not 97500', sale4Db)

    const dep4 = await request('/api/reconciliation/deposits', token, 'POST', {
      deposit_date: settle4,
      actual_amount: 40000,
      channel_hint: cardId,
      confirm_status: 'confirmed',
    })
    requireResult(dep4.status === 201, 'create step-4 short deposit failed', dep4)

    const recon4 = await request('/api/reconciliation/reconcile-card', token, 'POST', {
      channel_id: cardId,
    })
    requireResult(recon4.status === 201, 'reconcile-card step-4 failed', recon4)
    const anomaly = recon4.body.created?.find((row: any) =>
      row.matches?.some((m: any) => m.sales_record_id === sale4.body.id)
    )
    requireResult(anomaly?.status === 'amount_mismatch', 'step-4 expected amount_mismatch', recon4)
    const disc4 = Number(anomaly.discrepancy_amount)
    console.log(`STEP 4 signed discrepancy_amount=${disc4} (97500 − 40000 = 57500)`)
    requireResult(Math.abs(disc4) === 57500, 'step-4 discrepancy magnitude is not 57500', anomaly)
    const anomalyId = anomaly.id as string

    const explain4 = await request('/api/reconciliation/explain-discrepancy', token, 'POST', {
      reconciliation_id: anomalyId,
    })
    requireResult(explain4.status === 200, 'explain-discrepancy step-4 failed', explain4)
    requireResult(explain4.body.status === 'amount_mismatch', 'step-4 AI changed status', explain4)
    printAdvisory('STEP 4 ANOMALY', explain4.body.advisory)

    const blob = `${explain4.body.advisory.estimated_cause} ${explain4.body.advisory.reasoning}`.toLowerCase()
    const flagsAnomaly =
      /omission|missing|error|anomal|not (a |like a )?(normal )?fee|too (large|big)|far (beyond|from)|data error|shortfall|incomplete|wrong amount|possible missing|extra funds|does not look|implausible|cannot be|not consistent|unexplained|partial (sale|deposit)|underpayment|omitted/.test(
        blob
      ) ||
      /누락|오류|이상|수수료로 보기|수수료가 아님|누락된|데이터 오류|입금 누락/.test(blob)
    const feeOnly =
      /fee|2\.5|percent|commission|가맹점|settlement fee|card fee/.test(blob) &&
      !flagsAnomaly
    const highFee = feeOnly && explain4.body.advisory.confidence === 'high'

    console.log(
      `STEP 4 honesty scan: flagsAnomaly=${flagsAnomaly} feeOnly=${feeOnly} confidence=${explain4.body.advisory.confidence}`
    )
    requireResult(
      !highFee,
      'STEP 4 FAIL: AI confidently called a ~59% shortfall a card fee (anti-hallucination miss)',
      explain4.body.advisory
    )
    requireResult(
      flagsAnomaly || explain4.body.advisory.confidence === 'low',
      'STEP 4 FAIL: AI did not flag omission/error/anomaly and did not even set confidence=low',
      explain4.body.advisory
    )
    console.log('CONFIRMED STEP 4: AI did not treat the 57500 gap as a normal card fee')

    const after4 = await dbRecon(anomalyId)
    requireResult(after4?.status === 'amount_mismatch', 'step-4 DB status changed', after4)

    // ── 5. guard: matched is not explainable ───────────────────────────────
    console.log('\n========== STEP 5: explain on matched → 400/409 ==========')
    const saleDate5 = '2026-08-01'
    const settle5 = addDays(saleDate5, 2)
    const sale5 = await request('/api/reconciliation/sales', token, 'POST', {
      sale_date: saleDate5,
      gross_amount: 100000,
      channel_id: cardId,
      sale_kind: 'card',
      entry_source: 'manual',
    })
    requireResult(sale5.status === 201, 'create step-5 sale failed', sale5)

    const dep5 = await request('/api/reconciliation/deposits', token, 'POST', {
      deposit_date: settle5,
      actual_amount: 97500,
      channel_hint: cardId,
      confirm_status: 'confirmed',
    })
    requireResult(dep5.status === 201, 'create step-5 net deposit failed', dep5)

    const recon5 = await request('/api/reconciliation/reconcile-card', token, 'POST', {
      channel_id: cardId,
    })
    requireResult(recon5.status === 201, 'reconcile-card step-5 failed', recon5)
    const matched = recon5.body.created?.find((row: any) =>
      row.matches?.some((m: any) => m.sales_record_id === sale5.body.id)
    )
    requireResult(matched?.status === 'matched', 'step-5 expected matched', recon5)
    const matchedId = matched.id as string
    console.log(`STEP 5 matched reconciliation_id=${matchedId}`)

    const explain5 = await request('/api/reconciliation/explain-discrepancy', token, 'POST', {
      reconciliation_id: matchedId,
    })
    requireResult(
      explain5.status === 400 || explain5.status === 409,
      'step-5 expected 400 or 409 for matched id',
      explain5
    )
    const matchedDb = await dbRecon(matchedId)
    requireResult(matchedDb?.status === 'matched', 'step-5 matched row status changed', matchedDb)
    requireResult(
      matchedDb?.discrepancy_advisory == null,
      'step-5 wrote an advisory onto a matched row',
      matchedDb
    )
    console.log('CONFIRMED STEP 5: matched id rejected; row untouched')

    console.log('\n========== ALL LIVE EXPLAIN CHECKS PASSED ==========')
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
