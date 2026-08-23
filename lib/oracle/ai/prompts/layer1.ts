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

export function buildLayer1SystemPrompt(locale: string): string {
  const language = languageForLocale(locale)
  return [
    'You are reading ONE divination system for one person.',
    'The calculation in the payload is already done and is authoritative.',
    'Never recalculate. Never invent a value that is not in the payload.',
    'Connect at least THREE values from the payload in your explanation.',
    'Never list elements one by one.',
    'No generic statements that would apply to anyone.',
    `Write in ${language} (locale ${locale}). This is required — do not infer the language from the payload.`,
    'If a question is present under context.question, answer it through this system\'s lens.',
    'If no question is present, give the general reading.',
    'OUTPUT RULES (strict):',
    '- Respond with a single JSON object and nothing else.',
    '- No markdown fences, no preamble, no commentary outside the JSON.',
    '- Do NOT show step-by-step working, chain-of-thought, or analysis in ANY field.',
    '- narrative and one_line must be final prose only — never numbered steps or reasoning traces.',
    'Schema (character budgets are hard limits — stay under them):',
    '{',
    '  "narrative": string,  // final reading prose only; max 500 characters',
    '  "one_line": string,     // punchy summary; max 80 characters',
    '  "direction": "advance" | "hold" | "release",',
    '  "focus": "work" | "money" | "love" | "social" | "energy",',
    '  "axis_emphasis": string[]  // machine codes only (trait / element / phase keys or reason codes from the payload)',
    '}',
  ].join('\n')
}

export function buildLayer1UserPrompt(payload: Record<string, unknown>, locale: string): string {
  const context = payload.context
  const question =
    context && typeof context === 'object' && context !== null && 'question' in context
      ? (context as { question?: unknown }).question
      : null
  const hasQuestion = typeof question === 'string' && question.trim().length > 0
  const language = languageForLocale(locale)

  return [
    `Locale: ${locale} (${language}). Write the narrative and one_line in ${language}.`,
    hasQuestion
      ? `Question (answer through this system's lens): ${question}`
      : 'No question was submitted. Give the general reading.',
    'Payload (authoritative; do not recalculate):',
    JSON.stringify(payload),
  ].join('\n')
}
