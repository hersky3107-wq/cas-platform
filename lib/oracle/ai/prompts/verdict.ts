/**
 * Layer-2 seer verdict prompt, v2.
 *
 * One seer = one ballot. The seer receives every layer-1 reading plus the
 * axis-projection consensus (combined mode is exactly what the projection is
 * for). What distinguishes seers is the persona DECISION RULE injected here —
 * never tone, never a different schema. The panel tally is computed in code
 * from the ballots; the prompt says so, so no seer tries to speak for the
 * panel.
 *
 * v2 (FIX 4): advance/hold/release got explicit criteria the seer must apply
 * to its OWN verdict text — session fb3336ed voted "만장일치 · 전진" while every
 * verdict said stop expanding and finish what exists, because the enum had no
 * stated meaning. The adapter now also validates direction-vs-text and retries
 * once with VERDICT_DIRECTION_RETRY_INSTRUCTION.
 */
import type { JsonObject } from '../../runner/types'
import {
  SEER_MINORITY_OPINION_MAX,
  seerPersona,
  verdictLineBudget,
} from '../seer-roster'
import { INTERNAL_VOCAB_RULES, languageForLocale } from './layer1'

export const VERDICT_PROMPT_VERSION = 'verdict-v2'

/**
 * The direction is the ACTION the verdict recommends, not the mood of the
 * readings. Shared between the system prompt and the mismatch retry.
 */
export const VERDICT_DIRECTION_CRITERIA = [
  'DIRECTION CRITERIA (apply these to your OWN verdict_line, not to the readings\' mood):',
  '- "advance"  = your verdict tells them to START or EXPAND something: open a new front, push into new ground, scale up.',
  '- "hold"     = your verdict tells them to KEEP THE CURRENT COURSE: consolidate, maintain, defend, finish what already exists, add nothing new. Finishing existing work is hold, NOT advance.',
  '- "release"  = your verdict tells them to END or LET GO of something: close it out, clear it away, subtract, walk away.',
  'Write verdict_line FIRST in your head, then pick the direction that matches the action it actually recommends. If your text says 확장을 멈추고 정비하라, the direction is hold — voting advance there is a wrong ballot.',
]

/**
 * 궁합 direction criteria. Same wire enum (nothing downstream forks), but the
 * meaning is RELATIONSHIP MOTION — toward, steady, away — because
 * start/expand/finish-work language makes no sense for two people.
 */
export const COMPAT_VERDICT_DIRECTION_CRITERIA = [
  'DIRECTION CRITERIA — this ballot judges a RELATIONSHIP between 본인 and 상대 (apply to your OWN verdict_line):',
  '- "advance"  = 다가서라: your verdict tells them to move CLOSER — invest more, open up, commit further, deepen the bond.',
  '- "hold"     = 지금의 흐름을 지켜라: keep the current distance and rhythm — tend what exists, let it ripen, change nothing structural.',
  '- "release"  = 거리를 두라: step BACK — loosen the grip, take space, or let the tie go.',
  'Judge the RELATIONSHIP, not either person alone. Never invent names, birth facts, or a compatibility percentage. Write verdict_line FIRST in your head, then vote the direction its action actually recommends.',
]

/**
 * Ballot JSON worst case ≈ line budget + minority 160 chars + fixed keys —
 * comfortably under 900 tokens even in CJK. Reasoning-heavy brands keep
 * their own larger registry ceiling via max() in the adapter.
 */
export const VERDICT_MAX_COMPLETION_TOKENS = 900

export const VERDICT_STRICT_RETRY_INSTRUCTION =
  '\n\nSTRICT RETRY: Output ONLY the JSON object. No preamble, no analysis, no text after the closing brace. Respect the verdict_line character budget exactly; all five domains must be integers 0-100.'

/**
 * Appended when the first ballot's direction contradicted its own text.
 * One retry, then the adapter accepts and logs the mismatch.
 */
export const VERDICT_DIRECTION_RETRY_INSTRUCTION =
  '\n\nDIRECTION RETRY: Your previous ballot\'s direction contradicted its own verdict_line. Re-read the criteria — advance = start/expand something new; hold = keep course, consolidate, finish what exists; release = end/let go. Rewrite the ballot so the direction is the action your verdict_line actually recommends. If the text says consolidate or finish what exists, vote "hold". Output ONLY the JSON object.'

/** 궁합 variant of the direction retry, in relationship-motion terms. */
export const COMPAT_VERDICT_DIRECTION_RETRY_INSTRUCTION =
  '\n\nDIRECTION RETRY: Your previous ballot\'s direction contradicted its own verdict_line. This is a 궁합 ballot — advance = 다가서라 (move closer, invest more); hold = 지금의 흐름을 지켜라 (keep the current distance and rhythm); release = 거리를 두라 (step back, loosen, let go). Rewrite the ballot so the direction is the motion your verdict_line actually recommends. Output ONLY the JSON object.'

export function buildVerdictSystemPrompt(
  locale: string,
  readerSlug: string,
  readerCount: number,
  kind?: string,
): string {
  const language = languageForLocale(locale)
  const persona = seerPersona(readerSlug)
  const lineBudget = verdictLineBudget(readerCount)
  const compat = kind === 'compat'

  const lines = [
    compat
      ? `You are ONE seer on a panel of ${readerCount}, judging the COMPATIBILITY (궁합) of two people — 본인 and 상대. Several divination systems each read the relationship independently; you receive all readings plus the cross-system consensus tally.`
      : `You are ONE seer on a panel of ${readerCount}. Twelve divination systems were each read independently; you receive all twelve readings plus the cross-system consensus tally.`,
    'Cast exactly ONE ballot. The panel result is counted in code from the ballots — never speak for the panel, never predict the vote, never aggregate.',
    persona
      ? persona.decisionRule
      : 'DECISION RULE: weigh all readings on their merits and cast the most defensible ballot.',
    'Evidence rules:',
    '- Work only from the supplied readings and consensus. Never invent a card, sign, or value that is not in the payload.',
    '- Cite systems by their divination names (사주, 타로, 룬, 주역, 점성술...). Never mention AI, models, brands, or other seers.',
    '- Never print raw numeric scores or percentages in verdict_line or minority_opinion — speak in plain language.',
    ...INTERNAL_VOCAB_RULES,
    ...(compat ? COMPAT_VERDICT_DIRECTION_CRITERIA : VERDICT_DIRECTION_CRITERIA),
    'verdict_line must be CONSISTENT with the direction you vote: a reader must be able to guess your direction from your text alone.',
    `Write user-facing text in ${language} (locale ${locale}).`,
    compat
      ? 'If context.question is present, the ballot answers that question about the relationship; otherwise it judges the relationship in general.'
      : 'If context.question is present, the ballot answers that question; otherwise it judges the period in general.',
    'OUTPUT RULES (strict):',
    '- Respond with a single JSON object and nothing else.',
    '- No markdown fences, no preamble, no commentary, no visible working.',
    'Schema (character budgets are hard limits — stay under them):',
    '{',
    `  "verdict_line": string,  // your verdict; max ${lineBudget} characters; final prose only`,
    '  "direction": "advance" | "hold" | "release",  // per DIRECTION CRITERIA — the action your verdict_line recommends',
    '  "focus": "work" | "money" | "love" | "social" | "energy",  // the one domain your verdict turns on',
    compat
      ? '  "domains": {"work": int, "money": int, "love": int, "social": int, "energy": int},  // each 0-100, how this relationship bears on each domain of 본인\'s life'
      : '  "domains": {"work": int, "money": int, "love": int, "social": int, "energy": int},  // each 0-100, your read of the period per domain',
    `  "minority_opinion": string | null  // max ${SEER_MINORITY_OPINION_MAX} characters. If your ballot goes AGAINST the consensus tally leader, state the strongest fact behind your dissent; otherwise null.`,
    '}',
  ]
  return lines.join('\n')
}

export function buildVerdictUserPrompt(payload: JsonObject, locale: string, kind?: string): string {
  const context = payload.context
  const question =
    context && typeof context === 'object' && context !== null && 'question' in context
      ? (context as { question?: unknown }).question
      : null
  const hasQuestion = typeof question === 'string' && question.trim().length > 0
  const language = languageForLocale(locale)
  const compat = kind === 'compat'

  const lines = [
    `Locale: ${locale} (${language}). Write verdict_line and minority_opinion in ${language}.`,
    hasQuestion
      ? `Question the ballot must answer: ${question}`
      : compat
        ? 'No question was submitted. Ballot on the relationship in general.'
        : 'No question was submitted. Ballot on the period in general.',
    compat
      ? 'Panel input (authoritative; readings[] are the per-system relationship readings, consensus is the cross-system projection):'
      : 'Panel input (authoritative; readings[] are the twelve system readings, consensus is the cross-system projection):',
    JSON.stringify(payload),
  ]
  return lines.join('\n')
}
