import 'server-only'

/**
 * SHARED low-level helpers for gunpo resident(시민) chips — cloned from the
 * generic (non-fishery-specific) pieces of lib/jeju/fishery.ts so this tree
 * never imports from lib/jeju. Kept intentionally tiny and dependency-free.
 */

export interface ContextMeta {
  /** Literal label for UI, e.g. "🔍 검색 · {asOf} 기준 · {retrievedAt} 조회" */
  source: '검색'
  /** ISO datetime (KST, +09:00) of when the Perplexity call completed. */
  retrievedAt: string
  /** Date/period the information refers to, extracted from the model text. */
  asOf: string | null
}

function kstNow(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000)
}

/** YYYY-MM-DD in Asia/Seoul. */
export function kstTodayIso(): string {
  const d = kstNow()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** Full ISO timestamp with +09:00 offset — used as ContextMeta.retrievedAt. */
export function kstNowIso(): string {
  const d = kstNow()
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+09:00`
  )
}

/** Strips Perplexity citation markers + CJK punctuation Perplexity sometimes emits. */
export function cleanPerplexityText(text: string): string {
  return text
    .replace(/\[\d+\]/g, '')
    .replace(/。/g, '.')
    .replace(/「|」/g, '"')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Extract a date/period string (YYYY-MM-DD / YYYY-MM / YYYY) from model output. */
export function extractAsOf(text: string): string | null {
  const full = text.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/)
  if (full) return `${full[1]}-${full[2].padStart(2, '0')}-${full[3].padStart(2, '0')}`
  const ymKo = text.match(/(\d{4})년\s*(\d{1,2})월/)
  if (ymKo) return `${ymKo[1]}-${ymKo[2].padStart(2, '0')}`
  const yKo = text.match(/(\d{4})년/)
  if (yKo) return yKo[1]
  return null
}

/** Shared data.go.kr portal key (same env the gunpo governance connectors read). */
export function dataGoKrKey(): string {
  return process.env.DATA_GO_KR_KEY ?? process.env.KPX_SERVICE_KEY ?? ''
}

export function extractJsonObject(raw: string): string {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i)
  if (fence?.[1]) text = fence[1].trim()
  if (text.startsWith('{')) return text
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return start !== -1 && end > start ? text.slice(start, end + 1) : text
}

export function strOrNull(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim()
  return s ? s : null
}

/**
 * Perplexity search helper — cloned from lib/jeju/resident-search.ts (generic,
 * no Jeju-specific logic: raw OpenAI-compatible call against api.perplexity.ai).
 * Never throws — degrades to empty text + citations on any failure.
 */
const PPLX_URL = 'https://api.perplexity.ai/chat/completions'
const PPLX_MODEL = 'sonar'

export interface PerplexityAnswer {
  text: string
  citations: string[]
}

interface AskOptions {
  systemPrompt?: string
  maxTokens?: number
  timeoutMs?: number
}

export async function askPerplexity(prompt: string, opts: AskOptions = {}): Promise<PerplexityAnswer> {
  const apiKey = process.env.PERPLEXITY_API_KEY
  if (!apiKey || !prompt.trim()) {
    return { text: '', citations: [] }
  }

  const messages: Array<{ role: string; content: string }> = []
  if (opts.systemPrompt) messages.push({ role: 'system', content: opts.systemPrompt })
  messages.push({ role: 'user', content: prompt })

  try {
    const res = await fetch(PPLX_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: PPLX_MODEL,
        messages,
        max_tokens: opts.maxTokens ?? 700,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    })

    if (!res.ok) {
      console.error(`[gunpo-resident-search] perplexity http ${res.status}`)
      return { text: '', citations: [] }
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      citations?: unknown
      error?: { message?: string }
    }
    if (json.error) {
      console.error('[gunpo-resident-search] perplexity error:', json.error.message)
      return { text: '', citations: [] }
    }

    const text = json.choices?.[0]?.message?.content ?? ''
    const citations = Array.isArray(json.citations)
      ? json.citations.filter((c): c is string => typeof c === 'string')
      : []

    return { text, citations }
  } catch (e) {
    console.error('[gunpo-resident-search] perplexity call failed:', e instanceof Error ? e.message : e)
    return { text: '', citations: [] }
  }
}
