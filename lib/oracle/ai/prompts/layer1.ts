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

/** Computed chart values are law; the AI fills gaps the engine honestly cannot. */
export const TIER_AUTHORITY_RULES = [
  'TWO-TIER AUTHORITY (mandatory):',
  'TIER 1 — computed. When the chart already carries a real engine value, that value is authoritative. Explain it. NEVER override, second-guess, or substitute your own.',
  'TIER 2 — inferred. When the chart explicitly says a rule does not apply (판정불가, AI 판단 요청), reason from what IS on the chart and state the answer in this system\'s own terms. Variation between runs is acceptable here. You may not refuse with a sentence like "용신을 고정하지 않습니다".',
]

const NATIVE_SYSTEM_RULES: Record<string, string> = {
  tarot:
    'Tarot: name every card, its position label, and whether it is 정방향 or 역방향 — then say what that card in that position means for the question. Tarot has no 오행; never mention 오행 or elemental percentages.',
  runes:
    'Runes: name every rune (Korean name from the chart), its position, and 정방향/역방향 — a reversed rune reads as the stave\'s meaning blocked or turned inward, not as a random bad omen.',
  iching:
    'I Ching: name 본괘 and 변괘 by their names, explain what the situation-hexagram and the becoming-hexagram each say, and read the 변효 (and 세효/응효 where telling) in 육효 terms. A 육친 is 강 only when that line\'s 월령 is 왕(旺) or 상(相), and 약 only when 수(囚) or 사(死); 휴(休) is rest, not strength. Never infer 왕쇠 from presence, 육친 name, or 세효 alone — use only the 월령 / 일건 / 동효생극 fields already on the chart. 복장 is the list of 육친 missing from the six lines; an empty 복장 means all five are present. If 월령 is 없음, do not call the line strong or weak.',
  saju: 'Saju: read from 팔자 (천간/지지), 십신, 오행 분포, the current 대운, and 용신. 일간 강약 is saju.용신.강약 with 득령/득지/득세 already on the chart. TIER 1: when saju.용신.출처 is 억부법 계산 and 용신 is not 없음, that 오행 is the 용신 — copy it; never name a different 오행 as 용신; omit JSON "needed" or set it to the same 오행. If 강약 is 중화, that is also TIER 1: say the chart is balanced and do not pick a 용신. TIER 2: when saju.용신.출처 is AI 판단 요청 (억부 판정불가), you MUST state what this 사주 needs and why, from 일간·득령/득지/득세·편왕·십신분포·대운, in 사주 terms (인성/비겁 vs 식상/재성/관성, or 종격). Fill JSON "needed" with 목 or 화 or 토 or 금 or 수. Forbidden refusals: "용신을 하나로 고정하지 않습니다", "용신을 고정하지 않습니다", "용신을 억지로 고르지 않습니다". Never infer a TIER-1 용신 from 오행 counts. 조후/병약/통관 are not computed — do not present them as engine output.',
  ziwei: 'Ziwei: read from 12궁 placements, 주성/보조성, 사화, and the current 대한 — explain what the relevant palace and its stars mean, not just their names.',
  astro:
    'Astrology: name planets, signs, houses, aspects, and angles from the chart. Planets (목성, 화성...) are planets — never call a planet an element. The four sign elements are 불·흙·바람·물.',
  prism: 'PRISM: speak in MBTI, the three colours, weekday/season, and this year/month\'s cycle. Never say 코어 매트릭스.',
  ninestar:
    'Nine Star: name 본명성 / 월명성 / 일명성 and their 오행, and what today\'s star means against the natal star. The 연반 구궁 is the directional chart — name 오황살 / 암검살 / 본명살 / 본명적살 / 세파 / 월파 and 길방 only from those chart fields, never by inferring a direction from the star number alone. 길방 is 오행 상생 with 본명성 and free of those 흉방; do not invent a 대길/소길 grade.',
  sukuyou:
    'Sukuyou: name the natal 宿 and today\'s 宿 and read their relation. 宿 are lunar mansions — never call them 명성 and never borrow 구성기학 vocabulary (본명성).',
  tzolkin: 'Tzolkin: name the nawal and tone for the natal day and for today. Use the Yucatec names from the chart.',
  numerology: 'Numerology: speak through 라이프패스, 생일수, 개인연/월, and other numbers present in the chart — these number NAMES (e.g. 라이프패스 7) are the system\'s own vocabulary and may be named.',
  name: 'Name: speak through 오격 (천·인·지·외·총) and their 길흉 — say what each 격\'s reading means for the question.',
}

/**
 * 궁합 layer-1 framing. The direction enum keeps its wire values
 * (advance/hold/release) so nothing downstream forks, but its MEANING is
 * relationship motion: 다가서라 / 지금 흐름대로 / 거리를 두라.
 */
const COMPAT_READING_RULES = [
  'THIS IS A 궁합 (two-person compatibility) READING. The chart describes a RELATIONSHIP: 본인 (the person asking) and 상대 (the other person). The 관계 block is the heart — read it first.',
  'Speak about the relationship between 본인 and 상대. Never invent names, ages, birth facts, or genders for either person — the chart deliberately carries none.',
  'Do not manufacture a percentage score or a pass/fail verdict. Say what the chart actually shows: where the two charts pull together, where they grind, and what that asks of them.',
  'direction (relationship motion): "advance" = 다가서라 (invest more, move closer, commit further); "hold" = 지금의 흐름을 지켜라 (keep the current distance and rhythm, tend what exists); "release" = 거리를 두라 (step back, loosen, or let go).',
]

export function buildLayer1SystemPrompt(locale: string, system?: string, kind?: string): string {
  const language = languageForLocale(locale)
  const lines = [
    kind === 'compat'
      ? 'You are reading ONE divination system for the RELATIONSHIP between two people.'
      : 'You are reading ONE divination system for one person.',
    'The native chart in the payload is already done and is authoritative. Never recalculate. Never invent a card, sign, or value that is not in the chart.',
    ...(kind === 'compat' ? COMPAT_READING_RULES : []),
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
    ...TIER_AUTHORITY_RULES,
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
    '  "needed": string            // saju TIER 2 only: 목|화|토|금|수. Omit when 용신 is already computed.',
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
  kind?: string,
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
      ? kind === 'compat'
        ? `Question about this relationship (answer through this system's lens): ${question}`
        : `Question (answer through this system's lens): ${question}`
      : kind === 'compat'
        ? 'No question was submitted. Give the general relationship reading for 본인 and 상대.'
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
