import type { ElectionCandidateLite } from './markets'

const TTL_MS = 15 * 60 * 1000

let cached: { at: number; rows: ElectionCandidateLite[] } | null = null

export function readPoliticsSlateCache(nowMs = Date.now()): ElectionCandidateLite[] | null {
  if (!cached) return null
  if (nowMs - cached.at > TTL_MS) return null
  return cached.rows
}

export function writePoliticsSlateCache(rows: ElectionCandidateLite[], nowMs = Date.now()): void {
  cached = { at: nowMs, rows }
}

export function clearPoliticsSlateCache(): void {
  cached = null
}
