import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('operator path isolation — price engine files stay untouched', () => {
  it('does not edit grading-core.ts or resolution.ts', () => {
    const gradingCore = readFileSync(join(process.cwd(), 'lib/prediction/grading-core.ts'), 'utf8')
    const resolution = readFileSync(join(process.cwd(), 'lib/prediction/resolution.ts'), 'utf8')
    for (const src of [gradingCore, resolution]) {
      expect(src).not.toContain('operator_manual')
      expect(src).not.toContain('operator-grade')
      expect(src).not.toContain('prediction_round_grade_evidence')
      expect(src).not.toContain('observed_fact')
    }
  })

  it('the operator write path is a sibling of saveGraded — it never calls it', () => {
    const core = readFileSync(join(process.cwd(), 'lib/prediction/operator-grade.ts'), 'utf8')
    const live = readFileSync(join(process.cwd(), 'lib/prediction/operator-grade-live.ts'), 'utf8')
    expect(core).not.toMatch(/\bsaveGraded\s*\(/)
    expect(core).not.toMatch(/resolution_price\s*:/)
    expect(live).not.toMatch(/\bsaveGraded\s*\(/)
    expect(live).not.toMatch(/resolution_price\s*:/)
    expect(live).toContain('prediction_round_grade_evidence')
    expect(live).toContain('gradeChildren')
  })
})
