/**
 * Spreadsheet import — LIVE E2E (real HTTP + remote DB + Storage).
 *
 * Verification only. Stops on the first unexpected failure. Does NOT patch
 * schema, matcher, or the spreadsheet parser.
 *
 * Run (dev server must already be up on localhost:3000):
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/verify-reconciliation-spreadsheet-e2e.ts
 */
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '../lib/supabase/server'
import { DEPOSIT_IMAGE_BUCKET } from '../lib/reconciliation/storage'

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const BUCKET = DEPOSIT_IMAGE_BUCKET
const ROW_CAP = 300

type Probe = { status: number; body: any }

async function request(
  path: string,
  token: string | null,
  method = 'GET',
  json?: Record<string, unknown>
): Promise<Probe> {
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
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
  const dumped = JSON.stringify(body, null, 2)
  console.log(`\n${method} ${path}\nHTTP ${response.status}\n${dumped.slice(0, 5000)}`)
  return { status: response.status, body }
}

function requireResult(condition: unknown, label: string, detail: unknown): asserts condition {
  if (!condition) {
    console.error(`\nSTOP — ${label}\n${JSON.stringify(detail, null, 2)}`)
    throw new Error(label)
  }
}

function csvDataUrl(csv: string): string {
  return `data:text/csv;base64,${Buffer.from(csv, 'utf8').toString('base64')}`
}

async function postSheet(
  token: string | null,
  kind: 'deposits' | 'sales',
  csv: string,
  filename: string
): Promise<Probe> {
  return request('/api/reconciliation/parse-spreadsheet', token, 'POST', {
    file: csvDataUrl(csv),
    media_type: 'text/csv',
    filename,
    kind,
  })
}

const anon = createClient(SUPABASE_URL, ANON_KEY)
const createdUserIds: string[] = []
const storagePaths: string[] = []

async function dbDoc(id: string, owner: string) {
  const { data, error } = await supabaseAdmin
    .from('raw_documents')
    .select('id, user_id, source_type, storage_path, raw_text, parse_status, parse_error')
    .eq('id', id)
    .eq('user_id', owner)
    .maybeSingle()
  if (error) throw new Error(`DB document read failed: ${error.message}`)
  console.log(`DB raw_documents: ${JSON.stringify(data)}`)
  return data as Record<string, unknown> | null
}

async function depositsForDoc(docId: string, owner: string) {
  const { data, error } = await supabaseAdmin
    .from('deposit_records')
    .select('id, actual_amount, deposit_date, confidence, confirm_status, raw_document_id')
    .eq('raw_document_id', docId)
    .eq('user_id', owner)
    .order('deposit_date', { ascending: true })
  if (error) throw new Error(`DB deposit read failed: ${error.message}`)
  console.log(`DB deposit_records for doc: ${JSON.stringify(data)}`)
  return (data ?? []) as Record<string, unknown>[]
}

async function salesForDoc(docId: string, owner: string) {
  const { data, error } = await supabaseAdmin
    .from('sales_records')
    .select(
      'id, gross_amount, sale_date, confidence, confirm_status, sale_kind, entry_source, raw_document_id'
    )
    .eq('raw_document_id', docId)
    .eq('user_id', owner)
    .order('sale_date', { ascending: true })
  if (error) throw new Error(`DB sale read failed: ${error.message}`)
  console.log(`DB sales_records for doc: ${JSON.stringify(data)}`)
  return (data ?? []) as Record<string, unknown>[]
}

async function countOwned(table: 'deposit_records' | 'sales_records', owner: string) {
  const { count, error } = await supabaseAdmin
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('user_id', owner)
  if (error) throw new Error(`count ${table} failed: ${error.message}`)
  return count ?? 0
}

async function createUser() {
  const email = `recon-sheet-verify-${Date.now()}@example.com`
  const password = `Vf-${Math.random().toString(36).slice(2)}-${Date.now()}`
  const created = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  requireResult(!created.error && created.data.user, 'create user failed', created.error)
  const userId = created.data.user.id
  createdUserIds.push(userId)
  const signed = await anon.auth.signInWithPassword({ email, password })
  requireResult(!signed.error && signed.data.session, 'sign-in failed', signed.error)
  console.log(`Throwaway user: ${email} (${userId})`)
  return { userId, token: signed.data.session.access_token }
}

async function listPrefix(userId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).list(userId, { limit: 100 })
  if (error) throw new Error(`storage list failed: ${error.message}`)
  return (data ?? []).filter((f) => f.name && !f.name.endsWith('/')).map((f) => `${userId}/${f.name}`)
}

async function cleanup() {
  for (const uid of createdUserIds) {
    const listed = await listPrefix(uid).catch((e) => {
      console.error(`listPrefix cleanup ${uid}: ${e}`)
      return [] as string[]
    })
    const paths = [...new Set([...storagePaths.filter((p) => p.startsWith(`${uid}/`)), ...listed])]
    if (paths.length) {
      const removed = await supabaseAdmin.storage.from(BUCKET).remove(paths)
      console.log(
        `Storage cleanup ${uid}: ${removed.error ? `ERROR ${removed.error.message}` : `removed ${paths.length} object(s)`}`
      )
    }
    const del = await supabaseAdmin.auth.admin.deleteUser(uid)
    console.log(`User cleanup ${uid}: ${del.error ? `ERROR ${del.error.message}` : 'OK'}`)
    if (del.error) process.exitCode = 1
  }
}

function trackStorage(body: any) {
  if (typeof body?.storage_path === 'string') storagePaths.push(body.storage_path)
}

const DEPOSITS_CSV = [
  '거래일자,입금액,메모',
  '2026-08-01,10000,김철수',
  '2026-08-02,25000,이영희',
  '2026-08-03,50000,박민수',
].join('\n')

const SALES_CSV = [
  '판매일,금액,결제수단',
  '2026-08-10,30000,카드',
  '2026-08-11,15000,현금',
  '2026-08-12,22000,카드',
].join('\n')

const FAILED_ROW_CSV = [
  '거래일자,입금액,메모',
  '2026-08-20,10000,ok',
  '2026-08-21,abc,broken',
  '2026-08-22,20000,ok2',
].join('\n')

async function main() {
  try {
    const bucket = await supabaseAdmin.storage.getBucket(BUCKET)
    requireResult(!bucket.error && bucket.data, 'getBucket failed', bucket.error)
    console.log(`Bucket: ${JSON.stringify({ id: bucket.data.id, public: bucket.data.public })}`)
    requireResult(bucket.data.public === false, 'bucket must be private', bucket.data)

    const user = await createUser()

    console.log('\n========== STEP 7a: unauthenticated → 401 ==========')
    const unauth = await postSheet(null, 'deposits', DEPOSITS_CSV, 'deposits.csv')
    requireResult(unauth.status === 401, 'unauthenticated POST expected 401', unauth)
    console.log('CONFIRMED: unauthenticated → 401')

    console.log('\n========== STEP 1: DEPOSITS CSV (non-standard headers) ==========')
    const parse1 = await postSheet(user.token, 'deposits', DEPOSITS_CSV, 'deposits-pos.csv')
    trackStorage(parse1.body)
    requireResult(parse1.status === 201, 'deposits CSV expected 201', parse1)
    requireResult(parse1.body.kind === 'deposits', 'kind should echo deposits', parse1.body)
    requireResult(parse1.body.parsed_count === 3, 'expected 3 parsed deposit rows', parse1.body)
    requireResult(Array.isArray(parse1.body.inserted) && parse1.body.inserted.length === 3, 'inserted length', parse1.body)
    requireResult(
      parse1.body.inserted.every((r: any) => typeof r.confidence === 'number'),
      'per-row confidence missing',
      parse1.body.inserted
    )
    const map1 = parse1.body.column_map
    console.log(`AI/heuristic column_map: ${JSON.stringify(map1)}`)
    requireResult(map1, 'column_map missing', parse1.body)
    requireResult(map1.dateCol === 0, '거래일자 should map to column 0 (date)', map1)
    requireResult(map1.amountCol === 1, '입금액 should map to column 1 (amount)', map1)
    requireResult(
      typeof parse1.body.storage_path === 'string' && parse1.body.storage_path.startsWith(`${user.userId}/`),
      'storage path not under owner prefix',
      parse1.body.storage_path
    )

    const doc1 = await dbDoc(parse1.body.document_id, user.userId)
    requireResult(doc1?.source_type === 'excel', 'source_type should be excel', doc1)
    requireResult(doc1?.raw_text == null, 'raw_text must be null', doc1)
    requireResult(doc1?.parse_status === 'parsed', 'document should be parsed', doc1)
    requireResult(doc1?.storage_path === parse1.body.storage_path, 'storage_path mismatch', doc1)

    const deps1 = await depositsForDoc(parse1.body.document_id, user.userId)
    requireResult(deps1.length === 3, 'expected 3 deposit_records in DB', deps1)
    requireResult(
      deps1.every((d) => d.confirm_status === 'pending'),
      'all deposits should be pending',
      deps1
    )
    const amounts1 = deps1.map((d) => d.actual_amount).sort()
    requireResult(
      JSON.stringify(amounts1) === JSON.stringify([10000, 25000, 50000]),
      'deposit amounts mismatch',
      amounts1
    )
    const salesLeak1 = await salesForDoc(parse1.body.document_id, user.userId)
    requireResult(salesLeak1.length === 0, 'deposits kind must not write sales_records', salesLeak1)
    console.log(
      `CONFIRMED STEP 1: HTTP 201, 3 pending deposits, map source=${map1.source} dateCol=${map1.dateCol} amountCol=${map1.amountCol}`
    )

    console.log('\n========== STEP 7b: stored object not public ==========')
    const listed = await listPrefix(user.userId)
    requireResult(listed.includes(parse1.body.storage_path), 'uploaded CSV not in bucket prefix', listed)
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${parse1.body.storage_path}`
    const publicRes = await fetch(publicUrl)
    const publicBody = await publicRes.text()
    console.log(`GET public URL HTTP ${publicRes.status} ${publicBody.slice(0, 200)}`)
    requireResult(
      publicRes.status === 400 || publicRes.status === 403 || publicRes.status === 404,
      'public object URL must not succeed',
      { status: publicRes.status, body: publicBody.slice(0, 400) }
    )
    const signed = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(parse1.body.storage_path, 60)
    requireResult(!signed.error && signed.data?.signedUrl, 'admin signed URL failed', signed.error)
    const signedRes = await fetch(signed.data.signedUrl)
    console.log(`GET signed URL HTTP ${signedRes.status}`)
    requireResult(signedRes.status === 200, 'signed URL should return the object', signedRes.status)
    console.log('CONFIRMED STEP 7: prefix ownership + not publicly readable')

    console.log('\n========== STEP 2: SALES CSV ==========')
    const parse2 = await postSheet(user.token, 'sales', SALES_CSV, 'sales-pos.csv')
    trackStorage(parse2.body)
    requireResult(parse2.status === 201, 'sales CSV expected 201', parse2)
    requireResult(parse2.body.kind === 'sales', 'kind should echo sales', parse2.body)
    requireResult(parse2.body.parsed_count === 3, 'expected 3 parsed sales rows', parse2.body)
    const map2 = parse2.body.column_map
    console.log(`AI/heuristic column_map: ${JSON.stringify(map2)}`)
    requireResult(map2?.dateCol === 0, '판매일 should map to column 0', map2)
    requireResult(map2?.amountCol === 1, '금액 should map to column 1', map2)

    const doc2 = await dbDoc(parse2.body.document_id, user.userId)
    requireResult(doc2?.parse_status === 'parsed' && doc2?.source_type === 'excel', 'sales document', doc2)

    const sales2 = await salesForDoc(parse2.body.document_id, user.userId)
    requireResult(sales2.length === 3, 'expected 3 sales_records in DB', sales2)
    requireResult(
      sales2.every((s) => s.confirm_status === 'pending'),
      'all sales should be pending',
      sales2
    )
    requireResult(
      sales2.every((s) => s.entry_source === 'pos_import'),
      'entry_source should be pos_import',
      sales2
    )
    const kinds = sales2.map((s) => s.sale_kind)
    console.log(`sale_kind values: ${JSON.stringify(kinds)}`)
    requireResult(
      map2.saleKindCol === 2,
      '결제수단 should map to sale_kind column 2 (where possible)',
      map2
    )
    requireResult(kinds.includes('cash'), '현금 row should map to sale_kind=cash', kinds)
    requireResult(kinds.filter((k) => k === 'card').length >= 1, '카드 row should map to card', kinds)
    const depsLeak2 = await depositsForDoc(parse2.body.document_id, user.userId)
    requireResult(depsLeak2.length === 0, 'sales kind must not write deposit_records', depsLeak2)
    console.log('CONFIRMED STEP 2: HTTP 201, 3 pending sales, pos_import, sale_kind mapped')

    console.log('\n========== STEP 3: FAILED ROW (amount=abc) not guessed ==========')
    const parse3 = await postSheet(user.token, 'deposits', FAILED_ROW_CSV, 'deposits-broken.csv')
    trackStorage(parse3.body)
    requireResult(parse3.status === 201, 'mixed CSV with one bad row expected 201 (good rows still import)', parse3)
    requireResult(parse3.body.parsed_count === 2, 'expected 2 good rows parsed', parse3.body)
    requireResult(parse3.body.failed_count >= 1, 'broken row must be reported', parse3.body)
    const failed3: any[] = parse3.body.failed_rows ?? []
    console.log(`failed_rows: ${JSON.stringify(failed3)}`)
    requireResult(
      failed3.some((r) => Array.isArray(r.cells) && r.cells.includes('abc')),
      'failed_rows must include the abc cells — not silently dropped',
      failed3
    )
    const deps3 = await depositsForDoc(parse3.body.document_id, user.userId)
    requireResult(deps3.length === 2, 'only good rows should insert', deps3)
    const amounts3 = deps3.map((d) => Number(d.actual_amount)).sort((a, b) => a - b)
    requireResult(
      JSON.stringify(amounts3) === JSON.stringify([10000, 20000]),
      'good amounts 10000 and 20000; abc must not become a deposit',
      amounts3
    )
    console.log('CONFIRMED STEP 3: abc reported in failed_rows, 2 good deposits, no guessed amount')

    console.log('\n========== STEP 4: WRONG KIND (deposits CSV + kind=sales) ==========')
    const beforeDeps = await countOwned('deposit_records', user.userId)
    const beforeSales = await countOwned('sales_records', user.userId)
    const parse4 = await postSheet(user.token, 'sales', DEPOSITS_CSV, 'deposits-as-sales.csv')
    trackStorage(parse4.body)
    requireResult(parse4.status !== 500, 'wrong kind must not crash', parse4)
    requireResult(parse4.status === 201, 'wrong kind should still import into the declared table', parse4)
    requireResult(parse4.body.kind === 'sales', 'response kind must stay sales (no auto-switch)', parse4.body)
    const sales4 = await salesForDoc(parse4.body.document_id, user.userId)
    const deps4 = await depositsForDoc(parse4.body.document_id, user.userId)
    requireResult(deps4.length === 0, 'kind=sales must not write deposits for this document', deps4)
    requireResult(sales4.length === parse4.body.parsed_count, 'rows must land on sales_records', {
      sales4: sales4.length,
      parsed: parse4.body.parsed_count,
    })
    requireResult(sales4.length > 0, 'expected sales rows from the mis-tagged file', sales4)
    const afterDeps = await countOwned('deposit_records', user.userId)
    const afterSales = await countOwned('sales_records', user.userId)
    requireResult(afterDeps === beforeDeps, 'no extra deposits from wrong-kind post', {
      beforeDeps,
      afterDeps,
    })
    requireResult(afterSales === beforeSales + sales4.length, 'new rows went to sales only', {
      beforeSales,
      afterSales,
      added: sales4.length,
    })
    console.log(
      `CONFIRMED STEP 4: HTTP ${parse4.status}, kind=sales, ${sales4.length} sales_records, 0 deposits for this doc. map=${JSON.stringify(parse4.body.column_map)}`
    )

    console.log('\n========== STEP 5: EMPTY CSV → 422 ==========')
    const beforeDeps5 = await countOwned('deposit_records', user.userId)
    const beforeSales5 = await countOwned('sales_records', user.userId)
    const parse5 = await postSheet(user.token, 'deposits', '\n', 'empty.csv')
    trackStorage(parse5.body)
    requireResult(parse5.status === 422, 'empty CSV expected 422', parse5)
    requireResult(typeof parse5.body.document_id === 'string', '422 should still create raw_documents', parse5)
    const doc5 = await dbDoc(parse5.body.document_id, user.userId)
    requireResult(doc5?.parse_status === 'failed', 'empty CSV document should be failed', doc5)
    const deps5 = await depositsForDoc(parse5.body.document_id, user.userId)
    const sales5 = await salesForDoc(parse5.body.document_id, user.userId)
    requireResult(deps5.length === 0 && sales5.length === 0, 'empty CSV must insert nothing', { deps5, sales5 })
    requireResult(
      (await countOwned('deposit_records', user.userId)) === beforeDeps5,
      'no new deposits on empty CSV',
      { beforeDeps5 }
    )
    requireResult(
      (await countOwned('sales_records', user.userId)) === beforeSales5,
      'no new sales on empty CSV',
      { beforeSales5 }
    )
    console.log('CONFIRMED STEP 5: HTTP 422, parse_status=failed, zero rows inserted')

    console.log('\n========== STEP 6: CAP >300 data rows → 400 ==========')
    const capLines = ['거래일자,입금액,메모']
    for (let i = 1; i <= ROW_CAP + 1; i++) {
      capLines.push(`2026-08-01,${1000 + i},row${i}`)
    }
    requireResult(capLines.length === ROW_CAP + 2, 'cap fixture size', capLines.length)
    const beforeDeps6 = await countOwned('deposit_records', user.userId)
    const parse6 = await postSheet(user.token, 'deposits', capLines.join('\n'), 'over-cap.csv')
    trackStorage(parse6.body)
    requireResult(parse6.status === 400, 'over-cap expected 400', parse6)
    requireResult(parse6.body.row_cap === ROW_CAP, 'row_cap should be 300', parse6.body)
    requireResult(typeof parse6.body.document_id === 'string', 'over-cap still stores a document', parse6)
    const doc6 = await dbDoc(parse6.body.document_id, user.userId)
    requireResult(doc6?.parse_status === 'failed', 'over-cap document should be failed', doc6)
    const deps6 = await depositsForDoc(parse6.body.document_id, user.userId)
    requireResult(deps6.length === 0, 'over-cap must not insert deposits', deps6)
    requireResult(
      (await countOwned('deposit_records', user.userId)) === beforeDeps6,
      'over-cap must not add deposits',
      { beforeDeps6 }
    )
    console.log('CONFIRMED STEP 6: HTTP 400, row_cap=300, parse_status=failed, nothing inserted')

    console.log('\n========== ALL LIVE SPREADSHEET CHECKS PASSED ==========')
  } finally {
    await cleanup()
  }
}

main().catch((error) => {
  console.error(
    `\nVERIFICATION STOPPED: ${error instanceof Error ? error.stack ?? error.message : String(error)}`
  )
  process.exit(1)
})
