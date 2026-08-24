import { describe, expect, it } from 'vitest'
import { isPlaceholderRationale, parsePrediction, sanitizeRationale, isBinaryDirection } from '../prediction-parse'

describe('isPlaceholderRationale', () => {
  it('rejects angle-bracket schema echoes', () => {
    expect(isPlaceholderRationale('<one line, max 200 chars>')).toBe(true)
    expect(isPlaceholderRationale('<string>')).toBe(true)
  })

  it('accepts normal prose', () => {
    expect(isPlaceholderRationale('Momentum looks positive after the last earnings beat.')).toBe(false)
  })
})

describe('parsePrediction — binary up/down only', () => {
  it('parses valid JSON and keeps rationale prose', () => {
    const parsed = parsePrediction(
      '{"direction":"up","probability":72,"rationale":"Momentum looks positive after the last earnings beat."}',
    )
    expect(parsed).toEqual({
      direction: 'up',
      probability: 72,
      magnitude: null,
      rationale: 'Momentum looks positive after the last earnings beat.',
      rejectedDirection: false,
    })
  })

  it('stores null rationale when the model echoes the prompt placeholder', () => {
    const parsed = parsePrediction('{"direction":"down","probability":61,"rationale":"<one line, max 200 chars>"}')
    expect(parsed).toEqual({
      direction: 'down',
      probability: 61,
      magnitude: null,
      rationale: null,
      rejectedDirection: false,
    })
  })

  it('rejects flat — direction null, rejectedDirection true', () => {
    const parsed = parsePrediction('{"direction":"flat","probability":40,"rationale":"Range-bound near anchor."}')
    expect(parsed?.direction).toBeNull()
    expect(parsed?.rejectedDirection).toBe(true)
    expect(parsed?.probability).toBe(40)
    expect(isBinaryDirection(parsed?.direction)).toBe(false)
  })

  it('rejects abstain, neutral, and null direction', () => {
    expect(parsePrediction('{"direction":"abstain","probability":50,"rationale":"Unsure."}')?.direction).toBeNull()
    expect(parsePrediction('{"direction":"neutral","probability":50,"rationale":"Unsure."}')?.rejectedDirection).toBe(
      true,
    )
    expect(parsePrediction('{"direction":null,"probability":50,"rationale":"Unsure."}')?.rejectedDirection).toBe(true)
  })
})

describe('parsePrediction — magnitude extraction (raw only; bounds/sign checked by lib/league/magnitude.ts)', () => {
  it('extracts a signed numeric magnitude', () => {
    const parsed = parsePrediction('{"direction":"up","probability":72,"magnitude":2.4,"rationale":"Earnings beat."}')
    expect(parsed?.magnitude).toBe(2.4)
    const down = parsePrediction('{"direction":"down","probability":65,"magnitude":-1.1,"rationale":"Weak guidance."}')
    expect(down?.magnitude).toBe(-1.1)
  })

  it('is null when magnitude is missing or non-numeric', () => {
    expect(parsePrediction('{"direction":"up","probability":72,"rationale":"No magnitude field."}')?.magnitude).toBeNull()
    expect(
      parsePrediction('{"direction":"up","probability":72,"magnitude":"not a number","rationale":"x"}')?.magnitude,
    ).toBeNull()
  })

  it('does not apply direction-sign or per-horizon bound checks itself — an inverted or absurd value still round-trips raw', () => {
    // This module has no horizon to validate against; validateMagnitude (called
    // by the orchestrator) is the sole gate for sign consistency and bounds.
    const invertedSign = parsePrediction('{"direction":"up","probability":72,"magnitude":-2.4,"rationale":"x"}')
    expect(invertedSign?.magnitude).toBe(-2.4)
    const absurd = parsePrediction('{"direction":"up","probability":72,"magnitude":900,"rationale":"x"}')
    expect(absurd?.magnitude).toBe(900)
  })

  it('also extracts magnitude via the prose fallback path', () => {
    const prose = 'Some citation text... "direction": "up", "probability": 70, "magnitude": 3.2, "rationale": "Strong momentum" ...more citations'
    const parsed = parsePrediction(prose)
    expect(parsed?.direction).toBe('up')
    expect(parsed?.magnitude).toBe(3.2)
  })
})

describe('sanitizeRationale', () => {
  it('returns null for placeholder echoes', () => {
    expect(sanitizeRationale('<one line, max 200 chars>')).toBeNull()
  })

  // Regression: the WORLD qwen3.5-flash row on round fffc1716 stored the
  // literal prompt placeholder "<one line, max 200 chars>" as its rationale.
  // Both guards must reject that exact string at write time so it cannot
  // re-enter the table after the purge.
  it('rejects the exact stored qwen3.5-flash placeholder at write time', () => {
    const stored = '<one line, max 200 chars>'
    expect(isPlaceholderRationale(stored)).toBe(true)
    expect(sanitizeRationale(stored)).toBeNull()
  })

  it('parsePrediction drops the placeholder rationale but keeps direction', () => {
    const parsed = parsePrediction(
      '{"direction":"up","probability":72,"rationale":"<one line, max 200 chars>"}',
    )
    expect(parsed).toEqual({
      direction: 'up',
      probability: 72,
      magnitude: null,
      rationale: null,
      rejectedDirection: false,
    })
  })
})
