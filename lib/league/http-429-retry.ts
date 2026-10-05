/**
 * One 429 retry for every league seat. Honors Retry-After, capped at 30s,
 * and only waits when the leftover tick budget can still cover the wait.
 */

export const RETRY_AFTER_CAP_MS = 30_000

export function parseRetryAfterMs(raw: string | null | undefined, nowMs: number = Date.now()): number | null {
  if (!raw || !raw.trim()) return null
  const trimmed = raw.trim()
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const sec = Number(trimmed)
    return Number.isFinite(sec) && sec >= 0 ? Math.round(sec * 1000) : null
  }
  const dateMs = Date.parse(trimmed)
  if (!Number.isNaN(dateMs)) {
    const diff = dateMs - nowMs
    return diff > 0 ? diff : 0
  }
  return null
}

/** Pull Retry-After from an error string (`retry-after=12` or `Retry-After: Wed…`). */
export function retryAfterFromError(message: string | null | undefined, nowMs: number = Date.now()): number | null {
  if (!message) return null
  const tagged = message.match(/retry-after\s*[:=]\s*([^\s;,]+)/i)
  if (tagged?.[1]) return parseRetryAfterMs(tagged[1], nowMs)
  const header = message.match(/retry-after\s+([^\s;,]+)/i)
  if (header?.[1]) return parseRetryAfterMs(header[1], nowMs)
  return null
}

export function isHttp429Message(message: string | null | undefined): boolean {
  if (!message) return false
  const lower = message.toLowerCase()
  return lower.includes('429') || lower.includes('rate limit') || lower.includes('too many requests')
}

export function cappedRetryAfterMs(rawMs: number | null): number {
  if (rawMs == null || !Number.isFinite(rawMs) || rawMs < 0) return 0
  return Math.min(Math.round(rawMs), RETRY_AFTER_CAP_MS)
}

export function canHonor429Retry(args: {
  waitMs: number
  remainingBudgetMs?: number | null
}): boolean {
  const wait = Math.max(0, args.waitMs)
  if (args.remainingBudgetMs == null) return true
  return args.remainingBudgetMs > wait
}

export function plan429Retry(args: {
  error: string | null | undefined
  remainingBudgetMs?: number | null
  nowMs?: number
}): { retry: boolean; waitMs: number } {
  if (!isHttp429Message(args.error)) return { retry: false, waitMs: 0 }
  const waitMs = cappedRetryAfterMs(retryAfterFromError(args.error, args.nowMs ?? Date.now()))
  return { retry: canHonor429Retry({ waitMs, remainingBudgetMs: args.remainingBudgetMs }), waitMs }
}

export function httpErrorWithRetryAfter(
  res: { status: number; statusText: string; headers: { get(name: string): string | null } },
  body?: string,
): string {
  const retryAfter = res.headers.get('retry-after')
  const tagged = retryAfter ? `; retry-after=${retryAfter.trim()}` : ''
  const bodyBit = body ? ` - ${body}` : ''
  return `HTTP ${res.status} ${res.statusText}${tagged}${bodyBit}`
}

export async function waitThenRetry429<T>(args: {
  first: T
  errorOf: (value: T) => string | null | undefined
  retry: () => Promise<T>
  remainingBudgetMs?: number | null
  sleep?: (ms: number) => Promise<void>
  nowMs?: number
  log?: (line: string) => void
  label?: string
}): Promise<T> {
  const plan = plan429Retry({
    error: args.errorOf(args.first),
    remainingBudgetMs: args.remainingBudgetMs,
    nowMs: args.nowMs,
  })
  if (!plan.retry) return args.first
  const line = `[league-generate] 429 retry${args.label ? ` model=${args.label}` : ''} wait_ms=${plan.waitMs}`
  ;(args.log ?? console.log)(line)
  if (plan.waitMs > 0) {
    const sleep = args.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
    await sleep(plan.waitMs)
  }
  return args.retry()
}
