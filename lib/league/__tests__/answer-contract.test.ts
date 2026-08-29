/**
 * Answer contracts — one per proposition_kind, NEVER per adapter.
 *
 * THE PRODUCT LAW under test: every proposition names ONE subject and asks
 * yes/no about it. Exactly two answers per contract. No abstain, no flat, no
 * draw, no third party — a third value is rejected and retried, never stored.
 *
 * The QUALIFIER is required in every contract and is never graded: it must
 * not appear anywhere in `round-hit.ts`, `win-rate.ts`, or
 * `lib/prediction/resolution.ts` (asserted against source below, the same
 * negative-assertion style the magnitude tests use).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  answerContractFor,
  buildRoundPrompts,
  QUALIFIER_TEXT_MAX_CHARS,
  type AnswerContract,
} from '../answer-contract'
import type { PropositionKind } from '../gateway/types'

const KINDS: PropositionKind[] = ['binary_close_higher', 'binary_subject_outcome', 'binary_threshold']

describe('product law — every contract has exactly two sides, nothing else', () => {
  it.each(KINDS)('%s: two distinct sides, no abstain/flat/draw escape hatch', (kind) => {
    const c = answerContractFor(kind)
    expect(c.sides).toHaveLength(2)
    expect(c.sides[0]).not.toBe(c.sides[1])
    for (const banned of ['abstain', 'flat', 'draw', 'neutral']) {
      expect(c.sides).not.toContain(banned)
    }
  })

  it('side vocabularies are what the spec says', () => {
    expect(answerContractFor('binary_close_higher').sides).toEqual(['up', 'down'])
    expect(answerContractFor('binary_subject_outcome').sides).toEqual(['yes', 'no'])
    expect(answerContractFor('binary_threshold').sides).toEqual(['above', 'below'])
  })

  it.each(KINDS)('%s: a third-value side is rejected, not coerced', (kind) => {
    const c = answerContractFor(kind)
    const text = '{"side":"draw","direction":"flat","probability":50,"qualifier":"1-1","predicted_value":1,"magnitude":0,"rationale":"Hedging."}'
    const v = c.validate(c.parse(text), '1d')
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toMatch(/^non_binary_(direction|side)$/)
  })

  it.each(KINDS)('%s: null/empty output fails the side gate', (kind) => {
    const c = answerContractFor(kind)
    expect(c.validate(c.parse(null), '1d').ok).toBe(false)
    expect(c.validate(null, '1d').ok).toBe(false)
  })
})

describe('reasoning block is category-blind and shared', () => {
  it.each(KINDS)('%s: closed-book prompt carries CHAIN / EVIDENCE / BASE RATE / COUNTER', (kind) => {
    const p = answerContractFor(kind).closedBookSystemPrompt
    for (const label of ['CHAIN:', 'EVIDENCE:', 'BASE RATE:', 'COUNTER:']) {
      expect(p).toContain(label)
    }
    expect(p).toContain('PART 1 — REASONING: exactly four labeled lines')
    expect(p).toContain('PART 2 — ANSWER: exactly ONE line of strict JSON')
  })

  it('only the two side words vary inside EVIDENCE', () => {
    expect(answerContractFor('binary_close_higher').closedBookSystemPrompt).toContain('argue up, which argue down')
    expect(answerContractFor('binary_subject_outcome').closedBookSystemPrompt).toContain('argue yes, which argue no')
    expect(answerContractFor('binary_threshold').closedBookSystemPrompt).toContain('argue above, which argue below')
  })

  it('the prompts differ ONLY per kind — same kind, same bytes, regardless of adapter/category', () => {
    // 12 adapters must never mean 12 prompt sets: the contract registry returns
    // the same frozen object for every caller of the same kind.
    for (const kind of KINDS) {
      expect(answerContractFor(kind)).toBe(answerContractFor(kind))
    }
  })
})

// ---------------------------------------------------------------------------
// binary_subject_outcome — yes/no about a NAMED subject
// ---------------------------------------------------------------------------

describe('binary_subject_outcome', () => {
  const c: AnswerContract = answerContractFor('binary_subject_outcome')

  it('schema: side, probability, qualifier, rationale', () => {
    expect(c.jsonKeys).toEqual(['side', 'probability', 'qualifier', 'rationale'])
    expect(c.closedBookSystemPrompt).toContain('Required JSON keys: side, probability, qualifier, rationale.')
  })

  it('prompt states the law: never "A vs B", a draw is NO', () => {
    expect(c.closedBookSystemPrompt).toContain('whether the NAMED subject achieves the stated outcome')
    expect(c.closedBookSystemPrompt).toContain('(including a draw) is "no"')
    expect(c.closedBookSystemPrompt).toContain('Never abstain, never a name')
    expect(c.retryInstruction).toContain('any other result (including a draw) is "no"')
  })

  it('parses a valid yes with a scoreline qualifier', () => {
    const text = [
      'CHAIN: no related-instrument data',
      'EVIDENCE: 8 wins in the last 10; opponent missing two starters.',
      'BASE RATE: home sides win 46% of the time in this league.',
      'COUNTER: derby matches have a higher draw rate.',
      '{"side":"yes","probability":64,"qualifier":"2-1","rationale":"Form and squad depth favor the named side."}',
    ].join('\n')
    const answer = c.parse(text)
    const v = c.validate(answer, '1d')
    expect(v).toEqual({ ok: true, side: 'yes', qualifierNumber: null, qualifierText: '2-1' })
    expect(answer!.probability).toBe(64)
    expect(c.splitReasoning(text)).toContain('EVIDENCE: 8 wins')
    expect(c.splitReasoning(text)).not.toContain('"side"')
  })

  it('parses a no call — the subject failing the outcome is a first-class answer', () => {
    const v = c.validate(c.parse('{"side":"no","probability":58,"qualifier":"1-1 draw","rationale":"Rotation risk ahead of the cup tie."}'), '1w')
    expect(v).toEqual({ ok: true, side: 'no', qualifierNumber: null, qualifierText: '1-1 draw' })
  })

  it('a team name / candidate name as the side is rejected', () => {
    for (const side of ['man united', 'candidate a', 'trump', 'draw', 'tie']) {
      const v = c.validate(c.parse(`{"side":"${side}","probability":60,"qualifier":"2-1","rationale":"Picked a name."}`), '1d')
      expect(v).toEqual({ ok: false, reason: 'non_binary_side' })
    }
  })

  it('qualifier is REQUIRED — missing or blank fails like a bad side', () => {
    expect(c.validate(c.parse('{"side":"yes","probability":60,"rationale":"No detail."}'), '1d')).toEqual({
      ok: false,
      reason: 'invalid_qualifier:missing',
    })
    expect(c.validate(c.parse('{"side":"yes","probability":60,"qualifier":"  ","rationale":"Blank."}'), '1d')).toEqual({
      ok: false,
      reason: 'invalid_qualifier:missing',
    })
  })

  it('qualifier over the cap is rejected, not truncated', () => {
    const long = 'x'.repeat(QUALIFIER_TEXT_MAX_CHARS + 1)
    expect(c.validate(c.parse(`{"side":"yes","probability":60,"qualifier":"${long}","rationale":"Too long."}`), '1d')).toEqual({
      ok: false,
      reason: 'invalid_qualifier:too_long',
    })
  })

  it('a numeric margin qualifier is accepted as text ("4.5")', () => {
    const v = c.validate(c.parse('{"side":"yes","probability":55,"qualifier":4.5,"rationale":"Margin in points."}'), '1d')
    expect(v).toEqual({ ok: true, side: 'yes', qualifierNumber: null, qualifierText: '4.5' })
  })

  it('fenced and prose-embedded outputs still parse', () => {
    const fenced = '```json\n{"side":"no","probability":52,"qualifier":"0-0","rationale":"Low-scoring fixture."}\n```'
    expect(c.validate(c.parse(fenced), '1d')).toMatchObject({ ok: true, side: 'no' })
    const prose = 'Based on my search [1], "side": "yes", "probability": 61, "qualifier": "3-1" seems right.'
    expect(c.validate(c.parse(prose), '1d')).toMatchObject({ ok: true, side: 'yes', qualifierText: '3-1' })
  })
})

// ---------------------------------------------------------------------------
// binary_threshold — above/below a stated threshold
// ---------------------------------------------------------------------------

describe('binary_threshold', () => {
  const c: AnswerContract = answerContractFor('binary_threshold')

  it('schema: side, probability, predicted_value, rationale', () => {
    expect(c.jsonKeys).toEqual(['side', 'probability', 'predicted_value', 'rationale'])
    expect(c.closedBookSystemPrompt).toContain('Required JSON keys: side, probability, predicted_value, rationale.')
  })

  it('parses a valid above call with a predicted value', () => {
    const v = c.validate(c.parse('{"side":"above","probability":58,"predicted_value":3.4,"rationale":"Nowcast tracks above consensus."}'), '1m')
    expect(v).toEqual({ ok: true, side: 'above', qualifierNumber: 3.4, qualifierText: null })
  })

  it('parses below with a string-encoded number', () => {
    const v = c.validate(c.parse('{"side":"below","probability":66,"predicted_value":"2.9","rationale":"Cooling shelter costs."}'), '1m')
    expect(v).toEqual({ ok: true, side: 'below', qualifierNumber: 2.9, qualifierText: null })
  })

  it('predicted_value is REQUIRED and must be a plain number', () => {
    expect(c.validate(c.parse('{"side":"above","probability":60,"rationale":"No value."}'), '1d')).toEqual({
      ok: false,
      reason: 'invalid_qualifier:missing',
    })
    expect(c.validate(c.parse('{"side":"above","probability":60,"predicted_value":"around three","rationale":"Vague."}'), '1d')).toEqual({
      ok: false,
      reason: 'invalid_qualifier:missing',
    })
  })

  it('an absurd predicted value is rejected as out of bounds', () => {
    expect(c.validate(c.parse('{"side":"above","probability":60,"predicted_value":1e13,"rationale":"Garbled."}'), '1d')).toEqual({
      ok: false,
      reason: 'invalid_qualifier:out_of_bounds',
    })
  })

  it('at/equal is not an answer — only above or below', () => {
    for (const side of ['at', 'equal', 'in line', 'flat']) {
      expect(c.validate(c.parse(`{"side":"${side}","probability":50,"predicted_value":3.0,"rationale":"Fence-sitting."}`), '1d')).toEqual({
        ok: false,
        reason: 'non_binary_side',
      })
    }
  })
})

// ---------------------------------------------------------------------------
// Round prompts under non-price contracts
// ---------------------------------------------------------------------------

describe('buildRoundPrompts under subject/threshold contracts', () => {
  const round = {
    proposition_text: 'Will Manchester United win this match?',
    instrument: 'MATCH:MUN-LIV-20260901',
    category: 'sports',
    horizon: '1d',
    resolution_rule: 'yes iff Manchester United is the official winner; a draw is no',
    resolves_at: '2026-09-01T21:00:00.000Z',
  }

  it('subject prompts never instruct up/down', () => {
    const c = answerContractFor('binary_subject_outcome')
    const prompts = buildRoundPrompts(c, round, 'PACKET LINE 1', undefined)
    expect(prompts.price).toContain('yes or no')
    expect(prompts.price).not.toMatch(/\bup or down\b/)
    expect(prompts.scout).toContain('yes or no')
    expect(prompts.scout).not.toMatch(/directional call/)
    // The category-blind closers are shared verbatim across contracts.
    expect(prompts.price).toContain('Write the four-line reasoning block (CHAIN / EVIDENCE / BASE RATE / COUNTER)')
    expect(prompts.scout).toContain('Respond with the single-line JSON object described in the system message.')
  })

  it('no-packet fallback keeps the two-answer law per contract', () => {
    const subject = buildRoundPrompts(answerContractFor('binary_subject_outcome'), round, null, 'no fixture feed')
    expect(subject.price).toContain('(no fixture feed)')
    expect(subject.price).toContain('a draw or any other result is "no"')
    const threshold = buildRoundPrompts(answerContractFor('binary_threshold'), round, null)
    expect(threshold.price).toContain('above or below')
    expect(threshold.price).toContain('never at/equal, never abstain')
  })
})

// ---------------------------------------------------------------------------
// The qualifier never enters grading or any hit denominator
// ---------------------------------------------------------------------------

describe('qualifier is decoration — never graded, never in a denominator', () => {
  it('round-hit.ts, win-rate.ts, and resolution.ts never mention qualifier or answer-contract', () => {
    for (const rel of ['../round-hit.ts', '../win-rate.ts', '../../prediction/resolution.ts', '../../prediction/grading-core.ts']) {
      const src = readFileSync(join(__dirname, rel), 'utf8')
      expect(src, rel).not.toMatch(/qualifier|answer-contract|answerContract/i)
    }
  })
})
