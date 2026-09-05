/**
 * Layer-1 (per-system reading) prompt, v4.
 *
 * v4: layer-1 payloads are NATIVE in every mode (single AND combined) — the
 * axis projection goes only to layer-2 seers and the consensus map, so the
 * axes prompt variant is gone. The reading is written for someone who knows
 * nothing about the divination system: name the concrete chart elements, say
 * what each MEANS for the question, never print a raw numeric score, and end
 * with something to actually do. Budget 700–1100 chars (was 500 — too short
 * and too jargon-heavy for a premium reading).
 *
 * Output is forced JSON. Layer 2 reads `oracle_readings.summary`
 * (one_line / direction / focus / axis_emphasis), not the full narrative.
 */
import { LAYER1_NARRATIVE_MAX, LAYER1_NARRATIVE_MIN, LAYER1_NARRATIVE_TARGET } from '../parse-layer1'

export const LAYER1_PROMPT_VERSION = 'layer1-v4'

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
 * Claude's default prose is expansive and a prompt-only lock is not an API
 * hard stop — parseLayer1Json rejects narratives outside 400–1100 chars
 * (forcing one strict retry), and prism's maxCompletionTokens ceiling backs
 * that up. These lines are the Claude-specific in-prompt discipline, rescaled
 * to the v4 700–1100 budget.
 */
const PRISM_LENGTH_RULES = [
  'PRISM / length lock (mandatory):',
  `- Count characters in the final narrative string. If it would exceed ${LAYER1_NARRATIVE_MAX} Unicode characters, shorten BEFORE emitting JSON.`,
  `- Target narrative length: ${LAYER1_NARRATIVE_TARGET}. Never pad, never write filler to reach the minimum.`,
  '- one_line must be ≤80 characters and must not restate the whole narrative.',
]

/** Shared with the layer-2 verdict prompt (prompts/verdict.ts). */
export const INTERNAL_VOCAB_RULES = [
  'Never name our internal engine layers or scoring axes in user-facing prose.',
  'Forbidden phrases (do not quote, translate, or gloss them): 지휘 주기, 코어 매트릭스, 원소 공명, 수트→사원소→오행, 역위 반영, 카드 성향, 유지/방출 축, drive/stability vectors, core matrix, command cycle.',
  'Speak only in this divination system\'s own terms (cards, runes, 괘, 팔자, 궁성, planets/houses, 오격, 나왈, and so on).',
]

const NATIVE_SYSTEM_RULES: Record<string, string> = {
  tarot:
    'Tarot: name every card, its position label, and whether it is 정방향 or 역방향 — then say what that card in that position means for the question. Tarot has no 오행; never mention 오행 or elemental percentages.',
  runes:
    'Runes: name every rune (Korean name from the chart), its position, and 정방향/역방향 — a reversed rune reads as the stave\'s meaning blocked or turned inward, not as a random bad omen.',
  iching:
    'I Ching: name 본괘 and 변괘 by their names, explain what the situation-hexagram and the becoming-hexagram each say, and read the 변효 (and 세효/응효 where telling) in 육효 terms.',
  saju: 'Saju: read from 팔자 (천간/지지), 십신, 오행 분포, and the current 대운 — say what the dominant 십신 or element MEANS for the question, in plain words.',
  ziwei: 'Ziwei: read from 12궁 placements, 주성/보조성, 사화, and the current 대한 — explain what the relevant palace and its stars mean, not just their names.',
  astro:
    'Astrology: name planets, signs, houses, aspects, and angles from the chart. Planets (목성, 화성...) are planets — never call a planet an element. The four sign elements are 불·흙·바람·물.',
  prism: 'PRISM: speak in MBTI, the three colours, weekday/season, and this year/month\'s cycle. Never say 코어 매트릭스.',
  ninestar: 'Nine Star: name 본명성 / 월명성 / 일명성 and their 오행, and what today\'s star means against the natal star.',
  sukuyou:
    'Sukuyou: name the natal 宿 and today\'s 宿 and read their relation. 宿 are lunar mansions — never call them 명성 and never borrow 구성기학 vocabulary (본명성).',
  tzolkin: 'Tzolkin: name the nawal and tone for the natal day and for today. Use the Yucatec names from the chart.',
  numerology: 'Numerology: speak through 라이프패스, 생일수, 개인연/월, and other numbers present in the chart — these number NAMES (e.g. 라이프패스 7) are the system\'s own vocabulary and may be named.',
  name: 'Name: speak through 오격 (천·인·지·외·총) and their 길흉 — say what each 격\'s reading means for the question.',
}

export function buildLayer1SystemPrompt(locale: string, system?: string): string {
  const language = languageForLocale(locale)
  const lines = [
    'You are reading ONE divination system for one person.',
    'The native chart in the payload is already done and is authoritative. Never recalculate. Never invent a card, sign, or value that is not in the chart.',
    'WRITING RULES (this is the product):',
    '- Write for someone who knows NOTHING about this divination system. No unexplained jargon: the first time a term appears, make its meaning clear from the sentence itself.',
    '- Name the concrete elements of the chart — this card, this 괘, this 별자리 — and say what each one MEANS for this person\'s question. Meaning, not scores.',
    '- NEVER print a raw numeric score, percentage, or axis value in the prose. Internal numbers stay internal. (Numbers that ARE the system\'s own vocabulary — 라이프패스 7, 대운 나이대, 괘 이름 — are fine.)',
    '- No generic statements that would apply to anyone. Every claim ties to something in this chart.',
    '- END with what to actually do or watch for: one or two concrete, specific moves. Not "균형이 핵심" — say what to do on Monday.',
    `Write in ${language} (locale ${locale}). This is required — do not infer the language from the payload.`,
    'If a question is present under context.question, answer it through this system\'s lens.',
    'If no question is present, give the general reading.',
    ...INTERNAL_VOCAB_RULES,
    'axis_emphasis: 2–5 short human terms copied from the chart (card names, 괘 names, 십신, palace names). Never dotted machine codes.',
    'OUTPUT RULES (strict):',
    '- Respond with a single JSON object and nothing else.',
    '- No markdown fences, no preamble, no commentary outside the JSON.',
    '- Do NOT show step-by-step working, chain-of-thought, or analysis in ANY field.',
    '- narrative and one_line must be final prose only — never numbered steps or reasoning traces.',
    'Schema (character budgets are hard limits):',
    '{',
    `  "narrative": string,  // the reading; ${LAYER1_NARRATIVE_MIN}–${LAYER1_NARRATIVE_MAX} Unicode characters (aim ${LAYER1_NARRATIVE_TARGET}); plain language, no raw scores`,
    '  "one_line": string,     // punchy summary; max 80 characters; human terms only',
    '  "direction": "advance" | "hold" | "release",',
    '  "focus": "work" | "money" | "love" | "social" | "energy",',
    '  "axis_emphasis": string[]  // 2-5 human terms from the chart; never dotted codes or scoring-axis names',
    '}',
  ]
  if (system && NATIVE_SYSTEM_RULES[system]) lines.push(NATIVE_SYSTEM_RULES[system])
  if (system === 'prism') lines.push(...PRISM_LENGTH_RULES)
  return lines.join('\n')
}

export function buildLayer1UserPrompt(
  payload: Record<string, unknown>,
  locale: string,
  system?: string,
): string {
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
    'Native chart (authoritative; do not recalculate; do not import 오행/유지·방출 unless they appear in the chart):',
    JSON.stringify(payload),
  ]
  if (system === 'prism') {
    lines.push(
      `Reminder: narrative ${LAYER1_NARRATIVE_MIN}–${LAYER1_NARRATIVE_MAX} characters (aim ${LAYER1_NARRATIVE_TARGET}). Emit JSON only.`,
    )
  }
  if (system === 'tarot') {
    lines.push('Reminder: name the cards. A tarot reading that never names a card is wrong.')
  }
  return lines.join('\n')
}
