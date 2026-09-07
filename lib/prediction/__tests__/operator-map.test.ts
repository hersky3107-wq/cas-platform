import { describe, expect, it } from 'vitest'
import {
  formatOperatorOutcome,
  mapObservedFactToSide,
  normalizeObservedLabel,
  parsePrintedNumber,
  validateOperatorEvidenceInput,
} from '../operator-map'

describe('validateOperatorEvidenceInput', () => {
  it('requires an https URL and a 1–500 character fact', () => {
    expect(validateOperatorEvidenceInput('http://example.com', 'won 2-1')?.error).toMatch(/https/)
    expect(validateOperatorEvidenceInput('https://example.com', '')?.error).toMatch(/observed_fact/)
    expect(validateOperatorEvidenceInput('https://example.com', 'x'.repeat(501))?.error).toMatch(/observed_fact/)
    expect(validateOperatorEvidenceInput('  https://example.com/box  ', '  2-1  ')).toBeNull()
  })
})

describe('mapObservedFactToSide — subject_outcome', () => {
  it('maps a normalized subject match to yes, anything else to no', () => {
    expect(
      mapObservedFactToSide({
        propositionKind: 'binary_subject_outcome',
        subjectLabel: 'Manchester United',
        observedFact: 'manchester united',
      })
    ).toEqual({ ok: true, derived_side: 'yes' })

    expect(
      mapObservedFactToSide({
        propositionKind: 'binary_subject_outcome',
        subjectLabel: 'Manchester United',
        observedFact: 'Liverpool',
      })
    ).toEqual({ ok: true, derived_side: 'no' })
  })

  it('refuses a subject-outcome round with no subject_label', () => {
    expect(
      mapObservedFactToSide({
        propositionKind: 'binary_subject_outcome',
        subjectLabel: null,
        observedFact: 'yes',
      }).ok
    ).toBe(false)
  })
})

describe('mapObservedFactToSide — threshold', () => {
  it('compares the printed number to the line in subject_label', () => {
    expect(
      mapObservedFactToSide({
        propositionKind: 'binary_threshold',
        subjectLabel: '3.4%',
        observedFact: 'printed 3.7 percent',
      })
    ).toEqual({ ok: true, derived_side: 'above' })

    expect(
      mapObservedFactToSide({
        propositionKind: 'binary_threshold',
        subjectLabel: '3.4%',
        observedFact: '3.1',
      })
    ).toEqual({ ok: true, derived_side: 'below' })
  })

  it('refuses exact equality — no side to derive', () => {
    const result = mapObservedFactToSide({
      propositionKind: 'binary_threshold',
      subjectLabel: '3.4%',
      observedFact: '3.4',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/equals the threshold/)
  })
})

describe('mapObservedFactToSide — close_higher is refused', () => {
  it('never invents a close from operator evidence', () => {
    const result = mapObservedFactToSide({
      propositionKind: 'binary_close_higher',
      subjectLabel: null,
      observedFact: '231.45',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/market feed/)
  })
})

describe('helpers', () => {
  it('normalizes labels and parses the first printed number', () => {
    expect(normalizeObservedLabel('  Manchester United!  ')).toBe('manchester united')
    expect(parsePrintedNumber('CPI printed 3,412.5 overnight')).toBe(3412.5)
    expect(parsePrintedNumber('no number here')).toBeNull()
  })

  it('formats actual_outcome in the round vocabulary, not price wording', () => {
    expect(formatOperatorOutcome('yes', 'Manchester United  2-1')).toBe('yes (observed Manchester United 2-1)')
    expect(formatOperatorOutcome('above', '3.7%')).toBe('above (observed 3.7%)')
    expect(formatOperatorOutcome('yes', 'Manchester United 2-1')).not.toMatch(/close|anchor/)
  })
})
