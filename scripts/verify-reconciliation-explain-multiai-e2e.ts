/**
 * MULTI-AI discrepancy cross-verification — LIVE E2E
 * (real HTTP + remote DB + real openai/google/anthropic calls).
 *
 * Verification only. Stops on the first unexpected failure. Does NOT patch
 * schema, matcher, or the explain layer.
 *
 * Modes:
 *   happy     (default) — cases 1–3, prepares extra mismatch rows, keeps the
 *                         throwaway user (state file) so fail-injection can follow
 *   partial   — POST explain on the prepared partial-fail row (operator must
 *               have injected a bad model id for ONE provider first)
 *   allfail   — POST explain on the prepared all-fail row (operator must have
 *               injected a bad model id for ALL providers first)
 *   cleanup   — delete the throwaway user
 *
 * Run (dev server must already be up on localhost:3000):
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/verify-reconciliation-explain-multiai-e2e.ts [happy|partial|allfail|cleanup]
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '../lib/supabase/server'

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000'
const STATE_PATH = path.join(os.tmpdir(), 'cas-multiai-explain-verify.json')

type Probe = { status: number; body: any; elapsedMs: number }
type Mode = 'happy' | 'partial' | 'allfail' | 'cleanup'
type CauseBucket = 'missing_or_extra' | 'refund' | 'rounding' | 'promotion_or_ad' | 'fee' | 'other'

type State = {
  userId: string
  email: string
  token: string
  feeReconId: string
  anomalyReconId: string
  partialReconId: string
  allfailReconId: string
}

const MODE = (process.argv[2] as Mode | undefined) ?? 'happy'

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
    `\n${method} ${pathName}\nHTTP ${response.status} (${elapsedMs}ms)\n${JSON.stringify(body, null, 2)}`
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

/** Same keyword order as lib/reconciliation/explain-discrepancy.ts classifyCauseText. */
function classifyCauseText(text: string): CauseBucket {
  const t = text.toLowerCase()
  if (
    /missing|omission|omit|unexplained|extra fund|anomal|data error|not (?:a |look like )?(?:normal )?fee|누락|초과|오류|이상/.test(
      t
    )
  ) {
    return 'missing_or_extra'
  }
  if (/refund|chargeback|환불|취소/.test(t)) return 'refund'
  if (/round|반올림|절사/.test(t)) return 'rounding'
  if (/promo|advertis|\bad\b|광고|프로모션|할인|delivery-app|배달/.test(t)) return 'promotion_or_ad'
  if (/fee|rate|수수료|정산율/.test(t)) return 'fee'
  return 'other'
}

function voteBucket(vote: { cause?: string; reasoning?: string }): CauseBucket {
  const fromCause = classifyCauseText(String(vote.cause ?? ''))
  if (fromCause !== 'other') return fromCause
  return classifyCauseText(`${vote.cause ?? ''} ${vote.reasoning ?? ''}`)
}

function printFullAdvisory(label: string, advisory: unknown, dbAdvisory: unknown) {
  console.log(`\n===== ${label} HTTP advisory (verbatim JSON) =====`)
  console.log(JSON.stringify(advisory, null, 2))
  console.log(`===== ${label} DB discrepancy_advisory (verbatim JSON) =====`)
  console.log(JSON.stringify(dbAdvisory, null, 2))
  const a = advisory as Record<string, unknown> | null
  const votes = Array.isArray(a?.per_model) ? a.per_model : []
  console.log(`----- ${label} per_model votes -----`)
  votes.forEach((v: any, i: number) => {
    console.log(
      `  [${i}] model=${v?.model} bucket=${voteBucket(v)} confidence=${v?.confidence}\n      cause: ${v?.cause}\n      reasoning: ${v?.reasoning}`
    )
  })
  console.log(
    `----- ${label} consensus: cause=${a?.consensus_cause ?? a?.estimated_cause} final_confidence=${a?.final_confidence ?? a?.confidence} agreement=${a?.agreement} models_responded=${a?.models_responded}/${a?.models_requested} -----`
  )
}

const anon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

function loadState(): State {
  requireResult(fs.existsSync(STATE_PATH), `state file missing at ${STATE_PATH}`, { STATE_PATH })
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) as State
}

function saveState(state: State) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))
  console.log(`State written to ${STATE_PATH}`)
}

async function dbRecon(id: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from('reconciliations')
    .select('id, status, discrepancy_amount, discrepancy_reason, discrepancy_advisory, resolved')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(`DB recon read failed: ${error.message}`)
  console.log(`DB recon: ${JSON.stringify(data)}`)
  return data as Record<string, unknown> | null
}

async function dbSale(id: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from('sales_records')
    .select('id, gross_amount, expected_net_amount, expected_deposit_date, sale_date')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(`DB sale read failed: ${error.message}`)
  console.log(`DB sale: ${JSON.stringify(data)}`)
  return data as Record<string, unknown> | null
}

async function createMismatch(
  token: string,
  userId: string,
  cardId: string,
  saleDate: string,
  depositAmount: number,
  label: string
): Promise<{ reconId: string; discrepancy: number }> {
  const settle = addDays(saleDate, 2)
  const sale = await request('/api/reconciliation/sales', token, 'POST', {
    sale_date: saleDate,
    gross_amount: 100000,
    channel_id: cardId,
    sale_kind: 'card',
    entry_source: 'manual',
  })
  requireResult(sale.status === 201, `${label}: create sale failed`, sale)
  const saleDb = await dbSale(sale.body.id, userId)
  requireResult(Number(saleDb?.expected_net_amount) === 97500, `${label}: expected_net not 97500`, saleDb)

  const dep = await request('/api/reconciliation/deposits', token, 'POST', {
    deposit_date: settle,
    actual_amount: depositAmount,
    channel_hint: cardId,
    confirm_status: 'confirmed',
  })
  requireResult(dep.status === 201, `${label}: create deposit failed`, dep)

  const recon = await request('/api/reconciliation/reconcile-card', token, 'POST', {
    channel_id: cardId,
  })
  requireResult(recon.status === 201, `${label}: reconcile-card failed`, recon)
  const mismatch = recon.body.created?.find((row: any) =>
    row.matches?.some((m: any) => m.sales_record_id === sale.body.id)
  )
  requireResult(mismatch?.status === 'amount_mismatch', `${label}: expected amount_mismatch`, recon)
  const disc = Number(mismatch.discrepancy_amount)
  console.log(`${label}: reconciliation_id=${mismatch.id} discrepancy_amount=${disc}`)
  return { reconId: mismatch.id as string, discrepancy: disc }
}

function assertMultiAiShape(advisory: any, label: string, minResponded: number) {
  requireResult(advisory, `${label}: no advisory object`, advisory)
  requireResult(
    typeof advisory.estimated_cause === 'string' && advisory.estimated_cause.length > 0,
    `${label}: estimated_cause empty`,
    advisory
  )
  requireResult(
    ['low', 'medium', 'high'].includes(advisory.confidence),
    `${label}: confidence not low|medium|high`,
    advisory
  )
  requireResult(
    typeof advisory.reasoning === 'string' && advisory.reasoning.length > 0,
    `${label}: reasoning empty`,
    advisory
  )
  requireResult(Array.isArray(advisory.per_model), `${label}: per_model missing`, advisory)
  requireResult(
    advisory.per_model.length === advisory.models_responded,
    `${label}: per_model length !== models_responded`,
    advisory
  )
  requireResult(
    Number(advisory.models_responded) >= minResponded,
    `${label}: models_responded ${advisory.models_responded} < required ${minResponded}`,
    advisory
  )
  requireResult(advisory.models_requested === 3, `${label}: models_requested is not 3`, advisory)
  requireResult(
    typeof advisory.agreement === 'string' && /^\d+\/\d+$/.test(advisory.agreement),
    `${label}: agreement not N/M`,
    advisory
  )
  requireResult(
    typeof advisory.consensus_cause === 'string' && advisory.consensus_cause.length > 0,
    `${label}: consensus_cause missing`,
    advisory
  )
  requireResult(
    ['low', 'medium', 'high'].includes(advisory.final_confidence),
    `${label}: final_confidence not low|medium|high`,
    advisory
  )
}

async function happy() {
  const email = `recon-multiai-verify-${Date.now()}@example.com`
  const password = `Vf-${Math.random().toString(36).slice(2)}-${Date.now()}`
  const created = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  requireResult(!created.error && created.data.user, 'create throwaway user failed', created.error)
  const userId = created.data.user.id
  const signed = await anon.auth.signInWithPassword({ email, password })
  requireResult(!signed.error && signed.data.session, 'sign-in failed', signed.error)
  const token = signed.data.session.access_token
  console.log(`Throwaway user: ${email} (${userId})`)

  const chan = await request('/api/reconciliation/channels', token, 'POST', {
    name: 'Card-MultiAI',
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
    notes: 'multiai-e2e 2.5% T+2',
  })
  requireResult(rule.status === 201, 'create card rule failed', rule)

  // ── 1. NORMAL FEE ──────────────────────────────────────────────────────
  console.log('\n========== STEP 1: NORMAL FEE CASE (gross 100000 vs expected net 97500) ==========')
  const fee = await createMismatch(token, userId, cardId, '2026-07-10', 100000, 'STEP 1')
  requireResult(Math.abs(fee.discrepancy) === 2500, 'STEP 1 discrepancy magnitude is not 2500', fee)

  const explain1 = await request('/api/reconciliation/explain-discrepancy', token, 'POST', {
    reconciliation_id: fee.reconId,
  })
  requireResult(explain1.status === 200, 'STEP 1 explain-discrepancy failed', explain1)
  requireResult(explain1.body.status === 'amount_mismatch', 'STEP 1 AI changed status', explain1)
  requireResult(explain1.body.cached !== true, 'STEP 1 expected a fresh (non-cached) call', explain1)
  assertMultiAiShape(explain1.body.advisory, 'STEP 1', 3)

  const after1 = await dbRecon(fee.reconId, userId)
  requireResult(after1?.status === 'amount_mismatch', 'STEP 1 DB status is no longer amount_mismatch', after1)
  requireResult(after1?.discrepancy_advisory != null, 'STEP 1 discrepancy_advisory not persisted', after1)
  printFullAdvisory('STEP 1 FEE', explain1.body.advisory, after1?.discrepancy_advisory)

  const feeVotes = explain1.body.advisory.per_model as { cause: string; reasoning: string }[]
  feeVotes.forEach((v, i) => {
    console.log(`STEP 1 vote[${i}] bucket=${voteBucket(v)}`)
  })
  console.log(
    `CONFIRMED STEP 1: status still amount_mismatch; ${explain1.body.advisory.models_responded}/3 models; agreement=${explain1.body.advisory.agreement}`
  )

  // ── 2. ANOMALY ─────────────────────────────────────────────────────────
  console.log('\n========== STEP 2: ANOMALY CASE (deposit 40000 vs expected 97500, gap 57500 ~59%) ==========')
  const anomaly = await createMismatch(token, userId, cardId, '2026-07-20', 40000, 'STEP 2')
  requireResult(Math.abs(anomaly.discrepancy) === 57500, 'STEP 2 discrepancy magnitude is not 57500', anomaly)

  const explain2 = await request('/api/reconciliation/explain-discrepancy', token, 'POST', {
    reconciliation_id: anomaly.reconId,
  })
  requireResult(explain2.status === 200, 'STEP 2 explain-discrepancy failed', explain2)
  requireResult(explain2.body.status === 'amount_mismatch', 'STEP 2 AI changed status', explain2)
  assertMultiAiShape(explain2.body.advisory, 'STEP 2', 3)

  const after2 = await dbRecon(anomaly.reconId, userId)
  requireResult(after2?.status === 'amount_mismatch', 'STEP 2 DB status changed', after2)
  printFullAdvisory('STEP 2 ANOMALY', explain2.body.advisory, after2?.discrepancy_advisory)

  const anomalyVotes = explain2.body.advisory.per_model as { cause: string; reasoning: string }[]
  const buckets = anomalyVotes.map((v) => voteBucket(v))
  const missingCount = buckets.filter((b) => b === 'missing_or_extra').length
  const feeCount = buckets.filter((b) => b === 'fee').length
  console.log(`STEP 2 vote buckets: ${JSON.stringify(buckets)} missing_or_extra=${missingCount} fee=${feeCount}`)

  const blob = `${explain2.body.advisory.estimated_cause} ${explain2.body.advisory.reasoning} ${explain2.body.advisory.consensus_cause}`.toLowerCase()
  const flagsAnomaly =
    /omission|missing|error|anomal|not (a |like a )?(normal )?fee|too (large|big)|far (beyond|from)|data error|shortfall|incomplete|wrong amount|possible missing|extra funds|does not look|implausible|cannot be|not consistent|unexplained|partial (sale|deposit)|underpayment|omitted|models disagree/.test(
      blob
    ) || /누락|오류|이상|수수료로 보기|수수료가 아님|누락된|데이터 오류|입금 누락/.test(blob)
  const consensusBucket = classifyCauseText(
    String(explain2.body.advisory.consensus_cause ?? explain2.body.advisory.estimated_cause)
  )
  const feeOnlyConsensus = consensusBucket === 'fee'

  requireResult(
    missingCount >= 2,
    'STEP 2 FAIL: models did not converge on missing-or-extra (need >=2 of 3)',
    { buckets, advisory: explain2.body.advisory }
  )
  requireResult(
    !feeOnlyConsensus,
    'STEP 2 FAIL: consensus_cause classified as fee, not omission/error',
    { consensusBucket, advisory: explain2.body.advisory }
  )
  requireResult(
    flagsAnomaly || explain2.body.advisory.confidence === 'low',
    'STEP 2 FAIL: consensus did not flag omission/error/anomaly and confidence is not low',
    explain2.body.advisory
  )
  console.log(
    `CONFIRMED STEP 2: missing_or_extra votes=${missingCount}/3; consensusBucket=${consensusBucket}; agreement=${explain2.body.advisory.agreement}`
  )

  // ── 3. CACHE + FORCE ───────────────────────────────────────────────────
  console.log('\n========== STEP 3a: cache (POST fee case again, no force) ==========')
  const cached = await request('/api/reconciliation/explain-discrepancy', token, 'POST', {
    reconciliation_id: fee.reconId,
  })
  requireResult(cached.status === 200, 'STEP 3a cached explain failed', cached)
  requireResult(cached.body.cached === true, 'STEP 3a expected cached:true (no new AI calls)', cached)
  requireResult(cached.body.status === 'amount_mismatch', 'STEP 3a cached call changed status', cached)
  requireResult(
    JSON.stringify(cached.body.advisory) === JSON.stringify(explain1.body.advisory),
    'STEP 3a cached advisory does not match stored full breakdown',
    { first: explain1.body.advisory, cached: cached.body.advisory }
  )
  requireResult(
    cached.elapsedMs < 3000,
    `STEP 3a cached call was slow (${cached.elapsedMs}ms) — may have hit AI`,
    cached
  )
  printFullAdvisory('STEP 3a CACHED', cached.body.advisory, (await dbRecon(fee.reconId, userId))?.discrepancy_advisory)
  console.log(`CONFIRMED STEP 3a: cached=true elapsed=${cached.elapsedMs}ms full breakdown identical`)

  console.log('\n========== STEP 3b: force:true (re-run 3 models) ==========')
  const forced = await request('/api/reconciliation/explain-discrepancy', token, 'POST', {
    reconciliation_id: fee.reconId,
    force: true,
  })
  requireResult(forced.status === 200, 'STEP 3b force explain failed', forced)
  requireResult(forced.body.cached !== true, 'STEP 3b expected cached not true (fresh 3-model run)', forced)
  requireResult(forced.body.status === 'amount_mismatch', 'STEP 3b force changed status', forced)
  assertMultiAiShape(forced.body.advisory, 'STEP 3b', 3)
  requireResult(
    forced.elapsedMs > cached.elapsedMs,
    `STEP 3b force was not slower than cache (force=${forced.elapsedMs}ms cache=${cached.elapsedMs}ms)`,
    { forced: forced.elapsedMs, cached: cached.elapsedMs }
  )
  const afterForce = await dbRecon(fee.reconId, userId)
  printFullAdvisory('STEP 3b FORCE', forced.body.advisory, afterForce?.discrepancy_advisory)
  console.log(
    `CONFIRMED STEP 3b: cached=${forced.body.cached} elapsed=${forced.elapsedMs}ms models_responded=${forced.body.advisory.models_responded}`
  )

  // Extra mismatch rows for fail-injection follow-ups (not explained yet).
  const partial = await createMismatch(token, userId, cardId, '2026-07-25', 100000, 'PREP partial-fail')
  const allfail = await createMismatch(token, userId, cardId, '2026-07-28', 100000, 'PREP all-fail')
  requireResult((await dbRecon(partial.reconId, userId))?.discrepancy_advisory == null, 'partial row already has advisory', partial)
  requireResult((await dbRecon(allfail.reconId, userId))?.discrepancy_advisory == null, 'allfail row already has advisory', allfail)

  saveState({
    userId,
    email,
    token,
    feeReconId: fee.reconId,
    anomalyReconId: anomaly.reconId,
    partialReconId: partial.reconId,
    allfailReconId: allfail.reconId,
  })
  console.log('\n========== HAPPY PATH (steps 1–3) PASSED ==========')
  console.log('User kept. Next: inject a bad model id for ONE provider, then run mode `partial`.')
}

async function partial() {
  const state = loadState()
  console.log(`\n========== STEP 4: PARTIAL FAILURE (expect 2/3 models, still 200) ==========`)
  const before = await dbRecon(state.partialReconId, state.userId)
  requireResult(before?.status === 'amount_mismatch', 'STEP 4 row is not amount_mismatch', before)
  requireResult(before?.discrepancy_advisory == null, 'STEP 4 row already has an advisory (not a clean probe)', before)

  const explain = await request('/api/reconciliation/explain-discrepancy', state.token, 'POST', {
    reconciliation_id: state.partialReconId,
  })
  requireResult(explain.status === 200, 'STEP 4 expected 200 over remaining models, not a crash', explain)
  requireResult(explain.body.status === 'amount_mismatch', 'STEP 4 changed status', explain)
  requireResult(explain.body.cached !== true, 'STEP 4 should be a fresh call', explain)
  assertMultiAiShape(explain.body.advisory, 'STEP 4', 1)
  requireResult(
    explain.body.advisory.models_responded === 2,
    `STEP 4 expected models_responded=2 (got ${explain.body.advisory.models_responded}) — injection may not have taken effect`,
    explain.body.advisory
  )
  requireResult(
    explain.body.advisory.models_requested === 3,
    'STEP 4 models_requested is not 3',
    explain.body.advisory
  )
  requireResult(
    String(explain.body.advisory.agreement).endsWith('/2'),
    `STEP 4 agreement should be N/2 (got ${explain.body.advisory.agreement})`,
    explain.body.advisory
  )

  const after = await dbRecon(state.partialReconId, state.userId)
  requireResult(after?.status === 'amount_mismatch', 'STEP 4 DB status changed', after)
  requireResult(after?.discrepancy_advisory != null, 'STEP 4 did not persist partial advisory', after)
  printFullAdvisory('STEP 4 PARTIAL', explain.body.advisory, after?.discrepancy_advisory)
  console.log(
    `CONFIRMED STEP 4: HTTP 200, models_responded=${explain.body.advisory.models_responded}/3, agreement=${explain.body.advisory.agreement}, status untouched`
  )
}

async function allfail() {
  const state = loadState()
  console.log(`\n========== STEP 5: ALL-FAIL (expect 502, nothing persisted) ==========`)
  const before = await dbRecon(state.allfailReconId, state.userId)
  requireResult(before?.status === 'amount_mismatch', 'STEP 5 row is not amount_mismatch', before)
  requireResult(before?.discrepancy_advisory == null, 'STEP 5 row already has an advisory', before)

  const explain = await request('/api/reconciliation/explain-discrepancy', state.token, 'POST', {
    reconciliation_id: state.allfailReconId,
  })
  requireResult(explain.status === 502, `STEP 5 expected 502, got ${explain.status}`, explain)
  requireResult(
    typeof explain.body.error === 'string' && /no explanation produced/i.test(explain.body.error),
    'STEP 5 502 body did not say "no explanation produced"',
    explain.body
  )

  const after = await dbRecon(state.allfailReconId, state.userId)
  requireResult(after?.status === 'amount_mismatch', 'STEP 5 status changed after all-fail', after)
  requireResult(after?.discrepancy_advisory == null, 'STEP 5 FAIL: advisory was written despite all models failing', after)
  console.log('CONFIRMED STEP 5: HTTP 502, status untouched, discrepancy_advisory still null')
}

async function cleanup() {
  if (!fs.existsSync(STATE_PATH)) {
    console.log('No state file — nothing to clean up')
    return
  }
  const state = loadState()
  const result = await supabaseAdmin.auth.admin.deleteUser(state.userId)
  console.log(
    `\nCleanup ${state.userId}: ${result.error ? `ERROR ${result.error.message}` : 'OK (rows cascaded)'}`
  )
  fs.unlinkSync(STATE_PATH)
  if (result.error) process.exitCode = 1
}

async function main() {
  console.log(`Mode: ${MODE}`)
  if (MODE === 'happy') await happy()
  else if (MODE === 'partial') await partial()
  else if (MODE === 'allfail') await allfail()
  else if (MODE === 'cleanup') await cleanup()
  else throw new Error(`unknown mode ${MODE}`)
}

main().catch((error) => {
  console.error(
    `\nVERIFICATION STOPPED: ${error instanceof Error ? error.stack ?? error.message : String(error)}`
  )
  process.exit(1)
})
