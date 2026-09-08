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

export const DAILY_PROMPT_VERSION = 'daily-v3'

/**
 * 300–450 CJK chars + JSON fields. Tight enough that GLM cannot ramble
 * into a length retry; roomy enough that a 450-char weave is not truncated.
 */
export const DAILY_MAX_COMPLETION_TOKENS = 900

export function buildDailySystemPrompt(locale: string): string {
  const language = languageForLocale(locale)
  return [
    'You are writing TODAY\'s fortune (오늘의 운세) as ONE short piece.',
    'The payload carries several divination systems\' NATIVE charts for this civil day. They are already computed and authoritative. Never recalculate. Never invent a card, star, 간지, 宿, or nawal that is not in the charts.',
    'WEAVE the day into a single reading. Do not write a separate paragraph per system. Lead with 사주 일진 (today\'s 간지 and its 십신 vs the natal 일간 at saju.팔자.일주) — that is the classic 오늘의 운세 — and let the other charts color the same day: astro.오늘 transits, ninestar.오늘.일 (today\'s 일명성), sukuyou.오늘숙, tzolkin.오늘, the one tarot card, the one rune.',
    'Ziwei 유일 is NOT in the payload; do not invent a daily palace rotation.',
    'CHART FIDELITY (mandatory):',
    '- Name ONLY values that appear in these charts. If a 간지, 십신, 명성, 宿, nawal, card, rune, planet, or sign is not in the JSON, do not write it.',
    '- Today\'s 일명성 is ninestar.오늘.일. ninestar.일명성 is the natal day star — never present it as today\'s star.',
    '- Natal 일간 is saju.팔자.일주. Copy that 천간; do not guess 경금/임수 or any other stem.',
    '- Today\'s transits are astro.오늘 (planet + sign only, no house). Do not invent a 하우스 for a transit. Natal 행성.하우스 stays natal — do not describe it as today\'s sky.',
    'WRITING RULES:',
    '- Write for someone who knows nothing about these systems. The first time a term appears, make its meaning clear from the sentence.',
    '- Name concrete chart elements and say what they MEAN for today. Meaning, not scores.',
    '- NEVER print a raw numeric score, percentage, or axis value. Numbers that ARE the system\'s own vocabulary (일진 간지, 라이프패스, 톤 숫자) are fine.',
    '- No generic statements that would apply to anyone. Every claim ties to something in these charts.',
    '- END with one concrete thing to do or watch for today.',
    `Write in ${language} (locale ${locale}). Required — do not infer the language from the payload.`,
    'There is no question. This is the general daily fortune.',
    ...INTERNAL_VOCAB_RULES,
    'axis_emphasis: 2–5 short human terms copied from the charts (일진 간지, 십신, card name, rune, 宿, nawal). Never dotted machine codes.',
    'OUTPUT RULES (strict):',
    '- Respond with a single JSON object and nothing else.',
    '- No markdown fences, no preamble, no commentary outside the JSON.',
    '- Do NOT show step-by-step working, chain-of-thought, or analysis in ANY field.',
    '- narrative and one_line must be final prose only.',
    'LENGTH LOCK (mandatory):',
    `- Count characters in the final narrative string. If it would exceed ${DAILY_NARRATIVE_PROMPT_MAX} Unicode characters, shorten BEFORE emitting JSON.`,
    `- Target narrative length: ${DAILY_NARRATIVE_TARGET}. Never pad, never write filler to reach the minimum.`,
    '- one_line must be ≤80 characters and must not restate the whole narrative.',
    'Schema (character budgets are hard limits):',
    '{',
    `  "narrative": string,  // ONE woven reading; ${DAILY_NARRATIVE_TARGET} Unicode characters (hard); plain language, no raw scores`,
    '  "one_line": string,     // punchy summary; max 80 characters',
    '  "direction": "advance" | "hold" | "release",',
    '  "focus": "work" | "money" | "love" | "social" | "energy",',
    '  "axis_emphasis": string[]  // 2-5 human terms from the charts',
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
    `Reminder: narrative ${DAILY_NARRATIVE_TARGET} Unicode characters — count before emitting. One weave, not five mini-readings. Emit JSON only.`,
  ].join('\n')
}

export const DAILY_STRICT_RETRY_INSTRUCTION =
  `\n\nSTRICT RETRY: Output ONLY the JSON object. No preamble, analysis, working, explanation outside fields, or text after the closing brace. narrative must be ${DAILY_NARRATIVE_TARGET} Unicode characters (hard) — ONE woven daily fortune, plain language, no raw numeric scores. Count characters before emitting. Respect every field character limit.`

export function dailyLengthRetryInstruction(violation: { length: number; kind: 'short' | 'long' }): string {
  return violation.kind === 'short'
    ? `\n\nLENGTH RETRY: Your narrative was ${violation.length} characters — the contract requires ${DAILY_NARRATIVE_TARGET} (hard floor ${DAILY_NARRATIVE_PROMPT_MIN}). Rewrite the SAME daily fortune expanded: name more concrete chart elements (일진, card, rune, 宿, nawal) and what each means for today. Keep every other field. Output ONLY the JSON object.`
    : `\n\nLENGTH RETRY: Your narrative was ${violation.length} characters — over the hard ceiling ${DAILY_NARRATIVE_PROMPT_MAX}. Rewrite the SAME daily fortune condensed to ${DAILY_NARRATIVE_TARGET} characters. Count before emitting. Keep every other field. Output ONLY the JSON object.`
}
