/**
 * Contract-neutral grading sides — FROZEN-FIXTURE parity proof.
 *
 * (3) of the side-token pass: `gradeChildren` and the persisted
 * `actual_outcome` string moved from a hardcoded 'up'/'down' ternary onto the
 * round's answer-contract side pair. THE PRICE PATH MUST BE BYTE-IDENTICAL.
 * The FROZEN blocks below are verbatim copies of the pre-refactor logic from
 * lib/prediction/reconciliation.ts (the ternary) and the pre-refactor
 * persistence (`actual_outcome: outcome.rawOutcome`); every close_higher
 * assertion checks the new seam against them with strict equality.
 * grading-core.ts and resolution.ts themselves are untouched — asserted
 * against the actual source text at the bottom.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatOutcomeForKind, gradedSidesFor } from '../graded-sides'
import { formatRawOutcome, resolveRoundOutcome, type ResolutionDirection, type ResolvedOutcome } from '../resolution'

// ─── FROZEN pre-refactor logic (verbatim from reconciliation.ts @ 042bf875) ──

/** gradeChildren computed the losing side with this exact ternary. */
function frozenOpposite(direction: ResolutionDirection): 'up' | 'down' {
  return direction === 'up' ? 'down' : 'up'
}

/** saveGraded persisted the audit string with no mapping at all. */
function frozenActualOutcome(outcome: ResolvedOutcome): string {
  return outcome.rawOutcome
}

// ─── Fixtures produced by the REAL resolver (never hand-built strings) ───────

function resolvedOutcome(direction: ResolutionDirection): ResolvedOutcome {
  const anchor = 231.59
  const close = direction === 'up' ? 233.14 : 229.02
  const result = resolveRoundOutcome({
    instrument: 'AAPL',
    anchorPrice: anchor,
    anchorPriceAt: '2026-08-27T20:00:00.000Z',
    // Session close moments are sessionDate T23:59:59.999Z — the window must reach past it.
    resolvesAt: '2026-08-29T00:00:00.000Z',
    series: { ok: true, bars: [{ sessionDate: '2026-08-28', close }] },
  })
  if (!result.ok) throw new Error(`fixture did not resolve: ${result.reason}`)
  return result.outcome
}

describe('binary_close_higher — byte-identical to the frozen pre-refactor path', () => {
  it('gradeChildren side pair equals the frozen ternary for both directions', () => {
    for (const direction of ['up', 'down'] as const) {
      const sides = gradedSidesFor('binary_close_higher', direction)
      expect(sides.winner).toBe(direction)
      expect(sides.loser).toBe(frozenOpposite(direction))
    }
  })

  it('persisted actual_outcome is EXACTLY outcome.rawOutcome, both directions', () => {
    for (const direction of ['up', 'down'] as const) {
      const outcome = resolvedOutcome(direction)
      expect(formatOutcomeForKind('binary_close_higher', outcome)).toBe(frozenActualOutcome(outcome))
    }
  })

  it('unknown / legacy / null kinds take the close_higher pair (every pre-kind round is a price round)', () => {
    for (const kind of [null, undefined, '', 'mystery_kind']) {
      expect(gradedSidesFor(kind, 'up')).toEqual({ winner: 'up', loser: 'down' })
      const outcome = resolvedOutcome('down')
      expect(formatOutcomeForKind(kind, outcome)).toBe(frozenActualOutcome(outcome))
    }
  })
})

describe('non-price kinds — positional mapping onto the contract side pair', () => {
  it("binary_subject_outcome: engine 'up' (subject achieved it) grades yes over no", () => {
    expect(gradedSidesFor('binary_subject_outcome', 'up')).toEqual({ winner: 'yes', loser: 'no' })
    expect(gradedSidesFor('binary_subject_outcome', 'down')).toEqual({ winner: 'no', loser: 'yes' })
  })

  it('binary_threshold: above/below', () => {
    expect(gradedSidesFor('binary_threshold', 'up')).toEqual({ winner: 'above', loser: 'below' })
    expect(gradedSidesFor('binary_threshold', 'down')).toEqual({ winner: 'below', loser: 'above' })
  })

  it('actual_outcome speaks the round vocabulary: only the leading token is replaced', () => {
    const outcome = resolvedOutcome('up')
    const mapped = formatOutcomeForKind('binary_subject_outcome', outcome)
    expect(mapped).toBe(`yes${outcome.rawOutcome.slice('up'.length)}`)
    // The audit tail (session, close, anchor) is untouched byte-for-byte.
    expect(mapped.slice('yes'.length)).toBe(outcome.rawOutcome.slice('up'.length))
    expect(outcome.rawOutcome.startsWith('up ')).toBe(true)
  })
})

describe('the seam is real (source-level)', () => {
  const reconciliation = readFileSync(join(process.cwd(), 'lib/prediction/reconciliation.ts'), 'utf8')

  it('reconciliation gradeChildren consumes gradedSidesFor, not a ternary', () => {
    expect(reconciliation).toContain('gradedSidesFor(kind, direction)')
    expect(reconciliation).not.toContain("direction === 'up' ? 'down' : 'up'")
  })

  it('reconciliation saveGraded persists formatOutcomeForKind, not rawOutcome directly', () => {
    expect(reconciliation).toContain('formatOutcomeForKind(kind, outcome)')
    expect(reconciliation).not.toContain('actual_outcome: outcome.rawOutcome')
  })

  it('grading-core.ts and resolution.ts are untouched by the side-token pass', () => {
    const gradingCore = readFileSync(join(process.cwd(), 'lib/prediction/grading-core.ts'), 'utf8')
    const resolution = readFileSync(join(process.cwd(), 'lib/prediction/resolution.ts'), 'utf8')
    for (const src of [gradingCore, resolution]) {
      expect(src).not.toContain('graded-sides')
      expect(src).not.toContain('proposition_kind')
      expect(src).not.toContain('answer-contract')
    }
    // The engine still speaks exactly the binary vocabulary.
    expect(resolution).toContain("export type ResolutionDirection = 'up' | 'down'")
  })

  it('formatRawOutcome itself is untouched — the frozen shape still holds', () => {
    const outcome = resolvedOutcome('up')
    expect(formatRawOutcome(outcome)).toBe(outcome.rawOutcome)
    expect(outcome.rawOutcome).toBe('up (2026-08-28 close 233.14 vs anchor 231.59 @ 2026-08-27T20:00:00.000Z)')
  })
})
