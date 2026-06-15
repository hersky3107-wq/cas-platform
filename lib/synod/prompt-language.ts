/**
 * SYNOD — server-side question-language detection for prompt injection.
 *
 * Why this exists: debaters were drifting to the wrong language (Korean question
 * → Japanese answer; Arabic question → English leak / Egyptian dialect). The only
 * rule was a weak generic "respond in the same language as the question". This
 * module detects the question's language ONCE per request and produces a forceful,
 * language-specific instruction to inject into every SYNOD system prompt.
 *
 * Detection mirrors lib/synod/ui-labels.ts script logic (which is not exported):
 * Hangul→ko, kana→ja, Arabic block→ar, Han→zh-TW. Latin-script questions can't be
 * told apart by characters, so we fall back to a provided uiLocale, else 'unknown'.
 *
 * Pure: no DB, no network, no mutation.
 */

import { normalizeUiLocale } from '@/lib/synod/ui-labels'

/** Detected prompt-language code. 'unknown' = couldn't determine (Latin, no hint). */
export type PromptLanguageCode =
  | 'ko'
  | 'ja'
  | 'ar'
  | 'zh-TW'
  | 'en'
  | 'fr'
  | 'es'
  | 'pt'
  | 'unknown'

type ScriptCounts = {
  hangul: number
  kana: number
  han: number
  arabic: number
}

function countScripts(text: string): ScriptCounts {
  const counts: ScriptCounts = { hangul: 0, kana: 0, han: 0, arabic: 0 }

  for (const ch of text) {
    const code = ch.codePointAt(0)
    if (code == null) continue

    if (
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0x1100 && code <= 0x11ff) ||
      (code >= 0x3130 && code <= 0x318f)
    ) {
      counts.hangul++
    } else if (
      (code >= 0x3040 && code <= 0x309f) ||
      (code >= 0x30a0 && code <= 0x30ff)
    ) {
      counts.kana++
    } else if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0xf900 && code <= 0xfaff)
    ) {
      counts.han++
    } else if (
      (code >= 0x0600 && code <= 0x06ff) ||
      (code >= 0x0750 && code <= 0x077f) ||
      (code >= 0x08a0 && code <= 0x08ff) ||
      (code >= 0xfb50 && code <= 0xfdff) ||
      (code >= 0xfe70 && code <= 0xfeff)
    ) {
      counts.arabic++
    }
  }

  return counts
}

/**
 * Script-based detection (matches ui-labels.detectQuestionLocale). Returns null
 * for Latin-script or empty text, where character analysis is inconclusive.
 */
function detectFromScript(question: string): PromptLanguageCode | null {
  const text = question.trim()
  if (!text) return null

  const { hangul, kana, han, arabic } = countScripts(text)
  const significant = hangul + kana + han + arabic
  if (significant === 0) return null

  if (hangul > 0 && hangul >= kana && hangul >= han) return 'ko'
  if (kana > 0) return 'ja'
  if (arabic > 0 && arabic >= hangul + kana + han) return 'ar'
  if (han > 0 && kana === 0) return 'zh-TW'

  return null
}

/** Forceful, language-specific instruction injected near the end of system prompts. */
const INSTRUCTION_BY_CODE: Record<PromptLanguageCode, string> = {
  ko: 'CRITICAL LANGUAGE RULE: You MUST write your ENTIRE response in Korean (한국어) only. Do NOT use Japanese, English, Chinese, or any other language anywhere in your response — not even a single word or phrase.',
  ja: 'CRITICAL LANGUAGE RULE: You MUST write your ENTIRE response in Japanese (日本語) only. Do NOT use Korean, English, Chinese, or any other language anywhere.',
  ar: 'CRITICAL LANGUAGE RULE: You MUST write your ENTIRE response in Modern Standard Arabic (الفصحى) only. Do NOT use any regional dialect (no Egyptian/Levantine/Gulf colloquialisms). Do NOT use English or any other language anywhere.',
  'zh-TW':
    'CRITICAL LANGUAGE RULE: You MUST write your ENTIRE response in Traditional Chinese (繁體中文) only. Do NOT use Simplified Chinese, English, Japanese, or any other language anywhere.',
  en: 'CRITICAL LANGUAGE RULE: You MUST write your ENTIRE response in English only.',
  fr: 'CRITICAL LANGUAGE RULE: You MUST write your ENTIRE response in French (français) only. Do NOT use English or any other language anywhere.',
  es: 'CRITICAL LANGUAGE RULE: You MUST write your ENTIRE response in Spanish (español) only. Do NOT use English or any other language anywhere.',
  pt: 'CRITICAL LANGUAGE RULE: You MUST write your ENTIRE response in Portuguese (português) only. Do NOT use English or any other language anywhere.',
  unknown:
    'CRITICAL LANGUAGE RULE: Write your ENTIRE response in the SAME language as the question. Do not mix languages. Do not switch languages partway through.',
}

/**
 * Detect the question's language and return both the code and the explicit
 * instruction to inject into SYNOD system prompts.
 *
 * Primary signal is the question script (reliable for ko/ja/ar/zh-TW — exactly
 * the reported bugs). For Latin-script questions, falls back to `uiLocale` when
 * provided, otherwise 'unknown' (generic same-language rule).
 */
export function detectPromptLanguage(
  question: string,
  uiLocale?: string | null
): { code: PromptLanguageCode; instruction: string } {
  const scripted = detectFromScript(question)
  let code: PromptLanguageCode
  if (scripted) {
    code = scripted
  } else if (uiLocale != null && uiLocale.trim()) {
    code = normalizeUiLocale(uiLocale)
  } else {
    code = 'unknown'
  }
  return { code, instruction: INSTRUCTION_BY_CODE[code] }
}
