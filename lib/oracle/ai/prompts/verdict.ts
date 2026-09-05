/**
 * Layer-2 seer verdict prompt, v1.
 *
 * One seer = one ballot. The seer receives every layer-1 reading plus the
 * axis-projection consensus (combined mode is exactly what the projection is
 * for). What distinguishes seers is the persona DECISION RULE injected here —
 * never tone, never a different schema. The panel tally is computed in code
 * from the ballots; the prompt says so, so no seer tries to speak for the
 * panel.
 */
import type { JsonObject } from '../../runner/types'
import {
  SEER_MINORITY_OPINION_MAX,
  seerPersona,
  verdictLineBudget,
} from '../seer-roster'
import { INTERNAL_VOCAB_RULES, languageForLocale } from './layer1'

export const VERDICT_PROMPT_VERSION = 'verdict-v1'

/**
 * Ballot JSON worst case ≈ line budget + minority 160 chars + fixed keys —
 * comfortably under 900 tokens even in CJK. Reasoning-heavy brands keep
 * their own larger registry ceiling via max() in the adapter.
 */
export const VERDICT_MAX_COMPLETION_TOKENS = 900

export const VERDICT_STRICT_RETRY_INSTRUCTION =
  '\n\nSTRICT RETRY: Output ONLY the JSON object. No preamble, no analysis, no text after the closing brace. Respect the verdict_line character budget exactly; all five domains must be integers 0-100.'

export function buildVerdictSystemPrompt(
  locale: string,
  readerSlug: string,
  readerCount: number,
): string {
  const language = languageForLocale(locale)
  const persona = seerPersona(readerSlug)
  const lineBudget = verdictLineBudget(readerCount)

  const lines = [
    `You are ONE seer on a panel of ${readerCount}. Twelve divination systems were each read independently; you receive all twelve readings plus the cross-system consensus tally.`,
    'Cast exactly ONE ballot. The panel result is counted in code from the ballots — never speak for the panel, never predict the vote, never aggregate.',
    persona
      ? persona.decisionRule
      : 'DECISION RULE: weigh all readings on their merits and cast the most defensible ballot.',
    'Evidence rules:',
    '- Work only from the supplied readings and consensus. Never invent a card, sign, or value that is not in the payload.',
    '- Cite systems by their divination names (사주, 타로, 룬, 주역, 점성술...). Never mention AI, models, brands, or other seers.',
    ...INTERNAL_VOCAB_RULES,
    `Write user-facing text in ${language} (locale ${locale}).`,
    'If context.question is present, the ballot answers that question; otherwise it judges the period in general.',
    'OUTPUT RULES (strict):',
    '- Respond with a single JSON object and nothing else.',
    '- No markdown fences, no preamble, no commentary, no visible working.',
    'Schema (character budgets are hard limits — stay under them):',
    '{',
    `  "verdict_line": string,  // your verdict; max ${lineBudget} characters; final prose only`,
    '  "direction": "advance" | "hold" | "release",',
    '  "focus": "work" | "money" | "love" | "social" | "energy",  // the one domain your verdict turns on',
    '  "domains": {"work": int, "money": int, "love": int, "social": int, "energy": int},  // each 0-100, your read of the period per domain',
    `  "minority_opinion": string | null  // max ${SEER_MINORITY_OPINION_MAX} characters. If your ballot goes AGAINST the consensus tally leader, state the strongest fact behind your dissent; otherwise null.`,
    '}',
  ]
  return lines.join('\n')
}

export function buildVerdictUserPrompt(payload: JsonObject, locale: string): string {
  const context = payload.context
  const question =
    context && typeof context === 'object' && context !== null && 'question' in context
      ? (context as { question?: unknown }).question
      : null
  const hasQuestion = typeof question === 'string' && question.trim().length > 0
  const language = languageForLocale(locale)

  const lines = [
    `Locale: ${locale} (${language}). Write verdict_line and minority_opinion in ${language}.`,
    hasQuestion
      ? `Question the ballot must answer: ${question}`
      : 'No question was submitted. Ballot on the period in general.',
    'Panel input (authoritative; readings[] are the twelve system readings, consensus is the cross-system projection):',
    JSON.stringify(payload),
  ]
  return lines.join('\n')
}
