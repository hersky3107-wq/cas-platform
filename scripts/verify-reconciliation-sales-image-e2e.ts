/**
 * Sales-image pipeline — LIVE E2E (real HTTP + remote DB + Storage).
 *
 * Verification only. Stops on the first unexpected failure. Does NOT patch
 * schema, matcher, or the vision parser.
 *
 * Run (dev server must already be up on localhost:3000):
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/verify-reconciliation-sales-image-e2e.ts
 */
import { deflateSync } from 'node:zlib'
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '../lib/supabase/server'
import { DEPOSIT_IMAGE_BUCKET } from '../lib/reconciliation/storage'

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const BUCKET = DEPOSIT_IMAGE_BUCKET

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
  console.log(`\n${method} ${path}\nHTTP ${response.status}\n${JSON.stringify(body, null, 2).slice(0, 5000)}`)
  return { status: response.status, body }
}

function requireResult(condition: unknown, label: string, detail: unknown): asserts condition {
  if (!condition) {
    console.error(`\nSTOP — ${label}\n${JSON.stringify(detail, null, 2)}`)
    throw new Error(label)
  }
}

function crc32(buf: Buffer): number {
  let c = ~0 >>> 0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

/** 5×7 bitmap, bit 4 = leftmost pixel. */
const GLYPHS: Record<string, number[]> = {
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '-': [0, 0, 0, 0b01110, 0, 0, 0],
  ':': [0, 0b00100, 0, 0, 0b00100, 0, 0],
  ',': [0, 0, 0, 0, 0, 0b00100, 0b01000],
  '/': [0b00001, 0b00010, 0b00100, 0b00100, 0b01000, 0b10000, 0],
  '0': [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  '1': [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  '2': [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  '3': [0b01110, 0b10001, 0b00001, 0b00110, 0b00001, 0b10001, 0b01110],
  '4': [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  '5': [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  '6': [0b01110, 0b10000, 0b11110, 0b10001, 0b10001, 0b10001, 0b01110],
  '7': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  '8': [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  '9': [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00001, 0b01110],
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01110],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b10101, 0b01010],
  Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
}

function encodePngRgb(
  width: number,
  height: number,
  getRgb: (x: number, y: number) => [number, number, number]
): Buffer {
  const raw = Buffer.alloc((1 + width * 3) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3)
    raw[row] = 0
    for (let x = 0; x < width; x++) {
      const [r, g, b] = getRgb(x, y)
      const i = row + 1 + x * 3
      raw[i] = r
      raw[i + 1] = g
      raw[i + 2] = b
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function renderLinesPng(lines: string[]): Buffer {
  const scale = 8
  const pad = 24
  const lineH = 7 * scale + 16
  const colW = 6 * scale
  const width = pad * 2 + Math.max(...lines.map((l) => l.length)) * colW
  const height = pad * 2 + lines.length * lineH
  const ink = new Set<string>()
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!
    const y0 = pad + li * lineH
    for (let ci = 0; ci < line.length; ci++) {
      const g = GLYPHS[line[ci]!.toUpperCase()] ?? GLYPHS[' ']!
      const x0 = pad + ci * colW
      for (let gy = 0; gy < 7; gy++) {
        for (let gx = 0; gx < 5; gx++) {
          if (g[gy]! & (1 << (4 - gx))) {
            for (let sy = 0; sy < scale; sy++) {
              for (let sx = 0; sx < scale; sx++) {
                ink.add(`${x0 + gx * scale + sx},${y0 + gy * scale + sy}`)
              }
            }
          }
        }
      }
    }
  }
  return encodePngRgb(width, height, (x, y) => (ink.has(`${x},${y}`) ? [20, 20, 20] : [255, 255, 255]))
}

function renderBlankPng(): Buffer {
  return encodePngRgb(48, 48, () => [180, 180, 180])
}

function toDataUrl(png: Buffer): string {
  return `data:image/png;base64,${png.toString('base64')}`
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

async function salesForDoc(docId: string, owner: string) {
  const { data, error } = await supabaseAdmin
    .from('sales_records')
    .select(
      'id, sale_date, gross_amount, confidence, confirm_status, sale_kind, entry_source, raw_document_id'
    )
    .eq('raw_document_id', docId)
    .eq('user_id', owner)
  if (error) throw new Error(`DB sale read failed: ${error.message}`)
  console.log(`DB sales_records for doc: ${JSON.stringify(data)}`)
  return (data ?? []) as Record<string, unknown>[]
}

async function depositsForDoc(docId: string, owner: string) {
  const { data, error } = await supabaseAdmin
    .from('deposit_records')
    .select('id, actual_amount, deposit_date, confidence, confirm_status, raw_document_id')
    .eq('raw_document_id', docId)
    .eq('user_id', owner)
  if (error) throw new Error(`DB deposit read failed: ${error.message}`)
  console.log(`DB deposit_records for doc: ${JSON.stringify(data)}`)
  return (data ?? []) as Record<string, unknown>[]
}

async function dbSale(id: string, owner: string) {
  const { data, error } = await supabaseAdmin
    .from('sales_records')
    .select(
      'id, sale_date, gross_amount, confidence, confirm_status, sale_kind, entry_source, raw_document_id'
    )
    .eq('id', id)
    .eq('user_id', owner)
    .maybeSingle()
  if (error) throw new Error(`DB sale by id failed: ${error.message}`)
  console.log(`DB sales_records row: ${JSON.stringify(data)}`)
  return data as Record<string, unknown> | null
}

async function createUser(tag: string) {
  const email = `recon-saleimg-verify-${tag}-${Date.now()}@example.com`
  const password = `Vf-${Math.random().toString(36).slice(2)}-${Date.now()}`
  const created = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  requireResult(!created.error && created.data.user, `create ${tag} user failed`, created.error)
  const userId = created.data.user.id
  createdUserIds.push(userId)
  const signed = await anon.auth.signInWithPassword({ email, password })
  requireResult(!signed.error && signed.data.session, `sign-in ${tag} failed`, signed.error)
  console.log(`Throwaway ${tag}: ${email} (${userId})`)
  return {
    userId,
    token: signed.data.session.access_token,
    refresh: signed.data.session.refresh_token,
  }
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

async function main() {
  try {
    const bucket = await supabaseAdmin.storage.getBucket(BUCKET)
    requireResult(!bucket.error && bucket.data, 'getBucket failed', bucket.error)
    console.log(`Bucket: ${JSON.stringify({ id: bucket.data.id, public: bucket.data.public })}`)
    requireResult(bucket.data.public === false, 'bucket must be private (public=false)', bucket.data)

    const userA = await createUser('a')
    const userB = await createUser('b')

    console.log('\n========== STEP 5a: unauthenticated → 401 ==========')
    const unauth = await request('/api/reconciliation/parse-sales-image', null, 'POST', {
      image: toDataUrl(renderBlankPng()),
      media_type: 'image/png',
    })
    requireResult(unauth.status === 401, 'unauthenticated POST expected 401', unauth)
    console.log('CONFIRMED: unauthenticated → 401')

    console.log('\n========== STEP 1: CLEAR TENDER (CARD printed) ==========')
    const cardPng = renderLinesPng(['CARD PAY 45,000 KRW', '2026-08-15'])
    console.log(`Generated CARD receipt PNG bytes=${cardPng.length}`)
    const parse1 = await request('/api/reconciliation/parse-sales-image', userA.token, 'POST', {
      image: toDataUrl(cardPng),
      media_type: 'image/png',
    })
    trackStorage(parse1.body)
    requireResult(parse1.status === 201, 'clear-tender receipt expected 201', parse1)
    requireResult(typeof parse1.body.sale?.id === 'string', 'sale missing on 201', parse1.body)
    requireResult(parse1.body.sale.confirm_status === 'pending', 'sale should be pending', parse1.body.sale)
    requireResult(parse1.body.sale.entry_source === 'pos_import', 'entry_source should be pos_import', parse1.body.sale)
    requireResult(parse1.body.sale.sale_kind === 'card', 'sale_kind should be card (guessed from CARD PAY)', parse1.body)
    requireResult(parse1.body.sale_kind_guessed === true, 'sale_kind_guessed should be true', parse1.body)
    requireResult(parse1.body.parsed?.sale_kind_guess === 'card', 'parsed.sale_kind_guess should be card', parse1.body.parsed)
    requireResult(
      typeof parse1.body.parsed?.confidence === 'number' && parse1.body.parsed.confidence <= 0.65,
      'vision confidence must be <= 0.65',
      parse1.body.parsed
    )
    requireResult(parse1.body.needs_confirm === true, 'needs_confirm should be true', parse1.body)
    requireResult(
      parse1.body.storage_path.startsWith(`${userA.userId}/`),
      'storage path not under owner prefix',
      parse1.body.storage_path
    )

    const doc1 = await dbDoc(parse1.body.document_id, userA.userId)
    requireResult(doc1?.source_type === 'receipt_image', 'source_type should be receipt_image', doc1)
    requireResult(doc1?.raw_text == null, 'raw_text must be null', doc1)
    requireResult(doc1?.parse_status === 'parsed', 'document should be parsed', doc1)

    const sales1 = await salesForDoc(parse1.body.document_id, userA.userId)
    requireResult(sales1.length === 1, 'expected one sales_records row', sales1)
    requireResult(sales1[0]?.sale_kind === 'card', 'DB sale_kind card', sales1)
    requireResult(sales1[0]?.confirm_status === 'pending', 'DB pending', sales1)
    requireResult(sales1[0]?.entry_source === 'pos_import', 'DB pos_import', sales1)
    requireResult(Number(sales1[0]?.gross_amount) === 45000, 'DB amount 45000', sales1)
    requireResult(sales1[0]?.sale_date === '2026-08-15', 'DB date 2026-08-15', sales1)
    const depsLeak1 = await depositsForDoc(parse1.body.document_id, userA.userId)
    requireResult(depsLeak1.length === 0, 'sales image must not write deposits', depsLeak1)
    console.log(
      `CONFIRMED STEP 1: HTTP 201, sale_kind=card, sale_kind_guessed=true, conf=${parse1.body.parsed.confidence}, raw=${parse1.body.parsed.raw_model_text}`
    )

    console.log('\n========== STEP 5b: private bucket + signed URL + cross-user ==========')
    const listed = await listPrefix(userA.userId)
    requireResult(listed.includes(parse1.body.storage_path), 'uploaded object not under user prefix', listed)
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

    const clientB = createClient(SUPABASE_URL, ANON_KEY)
    const setB = await clientB.auth.setSession({
      access_token: userB.token,
      refresh_token: userB.refresh,
    })
    requireResult(!setB.error, 'user B setSession failed', setB.error)
    const steal = await clientB.storage.from(BUCKET).download(parse1.body.storage_path)
    console.log(`User B download A's object: ${steal.error ? steal.error.message : 'UNEXPECTED SUCCESS'}`)
    requireResult(!!steal.error, 'user B must not download user A image', steal)
    const stealSign = await clientB.storage.from(BUCKET).createSignedUrl(parse1.body.storage_path, 60)
    console.log(`User B sign A's object: ${stealSign.error ? stealSign.error.message : stealSign.data?.signedUrl}`)
    requireResult(!!stealSign.error, 'user B must not sign user A image', stealSign)
    console.log('CONFIRMED STEP 5: public URL denied; signed URL works; cross-user isolated')

    console.log('\n========== STEP 2: AMBIGUOUS TENDER (no payment method) ==========')
    const ambiguousPng = renderLinesPng(['AMOUNT 32,000 KRW', '2026-08-16'])
    console.log(`Generated ambiguous receipt PNG bytes=${ambiguousPng.length}`)
    const parse2 = await request('/api/reconciliation/parse-sales-image', userA.token, 'POST', {
      image: toDataUrl(ambiguousPng),
      media_type: 'image/png',
    })
    trackStorage(parse2.body)
    requireResult(parse2.status === 201, 'ambiguous receipt expected 201 (date+amount readable)', parse2)
    console.log(
      `AI sale_kind_guess=${parse2.body.parsed?.sale_kind_guess} sale_kind_guessed=${parse2.body.sale_kind_guessed} persisted=${parse2.body.sale?.sale_kind} raw=${parse2.body.parsed?.raw_model_text}`
    )
    requireResult(
      parse2.body.parsed?.sale_kind_guess == null,
      'KEY CHECK FAILED: AI faked a tender on an image with no payment method',
      parse2.body.parsed
    )
    requireResult(parse2.body.sale_kind_guessed === false, 'sale_kind_guessed must be false', parse2.body)
    requireResult(
      parse2.body.sale?.sale_kind === 'manual_total',
      'unknown tender must persist as manual_total, NOT card',
      parse2.body.sale
    )
    requireResult(parse2.body.sale_kind_needs_review === true, 'sale_kind_needs_review should be true', parse2.body)
    requireResult(parse2.body.needs_confirm === true, 'needs_confirm should be true when kind unknown', parse2.body)
    requireResult(parse2.body.sale?.confirm_status === 'pending', 'ambiguous sale pending', parse2.body.sale)
    requireResult(parse2.body.sale?.entry_source === 'pos_import', 'ambiguous entry_source', parse2.body.sale)

    const sales2 = await salesForDoc(parse2.body.document_id, userA.userId)
    requireResult(sales2.length === 1, 'one sale for ambiguous image', sales2)
    requireResult(sales2[0]?.sale_kind === 'manual_total', 'DB sale_kind must be manual_total not card', sales2)
    requireResult(sales2[0]?.confirm_status === 'pending', 'DB pending', sales2)
    requireResult(Number(sales2[0]?.gross_amount) === 32000, 'DB amount 32000', sales2)
    console.log('CONFIRMED STEP 2: no fake tender, persisted manual_total, sale_kind_guessed=false')

    console.log('\n========== STEP 3: PATCH sale_kind cash ==========')
    const saleId = parse2.body.sale.id as string
    const patch3 = await request(`/api/reconciliation/sales/${saleId}`, userA.token, 'PATCH', {
      sale_kind: 'cash',
    })
    requireResult(patch3.status === 200, 'PATCH sale_kind expected 200', patch3)
    requireResult(patch3.body.sale_kind === 'cash', 'response sale_kind should be cash', patch3.body)
    const dbAfter = await dbSale(saleId, userA.userId)
    requireResult(dbAfter?.sale_kind === 'cash', 'DB sale_kind after PATCH should be cash', dbAfter)
    requireResult(Number(dbAfter?.gross_amount) === 32000, 'PATCH must not rewrite amount', dbAfter)
    console.log('CONFIRMED STEP 3: PATCH sale_kind cash persisted')

    console.log('\n========== STEP 4: UNREADABLE blank image → 422 ==========')
    const parse4 = await request('/api/reconciliation/parse-sales-image', userA.token, 'POST', {
      image: toDataUrl(renderBlankPng()),
      media_type: 'image/png',
    })
    trackStorage(parse4.body)
    requireResult(parse4.status === 422, 'blank image expected 422', parse4)
    requireResult(typeof parse4.body.document_id === 'string', '422 should still create raw_documents', parse4)
    requireResult(parse4.body.sale == null, '422 must not include a sale', parse4.body)
    requireResult(
      parse4.body.parsed?.unreadable === true || parse4.body.parsed?.amount == null,
      'blank image must not guess an amount',
      parse4.body.parsed
    )
    const doc4 = await dbDoc(parse4.body.document_id, userA.userId)
    requireResult(doc4?.parse_status === 'failed', 'blank image document should be failed', doc4)
    const sales4 = await salesForDoc(parse4.body.document_id, userA.userId)
    requireResult(sales4.length === 0, 'unreadable image must not create a sale', sales4)
    console.log('CONFIRMED STEP 4: HTTP 422, parse_status=failed, zero sales, no guessed amount')

    console.log('\n========== STEP 6: REGRESSION deposit-image still works ==========')
    const depositPng = renderLinesPng(['DEPOSIT 50,000 KRW', '2026-08-30'])
    const parse6 = await request('/api/reconciliation/parse-deposit-image', userA.token, 'POST', {
      image: toDataUrl(depositPng),
      media_type: 'image/png',
    })
    trackStorage(parse6.body)
    requireResult(parse6.status === 201, 'deposit-image regression expected 201', parse6)
    requireResult(typeof parse6.body.deposit?.id === 'string', 'deposit missing', parse6.body)
    requireResult(parse6.body.deposit.confirm_status === 'pending', 'deposit pending', parse6.body.deposit)
    requireResult(
      typeof parse6.body.parsed?.confidence === 'number' && parse6.body.parsed.confidence <= 0.65,
      'deposit vision cap still <= 0.65',
      parse6.body.parsed
    )
    const doc6 = await dbDoc(parse6.body.document_id, userA.userId)
    requireResult(doc6?.parse_status === 'parsed' && doc6?.source_type === 'receipt_image', 'deposit document', doc6)
    const deps6 = await depositsForDoc(parse6.body.document_id, userA.userId)
    requireResult(deps6.length === 1, 'one pending deposit from image', deps6)
    requireResult(deps6[0]?.confirm_status === 'pending', 'deposit confirm pending', deps6)
    const salesLeak6 = await salesForDoc(parse6.body.document_id, userA.userId)
    requireResult(salesLeak6.length === 0, 'deposit-image must not write sales', salesLeak6)
    console.log(
      `CONFIRMED STEP 6: deposit-image HTTP 201, pending deposit amount=${deps6[0]?.actual_amount} conf=${parse6.body.parsed.confidence}`
    )

    console.log('\n========== ALL LIVE SALES-IMAGE CHECKS PASSED ==========')
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
