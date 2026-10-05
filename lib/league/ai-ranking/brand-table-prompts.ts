import {
  BRAND_TABLE_OTHER,
  BRAND_TABLE_SIZE,
  BRAND_TABLE_CANDIDATE_TOP,
  decodeBrandTableRanking,
  encodeBrandTableRanking,
  parseBrandTableAnswer,
} from './brand-table'
import type { AnswerContract, PromptRound } from '../answer-contract'
import { splitReasoningAndJson } from '../prediction-parse'

const CLOSED_BOOK =
  "You are an independent forecasting model in a prediction league. You answer ALONE; you never see any other model's answer. Your visible output has exactly TWO parts, in this order."

const SCOUT =
  "You are an independent forecasting model in a prediction league. You answer ALONE; you never see any other model's answer. You may reason internally, but your VISIBLE output MUST be exactly ONE line of strict JSON and nothing else — no markdown, no code fences, no preamble, no trailing text."

export const BRAND_TABLE_CLOSED_BOOK_PROMPT = [
  CLOSED_BOOK,
  '',
  'PART 1 — REASONING: exactly four labeled lines of plain text (no markdown, no code fences), at most ~150 words total. Cite packet ranks and base rates, not Elo or raw scores.',
  'CHAIN: what the rank-trend and news lines imply for the top 10. If none, write "CHAIN: no related-instrument data".',
  'EVIDENCE: which packet facts support keeping the current top brands, which support reshuffles, and which side is weightier.',
  "BASE RATE: use the packet's windows= / effective n= line. Shrinkage toward 50% is already applied — do not treat overlapping windows as independent trials.",
  'COUNTER: the strongest argument AGAINST your own table.',
  '',
  'PART 2 — ANSWER: exactly ONE line of strict JSON as the LAST line of your output, nothing after it.',
  '',
  `Required JSON keys: ranking, probability, rationale.`,
  '',
  'Example shape (replace values with your own forecast — do not copy this example verbatim):',
  `{"ranking":["OpenAI","Google","Anthropic","xAI","DeepSeek","Meta","Qwen","Moonshot","MiniMax","Mistral"],"probability":58,"rationale":"Current #1 holds a wide gap; challengers are stable."}`,
  '',
  `- ranking: an ordered list of exactly ${BRAND_TABLE_SIZE} DISTINCT brands chosen ONLY from the CANDIDATES line in the packet (current top ${BRAND_TABLE_CANDIDATE_TOP} plus "${BRAND_TABLE_OTHER}").`,
  `- probability: 0–100 integer confidence that your #1 pick will be #1 on the resolving snapshot.`,
  '- rationale: one concise sentence (200 characters or fewer). Never quote Elo or raw scores.',
].join('\n')

export const BRAND_TABLE_SCOUT_PROMPT = [
  SCOUT,
  '',
  `Required JSON keys: ranking, probability, rationale.`,
  '',
  'Example shape (replace values with your own forecast — do not copy this example verbatim):',
  `{"ranking":["OpenAI","Google","Anthropic","xAI","DeepSeek","Meta","Qwen","Moonshot","MiniMax","Mistral"],"probability":58,"rationale":"Incumbent #1 still leads published leaderboards."}`,
  '',
  `- ranking: exactly ${BRAND_TABLE_SIZE} DISTINCT brands from the packet CANDIDATES list only (top ${BRAND_TABLE_CANDIDATE_TOP} plus "${BRAND_TABLE_OTHER}").`,
  `- probability: 0–100 that your #1 pick finishes #1.`,
  '- rationale: one concise sentence. Never quote Elo or raw scores.',
  'Return the JSON object only.',
].join('\n')

export const BRAND_TABLE_RETRY =
  `Retry. Output the four-line reasoning block then ONE JSON line with ranking (exactly ${BRAND_TABLE_SIZE} distinct CANDIDATES), probability (0-100), rationale.`

export const BRAND_TABLE_DIRECTION_RETRY =
  `Retry. Last line must be JSON: {"ranking":["BrandA","BrandB","BrandC","BrandD","BrandE","BrandF","BrandG","BrandH","BrandI","BrandJ"],"probability":50,"rationale":"..."}. Ten distinct CANDIDATES only.`

export const BRAND_TABLE_PICK_PROMPT = [
  'Pick the SINGLE brand most likely to be #1 on the resolving LMArena snapshot.',
  `Choose ONLY from the CANDIDATES list (top ${BRAND_TABLE_CANDIDATE_TOP} plus "${BRAND_TABLE_OTHER}").`,
  'Return ONE JSON line: {"pick":"OpenAI","probability":55,"rationale":"..."}.',
  'probability is 0–100 that this brand is #1. Never quote Elo or raw scores.',
].join('\n')

function block(round: PromptRound): string {
  return [
    `Proposition: ${round.proposition_text}`,
    `Instrument: ${round.instrument}`,
    `Category: ${round.category}`,
    `Horizon: ${round.horizon}`,
    `Resolution rule: ${round.resolution_rule}`,
    `Resolves at (UTC): ${round.resolves_at}`,
  ].join('\n')
}

export function buildBrandTablePrompts(
  round: PromptRound,
  injection: string | null,
  packetError?: string,
): { price: string; scout: string } {
  const head = block(round)
  const packet = injection
    ? `DATA PACKET (closed book — use only this):\n${injection}`
    : `No packet available${packetError ? ` (${packetError})` : ''}. Still name five CANDIDATES if the proposition lists them; otherwise abstain by returning unparseable JSON.`
  return {
    price: `${head}\n\n${packet}\n\nWrite the four-line reasoning block (CHAIN / EVIDENCE / BASE RATE / COUNTER), then the single-line JSON object as the LAST line, exactly as described in the system message.`,
    scout: `${head}\n\nRespond with the single-line JSON object described in the system message.`,
  }
}

export function makeBrandTableContract(candidates: readonly string[]): AnswerContract {
  return {
    kind: 'binary_subject_outcome',
    sides: ['yes', 'no'],
    jsonKeys: ['ranking', 'probability', 'rationale'],
    closedBookSystemPrompt: BRAND_TABLE_CLOSED_BOOK_PROMPT,
    scoutSystemPrompt: BRAND_TABLE_SCOUT_PROMPT,
    retryInstruction: BRAND_TABLE_RETRY,
    directionOnlyRetryInstruction: BRAND_TABLE_DIRECTION_RETRY,
    packetAnswerGuidance:
      'Use the CANDIDATES line. ranking must be ten distinct names from that list. Do not quote Elo or scores.',
    noPacketAnswerGuidance: () =>
      'No packet. Still return ten distinct CANDIDATES if you can name the current top brands; otherwise the seat is unparseable.',
    scoutAnswerGuidance:
      'Search public LMArena rankings. ranking must be ten distinct brands from the current top 15 plus 기타·신규. No Elo.',
    parse(text) {
      const parsed = parseBrandTableAnswer(text, candidates)
      if (!parsed.ok) {
        return {
          side: null,
          probability: null,
          qualifierNumber: null,
          qualifierText: null,
          rationale: null,
          strongestCounter: null,
          counterMissing: false,
          rejectedSide: true,
          parseFailure: 'unparseable',
        }
      }
      return {
        side: 'yes',
        probability: parsed.answer.probability,
        qualifierNumber: null,
        qualifierText: encodeBrandTableRanking(parsed.answer.ranking),
        rationale: parsed.answer.rationale,
        strongestCounter: null,
        counterMissing: false,
        rejectedSide: false,
      }
    },
    validate(answer) {
      if (!answer?.qualifierText) return { ok: false, reason: 'unparseable' }
      const ranking = decodeBrandTableRanking(answer.qualifierText)
      if (ranking.length !== BRAND_TABLE_SIZE) return { ok: false, reason: 'wrong_size' }
      if (new Set(ranking).size !== BRAND_TABLE_SIZE) return { ok: false, reason: 'not_distinct' }
      return { ok: true, side: 'yes', qualifierNumber: null, qualifierText: answer.qualifierText }
    },
    ledgerFields(v) {
      return { magnitudePct: null, qualifierText: v.qualifierText }
    },
    splitReasoning(text) {
      return splitReasoningAndJson(text).reasoning
    },
  }
}
