/**
 * AI Prediction League — ANSWER CONTRACTS, one per proposition_kind.
 *
 * THE PRODUCT LAW (absolute, kind-independent): every proposition names ONE
 * subject and asks yes/no about it. Exactly TWO answers exist. No abstain, no
 * flat, no draw, no third party. Each contract only changes what the two
 * sides are CALLED and what the required, never-graded QUALIFIER is:
 *
 *   binary_close_higher    — sides up|down,     qualifier = signed percent move
 *   binary_subject_outcome — sides yes|no,      qualifier = audience detail
 *                            (predicted scoreline / vote margin / confidence
 *                            gap). Sides are about the NAMED subject achieving
 *                            the stated outcome — never "A vs B"; a draw is NO.
 *   binary_threshold       — sides above|below, qualifier = predicted value
 *
 * ONE contract per KIND — never per adapter. Twelve adapters share these
 * three contracts; an adapter picks a kind (via `slotsForRound`), it never
 * defines prompts of its own.
 *
 * The CHAIN / EVIDENCE / BASE RATE / COUNTER reasoning block is category-blind
 * and shared verbatim across all closed-book prompts; only the two side words
 * inside the EVIDENCE line vary (they compose back to the exact historical
 * text for binary_close_higher — proven byte-identical in
 * `__tests__/answer-contract-parity.test.ts`).
 *
 * THE QUALIFIER IS NEVER GRADED. It never enters `is_correct`, any hit
 * denominator, `lib/league/round-hit.ts`, `lib/league/win-rate.ts`, or
 * `lib/prediction/resolution.ts` — the same negative guarantee already
 * enforced for magnitude (see `lib/league/magnitude.ts` and its tests).
 *
 * Pure module — no server-only, no I/O — so vitest covers every contract.
 */

import type { PropositionKind } from './gateway/types'
import {
  isBinaryDirection,
  parsePrediction,
  sanitizeRationale,
  sanitizeReasoningText,
  splitReasoningAndJson,
} from './prediction-parse'
import { roundMagnitude, validateMagnitude } from './magnitude'

export type AnswerSide = 'up' | 'down' | 'yes' | 'no' | 'above' | 'below'

/** Raw extraction from model output — validation happens in `AnswerContract.validate`. */
export type ContractAnswer = {
  /** One of the contract's two sides, or null when missing/non-binary. */
  side: AnswerSide | null
  /** Confidence 0–100 (clamped, rounded), or null when missing. */
  probability: number | null
  /** Numeric qualifier (signed % / predicted value) — raw, unvalidated. */
  qualifierNumber: number | null
  /** Text qualifier (scoreline, margin, gap) — raw, unvalidated. */
  qualifierText: string | null
  rationale: string | null
  /** True when the model named a third value (flat/draw/abstain/a name/…). */
  rejectedSide: boolean
}

export type AnswerValidation =
  | {
      ok: true
      side: AnswerSide
      /** Validated numeric qualifier (rounded), null for text-qualifier kinds. */
      qualifierNumber: number | null
      /** Validated text qualifier, null for numeric-qualifier kinds. */
      qualifierText: string | null
    }
  | { ok: false; reason: string }

export type AnswerContract = {
  kind: PropositionKind
  /** The exactly-two sides, in prompt order. */
  sides: readonly [AnswerSide, AnswerSide]
  /** Required keys of the single-line answer JSON, in schema order. */
  jsonKeys: readonly [string, string, string, string]
  /** Closed-book tiers: PART 1 reasoning block + PART 2 answer JSON. */
  closedBookSystemPrompt: string
  /** Scout tier: JSON-only output, self-directed web search. */
  scoutSystemPrompt: string
  /** Appended once when the first answer fails `validate`. */
  retryInstruction: string
  /** User-prompt guidance when a packet/injection is present. */
  packetAnswerGuidance: string
  /** User-prompt guidance when no packet is available. */
  noPacketAnswerGuidance: (packetError?: string) => string
  /** User-prompt guidance for the scout tier. */
  scoutAnswerGuidance: string
  /** Extracts a raw answer from model output. Null when nothing parseable. */
  parse: (text: string | null) => ContractAnswer | null
  /**
   * Combined side + qualifier gate. Both are REQUIRED — a missing/invalid
   * qualifier fails exactly like a non-binary side, and both share the same
   * one-retry-then-error budget in the orchestrator.
   */
  validate: (answer: ContractAnswer | null, horizon: string) => AnswerValidation
  /** Visible reasoning block (text before the answer JSON), sanitized. */
  splitReasoning: (text: string | null) => string | null
}

// ---------------------------------------------------------------------------
// Shared prompt scaffolding (category-blind; byte-exact for close_higher)
// ---------------------------------------------------------------------------

const CLOSED_BOOK_INTRO =
  "You are an independent forecasting model in a prediction league. You answer ALONE; you never see any other model's answer. Your visible output has exactly TWO parts, in this order."

const SCOUT_INTRO =
  "You are an independent forecasting model in a prediction league. You answer ALONE; you never see any other model's answer. You may reason internally, but your VISIBLE output MUST be exactly ONE line of strict JSON and nothing else — no markdown, no code fences, no preamble, no trailing text."

/** The mandatory four-line reasoning block. Category-blind: only the two side
 *  words inside EVIDENCE vary by contract. */
function reasoningBlock(sideA: string, sideB: string): string {
  return [
    'PART 1 — REASONING: exactly four labeled lines of plain text (no markdown, no code fences), at most ~150 words total. Cite actual numbers from the packet, not vague qualities.',
    'CHAIN: what the RELATED INSTRUMENTS block implies for this proposition — the cross-asset connection a single-asset analyst would miss. If the packet has no related-instruments data, write "CHAIN: no related-instrument data".',
    `EVIDENCE: which specific packet numbers argue ${sideA}, which argue ${sideB}, and which side is weightier and why.`,
    "BASE RATE: what the packet's base rate says for this horizon, and why this round should or should not deviate from it.",
    'COUNTER: the strongest argument AGAINST your own conclusion.',
  ].join('\n')
}

const PART2_LINE =
  'PART 2 — ANSWER: exactly ONE line of strict JSON as the LAST line of your output, nothing after it.'

const EXAMPLE_HEADER =
  'Example shape (replace values with your own forecast — do not copy this example verbatim):'

type PromptConfig = {
  sides: readonly [AnswerSide, AnswerSide]
  jsonKeys: readonly [string, string, string, string]
  exampleJson: string
  /** Field rules shared by both tiers (all but the rationale line). */
  fieldRules: readonly string[]
  closedBookRationaleRule: string
  scoutRationaleRule: string
}

function composeClosedBookPrompt(cfg: PromptConfig): string {
  return [
    CLOSED_BOOK_INTRO,
    '',
    reasoningBlock(cfg.sides[0], cfg.sides[1]),
    '',
    PART2_LINE,
    '',
    `Required JSON keys: ${cfg.jsonKeys.join(', ')}.`,
    '',
    EXAMPLE_HEADER,
    cfg.exampleJson,
    '',
    [...cfg.fieldRules, cfg.closedBookRationaleRule].join('\n'),
  ].join('\n')
}

function composeScoutPrompt(cfg: PromptConfig): string {
  return [
    SCOUT_INTRO,
    '',
    `Required JSON keys: ${cfg.jsonKeys.join(', ')}.`,
    '',
    EXAMPLE_HEADER,
    cfg.exampleJson,
    '',
    [...cfg.fieldRules, cfg.scoutRationaleRule, 'Return the JSON object only.'].join('\n'),
  ].join('\n')
}

const CLOSED_BOOK_RATIONALE_RULE =
  '- rationale: one concise sentence distilled from your reasoning (200 characters or fewer). Write your actual conclusion — never repeat these instructions, schema labels, or placeholder text.'
const SCOUT_RATIONALE_RULE =
  '- rationale: one concise sentence of reasoning or a key citation in plain prose (200 characters or fewer). Write your actual reasoning — never repeat these instructions, schema labels, or placeholder text.'

// ---------------------------------------------------------------------------
// Generic side-keyed extraction (binary_subject_outcome / binary_threshold)
// ---------------------------------------------------------------------------

/**
 * Finds the LAST parseable JSON object carrying a "side" key — same
 * end-scanning, string-aware brace matcher as `prediction-parse.ts`'s
 * direction-keyed finder, so reasoning prose and nested objects cannot break
 * extraction.
 */
function findLastSideJson(text: string): { obj: Record<string, unknown>; start: number } | null {
  const opens: number[] = []
  for (let i = 0; i < text.length; i++) if (text[i] === '{') opens.push(i)
  for (let c = opens.length - 1; c >= 0; c--) {
    const start = opens[c]!
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = start; i < text.length; i++) {
      const ch = text[i]
      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') inString = true
      else if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          try {
            const obj = JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>
            if (obj && typeof obj === 'object' && 'side' in obj) return { obj, start }
          } catch {
            // not valid JSON from this open brace — try the previous one
          }
          break
        }
      }
    }
  }
  return null
}

function clampProbability(raw: unknown): number | null {
  const p = Number(raw)
  return Number.isFinite(p) ? Math.max(0, Math.min(100, Math.round(p))) : null
}

function normalizeSideFields(
  obj: Record<string, unknown>,
  sides: readonly [AnswerSide, AnswerSide],
  qualifierKey: string,
  qualifierShape: 'text' | 'number'
): ContractAnswer {
  const sideRaw = typeof obj.side === 'string' ? obj.side.trim().toLowerCase() : ''
  const side = sideRaw === sides[0] || sideRaw === sides[1] ? (sideRaw as AnswerSide) : null

  let qualifierNumber: number | null = null
  let qualifierText: string | null = null
  const qRaw = obj[qualifierKey]
  if (qualifierShape === 'number') {
    if (typeof qRaw === 'number' || typeof qRaw === 'string') {
      const n = Number(qRaw)
      if (Number.isFinite(n)) qualifierNumber = n
    }
  } else if (typeof qRaw === 'string') {
    const t = qRaw.trim().slice(0, 200)
    if (t) qualifierText = t
  } else if (typeof qRaw === 'number' && Number.isFinite(qRaw)) {
    // A numeric margin ("4.5") is a legitimate text qualifier — stringify it.
    qualifierText = String(qRaw)
  }

  return {
    side,
    probability: clampProbability(obj.probability),
    qualifierNumber,
    qualifierText,
    rationale: sanitizeRationale(typeof obj.rationale === 'string' ? obj.rationale : null),
    rejectedSide: side === null,
  }
}

function parseSideAnswer(
  text: string | null,
  sides: readonly [AnswerSide, AnswerSide],
  qualifierKey: string,
  qualifierShape: 'text' | 'number'
): ContractAnswer | null {
  if (!text) return null
  const last = findLastSideJson(text)
  if (last) return normalizeSideFields(last.obj, sides, qualifierKey, qualifierShape)

  // Fence-stripped / embedded JSON fallback, mirroring the legacy parser's tolerance.
  const stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()
  const blocks = stripped.match(/\{[\s\S]*?\}/g) ?? []
  for (const block of blocks.reverse()) {
    try {
      const obj = JSON.parse(block) as Record<string, unknown>
      if (obj && typeof obj === 'object' && 'side' in obj) {
        return normalizeSideFields(obj, sides, qualifierKey, qualifierShape)
      }
    } catch {
      // keep scanning
    }
  }

  // Prose fallback: a "side": "yes" fragment inside citations/markdown.
  const sideMatch =
    stripped.match(/"side"\s*:\s*"([a-z]+)"/i) ?? stripped.match(/\bside\b\s*[:=]\s*["']?([a-z]+)["']?/i)
  if (!sideMatch) return null
  const probMatch = stripped.match(/"probability"\s*:\s*(\d+)/i)
  const obj: Record<string, unknown> = {
    side: sideMatch[1],
    ...(probMatch ? { probability: Number(probMatch[1]) } : {}),
  }
  const qMatch =
    qualifierShape === 'number'
      ? stripped.match(new RegExp(`"${qualifierKey}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, 'i'))
      : stripped.match(new RegExp(`"${qualifierKey}"\\s*:\\s*"([^"]+)"`, 'i'))
  if (qMatch) obj[qualifierKey] = qualifierShape === 'number' ? Number(qMatch[1]) : qMatch[1]
  const rationaleMatch = stripped.match(/"rationale"\s*:\s*"([^"]+)"/i)
  if (rationaleMatch) obj.rationale = rationaleMatch[1]
  return normalizeSideFields(obj, sides, qualifierKey, qualifierShape)
}

function splitSideReasoning(text: string | null): string | null {
  if (!text) return null
  const last = findLastSideJson(text)
  if (!last) return null
  return sanitizeReasoningText(text.slice(0, last.start))
}

// ---------------------------------------------------------------------------
// Contract: binary_close_higher (up|down + signed percent qualifier)
// ---------------------------------------------------------------------------

/** Max chars for a text qualifier (scoreline "2-1", margin "4.5", gap). */
export const QUALIFIER_TEXT_MAX_CHARS = 40

/** Sanity backstop for binary_threshold's predicted value — units are
 *  proposition-specific (CPI %, box-office USD, chart position), so this only
 *  catches garbled output, not a fitted range. */
export const THRESHOLD_VALUE_ABS_MAX = 1e12

const CLOSE_HIGHER_CONFIG: PromptConfig = {
  sides: ['up', 'down'],
  jsonKeys: ['direction', 'probability', 'magnitude', 'rationale'],
  exampleJson:
    '{"direction":"up","probability":72,"magnitude":2.4,"rationale":"Recent earnings beat and buyback support a higher close."}',
  fieldRules: [
    '- direction: exactly one of "up" or "down". Exactly two answers exist — never flat, abstain, neutral, or any other value. If you expect little change, still pick the closer side (up or down).',
    '- probability: your confidence in the stated direction, integer 0 through 100.',
    '- magnitude: your expected percent change over the stated horizon, as a plain number signed to match direction — positive for "up", negative for "down" (e.g. 2.4 for +2.4%, -1.1 for -1.1%). Keep it a plausible move for the horizon; an extreme value will be rejected and you will be asked again.',
  ],
  closedBookRationaleRule: CLOSED_BOOK_RATIONALE_RULE,
  scoutRationaleRule: SCOUT_RATIONALE_RULE,
}

const BINARY_CLOSE_HIGHER: AnswerContract = {
  kind: 'binary_close_higher',
  sides: CLOSE_HIGHER_CONFIG.sides,
  jsonKeys: CLOSE_HIGHER_CONFIG.jsonKeys,
  closedBookSystemPrompt: composeClosedBookPrompt(CLOSE_HIGHER_CONFIG),
  scoutSystemPrompt: composeScoutPrompt(CLOSE_HIGHER_CONFIG),
  retryInstruction: `RETRY: Your previous answer was invalid. You may write brief reasoning first, but the LAST line of your output must be exactly one JSON line: {"direction":"up"|"down","probability":0-100,"magnitude":<signed number>,"rationale":"..."}. direction must be exactly "up" or "down" — never flat, abstain, neutral, or any other value. magnitude must be a plain number signed to match direction (positive for up, negative for down) and a plausible percent move for the stated horizon — not an extreme value.`,
  packetAnswerGuidance:
    'You have the numeric market data and research above. Exactly two answers exist: up or down, plus a probability. Do NOT answer "abstain" for lack of data — the packet above is your data. Prefer the numbered blocks over prose if they disagree.',
  noPacketAnswerGuidance: (packetError?: string) =>
    `No live market-data packet is available for this instrument${packetError ? ` (${packetError})` : ''}. Use your own prior knowledge; give your best up or down call with a probability. Exactly two answers exist — never flat or abstain.`,
  scoutAnswerGuidance:
    'Use live web search to gather the most recent price/context for this instrument, then make a directional call (exactly up or down) with a probability and cite your key source in the rationale.',
  parse(text) {
    // Delegates to the legacy parser VERBATIM — this is the byte-identical
    // stocks path (direction-keyed JSON, fences, prose fallbacks).
    const parsed = parsePrediction(text)
    if (!parsed) return null
    return {
      side: parsed.direction,
      probability: parsed.probability,
      qualifierNumber: parsed.magnitude,
      qualifierText: null,
      rationale: parsed.rationale,
      rejectedSide: parsed.rejectedDirection,
    }
  },
  validate(answer, horizon) {
    // Reproduces the historical predictionInvalidReason gate exactly,
    // including the reason tokens persisted to ModelRunResult.error.
    if (!answer || !isBinaryDirection(answer.side)) return { ok: false, reason: 'non_binary_direction' }
    const mv = validateMagnitude(answer.side, answer.qualifierNumber, horizon)
    if (!mv.ok) return { ok: false, reason: `invalid_magnitude:${mv.reason}` }
    return { ok: true, side: answer.side, qualifierNumber: mv.value, qualifierText: null }
  },
  splitReasoning(text) {
    return text ? splitReasoningAndJson(text).reasoning : null
  },
}

// ---------------------------------------------------------------------------
// Contract: binary_subject_outcome (yes|no about a NAMED subject)
// ---------------------------------------------------------------------------

const SUBJECT_OUTCOME_CONFIG: PromptConfig = {
  sides: ['yes', 'no'],
  jsonKeys: ['side', 'probability', 'qualifier', 'rationale'],
  exampleJson:
    '{"side":"yes","probability":64,"qualifier":"2-1","rationale":"Stronger recent form and a rest advantage support the stated outcome."}',
  fieldRules: [
    '- side: exactly one of "yes" or "no" — whether the NAMED subject achieves the stated outcome. Exactly two answers exist — any result that is not the stated outcome (including a draw) is "no". Never abstain, never a name, never any other value.',
    '- probability: your confidence in the stated side, integer 0 through 100.',
    `- qualifier: the concrete detail behind your call, as a short string (${QUALIFIER_TEXT_MAX_CHARS} characters or fewer) — e.g. a predicted final scoreline "2-1", a predicted vote margin in points "4.5", a predicted confidence gap. Required; it is never graded.`,
  ],
  closedBookRationaleRule: CLOSED_BOOK_RATIONALE_RULE,
  scoutRationaleRule: SCOUT_RATIONALE_RULE,
}

const BINARY_SUBJECT_OUTCOME: AnswerContract = {
  kind: 'binary_subject_outcome',
  sides: SUBJECT_OUTCOME_CONFIG.sides,
  jsonKeys: SUBJECT_OUTCOME_CONFIG.jsonKeys,
  closedBookSystemPrompt: composeClosedBookPrompt(SUBJECT_OUTCOME_CONFIG),
  scoutSystemPrompt: composeScoutPrompt(SUBJECT_OUTCOME_CONFIG),
  retryInstruction: `RETRY: Your previous answer was invalid. You may write brief reasoning first, but the LAST line of your output must be exactly one JSON line: {"side":"yes"|"no","probability":0-100,"qualifier":"<short string>","rationale":"..."}. side must be exactly "yes" or "no" — whether the named subject achieves the stated outcome; any other result (including a draw) is "no". Never abstain, never a name. qualifier is required: a short string (${QUALIFIER_TEXT_MAX_CHARS} characters or fewer) with your predicted detail (scoreline, margin, gap).`,
  packetAnswerGuidance:
    'You have the research packet above. Exactly two answers exist: yes or no — does the named subject achieve the stated outcome? Do NOT answer "abstain" for lack of data — the packet above is your data. Prefer the numbered blocks over prose if they disagree.',
  noPacketAnswerGuidance: (packetError?: string) =>
    `No research packet is available for this proposition${packetError ? ` (${packetError})` : ''}. Use your own prior knowledge; give your best yes or no call with a probability. Exactly two answers exist — a draw or any other result is "no"; never abstain.`,
  scoutAnswerGuidance:
    'Use live web search to gather the most recent facts about the named subject, then answer exactly yes or no — does the subject achieve the stated outcome? — with a probability, and cite your key source in the rationale.',
  parse(text) {
    return parseSideAnswer(text, SUBJECT_OUTCOME_CONFIG.sides, 'qualifier', 'text')
  },
  validate(answer) {
    if (!answer || (answer.side !== 'yes' && answer.side !== 'no')) {
      return { ok: false, reason: 'non_binary_side' }
    }
    const q = answer.qualifierText?.trim() ?? ''
    if (!q) return { ok: false, reason: 'invalid_qualifier:missing' }
    if (q.length > QUALIFIER_TEXT_MAX_CHARS) return { ok: false, reason: 'invalid_qualifier:too_long' }
    return { ok: true, side: answer.side, qualifierNumber: null, qualifierText: q }
  },
  splitReasoning: splitSideReasoning,
}

// ---------------------------------------------------------------------------
// Contract: binary_threshold (above|below + predicted value qualifier)
// ---------------------------------------------------------------------------

const THRESHOLD_CONFIG: PromptConfig = {
  sides: ['above', 'below'],
  jsonKeys: ['side', 'probability', 'predicted_value', 'rationale'],
  exampleJson:
    '{"side":"above","probability":58,"predicted_value":3.4,"rationale":"Recent tracking data runs ahead of the consensus line."}',
  fieldRules: [
    '- side: exactly one of "above" or "below" the threshold named in the proposition. Exactly two answers exist — never at, equal, abstain, or any other value. If you expect a value near the line, still pick the closer side; an exact tie resolves per the stated resolution rule.',
    '- probability: your confidence in the stated side, integer 0 through 100.',
    '- predicted_value: your predicted actual value as a plain number, in the same units as the proposition\'s threshold. Required; it is never graded.',
  ],
  closedBookRationaleRule: CLOSED_BOOK_RATIONALE_RULE,
  scoutRationaleRule: SCOUT_RATIONALE_RULE,
}

const BINARY_THRESHOLD: AnswerContract = {
  kind: 'binary_threshold',
  sides: THRESHOLD_CONFIG.sides,
  jsonKeys: THRESHOLD_CONFIG.jsonKeys,
  closedBookSystemPrompt: composeClosedBookPrompt(THRESHOLD_CONFIG),
  scoutSystemPrompt: composeScoutPrompt(THRESHOLD_CONFIG),
  retryInstruction: `RETRY: Your previous answer was invalid. You may write brief reasoning first, but the LAST line of your output must be exactly one JSON line: {"side":"above"|"below","probability":0-100,"predicted_value":<number>,"rationale":"..."}. side must be exactly "above" or "below" — never at, equal, abstain, or any other value. predicted_value is required: a plain number in the same units as the proposition's threshold.`,
  packetAnswerGuidance:
    'You have the data packet and research above. Exactly two answers exist: above or below the stated threshold, plus a probability. Do NOT answer "abstain" for lack of data — the packet above is your data. Prefer the numbered blocks over prose if they disagree.',
  noPacketAnswerGuidance: (packetError?: string) =>
    `No data packet is available for this proposition${packetError ? ` (${packetError})` : ''}. Use your own prior knowledge; give your best above or below call with a probability. Exactly two answers exist — never at/equal, never abstain.`,
  scoutAnswerGuidance:
    'Use live web search to gather the most recent data for this proposition, then answer exactly above or below the stated threshold with a probability, and cite your key source in the rationale.',
  parse(text) {
    return parseSideAnswer(text, THRESHOLD_CONFIG.sides, 'predicted_value', 'number')
  },
  validate(answer) {
    if (!answer || (answer.side !== 'above' && answer.side !== 'below')) {
      return { ok: false, reason: 'non_binary_side' }
    }
    if (answer.qualifierNumber === null) return { ok: false, reason: 'invalid_qualifier:missing' }
    if (!Number.isFinite(answer.qualifierNumber)) return { ok: false, reason: 'invalid_qualifier:non_numeric' }
    if (Math.abs(answer.qualifierNumber) > THRESHOLD_VALUE_ABS_MAX) {
      return { ok: false, reason: 'invalid_qualifier:out_of_bounds' }
    }
    return { ok: true, side: answer.side, qualifierNumber: roundMagnitude(answer.qualifierNumber), qualifierText: null }
  },
  splitReasoning: splitSideReasoning,
}

// ---------------------------------------------------------------------------
// Registry + round prompt assembly
// ---------------------------------------------------------------------------

const CONTRACTS: Record<PropositionKind, AnswerContract> = {
  binary_close_higher: BINARY_CLOSE_HIGHER,
  binary_subject_outcome: BINARY_SUBJECT_OUTCOME,
  binary_threshold: BINARY_THRESHOLD,
}

export function answerContractFor(kind: PropositionKind): AnswerContract {
  const contract = CONTRACTS[kind]
  if (!contract) throw new Error(`answer-contract: unknown proposition_kind '${kind}'`)
  return contract
}

/** The round fields the prompt names — same shape the orchestrator resolves. */
export type PromptRound = {
  proposition_text: string
  instrument: string
  category: string
  horizon: string
  resolution_rule: string
  resolves_at: string
}

function buildPropositionBlock(round: PromptRound): string {
  return [
    `Proposition: ${round.proposition_text}`,
    `Instrument: ${round.instrument}`,
    `Category: ${round.category}`,
    `Horizon: ${round.horizon}`,
    `Resolution rule: ${round.resolution_rule}`,
    `Resolves at (UTC): ${round.resolves_at}`,
  ].join('\n')
}

/** Closer lines are category-blind — identical across all three contracts. */
const CLOSED_BOOK_CLOSER =
  'Write the four-line reasoning block (CHAIN / EVIDENCE / BASE RATE / COUNTER), then the single-line JSON object as the LAST line, exactly as described in the system message.'
const SCOUT_CLOSER = 'Respond with the single-line JSON object described in the system message.'

/**
 * Builds the two prompt variants for a round under the given contract:
 *  - price:  closed-book tiers (premier/challenger/world). Injects the packet
 *            when present; abstention for "no data" is explicitly disallowed.
 *  - scout:  research agents — NO packets; they gather live data via their own
 *            web search and cite it (the league's core experiment).
 */
export function buildRoundPrompts(
  contract: AnswerContract,
  round: PromptRound,
  injection: string | null,
  packetError?: string
): { price: string; scout: string } {
  const block = buildPropositionBlock(round)

  let price: string
  if (injection) {
    price = [block, '', injection, '', contract.packetAnswerGuidance, CLOSED_BOOK_CLOSER].join('\n')
  } else {
    price = [block, '', contract.noPacketAnswerGuidance(packetError), CLOSED_BOOK_CLOSER].join('\n')
  }

  const scout = [block, '', contract.scoutAnswerGuidance, SCOUT_CLOSER].join('\n')

  return { price, scout }
}
