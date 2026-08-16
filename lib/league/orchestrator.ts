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
import { fetchDataPacket, formatDataPacketForPrompt, type DataPacket } from '@/lib/league/market-data'
import { getResearchPacket, type ResearchPacket } from '@/lib/league/research'

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

Output schema (all keys required):
{"direction":"up|down|flat|abstain","probability":<integer 0-100>,"rationale":"<one line, max 200 chars>"}

- direction: your single best call for how the proposition resolves. Use "flat" only if you genuinely expect ~no change. Use "abstain" ONLY if you truly cannot form any view — abstaining is never penalized, but a real call is preferred.
- probability: your confidence in the stated direction, integer 0-100.
- rationale: one concise sentence of reasoning or a key citation.
Return the JSON object only.`

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
  direction: 'up' | 'down' | 'flat' | null
  probability: number | null
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
  fx: 'green',
  gold_metal: 'green',
  crypto_spot: 'green',
  macro_econ: 'green',
  bond_rate: 'green',
  commodity_energy: 'yellow',
  futures_derivatives: 'yellow',
  sports: 'yellow',
  crypto_perps: 'yellow',
  politics_election: 'red',
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
    })
    .select('id, proposition_text, category, instrument, horizon, resolution_rule, resolves_at')
    .single()

  if (error || !data) throw new Error(`Failed to create round: ${error?.message ?? 'unknown'}`)
  return { round: data as ResolvedRound, created: true }
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
 *            data" is explicitly disallowed. When neither is available, the
 *            model is told so (and may honestly abstain).
 *  - scout:  research agents (You.com / Perplexity / grounded Gemini / ...).
 *            NO packets — they gather live data via their own web search and
 *            cite it. Keeping Scout packet-free is the league's core
 *            experiment: self-directed search vs reasoning from a fixed packet.
 */
function buildPrompts(round: ResolvedRound, packet: DataPacket, research: ResearchPacket): { price: string; scout: string } {
  const block = buildPropositionBlock(round)
  const closer = 'Respond with the single-line JSON object described in the system message.'

  let price: string
  if (packet.available || research.available) {
    price = [
      block,
      '',
      ...(packet.available
        ? ['DATA PACKET (authoritative price/history — Twelve Data):', formatDataPacketForPrompt(packet), '']
        : []),
      ...(research.available ? [research.promptBlock, ''] : []),
      'You have the market data and research above. Make a directional call (up/down/flat) with a probability. Do NOT answer "abstain" for lack of data — the packets above are your data.',
      closer,
    ].join('\n')
  } else {
    price = [
      block,
      '',
      `No live market-data packet is available for this instrument${packet.error ? ` (${packet.error})` : ''}. Use your own prior knowledge; give your best directional call, or "abstain" only if truly impossible.`,
      closer,
    ].join('\n')
  }

  const scout = [
    block,
    '',
    'Use live web search to gather the most recent price/context for this instrument, then make a directional call and cite your key source in the rationale.',
    closer,
  ].join('\n')

  return { price, scout }
}

type ParsedPrediction = {
  direction: 'up' | 'down' | 'flat' | null
  probability: number | null
  rationale: string | null
}

/** Extracts the first {...} block and validates fields. Null = unparseable. */
function parsePrediction(text: string | null): ParsedPrediction | null {
  if (!text) return null
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(match[0]) as Record<string, unknown>
  } catch {
    return null
  }
  const dirRaw = typeof obj.direction === 'string' ? obj.direction.trim().toLowerCase() : ''
  const direction =
    dirRaw === 'up' || dirRaw === 'down' || dirRaw === 'flat' ? (dirRaw as 'up' | 'down' | 'flat') : null

  let probability: number | null = null
  const p = Number(obj.probability)
  if (Number.isFinite(p)) probability = Math.max(0, Math.min(100, Math.round(p)))

  const rationale =
    typeof obj.rationale === 'string' && obj.rationale.trim().length
      ? obj.rationale.trim().slice(0, 500)
      : null

  return { direction, probability, rationale }
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
 * - parse-fail or no usable direction → ABSTAIN: row written with
 *   predicted_direction = null (does NOT count as wrong later).
 * - scout tier → row written with predicted_direction = null by design
 *   (scored on citation accuracy; reconciliation leaves is_correct null).
 *
 * Rows are keyed by the roster's canonical model_id (not the provider's
 * reported actual model) so two slots sharing one actual model string
 * (e.g. challenger gemini-3.6-flash vs scout gemini-3.6-flash-grounded)
 * never collide on the (round_id, model_id) unique key.
 */
async function runOneModel(
  entry: RosterEntry,
  roundId: string,
  userPrompt: string,
  timeoutMs: number,
  userId: string | null,
  maxCompletionTokens: number
): Promise<ModelRunResult> {
  const raw = await callWithRetry(entry, userPrompt, timeoutMs, userId, maxCompletionTokens)

  const base = { model_id: entry.model_id, actual_model: raw.actualModel, brand: entry.brand, camp: entry.camp, tier: entry.league_tier }

  if (raw.error) {
    const status: ModelStatus = isTimeout(raw.error) ? 'timeout' : 'error'
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
          reasoning_snippet: null,
          prompt_tokens: null,
          completion_tokens: null,
          reasoning_tokens: null,
          cost_usd: 0,
        },
        { onConflict: 'round_id,model_id' }
      )
    return {
      ...base,
      direction: null,
      probability: null,
      reasoning_snippet: null,
      cost_usd: 0,
      cost_source: 'estimated',
      status,
      error: raw.error,
    }
  }

  const parsed = parsePrediction(raw.text)
  // Prefer the provider's reported cost (OpenRouter/Perplexity = real billed;
  // You.com = documented flat-rate). Fall back to a token×list-price estimate
  // only when the provider reports nothing (core-6 direct APIs, Meta Muse).
  const hasProviderCost = typeof raw.costUsd === 'number'
  const costUsd = hasProviderCost
    ? raw.costUsd!
    : computeCostUsd(entry, raw.promptTokens, raw.completionTokens)
  const costSource: 'billed' | 'estimated' = hasProviderCost && !raw.costIsEstimated ? 'billed' : 'estimated'

  const isScout = entry.league_tier === 'scout'
  const parsedDirection = parsed?.direction ?? null
  // Scout: store null direction in DB (scored on citations later) but report
  // parsed direction in the run summary so we can measure web-search quality.
  const usableDirection = isScout ? null : parsedDirection
  const status: ModelStatus =
    isScout
      ? parsedDirection
        ? 'ok'
        : 'abstain'
      : parsedDirection
        ? 'ok'
        : 'abstain'

  // Abstain still records participation (null direction) so it never scores as wrong.
  const rationale = parsed?.rationale ?? (raw.text ? raw.text.trim().slice(0, 500) : null)
  const probability = parsed?.probability ?? null

  await supabaseAdmin
    .from('model_predictions')
    .upsert(
      {
        round_id: roundId,
        model_id: entry.model_id,
        brand: entry.brand,
        camp: entry.camp,
        league_tier: entry.league_tier,
        predicted_direction: usableDirection,
        predicted_value: probability,
        reasoning_snippet: rationale,
        prompt_tokens: raw.promptTokens,
        completion_tokens: raw.completionTokens,
        // The reused callers do not surface hidden reasoning-token counts.
        reasoning_tokens: null,
        cost_usd: costUsd,
      },
      { onConflict: 'round_id,model_id' }
    )

  return {
    ...base,
    direction: parsedDirection,
    probability,
    reasoning_snippet: rationale,
    cost_usd: costUsd,
    cost_source: costSource,
    status,
  }
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
  // One packet fetch per ROUND (2 Twelve Data credits), injected to every
  // price-tier model — not per model.
  const packet = await fetchDataPacket(round.instrument)
  // One research packet per ROUND, shared identically by tiers 1/2/3 (Scout
  // keeps its own live search). Cached per (instrument, horizon, 6h bucket);
  // its cost counts against the same kill-switch cap as the model calls.
  const research = await getResearchPacket({ round, budgetRemainingUsd: costCap })
  const prompts = buildPrompts(round, packet, research)

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
      const outcome = await runOneModel(entry, round.id, prompt, entryTimeoutMs, userId ?? null, tokenBudget)
      runningCost += outcome.cost_usd
      results.push(outcome)
      // Fires AFTER the DB write inside runOneModel — see onModelResult's doc
      // comment on GenerateOptions for why this ordering is load-bearing.
      onModelResult?.(outcome)
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, roster.length) }, () => worker())
  await Promise.all(workers)

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
