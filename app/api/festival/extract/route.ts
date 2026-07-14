import { writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { extract, type SourceType } from '@/lib/extract'
import type { FestivalSupplement } from '@/lib/festival/plan-schema'

export const runtime = 'nodejs'
export const maxDuration = 60

// ─────────────────────────────────────────────────────────────────────────────
// FESTIVAL manual-supplement extraction route.
//
// Accepts three supplement kinds and returns ONE normalized FestivalSupplement:
//   - paste : { kind:'paste', text }               → text passes through (capped)
//   - url   : { kind:'url',   url }                → extract({ type:'url', value:url })
//   - file  : multipart upload (pdf/docx/xlsx/hwpx) → save temp → extract() → delete temp
//
// ISOLATION: festival-only route. Reads shared infra (lib/extract). Never touches
// MOTIE/Jeju. The raw upload is NOT persisted — only the normalized text + a
// short label travel back to the client, which then posts them into the
// deliberate `start` action's `supplements` array (stored in festival_sessions).
//
// PII warning: this route does not attempt to redact PII. The form warns the
// user before upload; we cap text length and delete the temp file immediately
// after extraction so raw bytes do not linger on disk.
// ─────────────────────────────────────────────────────────────────────────────

/** Hard cap on paste/extracted text length forwarded to the pipeline. */
const MAX_TEXT_LENGTH = 20_000

/**
 * Accepted file extensions. hwpx (modern XML-based 한글 문서, a zip archive)
 * IS supported — lib/extract/adapters/hwpx.ts parses it. Only the LEGACY
 * binary .hwp format is excluded: it's an OLE compound file, not a zip, and
 * has no adapter here (extractHwpx explicitly rejects it if mislabeled as
 * .hwpx). Users on old 한글 versions must convert to hwpx/pdf first.
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

/** Maps an extracted source type to a FestivalSupplement.source. */
function sourceOf(st: SourceType): FestivalSupplement['source'] {
  if (st === 'url') return 'url'
  return 'file'
}

/**
 * JSON POST path for paste + url (the form sends JSON for these). The file path
 * is handled separately as multipart/form-data below.
 */
async function handleJson(body: Record<string, unknown>): Promise<Response> {
  const kind = typeof body.kind === 'string' ? body.kind : ''

  if (kind === 'paste') {
    const text = typeof body.text === 'string' ? body.text : ''
    if (!text.trim()) return fail('붙여넣은 텍스트가 비어 있습니다.')
    const t = truncate(text.trim())
    const supplement: FestivalSupplement = {
      label: '붙여넣기',
      text: t.text,
      source: 'paste',
      truncated: t.truncated,
      ok: true,
    }
    return json({ ok: true, supplement })
  }

  if (kind === 'url') {
    const url = typeof body.url === 'string' ? body.url.trim() : ''
    if (!url) return fail('URL이 비어 있습니다.')
    let urlObj: URL
    try {
      urlObj = new URL(url)
    } catch {
      return fail('올바른 URL 형식이 아닙니다.')
    }
    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      return fail('http/https URL만 지원합니다.')
    }

    const result = await extract({ type: 'url', value: url })
    if (!result.ok || !result.text.trim()) {
      return fail(result.error ?? 'URL 본문 추출에 실패했습니다.')
    }
    const t = truncate(result.text.trim())
    const supplement: FestivalSupplement = {
      label: `URL: ${urlObj.hostname}`,
      text: t.text,
      source: 'url',
      truncated: t.truncated,
      ok: true,
    }
    return json({ ok: true, supplement })
  }

  return fail(`지원하지 않는 kind: ${kind || '(없음)'}`)
}

/**
 * Multipart POST path for file uploads (pdf/docx/xlsx/hwpx). Saves to a temp
 * dir, runs extract(), then deletes the temp file regardless of success/failure.
 */
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

  const dir = path.join(tmpdir(), 'festival-extract')
  const tmpPath = path.join(dir, `${randomUUID()}${ext}`)
  let supplement: FestivalSupplement | null = null
  let extractError: string | null = null

  try {
    await mkdir(dir, { recursive: true })
    const bytes = new Uint8Array(await file.arrayBuffer())
    await writeFile(tmpPath, bytes)

    const result = await extract({ type: sourceType, value: tmpPath })
    if (!result.ok || !result.text.trim()) {
      extractError = result.error ?? '파일 본문 추출에 실패했습니다.'
      supplement = {
        label: `file: ${path.basename(file.name || 'upload')}`,
        text: `(추출 실패) ${extractError}`,
        source: 'file',
        truncated: false,
        ok: false,
        error: extractError,
      }
    } else {
      const t = truncate(result.text.trim())
      supplement = {
        label: `file: ${path.basename(file.name || 'upload')}`,
        text: t.text,
        source: 'file',
        truncated: t.truncated,
        ok: true,
      }
    }
  } catch (e: unknown) {
    extractError = e instanceof Error ? e.message : 'unknown error'
    supplement = {
      label: `file: ${path.basename(file.name || 'upload')}`,
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
    if (ct.includes('multipart/form-data')) {
      const form = await req.formData()
      return handleFile(form)
    }
    let body: Record<string, unknown> = {}
    try {
      body = await req.json()
    } catch {
      return fail('요청 본문을 해석하지 못했습니다.')
    }
    return handleJson(body)
  } catch (e: unknown) {
    return fail(e instanceof Error ? e.message : 'unknown error', 500)
  }
}
