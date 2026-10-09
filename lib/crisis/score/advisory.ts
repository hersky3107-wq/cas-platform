import { ADVISORY } from './thresholds'

export interface AdvisorySide {
  level: number
}

/**
 * Missing data is never divergence.
 * True only when both US and UK have a level and they differ by at least 2,
 * or exactly one of them changed in the last 72 h while the other has data and did not.
 */
export function advisoryPairDiverges(opts: {
  us: AdvisorySide | null
  uk: AdvisorySide | null
  usChanged: boolean
  ukChanged: boolean
}): boolean {
  if (!opts.us || !opts.uk) return false
  if (!Number.isFinite(opts.us.level) || !Number.isFinite(opts.uk.level)) return false
  if (Math.abs(opts.us.level - opts.uk.level) >= 2) return true
  if (opts.usChanged && !opts.ukChanged) return true
  if (opts.ukChanged && !opts.usChanged) return true
  return false
}

export function advisoryChangeValue(): number {
  return ADVISORY.changeValue
}
