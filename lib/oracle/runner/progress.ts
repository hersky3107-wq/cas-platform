/**
 * oracle_job_sessions.progress bookkeeping.
 *
 * Unit keys are prefixed so one progress object can carry both layers:
 * 'reading:saju', 'verdict:archivist'. The keys accumulate across layers —
 * a client polling at layer 2 can still see which systems were 결번.
 *
 * `failed` means "produced no output": an unreadable computation, a provider
 * error, or a timeout. All three are 결번 and none of them fail the session.
 */
import type { OracleJobProgress } from '../schema'

export const READING_UNIT_PREFIX = 'reading:'
export const VERDICT_UNIT_PREFIX = 'verdict:'

export function readingUnit(system: string): string {
  return `${READING_UNIT_PREFIX}${system}`
}

export function verdictUnit(readerSlug: string): string {
  return `${VERDICT_UNIT_PREFIX}${readerSlug}`
}

export type ParsedUnit = { kind: 'reading' | 'verdict'; id: string }

export function parseUnit(key: string): ParsedUnit | null {
  if (key.startsWith(READING_UNIT_PREFIX)) {
    return { kind: 'reading', id: key.slice(READING_UNIT_PREFIX.length) }
  }
  if (key.startsWith(VERDICT_UNIT_PREFIX)) {
    return { kind: 'verdict', id: key.slice(VERDICT_UNIT_PREFIX.length) }
  }
  return null
}

export function emptyProgress(): OracleJobProgress {
  return { done: [], pending: [], failed: [] }
}

/**
 * Every unit the session intends to produce, listed up front so the client
 * can render a complete progress bar from the first poll.
 */
export function initialProgress(systems: readonly string[], readers: readonly string[]): OracleJobProgress {
  return {
    done: [],
    pending: [...systems.map(readingUnit), ...readers.map(verdictUnit)],
    failed: [],
  }
}

function without(list: readonly string[], unit: string): string[] {
  return list.filter((entry) => entry !== unit)
}

function withUnit(list: readonly string[], unit: string): string[] {
  return list.includes(unit) ? [...list] : [...list, unit]
}

/** Idempotent: re-marking a unit that is already recorded changes nothing. */
export function markUnitDone(progress: OracleJobProgress, unit: string): OracleJobProgress {
  return {
    done: withUnit(progress.done, unit),
    pending: without(progress.pending, unit),
    failed: without(progress.failed, unit),
  }
}

/** Idempotent. A unit already in `done` is not demoted. */
export function markUnitFailed(progress: OracleJobProgress, unit: string): OracleJobProgress {
  if (progress.done.includes(unit)) {
    return { ...progress, pending: without(progress.pending, unit) }
  }
  return {
    done: [...progress.done],
    pending: without(progress.pending, unit),
    failed: withUnit(progress.failed, unit),
  }
}

export function progressCounts(progress: OracleJobProgress): {
  done: number
  pending: number
  failed: number
  total: number
} {
  const done = progress.done.length
  const pending = progress.pending.length
  const failed = progress.failed.length
  return { done, pending, failed, total: done + pending + failed }
}
