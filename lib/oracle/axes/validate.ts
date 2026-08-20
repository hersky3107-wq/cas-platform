import { ELEMENT_AXES, PHASE_AXES, SYSTEM_IDS, TRAIT_AXES, type AxisVote, type SystemId } from './types'
import { sumValues } from './math'

const SUM_EPSILON = 1e-6
const RANGE_LO = -1e-6
const RANGE_HI = 100 + 1e-6

function isSystemId(value: string): value is SystemId {
  return (SYSTEM_IDS as readonly string[]).includes(value)
}

function recordInRange(values: number[]): boolean {
  return values.every((value) => Number.isFinite(value) && value >= RANGE_LO && value <= RANGE_HI)
}

function sumsTo100(values: number[]): boolean {
  return Math.abs(sumValues(values) - 100) < SUM_EPSILON
}

export type ValidationIssue = { path: string; message: string }

/**
 * Contract check for one vote. Returns an empty list when the vote is valid.
 * Used by tests; projectors must pass this on every real engine output.
 */
export function validateAxisVote(vote: AxisVote): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (!isSystemId(vote.system)) {
    issues.push({ path: 'system', message: `unknown system "${vote.system}"` })
  }
  if (typeof vote.engineVersion !== 'string' || vote.engineVersion.trim() === '') {
    issues.push({ path: 'engineVersion', message: 'engineVersion must be a non-empty string' })
  }

  if (vote.traits === null) {
    if (vote.confidence.traits !== null) {
      issues.push({ path: 'confidence.traits', message: 'null traits must have null confidence' })
    }
  } else {
    const values = TRAIT_AXES.map((axis) => vote.traits![axis])
    if (values.some((value) => value === undefined)) {
      issues.push({ path: 'traits', message: 'traits must include all 6 axes' })
    } else if (!recordInRange(values)) {
      issues.push({ path: 'traits', message: 'each trait must be a finite 0–100 number' })
    }
    if (vote.confidence.traits === null) {
      issues.push({ path: 'confidence.traits', message: 'readable traits must have confidence' })
    }
  }

  if (vote.elements === null) {
    if (vote.confidence.elements !== null) {
      issues.push({ path: 'confidence.elements', message: 'null elements must have null confidence' })
    }
  } else {
    const values = ELEMENT_AXES.map((axis) => vote.elements![axis])
    if (values.some((value) => value === undefined)) {
      issues.push({ path: 'elements', message: 'elements must include all 5 axes' })
    } else if (!recordInRange(values)) {
      issues.push({ path: 'elements', message: 'each element must be a finite 0–100 number' })
    } else if (!sumsTo100(values)) {
      issues.push({ path: 'elements', message: `elements must sum to 100 (got ${sumValues(values)})` })
    }
    if (vote.confidence.elements === null) {
      issues.push({ path: 'confidence.elements', message: 'readable elements must have confidence' })
    }
  }

  if (vote.phase === null) {
    if (vote.confidence.phase !== null) {
      issues.push({ path: 'confidence.phase', message: 'null phase must have null confidence' })
    }
  } else {
    const values = PHASE_AXES.map((axis) => vote.phase![axis])
    if (values.some((value) => value === undefined)) {
      issues.push({ path: 'phase', message: 'phase must include all 3 axes' })
    } else if (!recordInRange(values)) {
      issues.push({ path: 'phase', message: 'each phase must be a finite 0–100 number' })
    } else if (!sumsTo100(values)) {
      issues.push({ path: 'phase', message: `phase must sum to 100 (got ${sumValues(values)})` })
    }
    if (vote.confidence.phase === null) {
      issues.push({ path: 'confidence.phase', message: 'readable phase must have confidence' })
    }
  }

  for (const [space, conf] of [
    ['traits', vote.confidence.traits],
    ['elements', vote.confidence.elements],
    ['phase', vote.confidence.phase],
  ] as const) {
    if (!conf) continue
    if (conf.weight !== 1 && conf.weight !== 0.5) {
      issues.push({ path: `confidence.${space}.weight`, message: 'weight must be 1 or 0.5' })
    }
    if (conf.basis !== 'direct' && conf.basis !== 'derived' && conf.basis !== 'degraded') {
      issues.push({ path: `confidence.${space}.basis`, message: 'basis must be direct|derived|degraded' })
    }
    if (conf.basis === 'direct' && conf.weight !== 1) {
      issues.push({ path: `confidence.${space}`, message: 'direct basis must weigh 1' })
    }
    if ((conf.basis === 'derived' || conf.basis === 'degraded') && conf.weight !== 0.5) {
      issues.push({ path: `confidence.${space}`, message: 'derived/degraded basis must weigh 0.5' })
    }
    if (space === 'phase') {
      const phaseConf = conf as import('./types').PhaseSpaceConfidence
      if (
        phaseConf.timescale !== 'era' &&
        phaseConf.timescale !== 'annual' &&
        phaseConf.timescale !== 'daily' &&
        phaseConf.timescale !== 'draw'
      ) {
        issues.push({ path: 'confidence.phase.timescale', message: 'timescale must be era|annual|daily|draw' })
      }
    }
  }

  if (!Array.isArray(vote.unreadable)) {
    issues.push({ path: 'unreadable', message: 'unreadable must be an array' })
  } else {
    vote.unreadable.forEach((entry, index) => {
      if (entry.space !== 'traits' && entry.space !== 'elements' && entry.space !== 'phase') {
        issues.push({ path: `unreadable.${index}.space`, message: 'invalid space' })
      }
      if (typeof entry.code !== 'string' || entry.code.trim() === '') {
        issues.push({ path: `unreadable.${index}.code`, message: 'code must be a non-empty machine string' })
      }
    })
  }

  for (const space of ['traits', 'elements', 'phase'] as const) {
    const codes = vote.reasons[space]
    if (codes === undefined) continue
    if (!Array.isArray(codes) || codes.some((code) => typeof code !== 'string' || code.trim() === '')) {
      issues.push({ path: `reasons.${space}`, message: 'reasons must be non-empty machine codes' })
    }
  }

  return issues
}

export function assertValidVote(vote: AxisVote): void {
  const issues = validateAxisVote(vote)
  if (issues.length > 0) {
    throw new Error(`axis vote failed contract: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`)
  }
}
