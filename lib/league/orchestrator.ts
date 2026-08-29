import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import { runSingleAiProvider } from '@/lib/ai/router'
import { callPlatformModel } from '@/lib/ai/platform-providers'
import {
  getRoster,
  computeCostUsd,
  type RosterEntry,
  type LeagueTier,
  type Camp,
} from '@/lib/league/roster'
import { adapterForLedgerCategory } from '@/lib/league/gateway/adapters/registry.server'
import { buildPriceSeriesPacket } from '@/lib/league/gateway/adapters/price-series-packet'
import { LIVE_PRICE_SERIES_IO } from '@/lib/league/gateway/adapters/price-series-io.server'
import type { CategoryPacket, PacketBuildContext } from '@/lib/league/gateway/types'
import {
  isBinaryDirection,
  parsePrediction,
  sanitizeRationale,
  splitReasoningAndJson,
  type ParsedPrediction,
} from '@/lib/league/prediction-parse'
import { resolveOpenPhase } from '@/lib/league/open-phase'
import { binaryCallsFromModels, dualConsensus } from '@/lib/league/log-odds-consensus'
import { aggregateMagnitude, validateMagnitude } from '@/lib/league/magnitude'

/**
 * AI Prediction League — generation orchestrator (server engine only).
 *
 * Takes ONE proposition, asks the roster INDEPENDENTLY (no debate, no
 * cross-talk — each model sees only the shared prompt), parses each answer into
 * structured fields, and writes rows into the existing prediction_rounds /
 * model_predictions ledger. DB write is the source of truth and happens
 * PER-MODEL as each returns (never batched at the end).
 *
 * ISOLATION:
 *  - Reuses runSingleAiProvider / callPlatformModel — NO new provider clients.
 *  - Calls runSingleAiProvider with sessionId = null, so it writes NOTHING to
 *    ai_responses / model_cost_logs / scores / debate_logs. Verdict/Compare
 *    insert paths are untouched; this engine writes only to the two ledger
 *    tables via the service-role client.
 *  - No UI, no SSE/streaming, no credit charging in this pass.
 */

const DEFAULT_CONCURRENCY = 6
const DEFAULT_TIMEOUT_MS = 60_000
// Run default. Raised 1200 → 3000 when the visible reasoning block (PART 1 of
// CLOSED_BOOK_SYSTEM_PROMPT) became mandatory: ~150 words of reasoning plus the
// JSON line needs ~400-600 visible tokens, and models with hidden reasoning
// spend from the same budget — a tight cap reproduces the empty-content
// failures documented in roster.ts. Heavy hidden reasoners carry larger
// per-entry overrides there.
const DEFAULT_MAX_COMPLETION_TOKENS = 3000
const PREMIER_MAX_COMPLETION_TOKENS = 5000
/** Kill-switch default when LEAGUE_RUN_COST_CAP_USD is unset/invalid. */
const FALLBACK_COST_CAP_USD = 20

/**
 * Closed-book tiers (premier/challenger/world): a reasoning league must ask
 * for reasoning. PART 1 is a mandatory four-line visible reasoning block —
 * cross-asset chain, numeric evidence weighing, base-rate deviation, and the
 * strongest self-counterargument — persisted verbatim to
 * model_predictions.reasoning_text. PART 2 is the answer JSON, unchanged in
 * shape, required to be the LAST line so `splitReasoningAndJson` can split
 * mixed output deterministically.
 */
const CLOSED_BOOK_SYSTEM_PROMPT = `You are an independent forecasting model in a prediction league. You answer ALONE; you never see any other model's answer. Your visible output has exactly TWO parts, in this order.

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

/**
 * Scout keeps the original JSON-only contract: their experiment is
 * self-directed web search, their output already interleaves citations, and
 * their budgets (1600-2500) were sized for search overhead — the reasoning
 * block is a closed-book-packet exercise they cannot perform (no packet).
 */
const SCOUT_SYSTEM_PROMPT = `You are an independent forecasting model in a prediction league. You answer ALONE; you never see any other model's answer. You may reason internally, but your VISIBLE output MUST be exactly ONE line of strict JSON and nothing else — no markdown, no code fences, no preamble, no trailing text.

Required JSON keys: direction, probability, magnitude, rationale.

Example shape (replace values with your own forecast — do not copy this example verbatim):
{"direction":"up","probability":72,"magnitude":2.4,"rationale":"Recent earnings beat and buyback support a higher close."}

- direction: exactly one of "up" or "down". Exactly two answers exist — never flat, abstain, neutral, or any other value. If you expect little change, still pick the closer side (up or down).
- probability: your confidence in the stated direction, integer 0 through 100.
- magnitude: your expected percent change over the stated horizon, as a plain number signed to match direction — positive for "up", negative for "down" (e.g. 2.4 for +2.4%, -1.1 for -1.1%). Keep it a plausible move for the horizon; an extreme value will be rejected and you will be asked again.
- rationale: one concise sentence of reasoning or a key citation in plain prose (200 characters or fewer). Write your actual reasoning — never repeat these instructions, schema labels, or placeholder text.
Return the JSON object only.`

/** Appended once when the first answer has an invalid direction and/or magnitude.
 *  Tier-neutral: brief reasoning before the JSON is allowed (closed-book) but the
 *  LAST line must be the answer JSON (both tiers' parse path). */
const PREDICTION_RETRY_INSTRUCTION = `RETRY: Your previous answer was invalid. You may write brief reasoning first, but the LAST line of your output must be exactly one JSON line: {"direction":"up"|"down","probability":0-100,"magnitude":<signed number>,"rationale":"..."}. direction must be exactly "up" or "down" — never flat, abstain, neutral, or any other value. magnitude must be a plain number signed to match direction (positive for up, negative for down) and a plausible percent move for the stated horizon — not an extreme value.`

type ItemType = 'ranked' | 'on_demand'

export type RoundInput =
  | { roundId: string }
  | {
      proposition_text: string
      category: string
      instrument: string
      horizon: string
      resolution_rule: string
      resolves_at: string
      item_type?: ItemType
      season_id?: string | null
      cache_key?: string | null
    }

export type GenerateOptions = {
  round: RoundInput
  /** Roster subset by tier — run 'world' first to keep the cost test cheap. */
  tiers?: LeagueTier[]
  concurrency?: number
  timeoutMs?: number
  /** Override completion-token budget (premier-only runs default to 5000, others 3000; roster entries may override per model). */
  maxCompletionTokens?: number
  /** Override kill-switch (else LEAGUE_RUN_COST_CAP_USD, else $20). */
  costCapUsd?: number
  /** Admin user id for optional BYOK key reads (core models). Platform models ignore it. */
  userId?: string | null
  /**
   * LIVE STREAM HOOK (optional, additive — no-op for every existing caller
   * that doesn't pass it): invoked once the round row is resolved/created,
   * before any model calls start. Lets a streaming route emit an early
   * "round" line with the round_id the client needs to reconcile from
   * `GET /api/league/card` later, plus `rosterSize` so the client can show a
   * lightweight "N of rosterSize answered" progress state without guessing.
   */
  onRoundResolved?: (round: { id: string; created: boolean; rosterSize: number }) => void
  /**
   * LIVE STREAM HOOK (optional, additive): invoked once per model, right
   * after that model's `model_predictions` row has been written (DB write
   * happens inside `runOneModel`, this fires immediately after — the callback
   * NEVER fires before the row exists, preserving "DB is truth, stream is
   * just a display of what was just persisted"). Does not change concurrency,
   * the kill-switch, or abstain/timeout handling in any way — it is a pure
   * side-effect tap on the existing `results.push(outcome)` in the worker loop.
   */
  onModelResult?: (result: ModelRunResult) => void
}

type ModelStatus = 'ok' | 'abstain' | 'timeout' | 'error'

export type ModelRunResult = {
  model_id: string
  /** Actual model string the provider ran (audit trail for substitutions). */
  actual_model: string
  brand: string
  camp: Camp
  tier: LeagueTier
  direction: 'up' | 'down' | null
  probability: number | null
  /** Validated expected percent change over the horizon, signed to match `direction`. Decoration only — never read by grading. */
  magnitude: number | null
  reasoning_snippet: string | null
  /** Full visible reasoning block (PART 1, pre-JSON text), verbatim minus fences, capped at 4000 chars. Null on error/legacy/JSON-only outputs. */
  reasoning_text: string | null
  cost_usd: number
  /**
   * Token × roster list-price estimate for the same call(s). Always stored
   * so we can see how far off the estimate was when `cost_usd` is billed.
   */
  estimated_cost_usd: number
  /** xAI Agent Tools invocation count. Null for models that do not report one. */
  server_side_tools_used: number | null
  /** Raw xAI `cost_in_usd_ticks` (summed across retries). Null if never reported. */
  cost_in_usd_ticks: number | null
  prompt_tokens: number | null
  completion_tokens: number | null
  /** 'billed' = provider-reported actual/documented cost. 'estimated' = our token×list-price fallback. */
  cost_source: 'billed' | 'estimated'
  status: ModelStatus
  error?: string
}

export type GenerateResult = {
  round_id: string
  created: boolean
  data_packet: { available: boolean; symbol?: string; latestClose?: number; error?: string }
  research: {
    available: boolean
    cached: boolean
    costUsd: number
    queries: string[]
    /** v2 (D): dispersion-decided budget tier + the signal that picked it. */
    tier: string
    tierSignal: string
    error?: string
  }
  /** v2 (A): Twelve Data credits spent on related series this run (cache hits free). */
  related_credits_spent: number
  results: ModelRunResult[]
  total_cost_usd: number
  capped: boolean
  cost_cap_usd: number
}

type ResolvedRound = {
  id: string
  proposition_text: string
  category: string
  instrument: string
  horizon: string
  resolution_rule: string
  resolves_at: string
}

/**
 * Denormalized traffic-light bucket for prediction_rounds.color_bucket.
 * green  = clean, machine-resolvable price series.
 * yellow = resolvable but noisier / event-timed.
 * red    = subjective / hard-to-auto-resolve.
 */
const CATEGORY_COLOR: Record<string, 'green' | 'yellow' | 'red'> = {
  stock: 'green',
  etf_index: 'green',
  gold_metal: 'green',
  macro_econ: 'green',
  bond_rate: 'green',
  fx: 'yellow',
  crypto_spot: 'yellow',
  crypto_perps: 'yellow',
  commodity_energy: 'yellow',
  futures_derivatives: 'yellow',
  politics_election: 'yellow',
  real_estate: 'yellow',
  sports: 'red',
  entertainment_awards: 'red',
  memecoin: 'red',
}

function colorForCategory(category: string): 'green' | 'yellow' | 'red' {
  return CATEGORY_COLOR[category] ?? 'yellow'
}

async function ensureRound(input: RoundInput): Promise<{ round: ResolvedRound; created: boolean }> {
  if ('roundId' in input) {
    const { data, error } = await supabaseAdmin
      .from('prediction_rounds')
      .select('id, proposition_text, category, instrument, horizon, resolution_rule, resolves_at')
      .eq('id', input.roundId)
      .single()
    if (error || !data) {
      throw new Error(`Round not found: ${input.roundId}${error ? ` (${error.message})` : ''}`)
    }
    return { round: data as ResolvedRound, created: false }
  }

  if (!input.resolves_at) throw new Error('resolves_at is required when creating a round')

  const itemType: ItemType = input.item_type ?? 'ranked'
  const openPhase = resolveOpenPhase(input.instrument, new Date())
  const { data, error } = await supabaseAdmin
    .from('prediction_rounds')
    .insert({
      proposition_text: input.proposition_text,
      category: input.category,
      color_bucket: colorForCategory(input.category),
      item_type: itemType,
      instrument: input.instrument,
      horizon: input.horizon,
      resolution_rule: input.resolution_rule,
      resolves_at: input.resolves_at,
      season_id: input.season_id ?? null,
      cache_key: input.cache_key ?? null,
      open_phase: openPhase,
    })
    .select('id, proposition_text, category, instrument, horizon, resolution_rule, resolves_at')
    .single()

  if (error || !data) throw new Error(`Failed to create round: ${error?.message ?? 'unknown'}`)
  return { round: data as ResolvedRound, created: true }
}

/**
 * Best-effort write of the round's ANCHOR price (see the doc comment at the
 * `persistAnchorPrice` call site in `generatePredictions`). Never throws —
 * a failure here degrades the card header to "no anchor price" (a state the
 * UI already renders correctly for pre-migration rounds), not a generation
 * failure. Deliberately NOT part of `ensureRound`'s insert: the packet fetch
 * that produces this price happens one line after `ensureRound` returns, and
 * duplicating that fetch earlier just to inline it into the insert would cost
 * an extra, redundant Twelve Data call.
 */
/**
 * Write-once snapshot of the exact closed-book injection. The `.is(..., null)`
 * guard is the same contract as the anchor: a later packet rebuild must not
 * erase what the original graded models saw.
 */
async function persistClosedBookPacket(roundId: string, cacheKey: string, text: string): Promise<void> {
  try {
    await supabaseAdmin
      .from('prediction_rounds')
      .update({
        closed_book_packet_cache_key: cacheKey,
        closed_book_packet_text: text,
      })
      .eq('id', roundId)
      .is('closed_book_packet_text', null)
  } catch {
    // best-effort — generation still proceeds; the reproduce test fails closed
    // if the write didn't land, which is the point of the audit trail.
  }
}

async function persistConsensusAggregates(
  roundId: string,
  results: readonly { direction: 'up' | 'down' | null; probability: number | null; magnitude: number | null }[],
): Promise<void> {
  try {
    const dual = dualConsensus(binaryCallsFromModels(results))
    const magnitude = aggregateMagnitude(results, dual.aggregate.direction)
    await supabaseAdmin
      .from('prediction_rounds')
      .update({
        consensus_majority_direction: dual.majority.direction,
        consensus_majority_probability: dual.majority.probability,
        consensus_aggregate_direction: dual.aggregate.direction,
        consensus_aggregate_probability: dual.aggregate.probability,
        consensus_aggregate_magnitude_pct: magnitude.medianPct,
        consensus_aggregate_magnitude_n: magnitude.n,
      })
      .eq('id', roundId)
  } catch {
    // best-effort — card still recomputes live from model rows
  }
}

async function persistAnchorPrice(
  roundId: string,
  price: number,
  sessionDate: string | null
): Promise<void> {
  try {
    await supabaseAdmin
      .from('prediction_rounds')
      .update({
        anchor_price: price,
        anchor_price_at: new Date().toISOString(),
        ...(sessionDate ? { anchor_session_date: sessionDate } : {}),
      })
      .eq('id', roundId)
  } catch {
    // best-effort — see doc comment above
  }
}

function buildPropositionBlock(round: ResolvedRound): string {
  return [
    `Proposition: ${round.proposition_text}`,
    `Instrument: ${round.instrument}`,
    `Category: ${round.category}`,
    `Horizon: ${round.horizon}`,
    `Resolution rule: ${round.resolution_rule}`,
    `Resolves at (UTC): ${round.resolves_at}`,
  ].join('\n')
}

/**
 * Builds the two prompt variants for a round:
 *  - price:  premier/challenger/world. Injects the Twelve Data packet AND the
 *            shared research packet (identical text for every closed-book
 *            model — fairness); when a packet is present, abstention for "no
 *            data" is explicitly disallowed. Binary up/down only.
 *  - scout:  research agents (You.com / Perplexity / grounded Gemini / ...).
 *            NO packets — they gather live data via their own web search and
 *            cite it. Keeping Scout packet-free is the league's core
 *            experiment: self-directed search vs reasoning from a fixed packet.
 */
function buildPrompts(round: ResolvedRound, injection: string | null, packetError?: string): { price: string; scout: string } {
  const block = buildPropositionBlock(round)
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

function isTransient(errMsg: string): boolean {
  const m = errMsg.toLowerCase()
  return (
    m.includes('timeout') ||
    m.includes('aborterror') ||
    m.includes('429') ||
    m.includes('rate limit') ||
    m.includes('500') ||
    m.includes('502') ||
    m.includes('503') ||
    m.includes('504') ||
    m.includes('econnreset') ||
    m.includes('etimedout')
  )
}

function isTimeout(errMsg: string): boolean {
  const m = errMsg.toLowerCase()
  return m.includes('timeout') || m.includes('aborterror') || m.includes('etimedout')
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const e = new Error(`${label} timeout after ${ms}ms`)
      e.name = 'TimeoutError'
      reject(e)
    }, ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    clearTimeout(timer!)
  }
}

type RawCall = {
  text: string | null
  promptTokens: number | null
  completionTokens: number | null
  actualModel: string
  /** Cost (USD) when the provider reports one — real billed (OpenRouter, Perplexity, xAI ticks) or a documented flat-rate estimate (You.com). Null otherwise. */
  costUsd: number | null
  /** True when costUsd came from a documented estimate rather than per-call billed telemetry. Meaningless when costUsd is null. */
  costIsEstimated: boolean
  serverSideToolsUsed: number | null
  costInUsdTicks: number | null
  /**
   * Tool fee on top of tokens, when NOT already folded into costUsd
   * (Anthropic web_search; OpenAI search-api estimate).
   */
  toolFeeUsd: number | null
  error?: string
}

/** Tier-appropriate system prompt: closed-book tiers carry the mandatory
 *  reasoning-block contract; scout keeps the original JSON-only contract. */
function systemPromptFor(entry: RosterEntry): string {
  return entry.league_tier === 'scout' ? SCOUT_SYSTEM_PROMPT : CLOSED_BOOK_SYSTEM_PROMPT
}

/** Single provider call via the appropriate EXISTING utility (no timeout/retry here). */
async function callOnce(
  entry: RosterEntry,
  userPrompt: string,
  timeoutMs: number,
  userId: string | null,
  maxCompletionTokens: number
): Promise<RawCall> {
  if (entry.caller.kind === 'core') {
    const res = await runSingleAiProvider({
      supabase: supabaseAdmin,
      authSupabase: supabaseAdmin,
      // CRITICAL: null session => no ai_responses/model_cost_logs/scores writes.
      sessionId: null,
      userId: userId ?? null,
      provider: entry.caller.provider,
      prompt: userPrompt,
      systemPrompt: systemPromptFor(entry),
      // Truthy only to enable an admin BYOK lookup; RLS bypass is via supabaseAdmin.
      supabaseAccessToken: userId ? 'league-admin' : undefined,
      skipLanguageInjection: true,
      maxCompletionTokens,
      modelOverride: entry.caller.modelOverride,
      allowGeminiThinking: entry.caller.allowGeminiThinking,
      searchTool: entry.caller.searchTool,
      maxTurns: entry.caller.maxTurns,
      timeoutMs,
    })
    return {
      text: res.text,
      promptTokens: res.promptTokens,
      completionTokens: res.completionTokens,
      actualModel: res.model || entry.model_id,
      // Billed USD when the provider reports one (xAI ticks, Perplexity
      // total_cost, OpenRouter usage.cost). Null → token×list-price estimate.
      costUsd: res.costUsd ?? null,
      costIsEstimated: false,
      serverSideToolsUsed: res.serverSideToolsUsed ?? null,
      costInUsdTicks: res.costInUsdTicks ?? null,
      toolFeeUsd: res.toolFeeUsd ?? null,
      error: res.error,
    }
  }  // Platform caller has no built-in external timeout — race it here.
  const res = await withTimeout(
    callPlatformModel({
      id: entry.caller.platformId,
      systemPrompt: systemPromptFor(entry),
      userPrompt,
      maxCompletionTokens,
    }),
    timeoutMs,
    entry.model_id
  )
  return {
    text: res.text,
    promptTokens: res.usage?.promptTokens ?? null,
    completionTokens: res.usage?.completionTokens ?? null,
    actualModel: entry.model_id,
    costUsd: res.costUsd ?? null,
    costIsEstimated: !!res.costIsEstimated,
    serverSideToolsUsed: null,
    costInUsdTicks: null,
    toolFeeUsd: null,
    error: res.error,
  }
}

/** Call with a single retry on transient failure. Timeouts surface as errors, not throws. */
async function callWithRetry(
  entry: RosterEntry,
  userPrompt: string,
  timeoutMs: number,
  userId: string | null,
  maxCompletionTokens: number
): Promise<RawCall> {
  try {
    const first = await callOnce(entry, userPrompt, timeoutMs, userId, maxCompletionTokens)
    if (first.error && isTransient(first.error)) {
      const second = await callOnce(entry, userPrompt, timeoutMs, userId, maxCompletionTokens)
      return second
    }
    return first
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown error'
    if (isTransient(msg)) {
      try {
        return await callOnce(entry, userPrompt, timeoutMs, userId, maxCompletionTokens)
      } catch (e2: unknown) {
        return { text: null, promptTokens: null, completionTokens: null, actualModel: entry.model_id, costUsd: null, costIsEstimated: false, serverSideToolsUsed: null, costInUsdTicks: null, toolFeeUsd: null, error: e2 instanceof Error ? e2.message : 'unknown error' }
      }
    }
    return { text: null, promptTokens: null, completionTokens: null, actualModel: entry.model_id, costUsd: null, costIsEstimated: false, serverSideToolsUsed: null, costInUsdTicks: null, toolFeeUsd: null, error: msg }
  }
}

/**
 * Runs one model and writes its ledger row immediately (per-model source of
 * truth). Returns the outcome for the aggregate report.
 *
 * A row is written for EVERY attempted model — the card renders the full
 * roster, so a model that fails must not silently vanish from the board:
 * - timeout / hard error → status timeout|error, row written with null
 *   direction/value/snippet and cost 0 (renders as "no opinion", never
 *   scores as wrong). A re-run upserts over it with a real answer.
 * - non-binary answer (flat/abstain/neutral/…) → one stricter retry; if still
 *   not up/down → status error, null direction (NOT stored as a prediction,
 *   NOT counted in hit denominators).
 * - scout tier → same directional storage as other tiers (self-directed
 *   search); reconciliation grades scout on direction like everyone else.
 *
 * Rows are keyed by the roster's canonical model_id (not the provider's
 * reported actual model) so two slots sharing one actual model string
 * (e.g. challenger gemini-3.6-flash vs scout gemini-3.6-flash-grounded)
 * never collide on the (round_id, model_id) unique key.
 *
 * Timeouts: `callWithRetry` retries once on transient failure (including
 * timeout). Default timeout is DEFAULT_TIMEOUT_MS (60s); roster entries may
 * set `timeoutMs` per model (e.g. deepseek-v4-pro 240s, grok-4.6-livesearch 150s).
 */
/**
 * Combined validity gate for direction + magnitude: a model's answer is only
 * usable when BOTH are valid. `magnitude` is required exactly like
 * `direction` — a missing/non-numeric/out-of-bounds/wrong-signed value fails
 * this gate the same way a non-binary direction does, and both share the
 * SAME one-retry-then-error budget (see `runOneModel`'s single retry call
 * below) rather than each getting its own retry.
 */
function predictionInvalidReason(parsed: ParsedPrediction | null, horizon: string): string | null {
  if (!isBinaryDirection(parsed?.direction)) return 'non_binary_direction'
  const mv = validateMagnitude(parsed!.direction, parsed!.magnitude, horizon)
  return mv.ok ? null : `invalid_magnitude:${mv.reason}`
}

async function runOneModel(
  entry: RosterEntry,
  roundId: string,
  userPrompt: string,
  timeoutMs: number,
  userId: string | null,
  maxCompletionTokens: number,
  horizon: string
): Promise<ModelRunResult> {
  let raw = await callWithRetry(entry, userPrompt, timeoutMs, userId, maxCompletionTokens)
  let totalCostUsd = 0
  let estimatedCostUsd = 0
  let toolsUsed: number | null = null
  let ticksSum: number | null = null
  let costSource: 'billed' | 'estimated' = 'estimated'

  const base = { model_id: entry.model_id, actual_model: raw.actualModel, brand: entry.brand, camp: entry.camp, tier: entry.league_tier }

  const accumulateCost = (call: RawCall) => {
    const estimate = computeCostUsd(entry, call.promptTokens, call.completionTokens)
    estimatedCostUsd += estimate
    const hasProviderCost = typeof call.costUsd === 'number'
    // Prefer the provider's billed figure when it reports one. The estimate
    // is kept separately so we can see how far off the roster price was.
    // Tool fees (Anthropic web_search, OpenAI search-api estimate) are NOT
    // inside costUsd for those providers — add them on top. xAI ticks and
    // Perplexity total_cost already include tool/request fees.
    const toolFee = typeof call.toolFeeUsd === 'number' ? call.toolFeeUsd : 0
    totalCostUsd += (hasProviderCost ? call.costUsd! : estimate) + toolFee
    if (hasProviderCost && !call.costIsEstimated) costSource = 'billed'
    if (typeof call.serverSideToolsUsed === 'number') {
      toolsUsed = (toolsUsed ?? 0) + call.serverSideToolsUsed
    }
    if (typeof call.costInUsdTicks === 'number') {
      ticksSum = (ticksSum ?? 0) + call.costInUsdTicks
    }
  }

  const ledger = () => ({
    estimated_cost_usd: Number(estimatedCostUsd.toFixed(6)),
    server_side_tools_used: toolsUsed,
    cost_in_usd_ticks: ticksSum,
    prompt_tokens: raw.promptTokens,
    completion_tokens: raw.completionTokens,
  })

  if (raw.error) {
    const status: ModelStatus = isTimeout(raw.error) ? 'timeout' : 'error'
    await upsertNullPrediction(roundId, entry)
    return {
      ...base,
      direction: null,
      probability: null,
      magnitude: null,
      reasoning_snippet: null,
      reasoning_text: null,
      cost_usd: 0,
      ...ledger(),
      estimated_cost_usd: 0,
      cost_source: 'estimated',
      status,
      error: raw.error,
    }
  }

  accumulateCost(raw)
  let parsed = parsePrediction(raw.text)

  // Invalid direction and/or magnitude (flat/abstain/missing/out-of-bounds/wrong-signed):
  // one stricter retry naming BOTH requirements, then error.
  let reason = predictionInvalidReason(parsed, horizon)
  if (reason) {
    const retryPrompt = `${userPrompt}\n\n${PREDICTION_RETRY_INSTRUCTION}`
    const retryRaw = await callWithRetry(entry, retryPrompt, timeoutMs, userId, maxCompletionTokens)
    if (retryRaw.error) {
      await upsertNullPrediction(roundId, entry)
      return {
        ...base,
        actual_model: retryRaw.actualModel,
        direction: null,
        probability: null,
        magnitude: null,
        reasoning_snippet: null,
        reasoning_text: null,
        cost_usd: Number(totalCostUsd.toFixed(6)),
        ...ledger(),
        cost_source: costSource,
        status: isTimeout(retryRaw.error) ? 'timeout' : 'error',
        error: retryRaw.error,
      }
    }
    accumulateCost(retryRaw)
    raw = retryRaw
    parsed = parsePrediction(retryRaw.text)
    reason = predictionInvalidReason(parsed, horizon)
  }

  if (reason) {
    await upsertNullPrediction(roundId, entry)
    return {
      ...base,
      actual_model: raw.actualModel,
      direction: null,
      probability: null,
      magnitude: null,
      reasoning_snippet: null,
      reasoning_text: null,
      cost_usd: Number(totalCostUsd.toFixed(6)),
      ...ledger(),
      cost_source: costSource,
      status: 'error',
      error: reason,
    }
  }

  const rationale =
    sanitizeRationale(parsed!.rationale) ??
    sanitizeRationale(raw.text ? raw.text.trim().slice(0, 500) : null)
  // Visible reasoning block (everything before the final answer JSON). Stored
  // for every tier — scout's pre-JSON prose (citations) is raw material too.
  // reasoning_snippet stays the one-line display rationale; this is the full text.
  const reasoningText = raw.text ? splitReasoningAndJson(raw.text).reasoning : null
  const probability = parsed!.probability ?? null
  const direction = parsed!.direction
  // `reason` (checked above) already screened out a non-binary direction via
  // `predictionInvalidReason` -> `isBinaryDirection`, so this narrows what
  // `parsed!.direction`'s static type (`BinaryDirection | null`) cannot express.
  if (!isBinaryDirection(direction)) throw new Error('unreachable: non-binary direction reached persistence')
  const magnitudeValidation = validateMagnitude(direction, parsed!.magnitude, horizon)
  const magnitude = magnitudeValidation.ok ? magnitudeValidation.value : null

  await supabaseAdmin
    .from('model_predictions')
    .upsert(
      {
        round_id: roundId,
        model_id: entry.model_id,
        brand: entry.brand,
        camp: entry.camp,
        league_tier: entry.league_tier,
        predicted_direction: direction,
        predicted_value: probability,
        predicted_magnitude_pct: magnitude,
        reasoning_snippet: rationale,
        reasoning_text: reasoningText,
        prompt_tokens: raw.promptTokens,
        completion_tokens: raw.completionTokens,
        reasoning_tokens: null,
        cost_usd: totalCostUsd,
        estimated_cost_usd: estimatedCostUsd,
        server_side_tools_used: toolsUsed,
      },
      { onConflict: 'round_id,model_id' }
    )

  return {
    ...base,
    actual_model: raw.actualModel,
    direction,
    probability,
    magnitude,
    reasoning_snippet: rationale,
    reasoning_text: reasoningText,
    cost_usd: Number(totalCostUsd.toFixed(6)),
    ...ledger(),
    cost_source: costSource,
    status: 'ok',
  }
}

async function upsertNullPrediction(roundId: string, entry: RosterEntry): Promise<void> {
  await supabaseAdmin
    .from('model_predictions')
    .upsert(
      {
        round_id: roundId,
        model_id: entry.model_id,
        brand: entry.brand,
        camp: entry.camp,
        league_tier: entry.league_tier,
        predicted_direction: null,
        predicted_value: null,
        predicted_magnitude_pct: null,
        reasoning_snippet: null,
        reasoning_text: null,
        prompt_tokens: null,
        completion_tokens: null,
        reasoning_tokens: null,
        cost_usd: 0,
        estimated_cost_usd: 0,
        server_side_tools_used: null,
      },
      { onConflict: 'round_id,model_id' }
    )
}

function resolveCostCap(override?: number): number {
  if (typeof override === 'number' && override > 0) return override
  const raw = Number(process.env.LEAGUE_RUN_COST_CAP_USD)
  return Number.isFinite(raw) && raw > 0 ? raw : FALLBACK_COST_CAP_USD
}

function resolveMaxCompletionTokens(opts: GenerateOptions): number {
  if (opts.maxCompletionTokens && opts.maxCompletionTokens > 0) return opts.maxCompletionTokens
  const premierOnly = opts.tiers?.length === 1 && opts.tiers[0] === 'premier'
  return premierOnly ? PREMIER_MAX_COMPLETION_TOKENS : DEFAULT_MAX_COMPLETION_TOKENS
}

function resolveMaxCompletionTokensForEntry(entry: RosterEntry, runDefault: number): number {
  return entry.maxCompletionTokens && entry.maxCompletionTokens > 0
    ? entry.maxCompletionTokens
    : runDefault
}

export async function generatePredictions(opts: GenerateOptions): Promise<GenerateResult> {
  const { round: roundInput, tiers, userId, onRoundResolved, onModelResult } = opts
  const concurrency = opts.concurrency && opts.concurrency > 0 ? opts.concurrency : DEFAULT_CONCURRENCY
  const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS
  const costCap = resolveCostCap(opts.costCapUsd)
  const maxCompletionTokens = resolveMaxCompletionTokens(opts)

  // Pure/synchronous config lookup — safe to resolve before the round exists,
  // so onRoundResolved can report rosterSize in the same callback.
  const roster = getRoster(tiers)

  const { round, created } = await ensureRound(roundInput)
  onRoundResolved?.({ id: round.id, created, rosterSize: roster.length })
  // PACKET ASSEMBLY is CATEGORY JUDGMENT and lives behind
  // `CategoryAdapter.buildPacket` (stocks today; the other 11 chips fall back
  // to the same price-series builder until their adapters exist). The shell
  // keeps only the DB side effects the adapter requests via events:
  //  - anchor_price: persist the ANCHOR price (best-effort, presentation only
  //    — never read by grading/reconciliation): the card header shows "what
  //    the instrument was at when this round opened" so a model's up/down
  //    call is legible. Only stamped once, at creation — never overwritten on
  //    a re-run of an existing round (`{ roundId }` input skips `created`),
  //    so the anchor always reflects the ORIGINAL open.
  const packetCtx: PacketBuildContext = {
    round,
    costCapUsd: costCap,
    onEvent: async (event) => {
      if (event.kind === 'anchor_price' && created) {
        await persistAnchorPrice(round.id, event.price, event.sessionDate)
      }
    },
  }
  const adapter = adapterForLedgerCategory(round.category)
  const pkt: CategoryPacket = adapter
    ? await adapter.buildPacket(adapter.slotsForRound(round), packetCtx)
    : await buildPriceSeriesPacket(packetCtx, LIVE_PRICE_SERIES_IO)
  // INPUT audit trail: freeze the exact text closed-book models are about to
  // see, BEFORE any model call. Write-once (null-guard).
  if (pkt.injection) {
    await persistClosedBookPacket(round.id, pkt.researchCacheKey, pkt.injection)
  }
  const prompts = buildPrompts(round, pkt.injection, pkt.dataPacket.error)

  const results: ModelRunResult[] = []
  let runningCost = pkt.researchCostUsd
  let capped = false
  let nextIndex = 0

  const worker = async (): Promise<void> => {
    for (;;) {
      // KILL-SWITCH: stop LAUNCHING new calls once the run's spend cap is hit.
      if (runningCost >= costCap) {
        capped = true
        return
      }
      const i = nextIndex++
      if (i >= roster.length) return

      const entry = roster[i]
      const prompt = entry.league_tier === 'scout' ? prompts.scout : prompts.price
      const tokenBudget = resolveMaxCompletionTokensForEntry(entry, maxCompletionTokens)
      const entryTimeoutMs = entry.timeoutMs && entry.timeoutMs > 0 ? entry.timeoutMs : timeoutMs
      const outcome = await runOneModel(entry, round.id, prompt, entryTimeoutMs, userId ?? null, tokenBudget, round.horizon)
      runningCost += outcome.cost_usd
      results.push(outcome)
      // Fires AFTER the DB write inside runOneModel — see onModelResult's doc
      // comment on GenerateOptions for why this ordering is load-bearing.
      onModelResult?.(outcome)
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, roster.length) }, () => worker())
  await Promise.all(workers)

  await persistConsensusAggregates(round.id, results)

  return {
    round_id: round.id,
    created,
    data_packet: pkt.dataPacket,
    research: pkt.research,
    related_credits_spent: pkt.relatedCreditsSpent,
    results,
    total_cost_usd: Number(runningCost.toFixed(6)),
    capped,
    cost_cap_usd: costCap,
  }
}
