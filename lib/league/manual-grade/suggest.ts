import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import { runSingleAiProvider } from '@/lib/ai/router'
import { extractJsonObject } from '@/lib/league/gateway/normalize-prompt'
import { parseSuggestionPayload, type ManualSuggestion } from './types'

const SUGGEST_MODEL = 'sonar'

/**
 * Perplexity Sonar prefetch of the actual result. Suggestion only — never applied.
 */
export async function suggestManualOutcome(args: {
  proposition_text: string
  resolution_rule: string
  category: string
  instrument: string
  resolves_at: string
}): Promise<ManualSuggestion> {
  const res = await runSingleAiProvider({
    supabase: supabaseAdmin,
    authSupabase: supabaseAdmin,
    sessionId: null,
    userId: null,
    provider: 'perplexity',
    skipLanguageInjection: true,
    modelOverride: SUGGEST_MODEL,
    maxCompletionTokens: 400,
    timeoutMs: 25_000,
    systemPrompt:
      'You look up the already-finished result of a prediction proposition. Output ONLY a JSON object. Never invent a result. If you cannot find a published official result, set verdict to "unknown".',
    prompt: [
      `Proposition: ${args.proposition_text}`,
      `Resolution rule: ${args.resolution_rule}`,
      `Category: ${args.category}`,
      `Instrument: ${args.instrument}`,
      `Resolves at (UTC): ${args.resolves_at}`,
      '',
      'Did the NAMED subject achieve the stated outcome?',
      'verdict: "yes" (subject achieved it) | "no" (did not, including a draw) | "void" (cancelled/postponed) | "unknown"',
      'Schema: {"verdict":"yes"|"no"|"void"|"unknown","confidence":0-1,"summary":"one sentence with score/result and source name","source_url":"https://... or null"}',
    ].join('\n'),
  })

  if (res.error || !res.text?.trim()) {
    return { verdict: 'unknown', confidence: 0, summary: res.error ?? 'search returned no result', source_url: null }
  }
  return parseSuggestionPayload(extractJsonObject(res.text))
}
