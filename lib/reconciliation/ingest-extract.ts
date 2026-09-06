import 'server-only'

import { runSingleAiProvider, type CompareChatMessage } from '@/lib/ai/router'
import { supabaseAdmin } from '@/lib/supabase/server'
import { extractJsonValue } from '@/lib/reconciliation/ai-ask'
import {
  INGEST_SHEET_MAX_ROWS,
  INGEST_VISION_MAX_COMPLETION_TOKENS,
} from '@/lib/reconciliation/config'
import type { SheetGrid } from '@/lib/reconciliation/spreadsheet-read'
import { todayKst } from '@/lib/reconciliation/reconcile'

/**
 * 넣기 (unified ingest) — turn a PHOTO or a SPREADSHEET into plain text
 * lines that classifyText() (the two-model classifier) can read, so the ONE
 * ingest box takes anything without the owner pre-declaring sale/deposit,
 * method, or issuer.
 *
 * - Image: one vision transcription call (same runSingleAiProvider plumbing
 *   as parser.ts's parseDepositImage — sessionId=null, no session-table
 *   writes). It TRANSCRIBES transaction lines verbatim; it does NOT decide
 *   sale vs deposit — that judgement stays with the classify cross-check.
 *   Unreadable photos fail loudly; nothing is invented.
 *
 * - Spreadsheet: pure serialization (no AI) — rows joined as `a | b | c`
 *   lines, capped at INGEST_SHEET_MAX_ROWS with an explicit truncation note
 *   so the classifier knows rows were cut.
 */

export type TranscribedImage =
  | { ok: true; text: string }
  | { ok: false; unreadable: true }

function visionTranscribePrompt(today: string): string {
  return [
    'You transcribe a Korean store photo (receipt, POS screen, internet-banking or deposit-alert screenshot, passbook page, or a handwritten sales note) into plain text lines for a downstream classifier.',
    'One transaction per line, exactly as printed: date (as shown), the counterparty/description/memo VERBATIM (keep card-issuer names like 신한/NH/하나/삼성 exactly), and the amount in won.',
    `Today (Asia/Seoul) is ${today} — do NOT use it to complete dates that lack a year; transcribe the date exactly as printed.`,
    'Include sales, refunds (mark 환불/취소 as printed), and inbound deposits (입금). Skip 잔액/balance lines, running totals, account numbers, and decoration.',
    'Do NOT invent, sum, or reorder rows. Do NOT decide whether a line is a sale or a deposit — just transcribe.',
    'If the photo is too blurry/dark/cropped to read ANY transaction line, set unreadable true.',
    'Respond with ONLY compact JSON, no prose, no code fences:',
    '{"lines":["<one transaction per line>"],"unreadable":<boolean>}',
  ].join(' ')
}

/** Vision-transcribe a ledger photo into classifiable text lines. */
export async function transcribeLedgerImage(params: {
  userId: string
  imageBase64: string
  mediaType: string
}): Promise<TranscribedImage> {
  const dataUrl = `data:${params.mediaType};base64,${params.imageBase64}`
  const userPrompt =
    'Transcribe every transaction line in this photo (date, description/memo verbatim, amount). Do not guess unreadable values.'
  const visionMessage = {
    role: 'user' as const,
    content: [
      { type: 'text', text: userPrompt },
      { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
    ],
  } as unknown as CompareChatMessage

  let modelText: string | null = null
  try {
    const result = await runSingleAiProvider({
      supabase: supabaseAdmin,
      sessionId: null,
      userId: params.userId,
      provider: 'openai',
      systemPrompt: visionTranscribePrompt(todayKst()),
      prompt: userPrompt,
      chatMessages: [visionMessage],
      temperature: 0,
      maxCompletionTokens: INGEST_VISION_MAX_COMPLETION_TOKENS,
      skipLanguageInjection: true,
    })
    modelText = result.text
  } catch {
    modelText = null
  }

  const parsed = modelText ? extractJsonValue(modelText) : null
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, unreadable: true }
  }
  const obj = parsed as Record<string, unknown>
  const lines = Array.isArray(obj.lines)
    ? obj.lines.filter((l): l is string => typeof l === 'string' && l.trim().length > 0)
    : []
  if (obj.unreadable === true || lines.length === 0) {
    return { ok: false, unreadable: true }
  }
  return { ok: true, text: lines.map((l) => l.trim()).join('\n') }
}

/** Serialize a spreadsheet grid into classifiable text lines (no AI, capped). */
export function sheetGridToText(grid: SheetGrid): string {
  const lines: string[] = []
  for (const row of grid.rows) {
    const cells = row.map((c) => c.text.trim())
    if (cells.every((c) => c === '')) continue
    lines.push(cells.join(' | '))
    if (lines.length >= INGEST_SHEET_MAX_ROWS) break
  }
  const truncated = grid.rows.length > INGEST_SHEET_MAX_ROWS
  const header = `[스프레드시트: ${grid.sheetName}${grid.extraSheetCount > 0 ? ` 외 ${grid.extraSheetCount}개 시트는 무시됨` : ''}]`
  const footer = truncated ? `[주의: ${INGEST_SHEET_MAX_ROWS}행까지만 읽음 — 이후 행 생략]` : null
  return [header, ...lines, ...(footer ? [footer] : [])].join('\n')
}
