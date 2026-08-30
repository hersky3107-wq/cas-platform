import 'server-only'

import {
  runSingleAiProvider,
  type CompareChatMessage,
  type ExtendedAiProviderName,
} from '@/lib/ai/router'
import { supabaseAdmin } from '@/lib/supabase/server'

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
 * STAGE 2d: parseDepositImage() is a sibling for screenshots/passbook photos.
 * It uses the same runSingleAiProvider path (openai / gpt-4o, which accepts
 * vision `image_url` parts) with sessionId=null. There is no regex fallback —
 * an unreadable image is a failure, not a guess. Vision confidence is capped
 * below the HITL 0.7 threshold so the existing confirm/edit UI always flags it.
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
  const schemaKeys = [
    '"date":"YYYY-MM-DD"|null',
    '"amount":<number>|null',
    ...extraFields.map((f) => `"${f.key}":<string>|null`),
    '"confidence":<0..1>',
  ]
  return [
    'You extract structured data from a short financial notification.',
    spec.aiHint,
    `Today (Asia/Seoul) is ${today}; use it to resolve a MM/DD date to a full year.`,
    ...extraFields.map((f) => f.aiDescription),
    'Respond with ONLY a compact JSON object, no prose, no code fences:',
    `{${schemaKeys.join(',')}}`,
    'amount is a plain number in KRW with no separators. If a value is not clearly present, use null and lower the confidence.',
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

function extractJson(text: string): Record<string, unknown> | null {
  const fenced = text.replace(/```(?:json)?/gi, '').trim()
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed: unknown = JSON.parse(fenced.slice(start, end + 1))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    /* fall through */
  }
  return null
}

export async function parseDeposit(params: {
  userId: string
  rawText: string
  spec: ParseSpec
  supabaseAccessToken?: string | null
  provider?: ExtendedAiProviderName
}): Promise<ParsedDeposit> {
  const { userId, rawText, spec } = params
  const text = rawText.trim()
  const today = todayKst()
  const regex = spec.regexFallback(text, today)

  if (!text) {
    return { date: null, amount: null, confidence: 0, method: 'none', raw_model_text: null, extra: null }
  }

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
      maxCompletionTokens: 120,
      skipLanguageInjection: true,
    })
    modelText = result.text
  } catch {
    modelText = null
  }

  const parsed = modelText ? extractJson(modelText) : null
  if (parsed) {
    const aiDate = normalizeDate(parsed.date)
    const aiAmount = normalizeAmount(parsed.amount)
    let confidence = clampConfidence(parsed.confidence)
    let method: ParsedDeposit['method'] = 'ai'

    // Cross-check with the deterministic fallback: agreement raises trust,
    // disagreement on the amount caps it (the number is what gets reconciled).
    if (aiAmount != null && regex.amount != null) {
      if (Math.abs(aiAmount - regex.amount) < 0.005) {
        confidence = Math.min(1, Math.max(confidence, 0.9))
        method = 'ai+regex'
      } else {
        confidence = Math.min(confidence, 0.5)
      }
    }
    if (aiAmount == null && regex.amount != null) {
      return {
        date: aiDate ?? regex.date,
        amount: regex.amount,
        confidence: Math.min(confidence || 0.4, 0.5),
        method: 'ai+regex',
        raw_model_text: modelText,
        extra: computeExtra(spec, text, parsed),
      }
    }

    return {
      date: aiDate ?? regex.date,
      amount: aiAmount,
      confidence: aiAmount == null ? Math.min(confidence, 0.3) : confidence,
      method,
      raw_model_text: modelText,
      extra: computeExtra(spec, text, parsed),
    }
  }

  // No usable model output — deterministic fallback only.
  const hasAny = regex.amount != null || regex.date != null
  return {
    date: regex.date,
    amount: regex.amount,
    confidence: regex.amount != null ? 0.45 : hasAny ? 0.2 : 0,
    method: hasAny ? 'regex' : 'none',
    raw_model_text: modelText,
    extra: computeExtra(spec, text, null),
  }
}

function visionSystemPrompt(today: string): string {
  return [
    'You extract the DEPOSIT date and amount from a photo of a Korean bank deposit-alert screenshot or a passbook page.',
    'This is ADVISORY extraction for a human to confirm. Do NOT guess.',
    `Today (Asia/Seoul) is ${today}; use it to resolve a MM/DD date to a full year.`,
    'Extract the money that came IN (입금/이체). Ignore 잔액/balance, account numbers, and names.',
    'If the image is blurry, cropped, dark, or the date/amount cannot be read with certainty, set unreadable true and both date and amount to null.',
    'Respond with ONLY a compact JSON object, no prose, no code fences:',
    '{"date":"YYYY-MM-DD"|null,"amount":<number>|null,"confidence":<0..1>,"unreadable":<boolean>}',
    'amount is a plain number in KRW with no separators. confidence must be conservative (vision OCR is unreliable).',
  ].join(' ')
}

/**
 * Vision parse of a deposit screenshot. Same ParsedDeposit shape as parseDeposit.
 * No regex fallback — unreadable images fail rather than invent numbers.
 * Confidence is capped at VISION_CONFIDENCE_CAP so the existing 0.7 HITL
 * review always flags the row.
 *
 * Uses runSingleAiProvider (openai / gpt-4o) with a multimodal user message.
 * sessionId is null so nothing is written to generic session tables.
 */
export async function parseDepositImage(params: {
  userId: string
  imageBase64: string
  mediaType: string
  supabaseAccessToken?: string | null
  provider?: ExtendedAiProviderName
}): Promise<ParsedDeposit & { unreadable: boolean }> {
  const today = todayKst()
  const dataUrl = `data:${params.mediaType};base64,${params.imageBase64}`
  const userPrompt =
    'Extract date and deposit amount from this image. If unreadable, say so — do not guess.'

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
      maxCompletionTokens: 160,
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
    }
  }

  const date = normalizeDate(parsed.date)
  const amount = normalizeAmount(parsed.amount)
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
  }
}
