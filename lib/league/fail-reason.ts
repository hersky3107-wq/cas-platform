/**
 * Machine codes stored on `model_predictions.fail_reason` when direction is
 * null. Never the provider body, never secrets — only these tokens.
 */

export const NO_ANSWER_FAIL_REASONS = [
  'timeout',
  'empty_content',
  'unparseable',
  'reasoning_leak',
  'rate_limited',
] as const

export type HttpFailReason = `http_4xx:${number}` | `http_5xx:${number}`
export type NoAnswerFailReason = (typeof NO_ANSWER_FAIL_REASONS)[number] | HttpFailReason

const HTTP_STATUS = /\bHTTP\s+(\d{3})\b/i

export function extractHttpStatus(error: string): number | null {
  const match = error.match(HTTP_STATUS)
  if (!match) return null
  const code = Number(match[1])
  return Number.isInteger(code) && code >= 100 && code <= 599 ? code : null
}

export function classifyNoAnswerFailReason(input: {
  error?: string | null
  parseFailure?: 'reasoning_leak' | 'unparseable' | null
}): NoAnswerFailReason {
  if (input.parseFailure === 'reasoning_leak') return 'reasoning_leak'
  const err = (input.error ?? '').trim()
  if (err) {
    const lower = err.toLowerCase()
    if (lower.includes('message.content was empty') || lower.includes('empty message.content')) {
      return 'empty_content'
    }
    if (lower.includes('timeout') || lower.includes('aborterror') || lower.includes('etimedout')) {
      return 'timeout'
    }
    if (/\b429\b/.test(err) || lower.includes('rate limit')) return 'rate_limited'
    const http = extractHttpStatus(err)
    if (http !== null) {
      if (http >= 400 && http < 500) return `http_4xx:${http}`
      if (http >= 500 && http < 600) return `http_5xx:${http}`
    }
  }
  return 'unparseable'
}
