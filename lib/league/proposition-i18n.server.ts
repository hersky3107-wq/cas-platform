/**
 * Server-only proposition translation / compose helpers.
 * Client cards must import from `./proposition-i18n` (pure) instead.
 */
import 'server-only'

import { runSingleAiProvider } from '@/lib/ai/router'
import { LEAGUE_LOCALES, type LeagueLocale } from './i18n/locales'
import {
  claimFromOpenInstrument,
  formatOpenTechPropositionAllLocales,
} from './gateway/adapters/tech-resolve'

export { formatOpenTechPropositionAllLocales }

/**
 * Translate a TECH free-prompt proposition into all 8 locales once.
 * Uses existing translation model path, with timeout & deterministic fallback.
 */
export async function translatePropositionTo8Locales(
  propositionText: string,
  existing?: Partial<Record<LeagueLocale, string>>,
): Promise<Record<LeagueLocale, string>> {
  const isKorean = /[\uAC00-\uD7A3]/.test(propositionText)
  const baseMap: Record<LeagueLocale, string> = {
    ko: existing?.ko ?? (isKorean ? propositionText : ''),
    en: existing?.en ?? (!isKorean ? propositionText : ''),
    ja: existing?.ja ?? '',
    'zh-TW': existing?.['zh-TW'] ?? '',
    fr: existing?.fr ?? '',
    es: existing?.es ?? '',
    ar: existing?.ar ?? '',
    pt: existing?.pt ?? '',
  }

  const missingLocales = LEAGUE_LOCALES.filter((loc) => !baseMap[loc])
  if (missingLocales.length === 0) return baseMap

  try {
    const systemPrompt = [
      'You translate a prediction proposition into multiple languages.',
      'Output a JSON object with keys for each requested locale.',
      'Rules:',
      '- Keep names, dates, numbers, and proper nouns unchanged.',
      '- Do not add preamble or markdown backticks outside JSON.',
      'Shape: { "ko": "...", "en": "...", "ja": "...", "zh-TW": "...", "fr": "...", "es": "...", "ar": "...", "pt": "..." }',
    ].join('\n')

    const { supabaseAdmin } = await import('@/lib/supabase/server')
    const res = await runSingleAiProvider({
      supabase: supabaseAdmin,
      authSupabase: supabaseAdmin,
      sessionId: null,
      userId: null,
      provider: 'google',
      modelOverride: 'gemini-3.5-flash',
      prompt: `Translate this proposition into ${missingLocales.join(', ')}:\n"${propositionText}"`,
      systemPrompt,
      skipLanguageInjection: true,
      maxCompletionTokens: 1000,
      timeoutMs: 8_000,
    })

    if (res.text) {
      const cleaned = res.text.replace(/```json\s*|\s*```/g, '').trim()
      const parsed = JSON.parse(cleaned) as Record<string, string>
      for (const loc of missingLocales) {
        if (typeof parsed[loc] === 'string' && parsed[loc].trim()) {
          baseMap[loc] = parsed[loc].trim()
        }
      }
    }
  } catch {
    // LLM translation failed or timed out — fallback gracefully
  }

  const fallback = baseMap.en || baseMap.ko || propositionText
  for (const loc of LEAGUE_LOCALES) {
    if (!baseMap[loc]) baseMap[loc] = fallback
  }

  return baseMap
}

export async function backfillTechPropositions(
  propositionText: string,
  instrument: string,
): Promise<Record<LeagueLocale, string> | null> {
  const claim = claimFromOpenInstrument(instrument, '', new Date())
  if (claim) {
    return formatOpenTechPropositionAllLocales(claim)
  }
  return translatePropositionTo8Locales(propositionText)
}
