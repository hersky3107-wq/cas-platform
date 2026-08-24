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
import { fetchDataPacket, sessionDateForPrice, type DataPacket } from '@/lib/league/market-data'
import { fetchCryptoContext, fetchMarketConsensus, wantsConsensus, wantsCryptoContext } from '@/lib/league/market-context'
import { assembleClosedBookInjection, type ClosedBookPacketInput } from '@/lib/league/closed-book-packet'
import { getResearchPacket, type ResearchPacket } from '@/lib/league/research'
import { isBinaryDirection, parsePrediction, sanitizeRationale, type ParsedPrediction } from '@/lib/league/prediction-parse'
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
// World/challenger default. Premier reasoning models get a larger budget (see
// PREMIER_MAX_COMPLETION_TOKENS) so hidden reasoning still leaves room for JSON.
const DEFAULT_MAX_COMPLETION_TOKENS = 1200
const PREMIER_MAX_COMPLETION_TOKENS = 4000
/** Kill-switch default when LEAGUE_RUN_COST_CAP_USD is unset/invalid. */
const FALLBACK_COST_CAP_USD = 20

const PREDICTION_SYSTEM_PROMPT = `You are an independent forecasting model in a prediction league. You answer ALONE; you never see any other model's answer. You may reason internally, but your VISIBLE output MUST be exactly ONE line of strict JSON and nothing else — no markdown, no code fences, no preamble, no trailing text.

Required JSON keys: direction, probability, magnitude, rationale.

Example shape (replace values with your own forecast — do not copy this example verbatim):
{"direction":"up","probability":72,"magnitude":2.4,"rationale":"Recent earnings beat and buyback support a higher close."}

- direction: exactly one of "up" or "down". Exactly two answers exist — never flat, abstain, neutral, or any other value. If you expect little change, still pick the closer side (up or down).
- probability: your confidence in the stated direction, integer 0 through 100.
- magnitude: your expected percent change over the stated horizon, as a plain number signed to match direction — positive for "up", negative for "down" (e.g. 2.4 for +2.4%, -1.1 for -1.1%). Keep it a plausible move for the horizon; an extreme value will be rejected and you will be asked again.
- rationale: one concise sentence of reasoning or a key citation in plain prose (200 characters or fewer). Write your actual reasoning — never repeat these instructions, schema labels, or placeholder text.
Return the JSON object only.`

/** Appended once when the first answer has an invalid direction and/or magnitude. */
const PREDICTION_RETRY_INSTRUCTION = `RETRY: Your previous answer was invalid. Respond with exactly one JSON line: {"direction":"up"|"down","probability":0-100,"magnitude":<signed number>,"rationale":"..."}. direction must be exactly "up" or "down" — never flat, abstain, neutral, or any other value. magnitude must be a plain number signed to match direction (positive for up, negative for down) and a plausible percent move for the stated horizon — not an extreme value.`

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
  /** Override completion-token budget (premier defaults to 4000, others 1200). */
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
  cost_usd: number
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
    error?: string
  }
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
  const closer = 'Respond with the single-line JSON object described in the system message.'

  let price: string
  if (injection) {
    price = [
      block,
      '',
      injection,
      '',
      'You have the numeric market data and research above. Exactly two answers exist: up or down, plus a probability. Do NOT answer "abstain" for lack of data — the packet above is your data. Prefer the numbered blocks over prose if they disagree.',
      closer,
    ].join('\n')
  } else {
    price = [
      block,
      '',
      `No live market-data packet is available for this instrument${packetError ? ` (${packetError})` : ''}. Use your own prior knowledge; give your best up or down call with a probability. Exactly two answers exist — never flat or abstain.`,
      closer,
    ].join('\n')
  }

  const scout = [
    block,
    '',
    'Use live web search to gather the most recent price/context for this instrument, then make a directional call (exactly up or down) with a probability and cite your key source in the rationale.',
    closer,
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
  /** Cost (USD) when the provider reports one — real billed (OpenRouter, Perplexity) or a documented flat-rate estimate (You.com). Null otherwise. */
  costUsd: number | null
  /** True when costUsd came from a documented estimate rather than per-call billed telemetry. Meaningless when costUsd is null. */
  costIsEstimated: boolean
  error?: string
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
      systemPrompt: PREDICTION_SYSTEM_PROMPT,
      // Truthy only to enable an admin BYOK lookup; RLS bypass is via supabaseAdmin.
      supabaseAccessToken: userId ? 'league-admin' : undefined,
      skipLanguageInjection: true,
      maxCompletionTokens,
      modelOverride: entry.caller.modelOverride,
      allowGeminiThinking: entry.caller.allowGeminiThinking,
      searchTool: entry.caller.searchTool,
      timeoutMs,
    })
    return {
      text: res.text,
      promptTokens: res.promptTokens,
      completionTokens: res.completionTokens,
      actualModel: res.model || entry.model_id,
      // Real billed cost when the provider reports one (currently only
      // Perplexity's usage.cost.total_cost flows through here) — else null,
      // and runOneModel falls back to a token×list-price estimate.
      costUsd: res.costUsd ?? null,
      costIsEstimated: false,
      error: res.error,
    }
  }  // Platform caller has no built-in external timeout — race it here.
  const res = await withTimeout(
    callPlatformModel({
      id: entry.caller.platformId,
      systemPrompt: PREDICTION_SYSTEM_PROMPT,
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
        return { text: null, promptTokens: null, completionTokens: null, actualModel: entry.model_id, costUsd: null, costIsEstimated: false, error: e2 instanceof Error ? e2.message : 'unknown error' }
      }
    }
    return { text: null, promptTokens: null, completionTokens: null, actualModel: entry.model_id, costUsd: null, costIsEstimated: false, error: msg }
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
  let costSource: 'billed' | 'estimated' = 'estimated'

  const base = { model_id: entry.model_id, actual_model: raw.actualModel, brand: entry.brand, camp: entry.camp, tier: entry.league_tier }

  const accumulateCost = (call: RawCall) => {
    const hasProviderCost = typeof call.costUsd === 'number'
    const usd = hasProviderCost
      ? call.costUsd!
      : computeCostUsd(entry, call.promptTokens, call.completionTokens)
    totalCostUsd += usd
    if (hasProviderCost && !call.costIsEstimated) costSource = 'billed'
  }

  if (raw.error) {
    const status: ModelStatus = isTimeout(raw.error) ? 'timeout' : 'error'
    await upsertNullPrediction(roundId, entry)
    return {
      ...base,
      direction: null,
      probability: null,
      magnitude: null,
      reasoning_snippet: null,
      cost_usd: 0,
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
        cost_usd: Number(totalCostUsd.toFixed(6)),
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
      cost_usd: Number(totalCostUsd.toFixed(6)),
      cost_source: costSource,
      status: 'error',
      error: reason,
    }
  }

  const rationale =
    sanitizeRationale(parsed!.rationale) ??
    sanitizeRationale(raw.text ? raw.text.trim().slice(0, 500) : null)
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
        prompt_tokens: raw.promptTokens,
        completion_tokens: raw.completionTokens,
        reasoning_tokens: null,
        cost_usd: totalCostUsd,
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
    cost_usd: Number(totalCostUsd.toFixed(6)),
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
        prompt_tokens: null,
        completion_tokens: null,
        reasoning_tokens: null,
        cost_usd: 0,
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

function toClosedBookInput(
  round: ResolvedRound,
  packet: DataPacket,
  research: ResearchPacket,
  consensus: Awaited<ReturnType<typeof fetchMarketConsensus>> | null,
  crypto: Awaited<ReturnType<typeof fetchCryptoContext>> | null,
): ClosedBookPacketInput {
  const series = packet.series ?? []
  const anchorClose = typeof packet.latestClose === 'number' ? packet.latestClose : null
  return {
    instrument: round.instrument,
    category: round.category,
    horizon: round.horizon,
    series,
    seriesSource: 'Twelve Data /time_series+quote',
    seriesAsOf: packet.asOf ?? series[series.length - 1]?.date ?? null,
    anchorClose,
    anchorSessionDate: anchorClose != null ? sessionDateForPrice(packet, anchorClose) : null,
    quoteAsOf: packet.asOf ?? null,
    consensus,
    crypto,
    findings: research.findings,
    researchCacheKey: research.cacheKey,
    assembledAt: new Date().toISOString(),
  }
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
  // One packet fetch per ROUND (quote + long time_series = 2 Twelve Data
  // credits). Consensus adds 5 more for equities (throttled to Basic's 8/min).
  const packet = await fetchDataPacket(round.instrument)
  // Persist the ANCHOR price (best-effort, presentation only — never read by
  // grading/reconciliation): the card header shows "what the instrument was
  // at when this round opened" so a model's up/down call is legible. Only
  // stamped once, at creation, from the same packet already fetched above —
  // never overwritten on a re-run of an existing round (`{ roundId }` input
  // skips `created`), so the anchor always reflects the ORIGINAL open.
  if (created && packet.available && typeof packet.latestClose === 'number') {
    await persistAnchorPrice(round.id, packet.latestClose, sessionDateForPrice(packet, packet.latestClose))
  }
  // One research packet per ROUND, shared identically by tiers 1/2/3 (Scout
  // keeps its own live search). Cached per (instrument, horizon, 6h bucket);
  // its cost counts against the same kill-switch cap as the model calls.
  // NO new AI call is added here — director+sonar are the existing pair;
  // findings are filtered/capped in assembleClosedBookInjection.
  const research = await getResearchPacket({ round, budgetRemainingUsd: costCap })
  const [consensus, crypto] = await Promise.all([
    packet.available && wantsConsensus(round.category) && packet.symbol
      ? fetchMarketConsensus(packet.symbol)
      : Promise.resolve(null),
    wantsCryptoContext(round.category) ? fetchCryptoContext(round.instrument) : Promise.resolve(null),
  ])
  const injection =
    packet.available || research.available
      ? assembleClosedBookInjection(toClosedBookInput(round, packet, research, consensus, crypto))
      : null
  // INPUT audit trail: freeze the exact text closed-book models are about to
  // see, BEFORE any model call. Write-once (null-guard).
  if (injection) {
    await persistClosedBookPacket(round.id, research.cacheKey, injection)
  }
  const prompts = buildPrompts(round, injection, packet.error)

  const results: ModelRunResult[] = []
  let runningCost = research.costUsd
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
    data_packet: {
      available: packet.available,
      symbol: packet.symbol,
      latestClose: packet.latestClose,
      error: packet.error,
    },
    research: {
      available: research.available,
      cached: research.cached,
      costUsd: Number(research.costUsd.toFixed(6)),
      queries: research.queries,
      error: research.error,
    },
    results,
    total_cost_usd: Number(runningCost.toFixed(6)),
    capped,
    cost_cap_usd: costCap,
  }
}
