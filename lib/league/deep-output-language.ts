/**
 * League-owned output-language lock for deep-open / deep-debate hops.
 * Isolated from lib/motie/output-language so the AX track keeps its own ALS.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { LEAGUE_LOCALES, type LeagueLocale } from './i18n/locales'

export const OUTPUT_LANGUAGE_NAME: Record<LeagueLocale, string> = {
  en: 'English',
  ko: 'Korean',
  ja: 'Japanese',
  'zh-TW': 'Traditional Chinese',
  fr: 'French',
  ar: 'Arabic',
  es: 'Spanish',
  pt: 'Portuguese',
}

const NAME_TO_LOCALE: Record<string, LeagueLocale> = Object.fromEntries(
  (Object.entries(OUTPUT_LANGUAGE_NAME) as [LeagueLocale, string][]).map(([locale, name]) => [name, locale]),
) as Record<string, LeagueLocale>

const LANGUAGE_DIRECTIVES: Record<LeagueLocale, string> = {
  ko: '언어 규칙(매우 중요): 출력은 100% 깨끗한 표준 한국어여야 합니다. 고유명사·티커만 원문을 허용합니다.',
  en: 'Language rule (mandatory): the output must be 100% clean, natural English. Proper nouns and tickers may stay in their original form.',
  ja: '言語ルール（必須）: 出力は100%自然な日本語でなければなりません。固有名詞・ティッカー以外は日本語で書いてください。',
  'zh-TW': '語言規則（必須）: 輸出必須是 100% 通順的繁體中文。專有名詞與代碼可保留原文。',
  fr: 'Règle de langue (obligatoire) : la sortie doit être intégralement en français naturel. Les noms propres et tickers peuvent rester dans leur forme d’origine.',
  ar: 'قاعدة اللغة (إلزامية): يجب أن يكون الناتج عربيًا فصيحًا بنسبة 100%. يجوز الإبقاء على الأسماء والرموز كما هي.',
  es: 'Regla de idioma (obligatoria): la salida debe ser 100% español natural. Los nombres propios y tickers pueden quedar en su forma original.',
  pt: 'Regra de idioma (obrigatória): a saída deve ser 100% português natural. Nomes próprios e tickers podem permanecer na forma original.',
}

const als = new AsyncLocalStorage<LeagueLocale>()

export function getOutputLanguage(): LeagueLocale {
  return als.getStore() ?? 'en'
}

export function activeLanguageDirective(): string {
  return LANGUAGE_DIRECTIVES[getOutputLanguage()]
}

export function runWithOutputLanguage<T>(locale: LeagueLocale, fn: () => Promise<T>): Promise<T> {
  return als.run(locale, fn)
}

export function isLeagueLocale(value: string): value is LeagueLocale {
  return (LEAGUE_LOCALES as readonly string[]).includes(value)
}

export function localeFromWriteInLine(question: string): LeagueLocale | null {
  const match = question.match(/^Write in ([^.]+)\./m)
  if (!match) return null
  return NAME_TO_LOCALE[match[1]!] ?? null
}

export function localeFromPersistedState(state: {
  outputLanguage?: unknown
  question?: unknown
}): LeagueLocale {
  if (typeof state.outputLanguage === 'string' && isLeagueLocale(state.outputLanguage)) {
    return state.outputLanguage
  }
  if (typeof state.question === 'string') {
    return localeFromWriteInLine(state.question) ?? 'en'
  }
  return 'en'
}
