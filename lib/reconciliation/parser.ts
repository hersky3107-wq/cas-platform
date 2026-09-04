import 'server-only'

import {
  runSingleAiProvider,
  type CompareChatMessage,
  type ExtendedAiProviderName,
} from '@/lib/ai/router'
import { supabaseAdmin } from '@/lib/supabase/server'
import type { DepositCandidateCore } from '@/lib/reconciliation/deposit-duplicates'
import {
  applyYearInference,
  extractDepositTextRows,
  formatLineDate,
  lowerConfidenceIfYearAmbiguous,
  parseLineDate,
  type LineDate,
} from '@/lib/reconciliation/deposit-text-rows'
import { SALE_KINDS, type SaleKind } from '@/lib/reconciliation/types'

/**
 * 대사기 — deposit-text parser.
 *
 * GENERIC IN SHAPE: one `parseDeposit()` function takes a ParseSpec so each
 * channel injects its own AI hint + regex fallback. STAGE 1 wired only the
 * bank-transfer spec (TRANSFER_PARSE_SPEC). STAGE 2 adds VOUCHER_PARSE_SPEC
 * (탐나는전 앱, 온누리 앱) as a second injected spec, SAME SHAPE — no image /
 * handwriting path for either.
 *
 * The AI call runs with sessionId=null so it does NOT write to the generic
 * session tables (ai_responses / model_cost_logs). userId is passed only so a
 * user's BYOK key can be used if present. Output is strict JSON; a deterministic
 * regex fallback covers the "no key / model failed / non-JSON" cases at lower
 * confidence.
 *
 * Both parseDeposit and parseDepositImage return an ARRAY of rows (multi-date
 * internet-banking captures). Empty/unreadable → zero rows, never invented.
 * Per-row dates stay on the printed line; year is inferred from sibling rows
 * in the same capture, never from "today". Vision confidence is capped at
 * VISION_CONFIDENCE_CAP (0.65). Callers must not insert until HITL confirms.
 *
 * STAGE 2d: parseDepositImage() is a sibling for screenshots/passbook photos.
 * It uses the same runSingleAiProvider path (openai / gpt-4o, which accepts
 * vision `image_url` parts) with sessionId=null. There is no regex fallback —
 * an unreadable image is a failure, not a guess.
 *
 * parseSalesImage() is the sales counterpart: same vision path, plus a
 * sale_kind_guess. Kind is advisory only — HITL must confirm it. If the model
 * cannot tell, the guess is null (caller persists manual_total, never card).
 *
 * EXTRA FIELDS: a spec may declare `extraFields` for channel-specific values
 * beyond date/amount (e.g. VOUCHER_PARSE_SPEC's `voucher_type`). This is
 * purely ADDITIVE — TRANSFER_PARSE_SPEC declares none, so its prompt, its
 * parse path, and `ParsedDeposit.extra` (always null) are byte-identical to
 * before this stage.
 */

/** Vision OCR is less reliable than text parse — always below the 0.7 HITL flag. */
export const VISION_CONFIDENCE_CAP = 0.65
export const HITL_CONFIDENCE_THRESHOLD = 0.7

export type ParsedDeposit = {
  date: string | null
  amount: number | null
  confidence: number
  method: 'ai' | 'regex' | 'ai+regex' | 'none'
  raw_model_text: string | null
  /**
   * Channel-specific values beyond date/amount (e.g. `{voucher_type: '탐나는전'}`).
   * null when the spec declares no `extraFields` — always null for
   * TRANSFER_PARSE_SPEC.
   */
  extra: Record<string, string | null> | null
  memo?: string | null
}

export type ParsedDepositRow = DepositCandidateCore

export type ParsedDepositBatch = {
  rows: ParsedDepositRow[]
  raw_model_text: string | null
  unreadable: boolean
}

/** One additional string field a ParseSpec wants extracted alongside date/amount. */
export type ExtraFieldSpec = {
  key: string
  /** One-line instruction appended to the AI prompt for this key. */
  aiDescription: string
  /** Deterministic fallback: scans the ORIGINAL deposit text for this value. */
  regexFallback: (text: string) => string | null
  /**
   * Optional sanitizer applied to whatever the AI returned for this key.
   * Falls back to `regexFallback(text)` when this returns null (covers a
   * missing key AND a hallucinated value that doesn't normalize).
   */
  normalize?: (raw: string | null) => string | null
}

export type ParseSpec = {
  channelType: string
  /** Channel-specific guidance appended to the parser system prompt. */
  aiHint: string
  /** Deterministic fallback for this channel's typical message shape. */
  regexFallback: (text: string, todayKst: string) => { date: string | null; amount: number | null }
  /** Extra values to extract beyond date/amount. Omit for a plain date+amount spec. */
  extraFields?: ExtraFieldSpec[]
}

const AMOUNT_RE = /(?:입금|이체|deposit|received)?[^\d]{0,8}([\d]{1,3}(?:,\d{3})+|\d{3,})\s*(?:원|krw)?/i
const YMD_RE = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/
const MD_RE = /(?<!\d)(\d{1,2})[.\-/](\d{1,2})(?!\d)/

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function todayKst(): string {
  const now = new Date()
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10)
}

function clampConfidence(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return Math.round(n * 100) / 100
}

function normalizeAmount(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw * 100) / 100
  if (typeof raw !== 'string') return null
  const cleaned = raw.replace(/[^\d.]/g, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

function normalizeDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const m = raw.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  return `${m[1]}-${m[2]}-${m[3]}`
}

/** Bank transfer deposit-alert SMS: amounts like "50,000원", dates as YYYY.MM.DD or MM/DD. */
export const TRANSFER_PARSE_SPEC: ParseSpec = {
  channelType: 'transfer',
  aiHint:
    'This is a Korean bank account deposit-alert message (계좌 입금 알림). ' +
    'Extract the DEPOSIT amount in KRW (the money that came IN — ignore any 잔액/balance figure) ' +
    'and the transaction date. Dates may be written as YYYY.MM.DD, YYYY-MM-DD, or MM/DD.',
  regexFallback: (text, today) => {
    let amount: number | null = null
    const am = text.match(AMOUNT_RE)
    if (am) amount = normalizeAmount(am[1])

    let date: string | null = null
    const ymd = text.match(YMD_RE)
    if (ymd) {
      date = `${ymd[1]}-${pad(Number(ymd[2]))}-${pad(Number(ymd[3]))}`
    } else {
      const md = text.match(MD_RE)
      if (md) {
        const year = today.slice(0, 4)
        date = `${year}-${pad(Number(md[1]))}-${pad(Number(md[2]))}`
      }
    }
    return { date, amount }
  },
}

/** App/barcode local vouchers wired in Stage 2. Only these two — see VOUCHER_PARSE_SPEC's doc comment. */
export const VOUCHER_TYPES = ['탐나는전', '온누리'] as const
export type VoucherType = (typeof VOUCHER_TYPES)[number]

/** Scans `text` for one of the two known voucher names. Deterministic, order-stable (탐나는전 checked first). */
export function matchVoucherType(text: string | null | undefined): VoucherType | null {
  if (!text) return null
  for (const type of VOUCHER_TYPES) {
    if (text.includes(type)) return type
  }
  return null
}

/**
 * App/barcode local-voucher deposit alert (탐나는전 앱, 온누리 앱): same bank
 * deposit-alert SHAPE as a transfer — only the payer/source name differs (the
 * voucher brand itself, not a person). Date/amount extraction is therefore
 * REUSED from TRANSFER_PARSE_SPEC verbatim; the only new work is the
 * `voucher_type` extra field. Only 탐나는전 / 온누리 are recognized for now —
 * anything else resolves to voucher_type: null (deposit still recorded, just
 * unhinted, same as an unidentifiable transfer).
 */
export const VOUCHER_PARSE_SPEC: ParseSpec = {
  channelType: 'app_voucher',
  aiHint:
    'This is a Korean bank account deposit-alert message (계좌 입금 알림) for an APP/BARCODE-TYPE LOCAL VOUCHER settlement — ' +
    'the payer/source name in the alert IS the voucher brand itself (e.g. "탐나는전", "온누리"), not a person or company. ' +
    'Extract the DEPOSIT amount in KRW (the money that came IN — ignore any 잔액/balance figure) ' +
    'and the transaction date. Dates may be written as YYYY.MM.DD, YYYY-MM-DD, or MM/DD.',
  regexFallback: (text, todayKst) => TRANSFER_PARSE_SPEC.regexFallback(text, todayKst),
  extraFields: [
    {
      key: 'voucher_type',
      aiDescription:
        'voucher_type must be exactly "탐나는전" or "온누리" (the two supported vouchers) if the payer name matches one of them, else null.',
      regexFallback: (text) => matchVoucherType(text),
      normalize: (raw) => matchVoucherType(raw),
    },
  ],
}

function buildSystemPrompt(spec: ParseSpec, today: string): string {
  const extraFields = spec.extraFields ?? []
  const extraKeys = extraFields.map((f) => `"${f.key}":<string>|null`)
  const rowShape = [
    '"date":"YYYY-MM-DD"|null',
    '"date_md":"MM-DD"|null',
    '"amount":<number>',
    '"memo":<string>|null',
    ...extraKeys,
    '"confidence":<0..1>',
  ].join(',')
  return [
    'You extract structured data from Korean bank deposit alerts or internet-banking text.',
    spec.aiHint,
    'The paste often contains MANY deposit rows on DIFFERENT dates. Extract EVERY inbound 입금/이체 row. Do NOT sum them. Do NOT keep only the first.',
    'Ignore 잔액/balance figures, account numbers, and running totals.',
    `Today (Asia/Seoul) is ${today}. Do NOT use that year to complete a MM/DD line.`,
    'If a line has no year, set date to null and set date_md to "MM-DD". Year is inferred later from other rows in this same capture. If no year appears anywhere, leave date null — do not guess.',
    ...extraFields.map((f) => f.aiDescription),
    'Respond with ONLY a compact JSON object, no prose, no code fences:',
    `{"rows":[{${rowShape}}],"unreadable":<boolean>}`,
    'memo is the counterparty or 적요 (payer name, 온누리, 탐나는전, etc). amount is KRW with no separators.',
    'If nothing readable, rows must be [] and unreadable true. Never invent a row.',
  ].join(' ')
}

/** Runs every `extraFields` entry: AI value (normalized) first, else the deterministic fallback. */
function computeExtra(
  spec: ParseSpec,
  text: string,
  aiParsed: Record<string, unknown> | null
): Record<string, string | null> | null {
  if (!spec.extraFields || spec.extraFields.length === 0) return null
  const out: Record<string, string | null> = {}
  for (const field of spec.extraFields) {
    const rawAi =
      aiParsed && typeof aiParsed[field.key] === 'string' ? (aiParsed[field.key] as string).trim() : null
    const normalized = field.normalize ? field.normalize(rawAi) : rawAi
    out[field.key] = normalized ?? field.regexFallback(text)
  }
  return out
}

function extractJsonValue(text: string): unknown {
  const fenced = text.replace(/```(?:json)?/gi, '').trim()
  const tryParse = (slice: string): unknown => {
    try {
      return JSON.parse(slice)
    } catch {
      return null
    }
  }
  const startArr = fenced.indexOf('[')
  const startObj = fenced.indexOf('{')
  if (startArr >= 0 && (startObj < 0 || startArr < startObj)) {
    const end = fenced.lastIndexOf(']')
    if (end > startArr) {
      const parsed = tryParse(fenced.slice(startArr, end + 1))
      if (parsed != null) return parsed
    }
  }
  if (startObj >= 0) {
    const end = fenced.lastIndexOf('}')
    if (end > startObj) {
      const parsed = tryParse(fenced.slice(startObj, end + 1))
      if (parsed != null) return parsed
    }
  }
  return null
}

function extractJson(text: string): Record<string, unknown> | null {
  const parsed = extractJsonValue(text)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>
  }
  return null
}

function asMemo(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 500)
}

function coerceDepositRowObjects(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row))
  }
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    if (Array.isArray(o.rows)) return coerceDepositRowObjects(o.rows)
    if ('amount' in o || 'date' in o) return [o]
  }
  return []
}

type RowDraft = DepositCandidateCore & { lineDate: LineDate | null }

function draftFromObject(
  o: Record<string, unknown>,
  spec: ParseSpec | null,
  scanText: string,
  method: DepositCandidateCore['method']
): RowDraft | null {
  const amount = normalizeAmount(o.amount)
  if (amount == null || amount <= 0) return null
  const date = normalizeDate(o.date)
  const mdSource =
    typeof o.date_md === 'string' && o.date_md.trim()
      ? o.date_md
      : typeof o.date === 'string' && !date
        ? o.date
        : ''
  const lineDate = date ? null : parseLineDate(mdSource)
  const memo = asMemo(o.memo ?? o.counterparty ?? o.payer)
  const extraScan = [memo, scanText].filter(Boolean).join('\n')
  return {
    date: date ?? (lineDate ? formatLineDate(lineDate) : null),
    amount,
    memo,
    confidence: clampConfidence(o.confidence == null || o.confidence === '' ? 0.5 : o.confidence),
    year_ambiguous: (date ?? (lineDate ? formatLineDate(lineDate) : null)) == null,
    method,
    extra: spec ? computeExtra(spec, extraScan, o) : null,
    lineDate: date ? { y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)), d: Number(date.slice(8, 10)) } : lineDate,
  }
}

function finalizeRows(drafts: RowDraft[], cap?: number): ParsedDepositRow[] {
  const inferred = applyYearInference(drafts)
  return inferred.map((row) => {
    const confidence = lowerConfidenceIfYearAmbiguous(
      cap != null ? Math.min(row.confidence, cap) : row.confidence,
      row.year_ambiguous
    )
    return {
      date: row.date,
      amount: row.amount,
      memo: row.memo,
      confidence,
      year_ambiguous: row.year_ambiguous,
      method: row.method,
      extra: row.extra,
      channel_hint: row.channel_hint,
    }
  })
}

function regexDrafts(text: string, spec: ParseSpec): RowDraft[] {
  return extractDepositTextRows(text).map((row) => ({
    date: row.date,
    amount: row.amount,
    memo: row.memo,
    confidence: row.year_ambiguous ? 0.4 : 0.45,
    year_ambiguous: row.year_ambiguous,
    method: 'regex' as const,
    extra: computeExtra(spec, [row.memo, text].filter(Boolean).join('\n'), null),
    lineDate: row.lineDate,
  }))
}

function crossCheckMethod(
  rows: ParsedDepositRow[],
  regexRows: ParsedDepositRow[]
): ParsedDepositRow[] {
  if (rows.length === 0 || regexRows.length === 0) return rows
  const regexAmounts = regexRows.map((r) => r.amount)
  return rows.map((row) => {
    if (row.amount == null) return row
    const hit = regexAmounts.some((a) => a != null && Math.abs(a - row.amount!) < 0.005)
    if (!hit) {
      return { ...row, confidence: Math.min(row.confidence, 0.5) }
    }
    if (rows.length === 1 && regexRows.length === 1) {
      return { ...row, method: 'ai+regex', confidence: Math.min(1, Math.max(row.confidence, 0.9)) }
    }
    return { ...row, method: row.method === 'ai' ? 'ai+regex' : row.method }
  })
}

export async function parseDeposit(params: {
  userId: string
  rawText: string
  spec: ParseSpec
  supabaseAccessToken?: string | null
  provider?: ExtendedAiProviderName
}): Promise<ParsedDepositBatch> {
  const { userId, rawText, spec } = params
  const text = rawText.trim()
  const today = todayKst()

  if (!text) {
    return { rows: [], raw_model_text: null, unreadable: true }
  }

  const regexRows = finalizeRows(regexDrafts(text, spec))

  let modelText: string | null = null
  try {
    const result = await runSingleAiProvider({
      supabase: supabaseAdmin,
      sessionId: null,
      userId,
      provider: params.provider ?? 'openai',
      systemPrompt: buildSystemPrompt(spec, today),
      prompt: text,
      supabaseAccessToken: params.supabaseAccessToken ?? undefined,
      temperature: 0,
      maxCompletionTokens: 2000,
      skipLanguageInjection: true,
    })
    modelText = result.text
  } catch {
    modelText = null
  }

  const parsed = modelText ? extractJsonValue(modelText) : null
  const unreadableFlag =
    parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).unreadable === true
      : false
  const aiDrafts = coerceDepositRowObjects(parsed)
    .map((o) => draftFromObject(o, spec, text, 'ai'))
    .filter((row): row is RowDraft => row != null)
  const aiRows = finalizeRows(aiDrafts)

  if (aiRows.length > 0) {
    return {
      rows: crossCheckMethod(aiRows, regexRows),
      raw_model_text: modelText,
      unreadable: false,
    }
  }

  if (regexRows.length > 0) {
    return { rows: regexRows, raw_model_text: modelText, unreadable: false }
  }

  return { rows: [], raw_model_text: modelText, unreadable: unreadableFlag || true }
}

function visionSystemPrompt(today: string): string {
  return [
    'You extract EVERY inbound DEPOSIT row from a photo of a Korean internet-banking screenshot, deposit-alert, or passbook page.',
    'This is ADVISORY extraction for a human to confirm. Do NOT guess. Do NOT sum rows. Do NOT keep only the first line.',
    `Today (Asia/Seoul) is ${today}. Do NOT use that year to complete a MM/DD line.`,
    'Each row keeps the date printed on that line. If a line has no year, set date null and date_md to "MM-DD".',
    'If no year appears anywhere in the image, leave those dates null — do not invent a year.',
    'Extract money that came IN (입금/이체). Ignore 잔액/balance, account numbers, and running totals.',
    'memo is the counterparty or 적요 on that line (name, 온누리, 탐나는전, etc).',
    'If the image is blurry, cropped, dark, or no deposit row can be read, set unreadable true and rows to [].',
    'Respond with ONLY a compact JSON object, no prose, no code fences:',
    '{"rows":[{"date":"YYYY-MM-DD"|null,"date_md":"MM-DD"|null,"amount":<number>,"memo":<string>|null,"confidence":<0..1>}],"unreadable":<boolean>}',
    'amount is KRW with no separators. confidence must be conservative (vision OCR is unreliable). Never invent a row.',
  ].join(' ')
}

/**
 * Vision parse of a deposit screenshot into an array of rows.
 * No regex fallback — unreadable images fail rather than invent numbers.
 * Each row's confidence is capped at VISION_CONFIDENCE_CAP.
 */
export async function parseDepositImage(params: {
  userId: string
  imageBase64: string
  mediaType: string
  supabaseAccessToken?: string | null
  provider?: ExtendedAiProviderName
}): Promise<ParsedDepositBatch> {
  const today = todayKst()
  const dataUrl = `data:${params.mediaType};base64,${params.imageBase64}`
  const userPrompt =
    'Extract EVERY deposit row in this image (date, amount, memo). Different dates stay on their own rows. If a line has no year, do not invent one. If unreadable, return zero rows — do not guess.'

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
      provider: params.provider ?? 'openai',
      systemPrompt: visionSystemPrompt(today),
      prompt: userPrompt,
      chatMessages: [visionMessage],
      supabaseAccessToken: params.supabaseAccessToken ?? undefined,
      temperature: 0,
      maxCompletionTokens: 2000,
      skipLanguageInjection: true,
    })
    modelText = result.text
  } catch {
    modelText = null
  }

  const parsed = modelText ? extractJsonValue(modelText) : null
  if (!parsed) {
    return { rows: [], raw_model_text: modelText, unreadable: true }
  }

  const unreadableFlag =
    typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).unreadable === true
      : false
  const drafts = coerceDepositRowObjects(parsed)
    .map((o) => draftFromObject(o, null, '', 'ai'))
    .filter((row): row is RowDraft => row != null)
  const rows = finalizeRows(drafts, VISION_CONFIDENCE_CAP)

  if (rows.length === 0) {
    return { rows: [], raw_model_text: modelText, unreadable: true }
  }

  return { rows, raw_model_text: modelText, unreadable: unreadableFlag && rows.length === 0 }
}

function salesVisionSystemPrompt(today: string): string {
  return [
    'You extract the SALE date, GROSS amount, and payment kind from a photo of a Korean shop receipt or POS screen.',
    'This is ADVISORY extraction for a human to confirm. Do NOT invent numbers.',
    `Today (Asia/Seoul) is ${today}; use it to resolve a MM/DD date to a full year.`,
    'Extract the sale total (매출/합계/결제금액), not 잔액, 거스름돈, or a tax-only line.',
    'sale_kind must be exactly one of: card, cash, app_voucher, manual_total — or null if you cannot tell.',
    'card = card/credit/체크/PG/배달앱/바코드결제 shown as card. cash = 현금. app_voucher = 탐나는전/온누리/지역상품권 barcode or app. manual_total = a handwritten lump total with no tender.',
    'A photo often cannot tell card vs cash. If the tender is not clearly printed, set sale_kind to null. Do NOT default to card.',
    'If the image is blurry, cropped, dark, or date/amount cannot be read with certainty, set unreadable true and date, amount, sale_kind to null.',
    'Respond with ONLY a compact JSON object, no prose, no code fences:',
    '{"date":"YYYY-MM-DD"|null,"amount":<number>|null,"sale_kind":"card"|"cash"|"app_voucher"|"manual_total"|null,"confidence":<0..1>,"unreadable":<boolean>}',
    'amount is a plain number in KRW with no separators. confidence must be conservative (vision OCR is unreliable).',
  ].join(' ')
}

function normalizeSaleKindGuess(raw: unknown): SaleKind | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if ((SALE_KINDS as readonly string[]).includes(t)) return t as SaleKind
  if (/현금|cash/.test(t)) return 'cash'
  if (/상품권|voucher|탐나는전|온누리|지역화폐/.test(t)) return 'app_voucher'
  if (/수기|manual/.test(t)) return 'manual_total'
  if (/카드|card|credit|체크/.test(t)) return 'card'
  return null
}

export type ParsedSaleImage = ParsedDeposit & {
  unreadable: boolean
  sale_kind_guess: SaleKind | null
}

/**
 * Vision parse of a receipt / POS screenshot into a sale.
 * Same provider, sessionId=null, confidence cap, and no-guess-on-unreadable
 * contract as parseDepositImage. sale_kind_guess is null when the tender
 * is not visible — callers must not silently assume 'card'.
 */
export async function parseSalesImage(params: {
  userId: string
  imageBase64: string
  mediaType: string
  supabaseAccessToken?: string | null
  provider?: ExtendedAiProviderName
}): Promise<ParsedSaleImage> {
  const today = todayKst()
  const dataUrl = `data:${params.mediaType};base64,${params.imageBase64}`
  const userPrompt =
    'Extract sale date, gross amount, and sale_kind from this receipt or POS photo. If unreadable, say so — do not guess numbers. If tender is unclear, sale_kind must be null.'

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
      provider: params.provider ?? 'openai',
      systemPrompt: salesVisionSystemPrompt(today),
      prompt: userPrompt,
      chatMessages: [visionMessage],
      supabaseAccessToken: params.supabaseAccessToken ?? undefined,
      temperature: 0,
      maxCompletionTokens: 180,
      skipLanguageInjection: true,
    })
    modelText = result.text
  } catch {
    modelText = null
  }

  const parsed = modelText ? extractJson(modelText) : null
  if (!parsed) {
    return {
      date: null,
      amount: null,
      confidence: 0,
      method: 'none',
      raw_model_text: modelText,
      extra: null,
      unreadable: true,
      sale_kind_guess: null,
    }
  }

  if (parsed.unreadable === true) {
    return {
      date: null,
      amount: null,
      confidence: 0,
      method: 'ai',
      raw_model_text: modelText,
      extra: null,
      unreadable: true,
      sale_kind_guess: null,
    }
  }

  const date = normalizeDate(parsed.date)
  const amount = normalizeAmount(parsed.amount)
  const saleKindGuess = normalizeSaleKindGuess(parsed.sale_kind ?? parsed.sale_kind_guess)
  const rawConf = parsed.confidence == null || parsed.confidence === '' ? 0.4 : parsed.confidence
  const confidence = Math.min(clampConfidence(rawConf), VISION_CONFIDENCE_CAP)
  const unreadable = date == null || amount == null

  return {
    date,
    amount,
    confidence: unreadable ? Math.min(confidence, 0.2) : confidence,
    method: 'ai',
    raw_model_text: modelText,
    extra: null,
    unreadable,
    sale_kind_guess: unreadable ? null : saleKindGuess,
  }
}
