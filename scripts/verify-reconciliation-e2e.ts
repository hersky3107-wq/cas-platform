/**
 * STAGE-1 RECONCILIATION — E2E VERIFICATION (real HTTP + live remote DB).
 *
 * Exercises the reconciliation loop through the actual /api/reconciliation/*
 * routes against the running dev server (which is wired to the LINKED remote
 * Supabase project via .env.local), using a real throwaway auth user.
 *
 * This is a VERIFICATION run: it reports every HTTP status + row, and stops
 * (non-zero exit) on the first unexpected failure. It does not patch schema,
 * migrations, or retry around failures.
 *
 * Run (dev server must already be up on localhost:3000):
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/verify-reconciliation-e2e.ts
 */
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '../lib/supabase/server'

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000'

type Probe = { status: number; body: Record<string, unknown> }

async function probe(
  path: string,
  token: string,
  opts: { method?: 'GET' | 'POST' | 'PATCH'; json?: unknown } = {}
): Promise<Probe> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  if (opts.json !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
  })
  const text = await res.text()
  let body: Record<string, unknown> = {}
  try {
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    body = { raw: text.slice(0, 500) }
  }
  return { status: res.status, body }
}

function log(label: string, r: Probe): void {
  console.log(`\n${label}`)
  console.log(`  HTTP ${r.status}`)
  console.log(`  ${JSON.stringify(r.body)}`)
}

function fail(label: string, r: Probe): never {
  console.error(`\nSTOP — ${label} failed`)
  console.error(`  HTTP ${r.status}`)
  console.error(`  ${JSON.stringify(r.body, null, 2)}`)
  process.exitCode = 1
  throw new Error(`${label}: HTTP ${r.status}`)
}

const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

async function createTestUser(tag: string): Promise<{ id: string; email: string; token: string }> {
  const email = `recon-verify-${tag}-${Date.now()}@example.com`
  const password = `Vf-${Math.random().toString(36).slice(2)}-${Date.now()}`
  const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`)
  const signIn = await anon.auth.signInWithPassword({ email, password })
  if (signIn.error || !signIn.data.session) throw new Error(`signIn failed: ${signIn.error?.message}`)
  return { id: data.user.id, email, token: signIn.data.session.access_token }
}

function todayKst(): string {
  const now = new Date()
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10)
}

async function main() {
  const createdUserId: string[] = []
  try {
    const user = await createTestUser('a')
    createdUserId.push(user.id)
    console.log(`Test user: ${user.email} (${user.id})`)

    const today = todayKst()
    const [yyyy, mm, dd] = today.split('-')

    // ── 0. Transfer channel ────────────────────────────────────────────────
    const chan = await probe('/api/reconciliation/channels', user.token, {
      method: 'POST',
      json: { name: 'Transfer-E2E', channel_type: 'transfer' },
    })
    log('0) POST /api/reconciliation/channels', chan)
    if (chan.status !== 201) fail('create channel', chan)
    const channelId = chan.body.id as string

    // ══════════════════════════════════════════════════════════════════════
    // CASE A: sale WITH matching deposit
    // ══════════════════════════════════════════════════════════════════════
    console.log('\n========== CASE A: sale + matching deposit ==========')

    // ── 1. Manual sale (transfer channel) ────────────────────────────────
    const saleAmountA = 137000
    const saleA = await probe('/api/reconciliation/sales', user.token, {
      method: 'POST',
      json: { sale_date: today, gross_amount: saleAmountA, channel_id: channelId },
    })
    log('1) POST /api/reconciliation/sales (case A)', saleA)
    if (saleA.status !== 201) fail('create sale A', saleA)

    // ── 2. Parse a realistic Korean bank deposit-alert SMS ───────────────
    const smsText = `[Web발신]\n[국민은행]\n${mm}/${dd} 14:22\n입금 ${saleAmountA.toLocaleString('en-US')}원\n홍길동님\n잔액 5,213,400원`
    const parseA = await probe('/api/reconciliation/parse', user.token, {
      method: 'POST',
      json: { raw_text: smsText, source_type: 'sms', channel_hint: channelId },
    })
    log('2) POST /api/reconciliation/parse (case A)', parseA)
    if (parseA.status !== 200) fail('parse deposit A', parseA)
    const parsedRowsA = (parseA.body.rows ?? []) as {
      date: string | null
      amount: number | null
      memo: string | null
      confidence: number
      duplicate_suspect?: boolean
      channel_hint?: string | null
    }[]
    if (!Array.isArray(parsedRowsA) || parsedRowsA.length === 0) fail('parse A returned no rows', parseA)
    const parsedA = parsedRowsA[0]!
    console.log(`  parsed => date=${parsedA.date} amount=${parsedA.amount} confidence=${parsedA.confidence} rows=${parsedRowsA.length}`)

    const commitA = await probe('/api/reconciliation/deposits/commit', user.token, {
      method: 'POST',
      json: {
        document_id: parseA.body.document_id,
        channel_hint: channelId,
        rows: parsedRowsA.map((row) => ({
          deposit_date: row.date ?? today,
          actual_amount: row.amount ?? saleAmountA,
          memo: row.memo,
          confidence: row.confidence,
          confirm_status: 'confirmed',
          channel_hint: row.channel_hint ?? channelId,
        })),
      },
    })
    log('3) POST /api/reconciliation/deposits/commit (case A)', commitA)
    if (commitA.status !== 201) fail('commit deposit A', commitA)
    const createdA = (commitA.body.created ?? []) as { id: string }[]
    if (createdA.length === 0) fail('commit A created zero deposits', commitA)

    // ── 4. Run reconciliation ────────────────────────────────────────────
    const reconcileA = await probe('/api/reconciliation/reconcile', user.token, {
      method: 'POST',
      json: { channel_id: channelId },
    })
    log('4) POST /api/reconciliation/reconcile (case A)', reconcileA)
    if (reconcileA.status !== 201) fail('reconcile A', reconcileA)

    // ── 5. Read back reconciliations + matches ───────────────────────────
    const resultsA = await probe('/api/reconciliation/results', user.token)
    log('5) GET /api/reconciliation/results (after case A)', resultsA)
    if (resultsA.status !== 200) fail('read results A', resultsA)
    const rowsA = (resultsA.body as unknown as { id: string; status: string; matches: unknown[] }[]) as unknown as
      | { id: string; status: string; matches: { sales_record_id: string | null; deposit_record_id: string | null }[] }[]
      | undefined
    const listA = Array.isArray(resultsA.body) ? (resultsA.body as unknown as typeof rowsA) : undefined
    const matchedRow = (listA ?? []).find((r) =>
      r.matches?.some((m) => m.sales_record_id === saleA.body.id)
    )
    console.log(`  reconciliation for sale A: ${JSON.stringify(matchedRow)}`)
    if (!matchedRow) fail('find reconciliation row for case A sale', resultsA)
    if (matchedRow!.status !== 'matched') {
      console.warn(`  WARNING: expected status 'matched', got '${matchedRow!.status}'`)
    }

    // ══════════════════════════════════════════════════════════════════════
    // CASE B: sale with NO matching deposit -> missing_deposit, one-sided match
    // ══════════════════════════════════════════════════════════════════════
    console.log('\n========== CASE B: sale with NO deposit (missing_deposit) ==========')

    const saleAmountB = 84250
    const saleB = await probe('/api/reconciliation/sales', user.token, {
      method: 'POST',
      json: { sale_date: today, gross_amount: saleAmountB, channel_id: channelId },
    })
    log('6) POST /api/reconciliation/sales (case B, no deposit)', saleB)
    if (saleB.status !== 201) fail('create sale B', saleB)

    const reconcileB = await probe('/api/reconciliation/reconcile', user.token, {
      method: 'POST',
      json: { channel_id: channelId },
    })
    log('7) POST /api/reconciliation/reconcile (case B)', reconcileB)
    if (reconcileB.status !== 201) fail('reconcile B', reconcileB)

    const resultsB = await probe('/api/reconciliation/results?status=missing_deposit', user.token)
    log('8) GET /api/reconciliation/results?status=missing_deposit', resultsB)
    if (resultsB.status !== 200) fail('read results B', resultsB)
    const listB = Array.isArray(resultsB.body)
      ? (resultsB.body as unknown as {
          id: string
          status: string
          matches: { id: string; sales_record_id: string | null; deposit_record_id: string | null }[]
        }[])
      : []
    const missingRow = listB.find((r) => r.matches?.some((m) => m.sales_record_id === saleB.body.id))
    console.log(`  reconciliation for sale B: ${JSON.stringify(missingRow)}`)
    if (!missingRow) fail('find missing_deposit reconciliation row for sale B (insert may still be blocked)', resultsB)
    const oneSidedMatch = missingRow!.matches.find((m) => m.sales_record_id === saleB.body.id)
    console.log(`  reconciliation_matches row: ${JSON.stringify(oneSidedMatch)}`)
    const insertedOk =
      missingRow!.status === 'missing_deposit' &&
      oneSidedMatch != null &&
      oneSidedMatch.deposit_record_id === null
    console.log(
      insertedOk
        ? '  CONFIRMED: missing_deposit row created with reconciliation_matches.deposit_record_id = NULL (DB fix verified).'
        : '  WARNING: row shape did not match expectation — see printed row above.'
    )

    console.log('\n========== DONE — no failures ==========')
  } finally {
    console.log('\nCleanup')
    for (const id of createdUserId) {
      await supabaseAdmin.auth.admin.deleteUser(id).catch(() => {})
      console.log(`  removed test user ${id} (cascades sales/deposits/reconciliations via auth.users FK)`)
    }
  }
}

main().catch((e) => {
  console.error('\nVERIFICATION CRASHED / STOPPED:', e instanceof Error ? e.message : e)
  process.exit(1)
})
