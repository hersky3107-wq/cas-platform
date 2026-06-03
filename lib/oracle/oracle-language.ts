export type OracleCjkLanguage = 'Korean' | 'Japanese' | 'Chinese'

export type OracleLanguageLocaleOptions = {
  acceptLanguage?: string | null
  userMetadata?: Record<string, unknown> | null
}

/** Detect CJK from user question / input text (same heuristics as Arena). */
export function detectOraclePromptLanguage(text: string): OracleCjkLanguage | null {
  const t = text.trim()
  if (!t) return null
  const hasKorean = /[\uAC00-\uD7AF]/.test(t)
  const hasJapanese = /[\u3040-\u309F\u30A0-\u30FF]/.test(t)
  const hasChinese = /[\u4E00-\u9FFF]/.test(t) && !hasJapanese && !hasKorean
  if (hasKorean) return 'Korean'
  if (hasJapanese) return 'Japanese'
  if (hasChinese) return 'Chinese'
  return null
}

function cjkLanguageFromLocaleTag(tag: string): OracleCjkLanguage | null {
  const normalized = tag.trim().toLowerCase().replace('_', '-')
  if (!normalized) return null
  if (normalized.startsWith('ko')) return 'Korean'
  if (normalized.startsWith('ja')) return 'Japanese'
  if (normalized.startsWith('zh')) return 'Chinese'
  return null
}

/** Parse Accept-Language (e.g. "ko-KR,ko;q=0.9,en;q=0.8") for preferred CJK locale. */
export function detectOracleLanguageFromAcceptLanguage(
  acceptLanguageHeader: string | null | undefined
): OracleCjkLanguage | null {
  if (!acceptLanguageHeader?.trim()) return null
  const tags = acceptLanguageHeader
    .split(',')
    .map((part) => part.trim().split(';')[0]?.trim() ?? '')
    .filter(Boolean)
  for (const tag of tags) {
    const lang = cjkLanguageFromLocaleTag(tag)
    if (lang) return lang
  }
  return null
}

/** User metadata locale / language fields from auth profile (e.g. Supabase user_metadata). */
export function detectOracleLanguageFromUserMetadata(
  metadata: Record<string, unknown> | null | undefined
): OracleCjkLanguage | null {
  if (!metadata) return null
  const candidates = [metadata.locale, metadata.language, metadata.preferred_language]
  for (const value of candidates) {
    if (typeof value !== 'string' || !value.trim()) continue
    const lang = cjkLanguageFromLocaleTag(value)
    if (lang) return lang
  }
  return null
}

export function resolveOracleCjkLanguage(
  languageSourceText: string,
  options?: OracleLanguageLocaleOptions
): OracleCjkLanguage | null {
  const fromHeader = detectOracleLanguageFromAcceptLanguage(options?.acceptLanguage)
  if (fromHeader) return fromHeader
  const fromMeta = detectOracleLanguageFromUserMetadata(options?.userMetadata)
  if (fromMeta) return fromMeta
  return detectOraclePromptLanguage(languageSourceText)
}

export function buildOracleLanguageOverride(
  languageSourceText: string,
  options?: OracleLanguageLocaleOptions
): string {
  const lang = resolveOracleCjkLanguage(languageSourceText, options)
  if (!lang) return ''
  return `[ABSOLUTE LANGUAGE OVERRIDE] The user's input is written in ${lang}. You MUST write your ENTIRE response in ${lang}. This overrides all other language instructions. No exceptions.\n\n`
}

export function applyOracleLanguageToSystemPrompt(
  systemPrompt: string,
  languageSourceText: string,
  options?: OracleLanguageLocaleOptions
): string {
  const prefix = buildOracleLanguageOverride(languageSourceText, options)
  return prefix ? `${prefix}${systemPrompt}` : systemPrompt
}
