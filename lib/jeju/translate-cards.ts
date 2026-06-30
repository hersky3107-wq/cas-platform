import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'
import { isPredominantlyKorean, languageName, type AiLocale } from '@/lib/jeju/ai-locale'

/**
 * Shared translation GATE for Jeju tourist card results.
 *
 * The tourist engines (tourist-local / tourist-seasonal / tourist-festivals) blend
 * AI (sonar) output with raw Korean public-data text. Per-engine sonar directives
 * try to produce the target language, but anything that slips through (official
 * odcloud descriptions, leaked Korean sentences) needs a single reliable backstop.
 *
 * This is that backstop: ONE function that, for non-Korean locales, collects every
 * translatable string field across all cards into an id-indexed list and translates
 * them in one (or a few, chunked) compose-model call(s). Matching is by EXPLICIT id,
 * and any item without a returned translation falls back to its original text — so a
 * partial model failure degrades per-item and NEVER crashes.
 *
 * locale === 'ko' → returns the items untouched immediately (no call, zero cost).
 *
 * ISOLATION: 'server-only', sessionId/userId null, noDbSupabase() never used for I/O.
 */

/** Compose tier (sonnet) — translation quality matters; default model, no override. */
const TRANSLATE_PROVIDER: ExtendedAiProviderName = 'anthropic'

/** Items per model call. Keeps each prompt small enough for reliable id matching. */
const CHUNK_SIZE = 15
/** Hard cap on calls so a huge list can never fan out unbounded. */
const MAX_CHUNKS = 3
/** Per-unit token allowance (CJK is token-dense); floored so tiny batches still fit. */
const TOKENS_PER_UNIT = 150
const MIN_TOKENS = 500
const MAX_TOKENS = 2600
const TIMEOUT_MS = 30_000

function noDbSupabase(): SupabaseClient {
  return createClient('http://localhost', 'translate-cards-no-db') as unknown as SupabaseClient
}

/** Strips ``` fences then extracts the first [...] array substring. */
function extractJsonArray(raw: string): string {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i)
  if (fence?.[1]) text = fence[1].trim()
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  return start !== -1 && end > start ? text.slice(start, end + 1) : text
}

/** One translatable string: its global id, which item/field it belongs to, the text. */
interface TranslationUnit {
  id: number
  itemIdx: number
  field: string
  text: string
}

function buildSystemPrompt(lang: string): string {
  return [
    `You are a precise translator for a Jeju (제주) travel app. Translate each item's "text" into ${lang}.`,
    'STRICT RULES:',
    `- Output language = ${lang}. Translate ALL descriptive prose and cautions into ${lang}. Do NOT leave any Korean sentence, and do NOT use any other language.`,
    `- EVEN IF a text is entirely Korean, you MUST translate it into ${lang}. Never return Korean text unchanged (proper nouns excepted).`,
    '- Keep Korean PROPER NOUNS (place / oreum / restaurant / festival names) in their original Korean, adding a short romanization or translation in parentheses on first mention — e.g. "성산일출봉 (Seongsan Ilchulbong)".',
    '- Translate each item INDEPENDENTLY. Return EXACTLY one output per input id — never skip an id.',
    '- Match by the explicit "id". Same count, same ids — do NOT merge, skip, add, or reorder items.',
    'OUTPUT: a JSON array ONLY (no markdown, no commentary). Shape: [{"id": <int>, "text": "<translation>"}].',
  ].join('\n')
}

/** Translates one chunk, writing id→text into `out`. Non-fatal: leaves originals on failure. */
async function translateChunk(chunk: TranslationUnit[], lang: string, out: Map<number, string>): Promise<void> {
  const payload = chunk.map((u) => ({ id: u.id, text: u.text }))
  const maxCompletionTokens = Math.min(MAX_TOKENS, Math.max(MIN_TOKENS, chunk.length * TOKENS_PER_UNIT))
  try {
    const r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: TRANSLATE_PROVIDER,
      prompt: JSON.stringify(payload),
      systemPrompt: buildSystemPrompt(lang),
      maxCompletionTokens,
      timeoutMs: TIMEOUT_MS,
    })
    if (r.error || !r.text?.trim()) return

    const parsed = JSON.parse(extractJsonArray(r.text)) as unknown
    if (!Array.isArray(parsed)) return
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const o = item as Record<string, unknown>
      const id = typeof o.id === 'number' ? o.id : Number(o.id)
      const text = typeof o.text === 'string' ? o.text.trim() : ''
      if (Number.isInteger(id) && text) out.set(id, text)
    }
  } catch {
    // Leave originals for this chunk — handled by per-id fallback in the caller.
  }
}

/**
 * Translates the given string `fields` of every item into `locale`'s language.
 *
 * Returns shallow-cloned items with translated fields; any field whose translation
 * is missing (model skipped it, parse failed, or it overflowed the call budget)
 * keeps its ORIGINAL value. For locale 'ko' the input is returned as-is.
 */
export async function translateCardFields<T extends object>(
  items: T[],
  locale: AiLocale,
  fields: readonly (keyof T & string)[]
): Promise<T[]> {
  if (locale === 'ko' || items.length === 0 || fields.length === 0) return items

  // Collect every non-empty string field into an id-indexed flat list.
  const units: TranslationUnit[] = []
  items.forEach((item, itemIdx) => {
    const rec = item as Record<string, unknown>
    for (const field of fields) {
      const v = rec[field]
      if (typeof v === 'string' && v.trim()) {
        units.push({ id: units.length, itemIdx, field, text: v.trim() })
      }
    }
  })
  if (units.length === 0) return items

  // Bounded chunking: at most MAX_CHUNKS calls. Overflow units keep their originals.
  const chunks: TranslationUnit[][] = []
  for (let i = 0; i < units.length && chunks.length < MAX_CHUNKS; i += CHUNK_SIZE) {
    chunks.push(units.slice(i, i + CHUNK_SIZE))
  }

  const lang = languageName(locale)
  const translations = new Map<number, string>()
  await Promise.all(chunks.map((chunk) => translateChunk(chunk, lang, translations)))

  // A unit "failed" if its chosen text (translation, else original) is still
  // predominantly Hangul — i.e. the model silently skipped it or echoed Korean.
  const isFailed = (u: TranslationUnit): boolean => {
    const chosen = translations.get(u.id) ?? u.text
    return isPredominantlyKorean(chosen)
  }

  // ONE retry pass for just the failed units (the common cause of leaked Korean).
  const failed = units.filter(isFailed)
  if (failed.length > 0) {
    const retry = new Map<number, string>()
    await translateChunk(failed, lang, retry)
    for (const u of failed) {
      const t = retry.get(u.id)
      // Only accept the retry if it actually produced non-Korean text.
      if (t && !isPredominantlyKorean(t)) translations.set(u.id, t)
    }
  }

  // Apply translations; per-id fallback to the original text.
  const out = items.map((item) => ({ ...item })) as T[]
  let translated = 0
  for (const u of units) {
    const t = translations.get(u.id)
    if (t) {
      ;(out[u.itemIdx] as Record<string, unknown>)[u.field] = t
      translated++
    }
  }
  if (translated < units.length) {
    console.warn(
      `[translate-cards] locale=${locale}: translated ${translated}/${units.length} fields (${units.length - translated} kept original).`
    )
  }
  return out
}
