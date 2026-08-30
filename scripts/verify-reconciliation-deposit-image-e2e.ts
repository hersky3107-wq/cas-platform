/**
 * Deposit-image pipeline — LIVE E2E (real HTTP + remote DB + Storage).
 *
 * Verification only. Stops on the first unexpected failure. Does NOT patch
 * schema, matcher, or the vision parser.
 *
 * Run (dev server must already be up on localhost:3000):
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/verify-reconciliation-deposit-image-e2e.ts
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
  console.log(`\n${method} ${path}\nHTTP ${response.status}\n${JSON.stringify(body, null, 2).slice(0, 4000)}`)
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
  D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  I: [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b10101, 0b01010],
}

function encodePngRgb(width: number, height: number, getRgb: (x: number, y: number) => [number, number, number]): Buffer {
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

function renderAlertPng(): Buffer {
  const scale = 8
  const pad = 24
  const lineH = 7 * scale + 16
  const lines = ['DEPOSIT 50,000 KRW', '2026-08-30']
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

async function createUser(tag: string) {
  const email = `recon-img-verify-${tag}-${Date.now()}@example.com`
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

async function main() {
  try {
    const bucket = await supabaseAdmin.storage.getBucket(BUCKET)
    requireResult(!bucket.error && bucket.data, 'getBucket failed — is reconciliation-deposits created?', bucket.error)
    console.log(`Bucket: ${JSON.stringify({ id: bucket.data.id, public: bucket.data.public })}`)
    requireResult(bucket.data.public === false, 'bucket must be private (public=false)', bucket.data)

    const userA = await createUser('a')
    const userB = await createUser('b')

    console.log('\n========== STEP 5 first: unauthenticated → 401 ==========')
    const unauth = await request('/api/reconciliation/parse-deposit-image', null, 'POST', {
      image: toDataUrl(renderBlankPng()),
      media_type: 'image/png',
    })
    requireResult(unauth.status === 401, 'unauthenticated POST expected 401', unauth)
    console.log('CONFIRMED STEP 5: unauthenticated → 401')

    console.log('\n========== STEP 1: upload generated deposit-alert PNG ==========')
    const alertPng = renderAlertPng()
    console.log(`Generated alert PNG bytes=${alertPng.length}`)
    const parse1 = await request('/api/reconciliation/parse-deposit-image', userA.token, 'POST', {
      image: toDataUrl(alertPng),
      media_type: 'image/png',
    })
    requireResult(
      parse1.status === 201 || parse1.status === 422,
      'step-1 expected 201 (parsed) or 422 (unreadable generated image)',
      parse1
    )
    const storagePath = parse1.body.storage_path as string
    const documentId = parse1.body.document_id as string
    requireResult(typeof storagePath === 'string' && storagePath.length > 0, 'storage_path missing', parse1)
    requireResult(typeof documentId === 'string', 'document_id missing', parse1)
    storagePaths.push(storagePath)

    requireResult(
      storagePath.startsWith(`${userA.userId}/`),
      'storage path is not under the owner prefix',
      { storagePath, userId: userA.userId }
    )

    const listedA = await listPrefix(userA.userId)
    console.log(`Storage list ${userA.userId}/ → ${JSON.stringify(listedA)}`)
    requireResult(listedA.includes(storagePath), 'uploaded object not in bucket under user prefix', listedA)

    const doc1 = await dbDoc(documentId, userA.userId)
    requireResult(doc1, 'raw_documents row missing', documentId)
    requireResult(doc1.source_type === 'receipt_image', 'source_type is not receipt_image', doc1)
    requireResult(doc1.storage_path === storagePath, 'storage_path mismatch on document', doc1)
    requireResult(doc1.raw_text == null, 'raw_text must be null for image docs', doc1)

    const parsed = parse1.body.parsed as {
      date: string | null
      amount: number | null
      confidence: number
      unreadable?: boolean
    }
    console.log(
      `STEP 1 parsed: date=${parsed?.date} amount=${parsed?.amount} confidence=${parsed?.confidence} unreadable=${parsed?.unreadable}`
    )
    requireResult(parsed && typeof parsed === 'object', 'parse result object missing', parse1)

    if (parse1.status === 201) {
      requireResult(doc1.parse_status === 'parsed', 'successful parse should mark document parsed', doc1)
      requireResult(typeof parsed.date === 'string' && typeof parsed.amount === 'number', '201 without date+amount', parsed)
      const deps = await depositsForDoc(documentId, userA.userId)
      requireResult(deps.length === 1, 'successful parse should create one deposit', deps)
      requireResult(deps[0]?.confirm_status === 'pending', 'deposit confirm_status should be pending', deps)
      console.log('CONFIRMED STEP 1: AI read the generated image (201 + deposit pending)')
    } else {
      requireResult(doc1.parse_status === 'failed', '422 should mark document failed', doc1)
      const deps = await depositsForDoc(documentId, userA.userId)
      requireResult(deps.length === 0, 'unreadable generated image must not create a deposit', deps)
      console.log('NOTE STEP 1: AI could not read the generated bitmap text (422). Pipeline still stored the image + raw_documents.')
    }

    console.log('\n========== STEP 2: confidence cap <= 0.65 ==========')
    if (parse1.status === 201) {
      requireResult(parsed.confidence <= 0.65, 'vision confidence must be <= 0.65', parsed)
      requireResult(parse1.body.needs_confirm === true, 'needs_confirm should be true under HITL 0.7', parse1)
      requireResult(
        Number(parse1.body.deposit?.confidence) <= 0.65,
        'persisted deposit confidence must be <= 0.65',
        parse1.body.deposit
      )
      console.log(`CONFIRMED STEP 2: confidence=${parsed.confidence} <= 0.65, needs_confirm=true`)
    } else {
      console.log('STEP 2 skipped: no successful vision parse on the generated image (nothing to cap).')
    }

    console.log('\n========== STEP 3: blank/garbage image → 422, no deposit ==========')
    const parse3 = await request('/api/reconciliation/parse-deposit-image', userA.token, 'POST', {
      image: toDataUrl(renderBlankPng()),
      media_type: 'image/png',
    })
    requireResult(parse3.status === 422, 'blank image expected 422', parse3)
    const failPath = parse3.body.storage_path as string
    const failDocId = parse3.body.document_id as string
    requireResult(typeof failPath === 'string', '422 should still store the image', parse3)
    requireResult(typeof failDocId === 'string', '422 should still create raw_documents', parse3)
    storagePaths.push(failPath)

    const doc3 = await dbDoc(failDocId, userA.userId)
    requireResult(doc3?.parse_status === 'failed', 'blank image document should be failed', doc3)
    requireResult(doc3?.source_type === 'receipt_image', 'blank image source_type', doc3)
    const deps3 = await depositsForDoc(failDocId, userA.userId)
    requireResult(deps3.length === 0, 'blank image must not create a deposit_record', deps3)
    const guessed = parse3.body.parsed?.amount
    requireResult(
      parse3.body.parsed?.unreadable === true || guessed == null,
      'blank image must not guess an amount',
      parse3.body.parsed
    )
    console.log('CONFIRMED STEP 3: 422, parse_status=failed, zero deposits, no guessed amount')

    console.log('\n========== STEP 4: private bucket + signed URL + cross-user ==========')
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`
    const publicRes = await fetch(publicUrl)
    const publicBody = await publicRes.text()
    console.log(`GET public URL\nHTTP ${publicRes.status}\n${publicBody.slice(0, 400)}`)
    requireResult(
      publicRes.status === 400 || publicRes.status === 403 || publicRes.status === 404,
      'public object URL must not succeed on a private bucket',
      { status: publicRes.status, body: publicBody.slice(0, 400) }
    )

    const signed = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(storagePath, 60)
    requireResult(!signed.error && signed.data?.signedUrl, 'admin createSignedUrl failed', signed.error)
    const signedRes = await fetch(signed.data.signedUrl)
    console.log(`GET signed URL HTTP ${signedRes.status} content-type=${signedRes.headers.get('content-type')}`)
    requireResult(signedRes.status === 200, 'signed URL should return the object', signedRes.status)
    const signedBytes = Buffer.from(await signedRes.arrayBuffer())
    requireResult(signedBytes.length > 0, 'signed URL body empty', signedBytes.length)

    const clientB = createClient(SUPABASE_URL, ANON_KEY)
    const setB = await clientB.auth.setSession({
      access_token: userB.token,
      refresh_token: userB.refresh,
    })
    requireResult(!setB.error, 'user B setSession failed', setB.error)
    const steal = await clientB.storage.from(BUCKET).download(storagePath)
    console.log(`User B download A's object: ${steal.error ? steal.error.message : 'UNEXPECTED SUCCESS'}`)
    requireResult(!!steal.error, 'user B must not download user A image', steal)
    const stealSign = await clientB.storage.from(BUCKET).createSignedUrl(storagePath, 60)
    console.log(`User B sign A's object: ${stealSign.error ? stealSign.error.message : stealSign.data?.signedUrl}`)
    requireResult(!!stealSign.error, 'user B must not sign user A image', stealSign)
    console.log('CONFIRMED STEP 4: public URL denied; signed URL works; cross-user isolated')

    console.log('\n========== ALL LIVE DEPOSIT-IMAGE CHECKS PASSED ==========')
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
