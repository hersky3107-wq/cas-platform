/**
 * Layer-1 (per-system reading) prompt, v3.
 *
 * v3: single-system payloads carry the engine's native chart. Combined /
 * integrated mode still sends the axis projection. Internal scoring-layer
 * names must never appear in user-facing prose.
 *
 * Output is forced JSON. Layer 2 reads `oracle_readings.summary`
 * (one_line / direction / focus / axis_emphasis), not the full narrative.
 */
export const LAYER1_PROMPT_VERSION = 'layer1-v3'

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

export type Layer1ReadingInput = 'native' | 'axes'

/**
 * Prism / Claude Sonnet 5 overshoots the shared 500-char narrative budget
 * (measured 400 / 998 / 640 / 877 content tokens). Cause: Claude's default
 * prose is expansive, and a prompt-only lock is not an API hard stop —
 * parseLayer1Json now rejects narrative >500 chars (forcing one retry),
 * and prism maxCompletionTokens is 700 so the model cannot fill 877 again.
 * These lines remain the Claude-specific in-prompt discipline.
 */
const PRISM_LENGTH_RULES = [
  'PRISM / Claude-specific length lock (mandatory):',
  '- Count characters in the final narrative string. If it would exceed 500 Unicode characters, shorten BEFORE emitting JSON.',
  '- Target narrative length: 280–420 characters. Never pad. Never write a second paragraph.',
  '- Prefer one dense sentence that names three payload values over any elaboration.',
  '- one_line must be ≤80 characters and must not restate the whole narrative.',
]

/** Shared with the layer-2 verdict prompt (prompts/verdict.ts). */
export const INTERNAL_VOCAB_RULES = [
  'Never name our internal engine layers or scoring axes in user-facing prose.',
  'Forbidden phrases (do not quote, translate, or gloss them): 지휘 주기, 코어 매트릭스, 원소 공명, 수트→사원소→오행, 역위 반영, 카드 성향, 유지/방출 축, drive/stability vectors, core matrix, command cycle.',
  'Speak only in this divination system\'s own terms (cards, runes, 괘, 팔자, 궁성, planets/houses, 오격, 나왈, and so on).',
]

const NATIVE_CHART_RULES = [
  'The payload.chart is THIS system\'s own calculation, already finished. It is authoritative.',
  'Do not invent 오행 percentages, 유지/방출 scores, or any cross-system mapping that is not written in the chart.',
  'Connect at least THREE facts from chart in the narrative.',
  'Never list every chart field. Pick the ones that speak to the question (or the general reading).',
  'axis_emphasis: 2–5 short human terms copied from the chart (card names, 괘 names, 십신, palace names). Never dotted machine codes.',
]

const NATIVE_SYSTEM_RULES: Record<string, string> = {
  tarot:
    'Tarot: name every card, its position label, and whether it is 정방향 or 역방향. Tarot has no 오행 — do not mention 오행, 수트→사원소, or elemental percentages.',
  runes: 'Runes: name every rune, its position, and 정방향/역방향 (and 어두운 면 when present).',
  iching: 'I Ching: name 본괘 and 변괘, and speak through the 효 (변효, 세효/응효) in 육효 terms.',
  saju: 'Saju: read from 팔자 (천간/지지), 십신, 오행 분포, and the current 대운.',
  ziwei: 'Ziwei: read from 12궁 placements, 주성/보조성, 사화, and the current 대한.',
  astro: 'Astrology: name planets, signs, houses, aspects, and angles from the chart.',
  prism: 'PRISM: speak in MBTI, the three colours, weekday/season, and this year/month\'s cycle. Never say 코어 매트릭스.',
  ninestar: 'Nine Star: name 본명성 / 월명성 / 일명성 and their 오행.',
  sukuyou: 'Sukuyou: name the natal 宿 and today\'s 宿.',
  tzolkin: 'Tzolkin: name the nawal and tone for the natal day and for today. Use the Yucatec names from the chart.',
  numerology: 'Numerology: speak through 라이프패스, 생일수, 개인연/월, and other numbers present in the chart.',
  name: 'Name: speak through 오격 (천·인·지·외·총) and their 길흉.',
}

export function buildLayer1SystemPrompt(
  locale: string,
  system?: string,
  readingInput: Layer1ReadingInput = 'axes',
): string {
  const language = languageForLocale(locale)
  const native = readingInput === 'native'
  const lines = [
    'You are reading ONE divination system for one person.',
    native
      ? 'The native chart in the payload is already done and is authoritative.'
      : 'The calculation in the payload is already done and is authoritative.',
    'Never recalculate. Never invent a value that is not in the payload.',
    native
      ? 'Connect at least THREE facts from chart in your explanation.'
      : 'Connect at least THREE values from the payload in your explanation.',
    'Never list elements one by one.',
    'No generic statements that would apply to anyone.',
    `Write in ${language} (locale ${locale}). This is required — do not infer the language from the payload.`,
    'If a question is present under context.question, answer it through this system\'s lens.',
    'If no question is present, give the general reading.',
    ...INTERNAL_VOCAB_RULES,
  ]
  if (native) {
    lines.push(...NATIVE_CHART_RULES)
    if (system && NATIVE_SYSTEM_RULES[system]) lines.push(NATIVE_SYSTEM_RULES[system])
  } else {
    lines.push(
      'When a parallel labels{} object is present, each labels[space][i] is the human term for reasons[space][i]. Use those labels in narrative/one_line — never invent alternate jargon.',
      'Never print machine codes in narrative or one_line (no dotted paths like saju.phase.daewoon_sewoon, no snake_case keys like peer_dominant). Use human labels only.',
      'Phase ties: if two phase values are equal and leading (e.g. advance 50 and hold 50), report the tie as a tie in the narrative. Do not invent a decisive lean. Prefer direction "hold" when forced to pick one enum value under a tie.',
    )
  }
  lines.push(
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
    native
      ? '  "axis_emphasis": string[]  // 2-5 human terms from the chart; never dotted codes or scoring-axis names'
      : '  "axis_emphasis": string[]  // machine codes only (trait / element / phase keys or reason codes from the payload)',
    '}',
  )
  if (system === 'prism') lines.push(...PRISM_LENGTH_RULES)
  return lines.join('\n')
}

export function buildLayer1UserPrompt(
  payload: Record<string, unknown>,
  locale: string,
  system?: string,
  readingInput: Layer1ReadingInput = 'axes',
): string {
  const context = payload.context
  const question =
    context && typeof context === 'object' && context !== null && 'question' in context
      ? (context as { question?: unknown }).question
      : null
  const hasQuestion = typeof question === 'string' && question.trim().length > 0
  const language = languageForLocale(locale)
  const native = readingInput === 'native' || payload.readingInput === 'native'

  const lines = [
    `Locale: ${locale} (${language}). Write the narrative and one_line in ${language}.`,
    hasQuestion
      ? `Question (answer through this system's lens): ${question}`
      : 'No question was submitted. Give the general reading.',
    native
      ? 'Native chart (authoritative; do not recalculate; do not import 오행/유지·방출 unless they appear in the chart):'
      : 'Payload (authoritative; do not recalculate):',
    JSON.stringify(payload),
  ]
  if (system === 'prism') {
    lines.push(
      'Reminder: narrative ≤500 characters (prefer ≤420). Emit JSON only — no essay, no second paragraph.',
    )
  }
  if (system === 'tarot' && native) {
    lines.push('Reminder: name the cards. A tarot reading that never names a card is wrong.')
  }
  return lines.join('\n')
}
