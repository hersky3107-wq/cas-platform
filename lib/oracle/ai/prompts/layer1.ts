/**
 * Layer-1 (per-system reading) prompt, v2.
 *
 * Output is forced JSON. Layer 2 reads `oracle_readings.summary`
 * (one_line / direction / focus / axis_emphasis), not the full narrative.
 */
export const LAYER1_PROMPT_VERSION = 'layer1-v2'

const LOCALE_LANGUAGE: Record<string, string> = {
  ko: 'Korean',
  en: 'English',
  ja: 'Japanese',
  zh: 'Chinese',
  'zh-CN': 'Simplified Chinese',
  'zh-TW': 'Traditional Chinese',
}

export function languageForLocale(locale: string): string {
  return LOCALE_LANGUAGE[locale] ?? LOCALE_LANGUAGE[locale.split('-')[0] ?? ''] ?? locale
}

/**
 * Prism / Claude Sonnet 5 overshoots the shared 500-char narrative budget
 * (measured 400 / 998 / 640 content tokens across three smokes). Cause:
 * Claude's default prose is expansive, the budget lives only in a schema
 * comment (not an API hard stop), and max_tokens 1200 leaves room for ~3×
 * the intended body — the runaway guard only trips above 1.5× the ceiling
 * (1800), so a 998-token narrative still "succeeds". These lines are the
 * Claude-specific hard stop without changing the model.
 */
const PRISM_LENGTH_RULES = [
  'PRISM / Claude-specific length lock (mandatory):',
  '- Count characters in the final narrative string. If it would exceed 500 Unicode characters, shorten BEFORE emitting JSON.',
  '- Target narrative length: 280–420 characters. Never pad. Never write a second paragraph.',
  '- Prefer one dense sentence that names three payload values over any elaboration.',
  '- one_line must be ≤80 characters and must not restate the whole narrative.',
]

export function buildLayer1SystemPrompt(locale: string, system?: string): string {
  const language = languageForLocale(locale)
  const lines = [
    'You are reading ONE divination system for one person.',
    'The calculation in the payload is already done and is authoritative.',
    'Never recalculate. Never invent a value that is not in the payload.',
    'Connect at least THREE values from the payload in your explanation.',
    'Never list elements one by one.',
    'No generic statements that would apply to anyone.',
    `Write in ${language} (locale ${locale}). This is required — do not infer the language from the payload.`,
    'If a question is present under context.question, answer it through this system\'s lens.',
    'If no question is present, give the general reading.',
    'When a parallel labels{} object is present, each labels[space][i] is the human term for reasons[space][i]. Use those labels in narrative/one_line — never invent alternate jargon.',
    'Never print machine codes in narrative or one_line (no dotted paths like saju.phase.daewoon_sewoon, no snake_case keys like peer_dominant). Use human labels only.',
    'Phase ties: if two phase values are equal and leading (e.g. advance 50 and hold 50), report the tie as a tie in the narrative. Do not invent a decisive lean. Prefer direction "hold" when forced to pick one enum value under a tie.',
    'OUTPUT RULES (strict):',
    '- Respond with a single JSON object and nothing else.',
    '- No markdown fences, no preamble, no commentary outside the JSON.',
    '- Do NOT show step-by-step working, chain-of-thought, or analysis in ANY field.',
    '- narrative and one_line must be final prose only — never numbered steps or reasoning traces.',
    'Schema (character budgets are hard limits — stay under them):',
    '{',
    '  "narrative": string,  // final reading prose only; max 500 characters; human terms only',
    '  "one_line": string,     // punchy summary; max 80 characters; human terms only',
    '  "direction": "advance" | "hold" | "release",',
    '  "focus": "work" | "money" | "love" | "social" | "energy",',
    '  "axis_emphasis": string[]  // machine codes only (trait / element / phase keys or reason codes from the payload)',
    '}',
  ]
  if (system === 'prism') lines.push(...PRISM_LENGTH_RULES)
  return lines.join('\n')
}

export function buildLayer1UserPrompt(payload: Record<string, unknown>, locale: string, system?: string): string {
  const context = payload.context
  const question =
    context && typeof context === 'object' && context !== null && 'question' in context
      ? (context as { question?: unknown }).question
      : null
  const hasQuestion = typeof question === 'string' && question.trim().length > 0
  const language = languageForLocale(locale)

  const lines = [
    `Locale: ${locale} (${language}). Write the narrative and one_line in ${language}.`,
    hasQuestion
      ? `Question (answer through this system's lens): ${question}`
      : 'No question was submitted. Give the general reading.',
    'Payload (authoritative; do not recalculate):',
    JSON.stringify(payload),
  ]
  if (system === 'prism') {
    lines.push(
      'Reminder: narrative ≤500 characters (prefer ≤420). Emit JSON only — no essay, no second paragraph.',
    )
  }
  return lines.join('\n')
}
