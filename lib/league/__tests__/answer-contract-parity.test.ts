/**
 * BYTE-PARITY PROOF for the binary_close_higher answer contract.
 *
 * The prompts, parser, validation, and retry instruction moved from
 * `orchestrator.ts` into `answer-contract.ts` (one contract per
 * proposition_kind). Stocks — and every price chip — must keep producing
 * byte-identical prompts and identical parse/validation outcomes.
 *
 * Technique (same as `gateway/__tests__/packet-parity.test.ts`): the
 * PRE-REFACTOR code is FROZEN below verbatim, and every output is compared
 * byte-for-byte / value-for-value against the contract-driven path. If a
 * future edit to answer-contract.ts changes a single character of the stocks
 * prompt set, this file fails.
 */

import { describe, expect, it } from 'vitest'
import { answerContractFor, buildRoundPrompts, type PromptRound } from '../answer-contract'
import { isBinaryDirection, parsePrediction, splitReasoningAndJson, type ParsedPrediction } from '../prediction-parse'
import { validateMagnitude } from '../magnitude'

// ---------------------------------------------------------------------------
// FROZEN pre-refactor fixtures (verbatim copies from lib/league/orchestrator.ts
// as of the commit before the answer-contract extraction). DO NOT EDIT.
// ---------------------------------------------------------------------------

const FROZEN_CLOSED_BOOK_SYSTEM_PROMPT = `You are an independent forecasting model in a prediction league. You answer ALONE; you never see any other model's answer. Your visible output has exactly TWO parts, in this order.

PART 1 — REASONING: exactly four labeled lines of plain text (no markdown, no code fences), at most ~150 words total. Cite actual numbers from the packet, not vague qualities.
CHAIN: what the RELATED INSTRUMENTS block implies for this proposition — the cross-asset connection a single-asset analyst would miss. If the packet has no related-instruments data, write "CHAIN: no related-instrument data".
EVIDENCE: which specific packet numbers argue up, which argue down, and which side is weightier and why.
BASE RATE: what the packet's base rate says for this horizon, and why this round should or should not deviate from it.
COUNTER: the strongest argument AGAINST your own conclusion.

PART 2 — ANSWER: exactly ONE line of strict JSON as the LAST line of your output, nothing after it.

Required JSON keys: direction, probability, magnitude, rationale.

Example shape (replace values with your own forecast — do not copy this example verbatim):
{"direction":"up","probability":72,"magnitude":2.4,"rationale":"Recent earnings beat and buyback support a higher close."}

- direction: exactly one of "up" or "down". Exactly two answers exist — never flat, abstain, neutral, or any other value. If you expect little change, still pick the closer side (up or down).
- probability: your confidence in the stated direction, integer 0 through 100.
- magnitude: your expected percent change over the stated horizon, as a plain number signed to match direction — positive for "up", negative for "down" (e.g. 2.4 for +2.4%, -1.1 for -1.1%). Keep it a plausible move for the horizon; an extreme value will be rejected and you will be asked again.
- rationale: one concise sentence distilled from your reasoning (200 characters or fewer). Write your actual conclusion — never repeat these instructions, schema labels, or placeholder text.`

const FROZEN_SCOUT_SYSTEM_PROMPT = `You are an independent forecasting model in a prediction league. You answer ALONE; you never see any other model's answer. You may reason internally, but your VISIBLE output MUST be exactly ONE line of strict JSON and nothing else — no markdown, no code fences, no preamble, no trailing text.

Required JSON keys: direction, probability, magnitude, rationale.

Example shape (replace values with your own forecast — do not copy this example verbatim):
{"direction":"up","probability":72,"magnitude":2.4,"rationale":"Recent earnings beat and buyback support a higher close."}

- direction: exactly one of "up" or "down". Exactly two answers exist — never flat, abstain, neutral, or any other value. If you expect little change, still pick the closer side (up or down).
- probability: your confidence in the stated direction, integer 0 through 100.
- magnitude: your expected percent change over the stated horizon, as a plain number signed to match direction — positive for "up", negative for "down" (e.g. 2.4 for +2.4%, -1.1 for -1.1%). Keep it a plausible move for the horizon; an extreme value will be rejected and you will be asked again.
- rationale: one concise sentence of reasoning or a key citation in plain prose (200 characters or fewer). Write your actual reasoning — never repeat these instructions, schema labels, or placeholder text.
Return the JSON object only.`

const FROZEN_PREDICTION_RETRY_INSTRUCTION = `RETRY: Your previous answer was invalid. You may write brief reasoning first, but the LAST line of your output must be exactly one JSON line: {"direction":"up"|"down","probability":0-100,"magnitude":<signed number>,"rationale":"..."}. direction must be exactly "up" or "down" — never flat, abstain, neutral, or any other value. magnitude must be a plain number signed to match direction (positive for up, negative for down) and a plausible percent move for the stated horizon — not an extreme value.`

/** FROZEN copy of the pre-refactor orchestrator buildPropositionBlock + buildPrompts. */
function frozenBuildPropositionBlock(round: PromptRound): string {
  return [
    `Proposition: ${round.proposition_text}`,
    `Instrument: ${round.instrument}`,
    `Category: ${round.category}`,
    `Horizon: ${round.horizon}`,
    `Resolution rule: ${round.resolution_rule}`,
    `Resolves at (UTC): ${round.resolves_at}`,
  ].join('\n')
}

function frozenBuildPrompts(round: PromptRound, injection: string | null, packetError?: string): { price: string; scout: string } {
  const block = frozenBuildPropositionBlock(round)
  const priceCloser =
    'Write the four-line reasoning block (CHAIN / EVIDENCE / BASE RATE / COUNTER), then the single-line JSON object as the LAST line, exactly as described in the system message.'
  const scoutCloser = 'Respond with the single-line JSON object described in the system message.'

  let price: string
  if (injection) {
    price = [
      block,
      '',
      injection,
      '',
      'You have the numeric market data and research above. Exactly two answers exist: up or down, plus a probability. Do NOT answer "abstain" for lack of data — the packet above is your data. Prefer the numbered blocks over prose if they disagree.',
      priceCloser,
    ].join('\n')
  } else {
    price = [
      block,
      '',
      `No live market-data packet is available for this instrument${packetError ? ` (${packetError})` : ''}. Use your own prior knowledge; give your best up or down call with a probability. Exactly two answers exist — never flat or abstain.`,
      priceCloser,
    ].join('\n')
  }

  const scout = [
    block,
    '',
    'Use live web search to gather the most recent price/context for this instrument, then make a directional call (exactly up or down) with a probability and cite your key source in the rationale.',
    scoutCloser,
  ].join('\n')

  return { price, scout }
}

/** FROZEN copy of the pre-refactor orchestrator predictionInvalidReason. */
function frozenPredictionInvalidReason(parsed: ParsedPrediction | null, horizon: string): string | null {
  if (!isBinaryDirection(parsed?.direction)) return 'non_binary_direction'
  const mv = validateMagnitude(parsed!.direction, parsed!.magnitude, horizon)
  return mv.ok ? null : `invalid_magnitude:${mv.reason}`
}

// ---------------------------------------------------------------------------

const contract = answerContractFor('binary_close_higher')

const ROUND: PromptRound = {
  proposition_text: 'Will AAPL close higher by 2026-08-29 than its last close?',
  instrument: 'AAPL',
  category: 'stock',
  horizon: '1d',
  resolution_rule: 'up iff resolution close > anchor close (Twelve Data 1day close)',
  resolves_at: '2026-08-29T20:00:00.000Z',
}

const INJECTION = [
  '[1] NUMERIC MARKET DATA',
  'AAPL last close 231.59 (2026-08-27), prev 229.31, chg +0.99%',
  '',
  '[2] BASE RATE',
  '1d up frequency over lookback: 53%',
].join('\n')

describe('binary_close_higher system prompts — byte-identical to the frozen originals', () => {
  it('closed-book system prompt matches byte-for-byte', () => {
    expect(contract.closedBookSystemPrompt).toBe(FROZEN_CLOSED_BOOK_SYSTEM_PROMPT)
  })

  it('scout system prompt matches byte-for-byte', () => {
    expect(contract.scoutSystemPrompt).toBe(FROZEN_SCOUT_SYSTEM_PROMPT)
  })

  it('retry instruction matches byte-for-byte', () => {
    expect(contract.retryInstruction).toBe(FROZEN_PREDICTION_RETRY_INSTRUCTION)
  })
})

describe('binary_close_higher round prompts — byte-identical to the frozen buildPrompts', () => {
  it('with a packet injection', () => {
    const frozen = frozenBuildPrompts(ROUND, INJECTION)
    const current = buildRoundPrompts(contract, ROUND, INJECTION)
    expect(current.price).toBe(frozen.price)
    expect(current.scout).toBe(frozen.scout)
  })

  it('without a packet, no error detail', () => {
    const frozen = frozenBuildPrompts(ROUND, null)
    const current = buildRoundPrompts(contract, ROUND, null)
    expect(current.price).toBe(frozen.price)
    expect(current.scout).toBe(frozen.scout)
  })

  it('without a packet, with an error detail', () => {
    const frozen = frozenBuildPrompts(ROUND, null, 'twelve_data timeout')
    const current = buildRoundPrompts(contract, ROUND, null, 'twelve_data timeout')
    expect(current.price).toBe(frozen.price)
    expect(current.scout).toBe(frozen.scout)
  })
})

describe('binary_close_higher parse + validate — identical to the frozen gate', () => {
  const CASES: { name: string; text: string | null }[] = [
    {
      name: 'v2 reasoning block + last-line JSON',
      text: [
        'CHAIN: semis firm, SOX +1.2% supports the complex.',
        'EVIDENCE: last close +0.99%, consensus above spot.',
        'BASE RATE: 53% up at 1d — no reason to deviate.',
        'COUNTER: macro print tomorrow could reverse the drift.',
        '{"direction":"up","probability":72,"magnitude":2.4,"rationale":"Momentum and consensus support a higher close."}',
      ].join('\n'),
    },
    { name: 'JSON-only down call', text: '{"direction":"down","probability":61,"magnitude":-1.1,"rationale":"Weak guidance pressures the close."}' },
    { name: 'flat direction (rejected value)', text: '{"direction":"flat","probability":50,"magnitude":0,"rationale":"No edge either way."}' },
    { name: 'abstain direction', text: '{"direction":"abstain","probability":0,"magnitude":0,"rationale":"Not enough data."}' },
    { name: 'missing magnitude', text: '{"direction":"up","probability":66,"rationale":"Drift continues."}' },
    { name: 'out-of-bounds magnitude (+900 on 1d)', text: '{"direction":"up","probability":70,"magnitude":900,"rationale":"Moonshot."}' },
    { name: 'sign mismatch (up with negative magnitude)', text: '{"direction":"up","probability":58,"magnitude":-2,"rationale":"Confused signs."}' },
    { name: 'zero magnitude accepted for either side', text: '{"direction":"down","probability":52,"magnitude":0,"rationale":"Barely lower."}' },
    {
      name: 'fenced JSON',
      text: '```json\n{"direction":"down","probability":64,"magnitude":-0.8,"rationale":"Fade the bounce."}\n```',
    },
    { name: 'prose fallback', text: 'I think direction: up, probability: 60, magnitude: 1.2 — earnings momentum.' },
    { name: 'unparseable prose', text: 'The market is uncertain and I cannot commit to a call.' },
    { name: 'null output', text: null },
  ]

  for (const c of CASES) {
    it(c.name, () => {
      const frozenParsed = parsePrediction(c.text)
      const frozenReason = frozenPredictionInvalidReason(frozenParsed, ROUND.horizon)

      const answer = contract.parse(c.text)
      const validation = contract.validate(answer, ROUND.horizon)

      if (frozenReason) {
        expect(validation).toEqual({ ok: false, reason: frozenReason })
      } else {
        // Valid under the old gate — the contract must accept with identical values.
        expect(validation.ok).toBe(true)
        if (!validation.ok) return
        expect(validation.side).toBe(frozenParsed!.direction)
        const mv = validateMagnitude(frozenParsed!.direction as 'up' | 'down', frozenParsed!.magnitude, ROUND.horizon)
        expect(validation.qualifierNumber).toBe(mv.ok ? mv.value : null)
        expect(validation.qualifierText).toBeNull()
        expect(answer!.probability).toBe(frozenParsed!.probability)
        expect(answer!.rationale).toBe(frozenParsed!.rationale)
      }
    })
  }

  it('splitReasoning matches splitReasoningAndJson for v2 output', () => {
    const text = CASES[0]!.text!
    expect(contract.splitReasoning(text)).toBe(splitReasoningAndJson(text).reasoning)
    expect(contract.splitReasoning(null)).toBeNull()
    expect(contract.splitReasoning('no json here at all')).toBe(splitReasoningAndJson('no json here at all').reasoning)
  })
})
