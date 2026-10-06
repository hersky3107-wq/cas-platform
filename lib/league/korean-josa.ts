/**
 * Korean particles follow the last syllable's batchim (받침) only when that
 * syllable is Hangul. Latin, digit, or symbol endings keep the template's
 * default particle (가/를/는/와) and are never rewritten.
 */

const WITH_BATCHIM: Record<string, string> = { 이: '이', 가: '이', 을: '을', 를: '을', 은: '은', 는: '은', 와: '과', 과: '과' }
const WITHOUT_BATCHIM: Record<string, string> = { 이: '가', 가: '가', 을: '를', 를: '를', 은: '는', 는: '는', 와: '와', 과: '와' }

function lastChar(text: string): string | undefined {
  const chars = Array.from(text.trimEnd())
  return chars[chars.length - 1]
}

function hangulCode(ch: string | undefined): number | null {
  if (!ch) return null
  const code = ch.charCodeAt(0) - 0xac00
  return code >= 0 && code <= 11171 ? code : null
}

export function endsWithHangul(text: string): boolean {
  return hangulCode(lastChar(text)) != null
}

export function hasBatchim(text: string): boolean {
  const code = hangulCode(lastChar(text))
  return code != null && code % 28 !== 0
}

export function josa(word: string, pair: '이/가' | '을/를' | '은/는' | '와/과'): string {
  const [withBatchim, without] = pair.split('/')
  if (!endsWithHangul(word)) return without!
  return hasBatchim(word) ? withBatchim! : without!
}

/** Correct a particle already attached to the preceding Hangul word. Idempotent. Latin/digit/symbol endings are left alone. */
export function fixKoreanJosa(text: string): string {
  if (!/[가-힣]/.test(text)) return text
  return text.replace(/([가-힣]+)(이|가|을|를|은|는|와|과)(?=의|[^가-힣]|$)/g, (full, word: string, particle: string) => {
    if (!endsWithHangul(word)) return full
    const next = hasBatchim(word) ? WITH_BATCHIM[particle] : WITHOUT_BATCHIM[particle]
    return next && next !== particle ? `${word}${next}` : full
  })
}
