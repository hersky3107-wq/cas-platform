/**
 * Pure helpers for the free pre-charge normalize path.
 *
 * Quota units: a cache miss on a fresh prompt costs 1; a cache miss that is
 * a clarification follow-up costs 0.5; cache hits cost 0.
 * Circuit counts only real LLM (or search) calls, never cache hits.
 */
import { createHash } from 'node:crypto'
import { normalizeCacheText } from './prefilter'

export const NORMALIZE_DAILY_QUOTA = 20
export const NORMALIZE_CIRCUIT_MAX = 2000
export const SEARCH_CIRCUIT_MAX = 400
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000

export function utcDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

export function normalizeCacheKey(categoryId: string, rawText: string, locale: string): string {
  const payload = `${categoryId}\n${normalizeCacheText(rawText)}\n${locale}`
  return createHash('sha256').update(payload, 'utf8').digest('hex')
}

export function quotaUnitsFor(opts: { cacheHit: boolean; isClarification: boolean }): number {
  if (opts.cacheHit) return 0
  return opts.isClarification ? 0.5 : 1
}

export function quotaWouldBreach(used: number, add: number, cap: number = NORMALIZE_DAILY_QUOTA): boolean {
  return used + add > cap + 1e-9
}
