import type { TouristLocale } from './tourist-labels'

/**
 * Shared AI-output locale helper for Jeju tourist engines.
 *
 * The tourist UI chrome is translated via tourist-labels.ts; this module governs
 * the language of AI-GENERATED content (course intros, place descriptions, tips).
 * The same 5 locales as the UI. Korean is the default and exact-prior behavior.
 *
 * Pure module (no server-only / client-only) so engines and routes can import it.
 *
 * LANGUAGE ENFORCEMENT: models (especially Perplexity sonar, which reads Korean
 * sources) tend to leak Korean into non-Korean output. The directives below are
 * deliberately forceful and are written IN the target language; engines sandwich
 * them (top of prompt + reminder at the end) to maximize compliance.
 */

export type AiLocale = TouristLocale

const AI_LOCALES: readonly AiLocale[] = ['ko', 'en', 'ja', 'zh-TW', 'zh-CN']

/** Normalize an arbitrary request value to a supported AI locale (default 'ko'). */
export function normalizeAiLocale(value: unknown): AiLocale {
  if (typeof value !== 'string') return 'ko'
  const v = value.trim()
  return (AI_LOCALES as readonly string[]).includes(v) ? (v as AiLocale) : 'ko'
}

/** Human-readable target-language name, used in translation instructions. */
export function languageName(locale: AiLocale): string {
  switch (locale) {
    case 'en':
      return 'English'
    case 'ja':
      return 'Japanese (日本語)'
    case 'zh-TW':
      return 'Traditional Chinese (繁體中文)'
    case 'zh-CN':
      return 'Simplified Chinese (简体中文)'
    case 'ko':
    default:
      return 'Korean (한국어)'
  }
}

/**
 * Strong top-of-prompt language directive, written IN the target language.
 *
 * For non-Korean locales it forbids mixing languages and confines Korean to
 * proper nouns (place / oreum / restaurant / festival / café names), kept in
 * their original Korean with a short romanization/translation in parentheses on
 * first mention — so a foreigner sees "성산일출봉 (Seongsan Ilchulbong)".
 */
export function languageDirective(locale: AiLocale): string {
  switch (locale) {
    case 'en':
      return [
        'CRITICAL LANGUAGE RULE — OUTPUT LANGUAGE = ENGLISH.',
        '- Write EVERY sentence, description, concept, tip and field value in English ONLY.',
        '- Do NOT write any sentence in Korean. Mixing languages within a single response is FORBIDDEN.',
        '- The ONLY Korean allowed is proper nouns (place / oreum / restaurant / festival / café names): keep them in their original Korean and add a short romanization or English gloss in parentheses on first mention — e.g. "성산일출봉 (Seongsan Ilchulbong)", "올레시장 (Olle Market)".',
        '- If you catch yourself writing a Korean sentence, STOP and rewrite it in English.',
      ].join('\n')
    case 'ja':
      return [
        '重要な言語ルール — 出力言語＝日本語。',
        '・すべての文・説明・コンセプト・ヒント・フィールド値を必ず日本語のみで書いてください。',
        '・韓国語の文を書いてはいけません。1つの回答の中で言語を混在させることは固く禁止します。',
        '・韓国語のまま残してよいのは固有名詞（地名・オルム・店名・祭り・カフェ名）だけです。元の韓国語を残し、初出時にカッコ内へ簡単な読み仮名または日本語訳を添えてください（例：「성산일출봉（城山日出峰／ソンサンイルチュルボン）」）。',
        '・もし韓国語の文を書きそうになったら、すぐに止めて日本語で書き直してください。',
      ].join('\n')
    case 'zh-TW':
      return [
        '重要語言規則 — 輸出語言＝繁體中文。',
        '・所有句子、說明、概念、提示與欄位內容都必須只用繁體中文書寫。',
        '・禁止寫任何韓文句子。在同一則回覆中混用語言是絕對禁止的。',
        '・唯一可以保留韓文的是專有名詞（地名、火山錐 oreum、餐廳、慶典、咖啡廳名稱）：保留原始韓文，並在首次出現時於括號內加上簡短的中文翻譯或拼音（例：「성산일출봉（城山日出峰）」）。',
        '・若發現自己正在寫韓文句子，請立即停止並改寫成繁體中文。',
      ].join('\n')
    case 'zh-CN':
      return [
        '重要语言规则 — 输出语言＝简体中文。',
        '・所有句子、说明、概念、提示与字段内容都必须只用简体中文书写。',
        '・禁止写任何韩文句子。在同一条回复中混用语言是绝对禁止的。',
        '・唯一可以保留韩文的是专有名词（地名、火山锥 oreum、餐厅、庆典、咖啡馆名称）：保留原始韩文，并在首次出现时于括号内加上简短的中文翻译或拼音（例："성산일출봉（城山日出峰）"）。',
        '・若发现自己正在写韩文句子，请立即停止并改写成简体中文。',
      ].join('\n')
    case 'ko':
    default:
      return '모든 설명·소개·컨셉·팁을 자연스러운 한국어로 작성하세요.'
  }
}

/**
 * EXTRA directive for Perplexity sonar engines, which search/read Korean-language
 * sources and are the worst offenders for echoing Korean. Empty for Korean.
 */
export function sonarLanguageDirective(locale: AiLocale): string {
  switch (locale) {
    case 'en':
      return 'SOURCE NOTE: you are searching and reading Korean-language web sources. You MUST TRANSLATE every finding into English. The output language is English regardless of the source language — only proper nouns stay Korean (with romanization). Never copy Korean sentences from the sources.'
    case 'ja':
      return '出典に関する注意：あなたは韓国語のウェブ情報を検索・参照しています。見つけた内容はすべて日本語に翻訳して出力してください。出力言語は情報源の言語に関わらず日本語です。固有名詞だけ韓国語のまま（読み仮名付き）残します。韓国語の文をそのままコピーしないでください。'
    case 'zh-TW':
      return '資料來源提醒：你正在搜尋並閱讀韓文網路資料。你必須將所有發現翻譯成繁體中文輸出。無論來源語言為何，輸出語言一律為繁體中文，只有專有名詞保留韓文（附拼音）。請勿直接複製韓文句子。'
    case 'zh-CN':
      return '资料来源提醒：你正在搜索并阅读韩文网络资料。你必须将所有发现翻译成简体中文输出。无论来源语言为何，输出语言一律为简体中文，只有专有名词保留韩文（附拼音）。请勿直接复制韩文句子。'
    case 'ko':
    default:
      return ''
  }
}

/**
 * Short closing reinforcement, placed at the END of the system prompt. Sandwiching
 * the rule (top + bottom) materially improves compliance. Empty for Korean so the
 * Korean prompt is unchanged.
 */
export function languageReminder(locale: AiLocale): string {
  switch (locale) {
    case 'en':
      return 'REMINDER: your entire answer must be in English. No Korean sentences — only proper nouns may stay Korean (with romanization).'
    case 'ja':
      return '再確認：回答全体を必ず日本語で書いてください。韓国語の文は禁止です（固有名詞のみ韓国語可・読み仮名付き）。'
    case 'zh-TW':
      return '再次提醒：整份回覆必須使用繁體中文，禁止任何韓文句子（僅專有名詞可保留韓文，附拼音）。'
    case 'zh-CN':
      return '再次提醒：整份回复必须使用简体中文，禁止任何韩文句子（仅专有名词可保留韩文，附拼音）。'
    case 'ko':
    default:
      return ''
  }
}

/**
 * Lightweight guard: is `text` predominantly Korean (Hangul) once parenthesized
 * proper-noun glosses are stripped? Used to log a warning when a non-Korean
 * locale comes back mostly Korean. Intentionally cheap; NOT a hard validator.
 */
export function isPredominantlyKorean(text: string): boolean {
  if (!text) return false
  // Drop parenthesized content — that's where preserved Korean proper nouns live.
  const stripped = text.replace(/[（(][^（）()]*[）)]/g, ' ')
  const hangul = (stripped.match(/[\uAC00-\uD7A3]/g) ?? []).length
  // "Meaningful" letters: Hangul + Kana + CJK ideographs + Latin.
  const letters = (
    stripped.match(/[\uAC00-\uD7A3\u3040-\u30FF\u4E00-\u9FFFA-Za-z]/g) ?? []
  ).length
  if (letters < 20) return false
  return hangul / letters > 0.5
}

/**
 * Logs a warning (no retry — too costly) when a non-Korean locale produces output
 * that is predominantly Korean, so language leakage is diagnosable in logs.
 */
export function warnIfWrongLanguage(text: string, locale: AiLocale, context: string): void {
  if (locale === 'ko') return
  if (isPredominantlyKorean(text)) {
    console.warn(
      `[ai-locale] ${context}: requested locale "${locale}" but output looks predominantly Korean — possible language leakage.`
    )
  }
}
