/** Detect CJK from user question / input text (same heuristics as Arena). */
export function detectOraclePromptLanguage(text: string): 'Korean' | 'Japanese' | 'Chinese' | null {
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

export function buildOracleLanguageOverride(languageSourceText: string): string {
  const lang = detectOraclePromptLanguage(languageSourceText)
  if (!lang) return ''
  return `[ABSOLUTE LANGUAGE OVERRIDE] The user's input is written in ${lang}. You MUST write your ENTIRE response in ${lang}. This overrides all other language instructions. No exceptions.\n\n`
}

export function applyOracleLanguageToSystemPrompt(
  systemPrompt: string,
  languageSourceText: string
): string {
  const prefix = buildOracleLanguageOverride(languageSourceText)
  return prefix ? `${prefix}${systemPrompt}` : systemPrompt
}
