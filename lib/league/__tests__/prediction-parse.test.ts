import { describe, expect, it } from 'vitest'
import {
  isPlaceholderRationale,
  parsePrediction,
  sanitizeRationale,
  sanitizeReasoningText,
  splitReasoningAndJson,
  isBinaryDirection,
  REASONING_TEXT_MAX_CHARS,
} from '../prediction-parse'

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

// v2 output contract: four-line reasoning block, then the answer JSON as the
// LAST line. The parser must split reliably even when the reasoning prose
// contains braces or the model wraps the JSON in a code fence.
describe('splitReasoningAndJson — v2 reasoning-block-then-JSON outputs', () => {
  const REASONING = [
    'CHAIN: SOXX -1.2% yesterday leads AAPL suppliers; a weak semis tape argues against a bounce.',
    'EVIDENCE: RSI 41 and 5-session return -2.1% argue down; put/call 0.87 and insider net buys argue up. Momentum is weightier at 1d.',
    'BASE RATE: 1d up base rate is 53%; nothing here justifies a large deviation.',
    'COUNTER: oversold bounces after -2% weeks occur 58% of the time.',
  ].join('\n')

  it('splits reasoning from the final JSON line and parses both', () => {
    const out = `${REASONING}\n{"direction":"down","probability":58,"magnitude":-0.8,"rationale":"Weak semis tape and momentum."}`
    const { reasoning, parsed } = splitReasoningAndJson(out)
    expect(reasoning).toBe(REASONING)
    expect(parsed?.direction).toBe('down')
    expect(parsed?.probability).toBe(58)
    expect(parsed?.magnitude).toBe(-0.8)
  })

  it('survives braces inside the reasoning prose (only the last direction-bearing JSON wins)', () => {
    const out = `CHAIN: the packet shows {volatility: high} conditions.\nEVIDENCE: mixed.\nBASE RATE: 53%.\nCOUNTER: momentum.\n{"direction":"up","probability":61,"magnitude":0.5,"rationale":"x marks"}`
    const { reasoning, parsed } = splitReasoningAndJson(out)
    expect(parsed?.direction).toBe('up')
    expect(reasoning).toContain('CHAIN:')
    expect(reasoning).not.toContain('"direction"')
  })

  it('ignores nested sub-objects without a direction key and JSON-in-string braces', () => {
    const out = `EVIDENCE: consensus {"buy": 24, "hold": 9}.\n{"direction":"down","probability":57,"magnitude":-0.6,"rationale":"Contains {braces} in a string."}`
    const { parsed } = splitReasoningAndJson(out)
    expect(parsed?.direction).toBe('down')
    expect(parsed?.rationale).toBe('Contains {braces} in a string.')
  })

  it('handles a fenced JSON answer after the reasoning block', () => {
    const out = `${REASONING}\n\`\`\`json\n{"direction":"up","probability":66,"magnitude":1.1,"rationale":"Bounce setup."}\n\`\`\``
    const { reasoning, parsed } = splitReasoningAndJson(out)
    expect(parsed?.direction).toBe('up')
    expect(reasoning).toContain('COUNTER:')
    expect(reasoning).not.toContain('```')
  })

  it('legacy JSON-only output parses with null reasoning', () => {
    const { reasoning, parsed } = splitReasoningAndJson('{"direction":"up","probability":72,"magnitude":2.4,"rationale":"Solid."}')
    expect(reasoning).toBeNull()
    expect(parsed?.direction).toBe('up')
  })

  it('parsePrediction on mixed output returns the SAME answer as the split (regression: greedy brace match must not swallow reasoning braces)', () => {
    const out = `CHAIN: {note} semis weak.\nEVIDENCE: down.\nBASE RATE: 53%.\nCOUNTER: bounce.\n{"direction":"down","probability":59,"magnitude":-0.7,"rationale":"Semis."}`
    expect(parsePrediction(out)).toEqual(splitReasoningAndJson(out).parsed)
  })
})

describe('sanitizeReasoningText', () => {
  it('caps at REASONING_TEXT_MAX_CHARS and strips fences', () => {
    const long = 'CHAIN: ' + 'x'.repeat(REASONING_TEXT_MAX_CHARS + 500)
    const cleaned = sanitizeReasoningText('```\n' + long + '\n```')
    expect(cleaned).not.toBeNull()
    expect(cleaned!.length).toBeLessThanOrEqual(REASONING_TEXT_MAX_CHARS)
    expect(cleaned).not.toContain('```')
  })

  it('returns null for empty or placeholder text', () => {
    expect(sanitizeReasoningText('   ')).toBeNull()
    expect(sanitizeReasoningText('<one line, max 200 chars>')).toBeNull()
    expect(sanitizeReasoningText(null)).toBeNull()
  })
})
