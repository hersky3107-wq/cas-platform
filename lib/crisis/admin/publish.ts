import type { EngineResult } from '../engine/schema'

/** Ledger publish uses headlines then missed_by_others, matching engine-publish. */
export function publishableIndices(result: Pick<EngineResult, 'headlines' | 'missed_by_others'> | null | undefined): number[] {
  if (!result) return []
  const n = (result.headlines?.length ?? 0) + (result.missed_by_others?.length ?? 0)
  return Array.from({ length: n }, (_, i) => i)
}
