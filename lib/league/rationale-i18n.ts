import 'server-only'

import { createHash } from 'node:crypto'
import { runSingleAiProvider } from '@/lib/ai/router'
import { supabaseAdmin } from '@/lib/supabase/server'
import type { LeagueLocale } from './i18n/locales'

/**
 * View-time rationale translation. Never called from generation.
 *
 * One batched model call per (round, locale) miss. Cache key is
 * (prediction_id, locale) plus a hash of the English original so a changed
 * snippet is retranslated. Failure/timeout returns the originals.
 */

const TRANSLATE_PROVIDER = 'google' as const
const TRANSLATE_MODEL = 'gemini-3.5-flash'
const TRANSLATE_TIMEOUT_MS = 25_000
const PRICE = { inputPerMTokens: 0.3, outputPerMTokens: 2.5 }

const LANGUAGE_NAME: Record<Exclude<LeagueLocale, 'en' | 'pt'>, string> = {
  ko: 'Korean',
  ja: 'Japanese',
  'zh-TW': 'Traditional Chinese (Taiwan)',
  fr: 'French',
  es: 'Spanish',
  ar: 'Arabic',
}

export type RationaleToTranslate = {
  predictionId: string
  text: string
}

export type TranslateRationalesResult = {
  translations: Record<string, string>
  fromCache: number
  translated: number
  failed: number
  latencyMs: number
  costUsd: number
  promptTokens: number | null
  completionTokens: number | null
  model: string
  error?: string
}

export function sourceHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 32)
}

export function shouldTranslateLocale(locale: LeagueLocale): locale is Exclude<LeagueLocale, 'en' | 'pt'> {
  return locale !== 'en' && locale !== 'pt'
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

export async function translateRoundRationales(
  items: RationaleToTranslate[],
  locale: LeagueLocale
): Promise<TranslateRationalesResult> {
  const started = Date.now()
  const empty: TranslateRationalesResult = {
    translations: {},
    fromCache: 0,
    translated: 0,
    failed: 0,
    latencyMs: 0,
    costUsd: 0,
    promptTokens: null,
    completionTokens: null,
    model: TRANSLATE_MODEL,
  }

  const usable = items.filter((i) => i.text.trim().length > 0)
  if (!shouldTranslateLocale(locale) || usable.length === 0) {
    return { ...empty, latencyMs: Date.now() - started }
  }

  const ids = usable.map((i) => i.predictionId)
  const { data: cachedRows } = await supabaseAdmin
    .from('prediction_rationale_translations')
    .select('prediction_id, translated_text, source_hash')
    .eq('locale', locale)
    .in('prediction_id', ids)

  const cached = new Map(
    (cachedRows ?? []).map((row) => [row.prediction_id as string, row as { translated_text: string; source_hash: string }])
  )

  const translations: Record<string, string> = {}
  const missing: RationaleToTranslate[] = []
  for (const item of usable) {
    const hit = cached.get(item.predictionId)
    if (hit && hit.source_hash === sourceHash(item.text) && hit.translated_text.trim()) {
      translations[item.predictionId] = hit.translated_text
    } else {
      missing.push(item)
    }
  }

  if (missing.length === 0) {
    return {
      ...empty,
      translations,
      fromCache: usable.length,
      latencyMs: Date.now() - started,
    }
  }

  const lang = LANGUAGE_NAME[locale]
  const payload = missing.map((item, idx) => ({ id: idx, text: item.text }))
  const systemPrompt = [
    `You translate AI prediction rationales into ${lang}.`,
    'Rules:',
    `- Output language = ${lang}. Translate every item.`,
    '- Keep tickers, numbers, and proper nouns (AAPL, NASDAQ, model names) unchanged.',
    '- Do not add commentary. One translation per input id.',
    'OUTPUT: a JSON array only. Shape: [{"id": <int>, "text": "<translation>"}].',
  ].join('\n')

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
    maxCompletionTokens: Math.min(4000, Math.max(800, missing.length * 80)),
    timeoutMs: TRANSLATE_TIMEOUT_MS,
  })

  const costUsd =
    typeof res.costUsd === 'number' ? res.costUsd : estimateUsd(res.promptTokens, res.completionTokens)

  let translated = 0
  let failed = missing.length
  if (!res.error && res.text?.trim()) {
    try {
      const parsed = JSON.parse(extractJsonArray(res.text)) as unknown
      if (Array.isArray(parsed)) {
        const byId = new Map<number, string>()
        for (const row of parsed) {
          if (!row || typeof row !== 'object') continue
          const o = row as Record<string, unknown>
          const id = typeof o.id === 'number' ? o.id : Number(o.id)
          const text = typeof o.text === 'string' ? o.text.trim() : ''
          if (Number.isInteger(id) && text) byId.set(id, text)
        }
        const writes: { prediction_id: string; locale: string; translated_text: string; source_hash: string }[] = []
        for (let i = 0; i < missing.length; i++) {
          const text = byId.get(i)
          if (!text) continue
          const item = missing[i]!
          translations[item.predictionId] = text
          writes.push({
            prediction_id: item.predictionId,
            locale,
            translated_text: text,
            source_hash: sourceHash(item.text),
          })
        }
        translated = writes.length
        failed = missing.length - translated
        if (writes.length) {
          await supabaseAdmin.from('prediction_rationale_translations').upsert(writes, {
            onConflict: 'prediction_id,locale',
          })
        }
      }
    } catch {
      // Fall through — callers keep English originals for any missing id.
    }
  }

  return {
    translations,
    fromCache: usable.length - missing.length,
    translated,
    failed,
    latencyMs: Date.now() - started,
    costUsd,
    promptTokens: res.promptTokens,
    completionTokens: res.completionTokens,
    model: res.model || TRANSLATE_MODEL,
    error: res.error,
  }
}
