import { writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { extract, type SourceType } from '@/lib/extract'
import type { JejuSupplement } from '@/lib/jeju/supplements'

export const runtime = 'nodejs'
export const maxDuration = 60

// ─────────────────────────────────────────────────────────────────────────────
// JEJU manual-supplement FILE extraction route (mirrors motie's file branch;
// copied pattern, NOT imported from motie). TEXT PASTE does not need a server
// round-trip (the brief page builds a paste JejuSupplement client-side), so
// this route is FILE-ONLY. UI file-upload wiring is S3 — this route lands now.
//
// Accepts multipart file upload (pdf/docx/xlsx/hwpx) → temp file →
// extract() from SHARED lib/extract (import only; never modify) → truncate
// 20,000 chars → delete temp in `finally` → return one JejuSupplement
// (source:'file').
// ─────────────────────────────────────────────────────────────────────────────

const MAX_TEXT_LENGTH = 20_000

const ACCEPTED_FILE_EXT: Record<string, SourceType> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.xlsx': 'xlsx',
  '.hwpx': 'hwpx',
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

function fail(error: string, status = 400): Response {
  return json({ ok: false, supplement: null, error }, status)
}

function truncate(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_TEXT_LENGTH) return { text, truncated: false }
  return { text: text.slice(0, MAX_TEXT_LENGTH), truncated: true }
}

async function handleFile(form: FormData): Promise<Response> {
  const file = form.get('file')
  if (!(file instanceof File)) return fail('파일이 전송되지 않았습니다.')
  if (file.size === 0) return fail('빈 파일입니다.')

  const ext = path.extname(file.name || '').toLowerCase()
  const sourceType = ACCEPTED_FILE_EXT[ext]
  if (!sourceType) {
    return fail(
      `지원하지 않는 파일 형식입니다(${ext || '확장자 없음'}). pdf, docx, xlsx, hwpx(구 hwp 제외)만 지원합니다.`
    )
  }

  if (file.size > 10 * 1024 * 1024) {
    return fail('파일이 너무 큽니다(최대 10MB).')
  }

  const dir = path.join(tmpdir(), 'jeju-extract')
  const tmpPath = path.join(dir, `${randomUUID()}${ext}`)
  let supplement: JejuSupplement | null = null
  let extractError: string | null = null

  try {
    await mkdir(dir, { recursive: true })
    const bytes = new Uint8Array(await file.arrayBuffer())
    await writeFile(tmpPath, bytes)

    const result = await extract({ type: sourceType, value: tmpPath })
    if (!result.ok || !result.text.trim()) {
      extractError = result.error ?? '파일 본문 추출에 실패했습니다.'
      supplement = {
        label: `파일: ${path.basename(file.name || 'upload')}`,
        text: `(추출 실패) ${extractError}`,
        source: 'file',
        truncated: false,
        ok: false,
        error: extractError,
      }
    } else {
      const t = truncate(result.text.trim())
      supplement = {
        label: `파일: ${path.basename(file.name || 'upload')}`,
        text: t.text,
        source: 'file',
        truncated: t.truncated,
        ok: true,
      }
    }
  } catch (e: unknown) {
    extractError = e instanceof Error ? e.message : 'unknown error'
    supplement = {
      label: `파일: ${path.basename(file.name || 'upload')}`,
      text: `(추출 실패) ${extractError}`,
      source: 'file',
      truncated: false,
      ok: false,
      error: extractError,
    }
  } finally {
    await rm(tmpPath, { force: true }).catch(() => {})
  }

  if (!supplement) return fail('추출 결과를 만들지 못했습니다.')
  return json({ ok: supplement.ok, supplement })
}

export async function POST(req: Request): Promise<Response> {
  const ct = req.headers.get('content-type') ?? ''
  try {
    if (!ct.includes('multipart/form-data')) {
      return fail('이 엔드포인트는 파일 업로드(multipart/form-data)만 지원합니다.')
    }
    const form = await req.formData()
    return handleFile(form)
  } catch (e: unknown) {
    return fail(e instanceof Error ? e.message : 'unknown error', 400)
  }
}
