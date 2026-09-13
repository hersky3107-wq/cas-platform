import { AsyncLocalStorage } from 'node:async_hooks'
import { LEAGUE_LOCALES, type LeagueLocale } from '@/lib/league/i18n/locales'

/**
 * Output-language lock for MOTIE / Jeju-style pipelines.
 *
 * Jeju and MOTIE prompts historically hardcoded Korean. League deep-analysis
 * reuses those pipelines with `councilMode: 'warroom'` and only prepended
 * "Write in English." to the user question — the system-prompt Korean lock
 * won, so a paid English session answered in Korean.
 *
 * League advances wrap each hop in `runWithOutputLanguage`. When the ALS
 * store is empty (Jeju / MOTIE / diagnostic), the Korean lock stays the
 * default so those products do not change.
 */

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

/** Byte-identical to the historic MOTIE/Jeju system lock. */
export const KOREAN_ONLY_DIRECTIVE =
  '언어 규칙(매우 중요, 반드시 준수): 출력은 100% 깨끗한 표준 한국어여야 합니다. 중국어·일본어 한자나 다른 언어 글자, 혼종·오염 표기를 절대 섞지 마십시오(금지 예: "電気료", "商业용", "šte한", "스티엄", "경관계통"). 브랜드명 등 불가피한 고유명사를 제외하고는 한자·외국어 글자를 쓰지 말고, 모든 문장을 자연스러운 한국어로만 작성하십시오.'

const LANGUAGE_DIRECTIVES: Record<LeagueLocale, string> = {
  ko: KOREAN_ONLY_DIRECTIVE,
  en: 'Language rule (mandatory): the output must be 100% clean, natural English. Do not mix Chinese, Japanese, or other scripts, and do not produce hybrid or contaminated spellings. Proper nouns, tickers, and unavoidable brand names may stay in their original form. Write every sentence in English.',
  ja: '言語ルール（必須）: 出力は100%自然な日本語でなければなりません。中国語・韓国語・その他の文字を混ぜず、固有名詞・ティッカーなど避けられない原語表記以外はすべて日本語で書いてください。',
  'zh-TW': '語言規則（必須遵守）：輸出必須是 100% 通順的繁體中文。不要混入韓文、日文或其他文字；專有名詞與代碼可保留原文，其餘句子一律以繁體中文撰寫。',
  fr: 'Règle de langue (obligatoire) : la sortie doit être intégralement en français naturel. N’entremêlez pas d’autres écritures. Les noms propres, tickers et marques inévitables peuvent rester dans leur forme d’origine. Rédigez chaque phrase en français.',
  ar: 'قاعدة اللغة (إلزامية): يجب أن يكون الناتج عربيًا فصيحًا بنسبة 100%. لا تخلط أبجديات أخرى. يجوز الإبقاء على الأسماء التجارية والرموز كما هي. اكتب كل جملة بالعربية.',
  es: 'Regla de idioma (obligatoria): la salida debe ser 100% español natural. No mezcles otros sistemas de escritura. Los nombres propios, tickers y marcas inevitables pueden quedar en su forma original. Escribe cada frase en español.',
  pt: 'Regra de idioma (obrigatória): a saída deve ser 100% português natural. Não misture outros alfabetos. Nomes próprios, tickers e marcas inevitáveis podem permanecer na forma original. Escreva cada frase em português.',
}

const als = new AsyncLocalStorage<LeagueLocale>()

export function getOutputLanguage(): LeagueLocale {
  return als.getStore() ?? 'ko'
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

/** Recover a locale from a persisted pipeline row (field first, then "Write in X."). */
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

export function activePureLanguageRule(flavor: 'trade' | 'energy'): string {
  const locale = getOutputLanguage()
  if (locale === 'ko') {
    return flavor === 'trade'
      ? '언어 규칙(절대 준수): 결과를 반드시 순수 한국어로 작성하라. 한자(漢字)·중국어·일본어 문자를 절대 사용하지 말 것. 단 영어 약어(HS코드, FTA, USD, VAT 등), 숫자, 단위는 허용.'
      : '언어 규칙(절대 준수): 결과를 반드시 순수 한국어로 작성하라. 한자(漢字)·중국어·일본어 문자를 절대 사용하지 말 것. 단 영어 약어(WTI, Brent, LNG, OPEC, USD, bbl 등), 숫자, 단위는 허용.'
  }
  const name = OUTPUT_LANGUAGE_NAME[locale]
  const abbrev = flavor === 'trade' ? 'HS codes, FTA, USD, VAT' : 'WTI, Brent, LNG, OPEC, USD, bbl'
  return `Language rule (mandatory): write the result entirely in ${name}. Do not mix Chinese, Japanese, or other scripts. English abbreviations (${abbrev}), numbers, and units are allowed.`
}

/** Search-specialist "summarize in X" line. Korean bytes unchanged when ALS is unset or ko. */
export function activeSearchSummarizeLine(): string {
  const locale = getOutputLanguage()
  if (locale === 'ko') {
    return '주어진 질의에 대해 최신·신뢰할 수 있는 외부 정보를 찾아 핵심만 간결하게(200~350자) 한국어로 요약하세요.'
  }
  const name = OUTPUT_LANGUAGE_NAME[locale]
  return `Find the latest reliable external information for the given query and summarize only the essentials (200–350 characters) in ${name}.`
}

/** Energy flavor of the older "정리하라" search lock (deep.ts). */
export function activeSearchPureLanguageRule(flavor: 'trade' | 'energy'): string {
  const locale = getOutputLanguage()
  if (locale === 'ko') {
    return flavor === 'trade'
      ? '언어 규칙(절대 준수): 결과를 반드시 순수 한국어로 정리하라. 한자(漢字)·중국어·일본어 문자를 절대 사용하지 말 것. 단 영어 약어(HS코드, FTA, USD, VAT 등), 숫자, 단위는 허용.'
      : '언어 규칙(절대 준수): 결과를 반드시 순수 한국어로 정리하라. 한자(漢字)·중국어·일본어 문자를 절대 사용하지 말 것. 단 영어 약어(WTI, Brent, LNG, OPEC, USD, bbl 등), 숫자, 단위는 허용.'
  }
  return activePureLanguageRule(flavor)
}
