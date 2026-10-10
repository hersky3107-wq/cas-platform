import type { SupabaseClient } from '@supabase/supabase-js'
import type { EngineResult } from '../engine/schema'
import type { CrisisLocale } from '../i18n/locales'
import { englishPayload, isCardTranslationPayload, koreanSeedPayload, TRANSLATABLE_FIELD_NOTE, type CardTranslationPayload } from './payload'
import { loadCardTranslation, saveCardTranslation } from './store'

export type TranslateCaller = (prompt: { system: string; user: string }) => Promise<string>

const LANGUAGE_NAME: Record<CrisisLocale, string> = {
  en: 'English',
  ko: 'Korean',
  ja: 'Japanese',
  'zh-TW': 'Traditional Chinese (Taiwan)',
  fr: 'French',
  ar: 'Arabic',
  es: 'Spanish',
  pt: 'Portuguese',
}

function extractJsonObject(raw: string): string {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i)
  if (fence?.[1]) text = fence[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return start !== -1 && end > start ? text.slice(start, end + 1) : text
}

export function parseTranslationPayload(raw: string): CardTranslationPayload | null {
  try {
    const parsed = JSON.parse(extractJsonObject(raw)) as unknown
    return isCardTranslationPayload(parsed) ? parsed : null
  } catch {
    return null
  }
}

export async function translatePayload(
  source: CardTranslationPayload,
  lang: CrisisLocale,
  caller: TranslateCaller,
): Promise<CardTranslationPayload | null> {
  if (lang === 'en') return source
  const language = LANGUAGE_NAME[lang] ?? lang
  const system = [
    `You translate CrisisWatch briefing cards into ${language}.`,
    'Rules:',
    `- Output language = ${language}.`,
    '- Keep numbers, place names, and official agency names.',
    '- Short plain sentences. No jargon.',
    `- ${TRANSLATABLE_FIELD_NOTE}`,
    'OUTPUT: a JSON object only, same shape as the input.',
  ].join('\n')
  try {
    const text = await caller({ system, user: JSON.stringify(source) })
    return parseTranslationPayload(text)
  } catch {
    return null
  }
}

export async function ensureCardTranslation(
  client: SupabaseClient,
  opts: {
    cardId: string
    lang: CrisisLocale
    result: EngineResult
    caller: TranslateCaller
  },
): Promise<CardTranslationPayload> {
  const cached = await loadCardTranslation(client, opts.cardId, opts.lang)
  if (cached) return cached

  if (opts.lang === 'en') {
    const payload = englishPayload(opts.result)
    await saveCardTranslation(client, opts.cardId, 'en', payload)
    return payload
  }

  if (opts.lang === 'ko') {
    const seed = koreanSeedPayload(opts.result)
    const translated = await translatePayload(englishPayload(opts.result), 'ko', opts.caller)
    const payload: CardTranslationPayload = translated
      ? { ...translated, headline: seed.headline, summary: seed.summary }
      : seed
    await saveCardTranslation(client, opts.cardId, 'ko', payload)
    return payload
  }

  const translated = await translatePayload(englishPayload(opts.result), opts.lang, opts.caller)
  const payload = translated ?? englishPayload(opts.result)
  if (translated) await saveCardTranslation(client, opts.cardId, opts.lang, payload)
  return payload
}

export async function seedPublishTranslations(
  client: SupabaseClient,
  cardId: string,
  result: EngineResult,
  caller: TranslateCaller,
): Promise<void> {
  await ensureCardTranslation(client, { cardId, lang: 'en', result, caller })
  await ensureCardTranslation(client, { cardId, lang: 'ko', result, caller })
}
