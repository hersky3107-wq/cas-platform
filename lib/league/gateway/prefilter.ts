/**
 * Layer-0 junk filters. Run BEFORE any model call. A reject here must use
 * the same refusal envelope as a post-normalize refusal so probing cannot
 * tell "filtered cheaply" from "normalized and refused".
 */

export const MIN_RAW_CHARS = 4
export const MAX_RAW_CHARS = 200

const HAS_WORD = /[A-Za-z0-9\uAC00-\uD7A3]/
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/
const URL = /https?:\/\/\S+|www\.\S+/gi
const REPEATED_RUN = /(.)\1{9,}/u

export function normalizeCacheText(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function prefilterRejects(rawText: string): boolean {
  const text = rawText.trim()
  if (text.length < MIN_RAW_CHARS || text.length > MAX_RAW_CHARS) return true
  if (!HAS_WORD.test(text)) return true
  if (CONTROL.test(text)) return true
  const withoutUrls = text.replace(URL, '').trim()
  if (!HAS_WORD.test(withoutUrls)) return true
  if (REPEATED_RUN.test(text)) return true
  const compact = text.replace(/\s/g, '')
  if (compact.length >= 8 && majorityCharRatio(compact) >= 0.85) return true
  return false
}

function majorityCharRatio(compact: string): number {
  const counts = new Map<string, number>()
  let max = 0
  for (const ch of compact) {
    const n = (counts.get(ch) ?? 0) + 1
    counts.set(ch, n)
    if (n > max) max = n
  }
  return max / compact.length
}
