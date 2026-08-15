import 'server-only'

import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'
import { supabaseAdmin } from '@/lib/supabase/server'

/**
 * 대사기 — deposit-text parser.
 *
 * GENERIC IN SHAPE: one `parseDeposit()` function takes a ParseSpec so each
 * channel injects its own AI hint + regex fallback. STAGE 1 wires only the
 * bank-transfer spec (TRANSFER_PARSE_SPEC). No image / handwriting path.
 *
 * The AI call runs with sessionId=null so it does NOT write to the generic
 * session tables (ai_responses / model_cost_logs). userId is passed only so a
 * user's BYOK key can be used if present. Output is strict JSON; a deterministic
 * regex fallback covers the "no key / model failed / non-JSON" cases at lower
 * confidence.
 */

export type ParsedDeposit = {
  date: string | null
  amount: number | null
  confidence: number
  method: 'ai' | 'regex' | 'ai+regex' | 'none'
  raw_model_text: string | null
}

export type ParseSpec = {
  channelType: string
  /** Channel-specific guidance appended to the parser system prompt. */
  aiHint: string
  /** Deterministic fallback for this channel's typical message shape. */
  regexFallback: (text: string, todayKst: string) => { date: string | null; amount: number | null }
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

function buildSystemPrompt(spec: ParseSpec, today: string): string {
  return [
    'You extract structured data from a short financial notification.',
    spec.aiHint,
    `Today (Asia/Seoul) is ${today}; use it to resolve a MM/DD date to a full year.`,
    'Respond with ONLY a compact JSON object, no prose, no code fences:',
    '{"date":"YYYY-MM-DD"|null,"amount":<number>|null,"confidence":<0..1>}',
    'amount is a plain number in KRW with no separators. If a value is not clearly present, use null and lower the confidence.',
  ].join(' ')
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
    return { date: null, amount: null, confidence: 0, method: 'none', raw_model_text: null }
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
      }
    }

    return {
      date: aiDate ?? regex.date,
      amount: aiAmount,
      confidence: aiAmount == null ? Math.min(confidence, 0.3) : confidence,
      method,
      raw_model_text: modelText,
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
  }
}
