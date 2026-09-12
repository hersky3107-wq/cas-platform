/**
 * 오늘의 운세 — one short weave of today's native charts, one AI.
 *
 * Not a panel, not a seer layer, not a synthesis of other narratives.
 * The model sees each system's own chart (never axis scores) and writes
 * ONE piece of 300–450 characters. Character budgets live in the JSON
 * schema the same way layer-1 v4 does — that is the length lock, not a
 * retry after the fact.
 */
import {
  DAILY_NARRATIVE_PROMPT_MAX,
  DAILY_NARRATIVE_PROMPT_MIN,
  DAILY_NARRATIVE_TARGET,
} from '../parse-layer1'
import { INTERNAL_VOCAB_RULES, languageForLocale } from './layer1'

export const DAILY_PROMPT_VERSION = 'daily-v4'

/**
 * 300–450 CJK chars + JSON fields. Tight enough that GLM cannot ramble
 * into a length retry; roomy enough that a 450-char weave is not truncated.
 */
export const DAILY_MAX_COMPLETION_TOKENS = 900

export function buildDailySystemPrompt(locale: string): string {
  const language = languageForLocale(locale)
  return [
    'You are writing TODAY\'s fortune (오늘의 운세) as ONE short, practical piece.',
    'The payload carries several divination systems\' NATIVE charts for this civil day. They are already computed and authoritative. Never recalculate. Never invent a card, star, 간지, 宿, or nawal that is not in the charts.',
    'CHART FIDELITY (mandatory):',
    '- Name ONLY values that appear in these charts. If a 간지, 십신, 명성, 宿, nawal, card, rune, planet, or sign is not in the JSON, do not write it.',
    '- Today\'s 일명성 is ninestar.오늘.일. ninestar.일명성 is the natal day star — never present it as today\'s star.',
    '- 구성 흉방 (오황살, 암검살, 본명살, 본명적살, 세파, 월파) and 길방 come only from ninestar.흉방 / ninestar.길방. Never invent a direction.',
    '- Natal 일간 is saju.팔자.일주. Copy that 천간; do not guess or substitute stems.',
    '- Today\'s transits are astro.오늘 (planet + sign only, no house). Do not invent a 하우스 for a transit. Natal 행성.하우스 stays natal — do not describe it as today\'s sky.',
    'CORE WRITING RULES (HALF GROUNDING, HALF PLAIN SPEECH):',
    '- DO NOT list or mention every system. The facts strip above the text already shows all individual values. Pick only the ONE or TWO strongest, most prominent signals of the day (e.g. today\'s 사주 일진/십신, or the single tarot card, or the rune) and build the reading around them.',
    '- IN-SENTENCE PLAIN EXPLANATION: Whenever ANY technical divination term appears (십신 like 정재/편관/상관, 하우스, 宿, 구성 별, 룬 이름, 카드 이름), explain it immediately in the same sentence in plain everyday Korean. Never assume the reader knows what it means (e.g. "표현과 창작의 기운인 상관", "나를 지키는 방패를 뜻하는 룬 알기즈", "재물과 결실을 상징하는 정재").',
    '- MANDATORY 3-PART CLOSE: The reading MUST conclude with these three items at the end in this exact order and format:',
    '  ① [One plain, jargon-free summary sentence of today\'s overall climate/flow.]',
    '  ② 오늘 하면 좋은 것: [One specific, real-world action the reader can actually do today. E.g. "오전에 밀린 서류 검토 끝내기", "지출 영수증 정리하기", "동료에게 먼저 안부 묻기". NEVER use vague filler like "마음을 다잡으세요" or "균형을 유지하세요"].',
    '  ③ 오늘 조심할 것: [One specific, real-world caution for today. E.g. "확인되지 않은 구두 약속 피하기", "충동적인 온라인 결제 자제하기", "감정적인 답장 바로 보내지 않기"].',
    '- NEVER print a raw numeric score, percentage, or internal code.',
    `Write in ${language} (locale ${locale}). Required — do not infer the language from the payload.`,
    'There is no question. This is the general daily fortune.',
    ...INTERNAL_VOCAB_RULES,
    'axis_emphasis: 2–4 short human terms copied from the charts actually cited (일진 간지, 십신, card name, rune). Never dotted machine codes.',
    'OUTPUT RULES (strict):',
    '- Respond with a single JSON object and nothing else.',
    '- No markdown fences, no preamble, no commentary outside the JSON.',
    '- Do NOT show step-by-step working, chain-of-thought, or analysis in ANY field.',
    '- narrative and one_line must be final prose only.',
    'LENGTH LOCK (mandatory):',
    `- Count characters in the final narrative string. If it would exceed ${DAILY_NARRATIVE_PROMPT_MAX} Unicode characters, shorten BEFORE emitting JSON.`,
    `- Target narrative length: ${DAILY_NARRATIVE_TARGET}. Shorter grounding, real conclusion — not more text. Never pad.`,
    '- one_line must be ≤80 characters and must not restate the whole narrative.',
    'Schema (character budgets are hard limits):',
    '{',
    `  "narrative": string,  // ONE woven reading; ${DAILY_NARRATIVE_TARGET} Unicode characters (hard); HALF grounding (1-2 signals with in-sentence plain explanation) + HALF close (①어떤 날 ②오늘 하면 좋은 것: [구체적 행동] ③오늘 조심할 것: [구체적 주의])`,
    '  "one_line": string,     // punchy summary; max 80 characters',
    '  "direction": "advance" | "hold" | "release",',
    '  "focus": "work" | "money" | "love" | "social" | "energy",',
    '  "axis_emphasis": string[]  // 2-4 human terms from the charts',
    '}',
  ].join('\n')
}

export function buildDailyUserPrompt(payload: Record<string, unknown>, locale: string): string {
  const language = languageForLocale(locale)
  return [
    `Locale: ${locale} (${language}). Write the narrative and one_line in ${language}.`,
    'No question was submitted. Weave today\'s charts into one short daily fortune.',
    'Native charts (authoritative; do not recalculate; do not import 오행/유지·방출 unless they appear in a chart):',
    JSON.stringify(payload),
    `Reminder: narrative ${DAILY_NARRATIVE_TARGET} Unicode characters. HALF grounding (pick only 1-2 signals, explain terms in same sentence) + HALF practical close in order (① [한 줄 요약] ② 오늘 하면 좋은 것: [구체적 실행 행동] ③ 오늘 조심할 것: [구체적 주의점]). Emit JSON only.`,
  ].join('\n')
}

export const DAILY_STRICT_RETRY_INSTRUCTION =
  `\n\nSTRICT RETRY: Output ONLY the JSON object. No preamble, analysis, working, explanation outside fields, or text after the closing brace. narrative must be ${DAILY_NARRATIVE_TARGET} Unicode characters (hard) — HALF grounding (explain technical terms in-sentence, max 1–2 systems) and HALF practical close (①어떤 날 ②오늘 하면 좋은 것: [구체적 행동] ③오늘 조심할 것: [구체적 주의]). Count characters before emitting. Respect every field character limit.`

export function dailyLengthRetryInstruction(violation: { length: number; kind: 'short' | 'long' }): string {
  return violation.kind === 'short'
    ? `\n\nLENGTH RETRY: Your narrative was ${violation.length} characters — the contract requires ${DAILY_NARRATIVE_TARGET} (hard floor ${DAILY_NARRATIVE_PROMPT_MIN}). Expand with clear in-sentence explanations of your 1–2 chart signals and concrete specific actions for today (①어떤 날 ②오늘 하면 좋은 것: ③오늘 조심할 것:). Keep every other field. Output ONLY the JSON object.`
    : `\n\nLENGTH RETRY: Your narrative was ${violation.length} characters — over the hard ceiling ${DAILY_NARRATIVE_PROMPT_MAX}. Condense to ${DAILY_NARRATIVE_TARGET} characters: keep only 1–2 chart signals, explain terms compactly, and keep the concrete close (①어떤 날 ②오늘 하면 좋은 것: ③오늘 조심할 것:). Count before emitting. Keep every other field. Output ONLY the JSON object.`
}
