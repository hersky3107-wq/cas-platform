import { describe, expect, it } from 'vitest'
import { isPlaceholderRationale, parsePrediction, sanitizeRationale } from '../prediction-parse'

describe('isPlaceholderRationale', () => {
  it('rejects angle-bracket schema echoes', () => {
    expect(isPlaceholderRationale('<one line, max 200 chars>')).toBe(true)
    expect(isPlaceholderRationale('<string>')).toBe(true)
  })

  it('accepts normal prose', () => {
    expect(isPlaceholderRationale('Momentum looks positive after the last earnings beat.')).toBe(false)
  })
})

describe('parsePrediction', () => {
  it('parses valid JSON and keeps rationale prose', () => {
    const parsed = parsePrediction(
      '{"direction":"up","probability":72,"rationale":"Momentum looks positive after the last earnings beat."}',
    )
    expect(parsed).toEqual({
      direction: 'up',
      probability: 72,
      rationale: 'Momentum looks positive after the last earnings beat.',
    })
  })

  it('stores null rationale when the model echoes the prompt placeholder', () => {
    const parsed = parsePrediction('{"direction":"down","probability":61,"rationale":"<one line, max 200 chars>"}')
    expect(parsed).toEqual({
      direction: 'down',
      probability: 61,
      rationale: null,
    })
  })

  it('still returns direction when rationale is rejected', () => {
    const parsed = parsePrediction('{"direction":"flat","probability":40,"rationale":"one line, max 200 chars"}')
    expect(parsed?.direction).toBe('flat')
    expect(parsed?.probability).toBe(40)
    expect(parsed?.rationale).toBeNull()
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
    expect(parsed).toEqual({ direction: 'up', probability: 72, rationale: null })
  })
})
