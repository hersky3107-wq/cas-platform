import {
  isAirankInstrument,
  parseAirankInstrument,
  decodeAirankInstrument,
  airankPropositionText,
  airankAllPropositions,
} from './ai-ranking/instrument'
import type { LeagueLocale } from './i18n/locales'
import { LEAGUE_LOCALES } from './i18n/locales'
import { runSingleAiProvider } from '@/lib/ai/router'
import {
  claimFromOpenInstrument,
  decodeOpenTechInstrument,
  formatOpenTechProposition,
  formatOpenTechPropositionAllLocales,
} from './gateway/adapters/tech-resolve'

export type LocalizedPropositionTarget = {
  proposition_text: string
  category?: string | null
  instrument?: string | null
  propositions?: Record<string, string> | null
}

/**
 * Resolves the proposition text for the viewer's locale.
 *
 * Priority:
 * 1. Viewer's locale from `propositions[locale]` if present.
 * 2. AIRANK: deterministic template from codec in all 8 locales (no LLM).
 * 3. Fallback to `en` then `ko` from `propositions`.
 * 4. Stored `proposition_text`.
 */
export function resolveLocalizedProposition(
  round: LocalizedPropositionTarget,
  locale: LeagueLocale = 'en',
): string {
  if (round.propositions && typeof round.propositions === 'object') {
    const direct = round.propositions[locale]
    if (typeof direct === 'string' && direct.trim()) return direct.trim()
  }

  // AIRANK: render from the codec with templates in all 8 locales (no LLM)
  if (round.category === 'ai_models' || (round.instrument && isAirankInstrument(round.instrument))) {
    const parts =
      (round.instrument ? decodeAirankInstrument(round.instrument) : null) ??
      (round.instrument ? parseAirankInstrument(round.instrument) : null)
    if (parts) {
      return airankPropositionText(parts, locale)
    }
  }

  // Fallback order: viewer's locale -> en -> ko -> stored proposition_text
  if (round.propositions && typeof round.propositions === 'object') {
    const en = round.propositions.en
    if (typeof en === 'string' && en.trim()) return en.trim()
    const ko = round.propositions.ko
    if (typeof ko === 'string' && ko.trim()) return ko.trim()
  }

  return round.proposition_text
}

/**
 * Localized share text for cards and propositions.
 */
export function leagueShareText(
  round: LocalizedPropositionTarget,
  locale: LeagueLocale = 'en',
): string {
  return resolveLocalizedProposition(round, locale)
}

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

  // Fill any remaining gaps from en then ko then raw propositionText
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
