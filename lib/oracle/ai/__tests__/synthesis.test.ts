import { describe, expect, it } from 'vitest'
import {
  parseSynthesisJson,
  SYNTHESIS_AGREEMENT_MAX,
  SYNTHESIS_CONCLUSION_MAX,
  SYNTHESIS_CONCLUSION_MIN,
  SYNTHESIS_LIST_MAX,
} from '../parse-synthesis'
import { buildSynthesisSystemPrompt } from '../prompts/synthesis'

// FIX 3: conclusions carry a hard floor now — fixtures must sit in band.
const CONCLUSION = '결'.repeat(SYNTHESIS_CONCLUSION_MIN)

describe('synthesis contract', () => {
  it('requires the exact four-field value types', () => {
    expect(
      parseSynthesisJson(
        JSON.stringify({
          agreements: ['one'],
          divergences: [],
          conclusion: CONCLUSION,
          confidence_note: null,
        }),
      ),
    ).toEqual({
      agreements: ['one'],
      divergences: [],
      conclusion: CONCLUSION,
      confidence_note: null,
    })
    expect(parseSynthesisJson('{"agreements":[],"divergences":[],"conclusion":3,"confidence_note":null}')).toBeNull()
  })

  it('rejects over-budget lists and strings instead of truncating', () => {
    expect(
      parseSynthesisJson(
        JSON.stringify({
          agreements: Array.from({ length: 20 }, () => 'a'.repeat(10)),
          divergences: [],
          conclusion: CONCLUSION,
          confidence_note: null,
        }),
      ),
    ).toBeNull()
    expect(
      parseSynthesisJson(
        JSON.stringify({
          agreements: ['a'.repeat(SYNTHESIS_AGREEMENT_MAX + 1)],
          divergences: [],
          conclusion: CONCLUSION,
          confidence_note: null,
        }),
      ),
    ).toBeNull()
    expect(
      parseSynthesisJson(
        JSON.stringify({
          agreements: [],
          divergences: [],
          conclusion: 'c'.repeat(SYNTHESIS_CONCLUSION_MAX + 1),
          confidence_note: null,
        }),
      ),
    ).toBeNull()
    expect(
      parseSynthesisJson(
        JSON.stringify({
          agreements: ['ok'],
          divergences: [],
          conclusion: 'c'.repeat(SYNTHESIS_CONCLUSION_MAX),
          confidence_note: null,
        }),
      ),
    ).not.toBeNull()
    expect(SYNTHESIS_LIST_MAX).toBe(6)
  })

  it('rejects a conclusion under the floor — a premium tier does not ship two sentences (FIX 3)', () => {
    expect(
      parseSynthesisJson(
        JSON.stringify({
          agreements: [],
          divergences: [],
          conclusion: 'c'.repeat(SYNTHESIS_CONCLUSION_MIN - 1),
          confidence_note: null,
        }),
      ),
    ).toBeNull()
    expect(
      parseSynthesisJson(
        JSON.stringify({
          agreements: [],
          divergences: [],
          conclusion: 'c'.repeat(SYNTHESIS_CONCLUSION_MIN),
          confidence_note: null,
        }),
      ),
    ).not.toBeNull()
  })

  it('pins JSON-only, no-working, no-machine-code prompt discipline', () => {
    const prompt = buildSynthesisSystemPrompt('ko')
    expect(prompt).toContain('exactly one JSON object')
    expect(prompt).toContain('no preamble')
    expect(prompt).toContain('visible working')
    expect(prompt).toContain('machine codes')
    expect(prompt).toContain('do not simulate reader dialogue')
  })
})
