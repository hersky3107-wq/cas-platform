import { writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { extract, type SourceType } from '@/lib/extract'
import type { MotieSupplement } from '@/lib/motie/supplements'

export const runtime = 'nodejs'
export const maxDuration = 60

// ─────────────────────────────────────────────────────────────────────────────
// MOTIE manual-supplement FILE extraction route (mirrors festival's file branch;
// copied, not shared — see app/api/festival/extract/route.ts for the reference
// implementation). TEXT PASTE does not need a server round-trip (the brief page
// builds a paste MotieSupplement client-side), so this route is FILE-ONLY.
// No URL support this step.
//
// Accepts a multipart file upload (pdf/docx/xlsx/hwpx) → save to a temp file →
// extract() from the SHARED lib/extract → truncate to 20,000 chars → delete the
// temp file in `finally` → return one normalized MotieSupplement (source:'file').
//
// ISOLATION: motie-only route. Reads shared infra (lib/extract) but does not
// modify it. Never touches festival/jeju. The raw upload is NOT persisted —
// only the normalized text + a short label travel back to the client, which
// then pushes them into the SAME supplements[] the paste flow uses.
//
// PII warning: this route does not attempt to redact PII. The brief page warns
// the user before upload; we cap text length and delete the temp file
// immediately after extraction so raw bytes do not linger on disk.
// ─────────────────────────────────────────────────────────────────────────────

/** Hard cap on extracted text length forwarded to the engine (mirrors festival's). */
const MAX_TEXT_LENGTH = 20_000

/**
 * Accepted file extensions. hwpx (modern XML-based 한글 문서, a zip archive) IS
 * supported — lib/extract/adapters/hwpx.ts parses it. Only the LEGACY binary
 * .hwp format is excluded.
 */
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

  // Cap raw upload size (10MB) — protects the server from oversized payloads.
  if (file.size > 10 * 1024 * 1024) {
    return fail('파일이 너무 큽니다(최대 10MB).')
  }

  const dir = path.join(tmpdir(), 'motie-extract')
  const tmpPath = path.join(dir, `${randomUUID()}${ext}`)
  let supplement: MotieSupplement | null = null
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
    // Always delete the temp file — raw upload bytes must not linger.
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
    return fail(e instanceof Error ? e.message : 'unknown error', 500)
  }
}
