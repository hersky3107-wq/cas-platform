/**
 * Validation and row shape for per-session ORACLE inputs.
 *
 * These are reading state, not profile identity. PRISM colours and its
 * four-question micro check can change on every reading, so each session
 * keeps its own copy for later re-test comparisons.
 */
import { PRISM_COLORS, type PrismColor } from '../engines/prism'
import type { MicroCheck } from '../engines/prism/types'

export type OraclePrismSessionInput = {
  impulse: PrismColor
  need: PrismColor
  identity: PrismColor
  microCheck?: MicroCheck
}

/**
 * Generic bag by design: future systems may add their own per-session input
 * without another migration. The create route currently validates `prism`
 * and preserves other top-level keys unchanged.
 */
export type OracleSessionInputs = {
  prism?: OraclePrismSessionInput
} & Record<string, unknown>

export type SessionInputsValidation =
  | { ok: true; value: OracleSessionInputs | null }
  | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isPrismColor(value: unknown): value is PrismColor {
  return typeof value === 'string' && (PRISM_COLORS as readonly string[]).includes(value)
}

function isMicroCheck(value: unknown): value is MicroCheck {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((entry) => Number.isInteger(entry) && entry >= 1 && entry <= 5)
  )
}

/**
 * Validates untrusted request JSON before any credit charge.
 * Missing/null sessionInputs is valid and leaves PRISM as a 결번.
 */
export function validateSessionInputs(raw: unknown): SessionInputsValidation {
  if (raw === undefined || raw === null) return { ok: true, value: null }
  if (!isRecord(raw)) {
    return { ok: false, error: 'sessionInputs must be an object when present' }
  }

  if (raw.prism === undefined) return { ok: true, value: { ...raw } }
  if (!isRecord(raw.prism)) {
    return { ok: false, error: 'sessionInputs.prism must be an object' }
  }

  const { impulse, need, identity, microCheck } = raw.prism
  if (!isPrismColor(impulse) || !isPrismColor(need) || !isPrismColor(identity)) {
    return {
      ok: false,
      error: `sessionInputs.prism colors must be one of ${PRISM_COLORS.join(', ')}`,
    }
  }
  if (new Set([impulse, need, identity]).size !== 3) {
    return { ok: false, error: 'sessionInputs.prism colors must be distinct' }
  }
  if (microCheck !== undefined && !isMicroCheck(microCheck)) {
    return {
      ok: false,
      error: 'sessionInputs.prism.microCheck must contain exactly four integers from 1 to 5',
    }
  }

  const prism: OraclePrismSessionInput = {
    impulse,
    need,
    identity,
    ...(microCheck === undefined ? {} : { microCheck }),
  }
  return { ok: true, value: { ...raw, prism } }
}
