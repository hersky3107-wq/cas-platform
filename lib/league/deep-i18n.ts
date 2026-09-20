import 'server-only'

import { createHash } from 'node:crypto'
import { runSingleAiProvider } from '@/lib/ai/router'
import { supabaseAdmin } from '@/lib/supabase/server'
import type { LeagueLocale } from './i18n/locales'
import {
  collectDeepTranslatableParts,
  DEEP_ENGLISH_SECTION_HEADERS,
  deepSectionHeadersFor,
  localizeDeepMarkdownHeaders,
  partitionCachedDeepTranslations,
  shouldTranslateDeepLocale,
  type DeepTranslationPart,
} from './deep-display'
import type { DeepSnapshot } from './deep-snapshot'
import {
  persistDeepTranslations,
  logDeepTranslationCacheError,
  type DeepTranslationStore,
} from './deep-i18n-store'

/**
 * View-time deep-analysis translation. Never called from generation.
 *
 * Same skip list (en/pt), same cheap Gemini flash model, and the same
 * source-hash cache as card rationales. One batched call per (run, locale)
 * miss; already-cached parts are not retranslated.
 */

const TRANSLATE_PROVIDER = 'google' as const
const TRANSLATE_MODEL = 'gemini-3.5-flash'
const TRANSLATE_TIMEOUT_MS = 45_000
const PRICE = { inputPerMTokens: 0.3, outputPerMTokens: 2.5 }
const BATCH_CHAR_BUDGET = 8_000

const LANGUAGE_NAME: Record<Exclude<LeagueLocale, 'en' | 'pt'>, string> = {
  ko: 'Korean',
  ja: 'Japanese',
  'zh-TW': 'Traditional Chinese (Taiwan)',
  fr: 'French',
  es: 'Spanish',
  ar: 'Arabic',
}

export type TranslateDeepResult = {
  translations: Record<string, string>
  fromCache: number
  translated: number
  failed: number
  latencyMs: number
  costUsd: number
  model: string
  error?: string
}

export function deepSourceHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 32)
}

function estimateUsd(promptTokens: number | null, completionTokens: number | null): number {
  const inn = typeof promptTokens === 'number' ? promptTokens : 0
  const out = typeof completionTokens === 'number' ? completionTokens : 0
  return (inn / 1_000_000) * PRICE.inputPerMTokens + (out / 1_000_000) * PRICE.outputPerMTokens
}

function extractJsonArray(raw: string): string {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i)
  if (fence?.[1]) text = fence[1].trim()
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  return start !== -1 && end > start ? text.slice(start, end + 1) : text
}

const defaultStore: DeepTranslationStore = {
  async loadCached(runId, locale, partKeys) {
    if (partKeys.length === 0) return { rows: [], error: null }
    const { data, error } = await supabaseAdmin
      .from('league_deep_translations')
      .select('part_key, translated_text, source_hash')
      .eq('run_id', runId)
      .eq('locale', locale)
      .in('part_key', partKeys)
    return {
      rows: (data ?? null) as { part_key: string; translated_text: string; source_hash: string }[] | null,
      error: error ? { message: error.message } : null,
    }
  },
  async upsert(writes) {
    const { error } = await supabaseAdmin.from('league_deep_translations').upsert(writes, {
      onConflict: 'run_id,part_key,locale',
    })
    return { error: error ? { message: error.message } : null }
  },
}

function headingGlossary(locale: Exclude<LeagueLocale, 'en' | 'pt'>): string {
  const labels = deepSectionHeadersFor(locale)
  return (Object.keys(DEEP_ENGLISH_SECTION_HEADERS) as (keyof typeof DEEP_ENGLISH_SECTION_HEADERS)[])
    .map((id) => `- "${DEEP_ENGLISH_SECTION_HEADERS[id]}" → "${labels[id]}"`)
    .join('\n')
}

function chunkParts(parts: DeepTranslationPart[]): DeepTranslationPart[][] {
  const batches: DeepTranslationPart[][] = []
  let current: DeepTranslationPart[] = []
  let chars = 0
  for (const part of parts) {
    const size = part.text.length
    if (current.length > 0 && chars + size > BATCH_CHAR_BUDGET) {
      batches.push(current)
      current = []
      chars = 0
    }
    current.push(part)
    chars += size
  }
  if (current.length) batches.push(current)
  return batches
}

async function translateBatch(
  missing: DeepTranslationPart[],
  locale: Exclude<LeagueLocale, 'en' | 'pt'>
): Promise<{ byIndex: Map<number, string>; costUsd: number; error?: string }> {
  const lang = LANGUAGE_NAME[locale]
  const payload = missing.map((item, idx) => ({ id: idx, text: item.text }))
  const systemPrompt = [
    `You translate AI Prediction League deep-analysis markdown into ${lang}.`,
    'Rules:',
    `- Output language = ${lang}. Translate every item.`,
    '- Keep tickers, numbers, and proper nouns (AAPL, NASDAQ, ChatGPT, Grok) unchanged.',
    '- Preserve markdown (headings, lists, emphasis).',
    '- Translate section titles. When the English heading is one of these, use the given equivalent:',
    headingGlossary(locale),
    '- Do not add commentary. One translation per input id.',
    'OUTPUT: a JSON array only. Shape: [{"id": <int>, "text": "<translation>"}].',
  ].join('\n')

  const inputChars = missing.reduce((sum, part) => sum + part.text.length, 0)
  const res = await runSingleAiProvider({
    supabase: supabaseAdmin,
    authSupabase: supabaseAdmin,
    sessionId: null,
    userId: null,
    provider: TRANSLATE_PROVIDER,
    modelOverride: TRANSLATE_MODEL,
    prompt: JSON.stringify(payload),
    systemPrompt,
    skipLanguageInjection: true,
    maxCompletionTokens: Math.min(8192, Math.max(1200, Math.ceil(inputChars * 0.9))),
    timeoutMs: TRANSLATE_TIMEOUT_MS,
  })

  const costUsd =
    typeof res.costUsd === 'number' ? res.costUsd : estimateUsd(res.promptTokens, res.completionTokens)
  const byIndex = new Map<number, string>()
  if (res.error || !res.text?.trim()) {
    return { byIndex, costUsd, error: res.error }
  }
  try {
    const parsed = JSON.parse(extractJsonArray(res.text)) as unknown
    if (!Array.isArray(parsed)) return { byIndex, costUsd, error: res.error }
    for (const row of parsed) {
      if (!row || typeof row !== 'object') continue
      const o = row as Record<string, unknown>
      const id = typeof o.id === 'number' ? o.id : Number(o.id)
      const text = typeof o.text === 'string' ? o.text.trim() : ''
      if (Number.isInteger(id) && text) byIndex.set(id, text)
    }
  } catch {
    return { byIndex, costUsd, error: res.error ?? 'parse_failed' }
  }
  return { byIndex, costUsd, error: res.error }
}

export async function translateDeepSnapshot(opts: {
  runId: string
  locale: LeagueLocale
  snapshot: DeepSnapshot
  store?: DeepTranslationStore
}): Promise<TranslateDeepResult> {
  const started = Date.now()
  const empty: TranslateDeepResult = {
    translations: {},
    fromCache: 0,
    translated: 0,
    failed: 0,
    latencyMs: 0,
    costUsd: 0,
    model: TRANSLATE_MODEL,
  }
  const { runId, locale } = opts
  const store = opts.store ?? defaultStore
  const parts = collectDeepTranslatableParts(opts.snapshot)
  if (!shouldTranslateDeepLocale(locale) || parts.length === 0) {
    return { ...empty, latencyMs: Date.now() - started }
  }

  const { rows: cachedRows, error: cacheReadError } = await store.loadCached(
    runId,
    locale,
    parts.map((part) => part.key)
  )
  if (cacheReadError) logDeepTranslationCacheError('cache-read', cacheReadError.message)

  const { translations, missing } = partitionCachedDeepTranslations(
    parts,
    cachedRows ?? [],
    deepSourceHash
  )

  if (missing.length === 0) {
    return {
      ...empty,
      translations,
      fromCache: parts.length,
      latencyMs: Date.now() - started,
    }
  }

  const headers = deepSectionHeadersFor(locale)
  let translated = 0
  let failed = 0
  let costUsd = 0
  let lastError: string | undefined
  for (const batch of chunkParts(missing)) {
    const result = await translateBatch(batch, locale)
    costUsd += result.costUsd
    if (result.error) lastError = result.error
    const writes: {
      run_id: string
      part_key: string
      locale: string
      translated_text: string
      source_hash: string
    }[] = []
    for (let i = 0; i < batch.length; i++) {
      const raw = result.byIndex.get(i)
      if (!raw) {
        failed += 1
        continue
      }
      const item = batch[i]!
      const text = localizeDeepMarkdownHeaders(raw, headers)
      translations[item.key] = text
      writes.push({
        run_id: runId,
        part_key: item.key,
        locale,
        translated_text: text,
        source_hash: deepSourceHash(item.text),
      })
    }
    translated += writes.length
    if (writes.length) await persistDeepTranslations(writes, store)
  }

  return {
    translations,
    fromCache: parts.length - missing.length,
    translated,
    failed,
    latencyMs: Date.now() - started,
    costUsd,
    model: TRANSLATE_MODEL,
    error: lastError,
  }
}
