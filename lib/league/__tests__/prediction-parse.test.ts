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
      rationale: 'Momentum looks positive after the last earnings beat.',
      rejectedDirection: false,
    })
  })

  it('stores null rationale when the model echoes the prompt placeholder', () => {
    const parsed = parsePrediction('{"direction":"down","probability":61,"rationale":"<one line, max 200 chars>"}')
    expect(parsed).toEqual({
      direction: 'down',
      probability: 61,
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
    expect(parsed).toEqual({ direction: 'up', probability: 72, rationale: null, rejectedDirection: false })
  })
})
