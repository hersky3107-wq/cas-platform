/**
 * STAGE-2 APP-VOUCHER — E2E VERIFICATION (real HTTP + live remote DB).
 *
 * Cases V-A (matched), V-B (missing_deposit), V-C (no cross-contamination
 * with the transfer engine). Reports every HTTP status + row; stops on the
 * first unexpected failure. Does NOT patch schema, migrations, or engine logic.
 *
 * Run (dev server must already be up on localhost:3000):
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/verify-reconciliation-app-voucher-e2e.ts
 */
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '../lib/supabase/server'

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000'

type Probe = { status: number; body: Record<string, unknown> }

type MatchRow = {
  id?: string
  sales_record_id: string | null
  deposit_record_id: string | null
}

type ReconRow = {
  id: string
  status: string
  discrepancy_amount?: number | null
  matches: MatchRow[]
}

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

function asReconList(body: unknown): ReconRow[] {
  return Array.isArray(body) ? (body as ReconRow[]) : []
}

function findReconForSale(list: ReconRow[], saleId: string): ReconRow | undefined {
  return list.find((r) => r.matches?.some((m) => m.sales_record_id === saleId))
}

function findReconForDeposit(list: ReconRow[], depositId: string): ReconRow | undefined {
  return list.find((r) => r.matches?.some((m) => m.deposit_record_id === depositId))
}

const anon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

async function createTestUser(tag: string): Promise<{ id: string; email: string; token: string }> {
  const email = `recon-voucher-verify-${tag}-${Date.now()}@example.com`
  const password = `Vf-${Math.random().toString(36).slice(2)}-${Date.now()}`
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`)
  const signIn = await anon.auth.signInWithPassword({ email, password })
  if (signIn.error || !signIn.data.session) {
    throw new Error(`signIn failed: ${signIn.error?.message}`)
  }
  return { id: data.user.id, email, token: signIn.data.session.access_token }
}

function todayKst(): string {
  const now = new Date()
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10)
}

/** Read-back via admin (select *) so Stage-2 columns are visible even if SalesRecord type omits them. */
async function readSaleRow(userId: string, saleId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabaseAdmin
    .from('sales_records')
    .select('*')
    .eq('id', saleId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(`readSaleRow: ${error.message}`)
  return (data as Record<string, unknown> | null) ?? null
}

async function readDepositRow(userId: string, depositId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabaseAdmin
    .from('deposit_records')
    .select('*')
    .eq('id', depositId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(`readDepositRow: ${error.message}`)
  return (data as Record<string, unknown> | null) ?? null
}

async function readChannelRow(userId: string, channelId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabaseAdmin
    .from('payment_channels')
    .select('*')
    .eq('id', channelId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(`readChannelRow: ${error.message}`)
  return (data as Record<string, unknown> | null) ?? null
}

async function main() {
  const createdUserId: string[] = []
  try {
    const user = await createTestUser('va')
    createdUserId.push(user.id)
    console.log(`Test user: ${user.email} (${user.id})`)

    const today = todayKst()
    const [yyyy, mm, dd] = today.split('-')
    void yyyy

    // ══════════════════════════════════════════════════════════════════════
    // CASE V-A: app-voucher matched (탐나는전)
    // ══════════════════════════════════════════════════════════════════════
    console.log('\n========== CASE V-A: app-voucher matched (탐나는전) ==========')

    const saleAmountVA = 55000

    // 1. Create app_voucher channel + manual sale
    //    Engine keys off channel_type='app_voucher' via channel_id.
    //    Also pass sale_kind / voucher_type; report whether the DAL persisted them.
    const chanVA = await probe('/api/reconciliation/channels', user.token, {
      method: 'POST',
      json: { name: '탐나는전', channel_type: 'app_voucher' },
    })
    log('V-A.0) POST /api/reconciliation/channels (탐나는전 / app_voucher)', chanVA)
    if (chanVA.status !== 201) fail('create 탐나는전 channel', chanVA)
    const tamnaChannelId = chanVA.body.id as string

    const saleVA = await probe('/api/reconciliation/sales', user.token, {
      method: 'POST',
      json: {
        sale_date: today,
        gross_amount: saleAmountVA,
        channel_id: tamnaChannelId,
        sale_kind: 'app_voucher',
        voucher_type: '탐나는전',
        voucher_amount: saleAmountVA,
        entry_source: 'manual',
      },
    })
    log('V-A.1) POST /api/reconciliation/sales (탐나는전)', saleVA)
    if (saleVA.status !== 201) fail('create sale V-A', saleVA)
    const saleVAId = saleVA.body.id as string

    const saleVADb = await readSaleRow(user.id, saleVAId)
    console.log(`  DB sale row (select *): ${JSON.stringify(saleVADb)}`)
    if (!saleVADb) fail('read back sale V-A from DB', saleVA)
    if (saleVADb.channel_id !== tamnaChannelId) {
      fail('sale V-A channel_id mismatch', {
        status: 500,
        body: { expected: tamnaChannelId, got: saleVADb.channel_id },
      })
    }
    console.log(
      `  sale_kind=${String(saleVADb.sale_kind)} voucher_type=${String(saleVADb.voucher_type)} ` +
        `voucher_amount=${String(saleVADb.voucher_amount)} entry_source=${String(saleVADb.entry_source)}`
    )
    if (saleVADb.sale_kind !== 'app_voucher' || saleVADb.voucher_type !== '탐나는전') {
      console.warn(
        '  NOTE: createSale DAL does not yet persist sale_kind/voucher_type ' +
          `(got sale_kind=${String(saleVADb.sale_kind)}, voucher_type=${String(saleVADb.voucher_type)}). ` +
          'Engine uses channel_id/channel_type — continuing V-A on that path.'
      )
    }

    // 2. Parse voucher deposit alert
    const smsVA =
      `[Web발신]\n[농협은행]\n${mm}/${dd} 10:15\n탐나는전 ${saleAmountVA.toLocaleString('en-US')}원 입금\n잔액 2,100,000원`
    const parseVA = await probe('/api/reconciliation/parse-voucher', user.token, {
      method: 'POST',
      json: { raw_text: smsVA, source_type: 'sms' },
    })
    log('V-A.2) POST /api/reconciliation/parse-voucher', parseVA)
    if (parseVA.status !== 201) fail('parse-voucher V-A', parseVA)

    const parsedVA = parseVA.body.parsed as {
      date: string | null
      amount: number | null
      confidence: number
      extra?: { voucher_type?: string | null } | null
    }
    const voucherTypeOut = (parseVA.body.voucher_type as string | null) ?? parsedVA.extra?.voucher_type ?? null
    const depositVA = parseVA.body.deposit as {
      id: string
      channel_hint: string | null
      deposit_date: string
      actual_amount: number
    }
    console.log(
      `  parsed => date=${parsedVA.date} amount=${parsedVA.amount} ` +
        `voucher_type=${voucherTypeOut} confidence=${parsedVA.confidence}`
    )
    console.log(`  deposit => id=${depositVA.id} channel_hint=${depositVA.channel_hint}`)

    if (parsedVA.date !== today || parsedVA.amount !== saleAmountVA) {
      fail('parse-voucher V-A date/amount mismatch', parseVA)
    }
    if (voucherTypeOut !== '탐나는전') {
      fail('parse-voucher V-A voucher_type expected 탐나는전', parseVA)
    }
    if (!depositVA.channel_hint) {
      fail('parse-voucher V-A did not set channel_hint', parseVA)
    }

    const hintedChan = await readChannelRow(user.id, depositVA.channel_hint)
    console.log(`  hinted channel row: ${JSON.stringify(hintedChan)}`)
    if (!hintedChan || hintedChan.channel_type !== 'app_voucher') {
      fail('hinted channel is not app_voucher', {
        status: 500,
        body: { hintedChan },
      })
    }
    if (hintedChan!.name !== '탐나는전') {
      fail('hinted channel name is not 탐나는전', {
        status: 500,
        body: { hintedChan },
      })
    }
    // Prefer reusing the channel we created; findOrCreate should have found it.
    if (depositVA.channel_hint !== tamnaChannelId) {
      console.warn(
        `  WARNING: channel_hint ${depositVA.channel_hint} !== pre-created ${tamnaChannelId} ` +
          '(findOrCreate may have created a duplicate — continuing with hinted id)'
      )
    }

    // 3. Reconcile app-voucher
    const reconcileVA = await probe('/api/reconciliation/reconcile-app-voucher', user.token, {
      method: 'POST',
      json: {},
    })
    log('V-A.3) POST /api/reconciliation/reconcile-app-voucher', reconcileVA)
    if (reconcileVA.status !== 201) fail('reconcile-app-voucher V-A', reconcileVA)

    // 4. Read back results + matches
    const resultsVA = await probe('/api/reconciliation/results', user.token)
    log('V-A.4) GET /api/reconciliation/results (after V-A)', resultsVA)
    if (resultsVA.status !== 200) fail('read results V-A', resultsVA)
    const listVA = asReconList(resultsVA.body)
    const matchedVA = findReconForSale(listVA, saleVAId)
    console.log(`  reconciliation for sale V-A: ${JSON.stringify(matchedVA)}`)
    if (!matchedVA) fail('find reconciliation for sale V-A', resultsVA)
    if (matchedVA!.status !== 'matched') {
      fail(`expected status matched, got ${matchedVA!.status}`, {
        status: 500,
        body: matchedVA as unknown as Record<string, unknown>,
      })
    }
    const pairVA = matchedVA!.matches.find(
      (m) => m.sales_record_id === saleVAId && m.deposit_record_id === depositVA.id
    )
    console.log(`  match pair: ${JSON.stringify(pairVA)}`)
    if (!pairVA) {
      fail('V-A match pair sale↔deposit missing', {
        status: 500,
        body: matchedVA as unknown as Record<string, unknown>,
      })
    }
    console.log('  CONFIRMED V-A: status=matched with sale↔deposit pair')

    // ══════════════════════════════════════════════════════════════════════
    // CASE V-B: app-voucher missing_deposit (온누리, no deposit)
    // ══════════════════════════════════════════════════════════════════════
    console.log('\n========== CASE V-B: app-voucher missing_deposit (온누리) ==========')

    const chanVB = await probe('/api/reconciliation/channels', user.token, {
      method: 'POST',
      json: { name: '온누리', channel_type: 'app_voucher' },
    })
    log('V-B.0) POST /api/reconciliation/channels (온누리 / app_voucher)', chanVB)
    if (chanVB.status !== 201) fail('create 온누리 channel', chanVB)
    const onnuriChannelId = chanVB.body.id as string

    const saleAmountVB = 32000
    const saleVB = await probe('/api/reconciliation/sales', user.token, {
      method: 'POST',
      json: {
        sale_date: today,
        gross_amount: saleAmountVB,
        channel_id: onnuriChannelId,
        sale_kind: 'app_voucher',
        voucher_type: '온누리',
        voucher_amount: saleAmountVB,
        entry_source: 'manual',
      },
    })
    log('V-B.1) POST /api/reconciliation/sales (온누리, no deposit)', saleVB)
    if (saleVB.status !== 201) fail('create sale V-B', saleVB)
    const saleVBId = saleVB.body.id as string
    console.log(`  DB sale row: ${JSON.stringify(await readSaleRow(user.id, saleVBId))}`)

    const reconcileVB = await probe('/api/reconciliation/reconcile-app-voucher', user.token, {
      method: 'POST',
      json: {},
    })
    log('V-B.2) POST /api/reconciliation/reconcile-app-voucher', reconcileVB)
    if (reconcileVB.status !== 201) fail('reconcile-app-voucher V-B', reconcileVB)

    const resultsVB = await probe('/api/reconciliation/results?status=missing_deposit', user.token)
    log('V-B.3) GET /api/reconciliation/results?status=missing_deposit', resultsVB)
    if (resultsVB.status !== 200) fail('read results V-B', resultsVB)
    const listVB = asReconList(resultsVB.body)
    const missingVB = findReconForSale(listVB, saleVBId)
    console.log(`  reconciliation for sale V-B: ${JSON.stringify(missingVB)}`)
    if (!missingVB) fail('find missing_deposit row for sale V-B', resultsVB)
    if (missingVB!.status !== 'missing_deposit') {
      fail(`expected missing_deposit, got ${missingVB!.status}`, {
        status: 500,
        body: missingVB as unknown as Record<string, unknown>,
      })
    }
    const oneSided = missingVB!.matches.find((m) => m.sales_record_id === saleVBId)
    console.log(`  reconciliation_matches row: ${JSON.stringify(oneSided)}`)
    if (!oneSided || oneSided.deposit_record_id !== null) {
      fail('expected one-sided match with deposit_record_id NULL', {
        status: 500,
        body: { oneSided },
      })
    }
    console.log('  CONFIRMED V-B: missing_deposit with deposit_record_id = NULL')

    // ══════════════════════════════════════════════════════════════════════
    // CASE V-C: no cross-contamination between transfer and app_voucher
    // ══════════════════════════════════════════════════════════════════════
    console.log('\n========== CASE V-C: no cross-contamination ==========')

    const transferChan = await probe('/api/reconciliation/channels', user.token, {
      method: 'POST',
      json: { name: 'Transfer-VC', channel_type: 'transfer' },
    })
    log('V-C.0) POST /api/reconciliation/channels (transfer)', transferChan)
    if (transferChan.status !== 201) fail('create transfer channel', transferChan)
    const transferChannelId = transferChan.body.id as string

    const transferAmount = 99000
    const voucherAmountVC = 41000

    const saleTransfer = await probe('/api/reconciliation/sales', user.token, {
      method: 'POST',
      json: {
        sale_date: today,
        gross_amount: transferAmount,
        channel_id: transferChannelId,
      },
    })
    log('V-C.1a) POST /api/reconciliation/sales (transfer)', saleTransfer)
    if (saleTransfer.status !== 201) fail('create transfer sale', saleTransfer)
    const saleTransferId = saleTransfer.body.id as string

    const saleVoucherVC = await probe('/api/reconciliation/sales', user.token, {
      method: 'POST',
      json: {
        sale_date: today,
        gross_amount: voucherAmountVC,
        channel_id: tamnaChannelId,
      },
    })
    log('V-C.1b) POST /api/reconciliation/sales (탐나는전)', saleVoucherVC)
    if (saleVoucherVC.status !== 201) fail('create voucher sale V-C', saleVoucherVC)
    const saleVoucherVCId = saleVoucherVC.body.id as string

    const smsTransfer =
      `[Web발신]\n[국민은행]\n${mm}/${dd} 15:40\n입금 ${transferAmount.toLocaleString('en-US')}원\n홍길동님\n잔액 9,000,000원`
    const parseTransfer = await probe('/api/reconciliation/parse', user.token, {
      method: 'POST',
      json: { raw_text: smsTransfer, source_type: 'sms', channel_hint: transferChannelId },
    })
    log('V-C.2a) POST /api/reconciliation/parse (transfer deposit)', parseTransfer)
    if (parseTransfer.status !== 201) fail('parse transfer deposit', parseTransfer)
    const depositTransfer = parseTransfer.body.deposit as { id: string; channel_hint: string | null }
    console.log(`  transfer deposit id=${depositTransfer.id} hint=${depositTransfer.channel_hint}`)

    const smsVoucherVC =
      `[Web발신]\n[농협은행]\n${mm}/${dd} 16:05\n탐나는전 ${voucherAmountVC.toLocaleString('en-US')}원 입금\n잔액 2,141,000원`
    const parseVoucherVC = await probe('/api/reconciliation/parse-voucher', user.token, {
      method: 'POST',
      json: { raw_text: smsVoucherVC, source_type: 'sms' },
    })
    log('V-C.2b) POST /api/reconciliation/parse-voucher (탐나는전 deposit)', parseVoucherVC)
    if (parseVoucherVC.status !== 201) fail('parse-voucher V-C', parseVoucherVC)
    const depositVoucherVC = parseVoucherVC.body.deposit as { id: string; channel_hint: string | null }
    console.log(
      `  voucher deposit id=${depositVoucherVC.id} hint=${depositVoucherVC.channel_hint} ` +
        `voucher_type=${String(parseVoucherVC.body.voucher_type)}`
    )
    console.log(`  transfer deposit DB: ${JSON.stringify(await readDepositRow(user.id, depositTransfer.id))}`)
    console.log(`  voucher deposit DB: ${JSON.stringify(await readDepositRow(user.id, depositVoucherVC.id))}`)

    // Run BOTH reconcilers
    const reconTransfer = await probe('/api/reconciliation/reconcile', user.token, {
      method: 'POST',
      json: { channel_id: transferChannelId },
    })
    log('V-C.3a) POST /api/reconciliation/reconcile (transfer)', reconTransfer)
    if (reconTransfer.status !== 201) fail('reconcile transfer V-C', reconTransfer)

    const reconVoucher = await probe('/api/reconciliation/reconcile-app-voucher', user.token, {
      method: 'POST',
      json: {},
    })
    log('V-C.3b) POST /api/reconciliation/reconcile-app-voucher', reconVoucher)
    if (reconVoucher.status !== 201) fail('reconcile-app-voucher V-C', reconVoucher)

    const resultsVC = await probe('/api/reconciliation/results', user.token)
    log('V-C.4) GET /api/reconciliation/results (after both)', resultsVC)
    if (resultsVC.status !== 200) fail('read results V-C', resultsVC)
    const listVC = asReconList(resultsVC.body)

    const reconForTransferSale = findReconForSale(listVC, saleTransferId)
    const reconForVoucherSale = findReconForSale(listVC, saleVoucherVCId)
    const reconForTransferDeposit = findReconForDeposit(listVC, depositTransfer.id)
    const reconForVoucherDeposit = findReconForDeposit(listVC, depositVoucherVC.id)

    console.log(`  recon(transfer sale): ${JSON.stringify(reconForTransferSale)}`)
    console.log(`  recon(voucher sale):  ${JSON.stringify(reconForVoucherSale)}`)
    console.log(`  recon(transfer deposit): ${JSON.stringify(reconForTransferDeposit)}`)
    console.log(`  recon(voucher deposit):  ${JSON.stringify(reconForVoucherDeposit)}`)

    if (!reconForTransferSale || reconForTransferSale.status !== 'matched') {
      fail('transfer sale not matched by transfer engine', {
        status: 500,
        body: { reconForTransferSale },
      })
    }
    if (!reconForVoucherSale || reconForVoucherSale.status !== 'matched') {
      fail('voucher sale not matched by app-voucher engine', {
        status: 500,
        body: { reconForVoucherSale },
      })
    }

    // Cross-contamination checks
    const transferMatchedVoucherDeposit = reconForTransferSale!.matches.some(
      (m) => m.deposit_record_id === depositVoucherVC.id
    )
    const voucherMatchedTransferDeposit = reconForVoucherSale!.matches.some(
      (m) => m.deposit_record_id === depositTransfer.id
    )
    const transferPairedOk = reconForTransferSale!.matches.some(
      (m) => m.sales_record_id === saleTransferId && m.deposit_record_id === depositTransfer.id
    )
    const voucherPairedOk = reconForVoucherSale!.matches.some(
      (m) => m.sales_record_id === saleVoucherVCId && m.deposit_record_id === depositVoucherVC.id
    )

    console.log(`  transfer engine paired own deposit: ${transferPairedOk}`)
    console.log(`  voucher engine paired own deposit:  ${voucherPairedOk}`)
    console.log(`  transfer stole voucher deposit: ${transferMatchedVoucherDeposit}`)
    console.log(`  voucher stole transfer deposit: ${voucherMatchedTransferDeposit}`)

    if (!transferPairedOk) {
      fail('transfer sale not paired with transfer deposit', {
        status: 500,
        body: reconForTransferSale as unknown as Record<string, unknown>,
      })
    }
    if (!voucherPairedOk) {
      fail('voucher sale not paired with voucher deposit', {
        status: 500,
        body: reconForVoucherSale as unknown as Record<string, unknown>,
      })
    }
    if (transferMatchedVoucherDeposit) {
      fail('CROSS-CONTAMINATION: transfer reconciliation swept up voucher deposit', {
        status: 500,
        body: reconForTransferSale as unknown as Record<string, unknown>,
      })
    }
    if (voucherMatchedTransferDeposit) {
      fail('CROSS-CONTAMINATION: app-voucher reconciliation swept up transfer deposit', {
        status: 500,
        body: reconForVoucherSale as unknown as Record<string, unknown>,
      })
    }

    // Also: voucher deposit must not appear in the transfer sale's recon, and vice versa
    if (reconForTransferDeposit?.id !== reconForTransferSale!.id) {
      fail('transfer deposit linked to unexpected reconciliation', {
        status: 500,
        body: { reconForTransferDeposit, reconForTransferSale },
      })
    }
    if (reconForVoucherDeposit?.id !== reconForVoucherSale!.id) {
      fail('voucher deposit linked to unexpected reconciliation', {
        status: 500,
        body: { reconForVoucherDeposit, reconForVoucherSale },
      })
    }

    console.log('  CONFIRMED V-C: each engine matched only its own channel rows; no cross-steal')

    console.log('\n========== DONE — V-A / V-B / V-C all confirmed ==========')
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
