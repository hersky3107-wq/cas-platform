/**
 * Korean particles follow the last Hangul syllable's batchim (받침).
 * 이/을/은/과 when there is a final consonant, 가/를/는/와 when there isn't.
 * A non-Hangul tail (GPU, 2026) does not count: the last Hangul syllable decides.
 */

const WITH_BATCHIM: Record<string, string> = { 이: '이', 가: '이', 을: '을', 를: '을', 은: '은', 는: '은', 와: '과', 과: '과' }
const WITHOUT_BATCHIM: Record<string, string> = { 이: '가', 가: '가', 을: '를', 를: '를', 은: '는', 는: '는', 와: '와', 과: '와' }

export function hasBatchim(text: string): boolean {
  const chars = Array.from(text)
  for (let i = chars.length - 1; i >= 0; i--) {
    const code = chars[i]!.charCodeAt(0) - 0xac00
    if (code < 0 || code > 11171) continue
    return code % 28 !== 0
  }
  return false
}

export function josa(word: string, pair: '이/가' | '을/를' | '은/는' | '와/과'): string {
  const [withBatchim, without] = pair.split('/')
  return hasBatchim(word) ? withBatchim! : without!
}

/** Correct a particle already attached to the preceding Hangul word. Idempotent. */
export function fixKoreanJosa(text: string): string {
  if (!/[가-힣]/.test(text)) return text
  return text.replace(/([가-힣]+)(이|가|을|를|은|는|와|과)(?=의|[^가-힣]|$)/g, (full, word: string, particle: string) => {
    const next = hasBatchim(word) ? WITH_BATCHIM[particle] : WITHOUT_BATCHIM[particle]
    return next && next !== particle ? `${word}${next}` : full
  })
}
