/**
 * Extra-tier generation. Never builds or receives a research packet.
 * History may read the PRICE SERIES only (dates + closes).
 * Sentiment searches web-visible news/opinion only — no series, no packet.
 * Consensus searches money-positioning (options / prediction markets / COT /
 * institutional targets) only — no series, no packet.
 * Crow reads a fact brief only: sports cache baseline + both sides, the KRSTOCK
 * price path plus the investor-flows block, or the price path plus the packet's
 * computed CROWDING block. Never the research prose, never invented numbers.
 * Oracle owns divination cache — this file does not write one.
 */
import 'server-only'

import { runSingleAiProvider } from '@/lib/ai/router'
import { readLeagueDivinationLive } from '@/lib/oracle/league-divination/live'
import { supabaseAdmin } from '@/lib/supabase/server'
import { classifyNoAnswerFailReason, type NoAnswerFailReason } from '../fail-reason'
import type { AnswerSide } from '../answer-contract'
import { fetchDataPacket } from '../market-data'
import { decodeStockInstrument } from '../gateway/adapters/stock-catalog'
import { stockUniverseDataEnabled } from '../gateway/adapters/stock-search'
import { computeCostUsd, lookupRosterEntry } from '../roster'
import {
  buildDivinationInput,
  customerFacingDivination,
  assertNoPacketOnDivinationInput,
  estimatedDivinationCostUsd,
  findInternalDivinationLeak,
  leagueProbabilityFromOracleConfidence,
  leagueSideFromDivination,
  type DivinationReader,
} from './divination'
import {
  HISTORY_ENGINE_MODEL_ID,
  HISTORY_NO_SERIES_REASON,
  assertHistoryInputShape,
  buildHistoryInput,
  buildHistorySystemPrompt,
  buildHistoryUserPrompt,
  historyRationaleNeedsRetry,
  historyRetryInstruction,
  leagueSideFromHistory,
  parseHistoryOutput,
  type HistoryCaller,
  type HistoryCallResult,
  type HistoryLeagueInput,
  type HistorySeriesBar,
} from './history'
import {
  SENTIMENT_ENGINE_MODEL_ID,
  SENTIMENT_NO_SIGNAL_REASON,
  assertSentimentInputShape,
  buildSentimentInput,
  buildSentimentSystemPrompt,
  buildSentimentUserPrompt,
  sentimentRationaleNeedsRetry,
  sentimentRetryInstruction,
  leagueSideFromSentiment,
  parseSentimentOutput,
  type SentimentCallResult,
  type SentimentCaller,
  type SentimentLeagueInput,
} from './sentiment'
import {
  CONSENSUS_ENGINE_MODEL_ID,
  CONSENSUS_NO_SIGNAL_REASON,
  assertConsensusInputShape,
  buildConsensusInput,
  buildConsensusSystemPrompt,
  buildConsensusUserPrompt,
  consensusRationaleNeedsRetry,
  consensusRetryInstruction,
  leagueSideFromConsensus,
  parseConsensusOutput,
  type ConsensusCallResult,
  type ConsensusCaller,
  type ConsensusLeagueInput,
} from './consensus'
import { EXTRA_SEAT_IDS, getExtraRoster, isExtraSeatId, lookupExtraSeat, type ExtraSeatId } from './seats'
import { visibleLeagueText } from '../visible-disclosure'
import { isEntertainmentLedgerCategory } from './entertainment-category'
import { isRealEstateLedgerCategory } from './real-estate-category'
import { isPoliticsLedgerCategory } from './politics-category'
import { isSportsLedgerCategory } from './sports-category'
import { decodeEntertainmentInstrument } from '../gateway/adapters/entertainment-catalog'
import { formatEntertainmentCrowBrief } from '../gateway/adapters/entertainment-packet'
import { decodePropertyInstrument } from '../gateway/adapters/real-estate-catalog'
import { formatPropertyCrowBrief } from '../gateway/adapters/real-estate-packet'
import { decodePoliticsInstrument } from '../gateway/adapters/politics-catalog'
import { formatPoliticsCrowBrief } from '../gateway/adapters/politics-packet'
import { decodeSportsInstrument } from '../gateway/adapters/sports-catalog'
import { formatSportsCrowBrief } from '../gateway/adapters/sports-packet'
import { readPoliticsSlateCache } from '../politics/slate-cache'
import { readFixtureCache } from '../sports/cache'
import {
  CROW_ENGINE_MODEL_ID,
  CROW_MAX_COMPLETION_TOKENS,
  CROW_TIMEOUT_MS,
  buildCrowInput,
  buildCrowSystemPrompt,
  buildCrowUserPrompt,
  crowRetryInstruction,
  formatFinanceCrowBrief,
  isKrEquityCrowInstrument,
  krEquityCrowBrief,
  withCrowdingBlock,
  leagueSideFromCrow,
  parseCrowOutput,
  type CrowCaller,
  type CrowCallResult,
  type CrowLeagueInput,
} from './crow'

export type ExtraSeatOutcome = {
  model_id: ExtraSeatId
  actual_model: ExtraSeatId | string
  brand: string
  camp: 'other'
  tier: 'extra'
  direction: AnswerSide | null
  probability: number | null
  magnitude: null
  qualifier_text: string | null
  reasoning_snippet: string | null
  reasoning_text: null
  cost_usd: number
  estimated_cost_usd: number
  cost_source: 'estimated' | 'billed'
  server_side_tools_used: null
  cost_in_usd_ticks: null
  prompt_tokens: number | null
  completion_tokens: number | null
  status: 'ok' | 'abstain' | 'error'
  error?: string
}

type ExtraRoundRow = {
  id: string
  proposition_text: string
  category: string
  instrument: string
  horizon: string | null
  opened_at: string | null
  created_at: string | null
  proposition_kind: string | null
  subject_label: string | null
  /** Crow reads only its computed CROWDING block; other seats never touch it. */
  closed_book_packet_text?: string | null
}

export type ExtraPriceSeries = {
  bars: HistorySeriesBar[]
  latestClose?: number | null
  asOf?: string | null
}

export type GenerateExtraSeatsOpts = {
  roundId: string
  excludeModelIds?: readonly string[]
  onSeatResult?: (result: ExtraSeatOutcome) => void
  /** Test seam — default is readLeagueDivinationLive. */
  divinationReader?: DivinationReader
  /** Test seam — default calls challenger Claude Sonnet 5. */
  historyCaller?: HistoryCaller
  /** Test seam — default calls extra Perplexity `sonar`. */
  sentimentCaller?: SentimentCaller
  /** Test seam — default calls extra Perplexity `sonar` (money signals). */
  consensusCaller?: ConsensusCaller
  /** Test seam — default calls first-party Mistral Medium 3.5. */
  crowCaller?: CrowCaller
  /**
   * Official-run reuse: dates + closes already fetched for the shared packet.
   * Extra-only / extra-stage ticks fetch the series themselves when omitted.
   * Never pass research / TIPS / consensus here. Sentiment must not use this.
   */
  priceSeries?: ExtraPriceSeries | null
}

async function loadRound(roundId: string): Promise<ExtraRoundRow> {
  const { data, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id, proposition_text, category, instrument, horizon, opened_at, created_at, proposition_kind, subject_label, closed_book_packet_text')
    .eq('id', roundId)
    .single()
  if (error || !data) {
    throw new Error(`extra seats: round not found ${roundId}${error ? ` (${error.message})` : ''}`)
  }
  return data as ExtraRoundRow
}

async function upsertExtraPrediction(row: {
  roundId: string
  category?: string | null
  model_id: ExtraSeatId
  brand: string
  direction: AnswerSide | null
  probability: number | null
  qualifier_text: string | null
  reasoning_snippet: string | null
  cost_usd: number
  estimated_cost_usd: number
  prompt_tokens?: number | null
  completion_tokens?: number | null
  fail_reason?: NoAnswerFailReason | null
  error?: string | null
}): Promise<void> {
  const { error } = await supabaseAdmin.from('model_predictions').upsert(
    {
      round_id: row.roundId,
      seat_id: `extra:${row.model_id}`,
      model_id: row.model_id,
      brand: row.brand,
      camp: 'other',
      league_tier: 'extra',
      predicted_direction: row.direction,
      predicted_value: row.probability,
      predicted_magnitude_pct: null,
      predicted_qualifier_text: row.qualifier_text,
      reasoning_snippet: visibleLeagueText(row.category, row.reasoning_snippet),
      reasoning_text: null,
      prompt_tokens: row.prompt_tokens ?? null,
      completion_tokens: row.completion_tokens ?? null,
      reasoning_tokens: null,
      cost_usd: row.cost_usd,
      estimated_cost_usd: row.estimated_cost_usd,
      server_side_tools_used: null,
      predicted_at: new Date().toISOString(),
      fail_reason:
        row.direction == null
          ? (row.fail_reason ?? classifyNoAnswerFailReason({ error: row.error }))
          : null,
    },
    { onConflict: 'round_id,model_id' },
  )
  if (error) throw new Error(`extra seat upsert ${row.model_id}: ${error.message}`)
}

function baseOutcome(id: ExtraSeatId, brand: string): ExtraSeatOutcome {
  return {
    model_id: id,
    actual_model: id,
    brand,
    camp: 'other',
    tier: 'extra',
    direction: null,
    probability: null,
    magnitude: null,
    qualifier_text: null,
    reasoning_snippet: null,
    reasoning_text: null,
    cost_usd: 0,
    estimated_cost_usd: 0,
    cost_source: 'estimated',
    server_side_tools_used: null,
    cost_in_usd_ticks: null,
    prompt_tokens: null,
    completion_tokens: null,
    status: 'abstain',
  }
}

async function runDivinationSeat(
  round: ExtraRoundRow,
  read: DivinationReader,
): Promise<ExtraSeatOutcome> {
  const seat = lookupExtraSeat('divination')!
  const input = buildDivinationInput(round)
  try {
    const raw = await read(input)
    const customer = customerFacingDivination(raw)
    const leak = findInternalDivinationLeak(customer)
    if (leak) throw new Error(`divination customer payload leaked ${leak}`)
    const cost = estimatedDivinationCostUsd(raw)
    const direction = leagueSideFromDivination(customer.verdict, customer.pick, round.proposition_kind)
    const probability = leagueProbabilityFromOracleConfidence(customer.confidence)
    const qualifier = customer.pick
    await upsertExtraPrediction({
      roundId: round.id,
      category: round.category,
      model_id: 'divination',
      brand: seat.brand,
      direction,
      probability,
      qualifier_text: qualifier,
      reasoning_snippet: customer.rationale,
      cost_usd: cost.costUsd,
      estimated_cost_usd: cost.estimatedCostUsd,
    })
    return {
      ...baseOutcome('divination', seat.brand),
      direction,
      probability,
      qualifier_text: qualifier,
      reasoning_snippet: customer.rationale,
      cost_usd: cost.costUsd,
      estimated_cost_usd: cost.estimatedCostUsd,
      status: 'ok',
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'divination seat failed'
    await upsertExtraPrediction({
      roundId: round.id,
      category: round.category,
      model_id: 'divination',
      brand: seat.brand,
      direction: null,
      probability: null,
      qualifier_text: null,
      reasoning_snippet: null,
      cost_usd: 0,
      estimated_cost_usd: 0,
      error: message,
    })
    return { ...baseOutcome('divination', seat.brand), status: 'error', error: message.slice(0, 500) }
  }
}

async function resolveHistorySeries(
  instrument: string,
  provided: ExtraPriceSeries | null | undefined,
): Promise<ExtraPriceSeries | null> {
  if (provided && provided.bars.length > 0) return provided
  const listing = decodeStockInstrument(instrument)
  if (listing && !stockUniverseDataEnabled()) return null
  const packet = await fetchDataPacket(instrument)
  if (!packet.available || !packet.series?.length) return null
  return {
    bars: packet.series.map((b) => ({ date: b.date, close: b.close })),
    latestClose: packet.latestClose ?? null,
    asOf: packet.asOf ?? null,
  }
}

function defaultHistoryCaller(): HistoryCaller {
  const entry = lookupRosterEntry(HISTORY_ENGINE_MODEL_ID)
  if (!entry || entry.caller.kind !== 'core') {
    throw new Error(`history seat: engine ${HISTORY_ENGINE_MODEL_ID} is not a core roster caller`)
  }
  const caller = entry.caller
  const timeoutMs = entry.timeoutMs && entry.timeoutMs > 0 ? entry.timeoutMs : 60_000
  const maxCompletionTokens = entry.maxCompletionTokens && entry.maxCompletionTokens > 0 ? entry.maxCompletionTokens : 2000
  return async ({ systemPrompt, userPrompt }) => {
    const res = await runSingleAiProvider({
      supabase: supabaseAdmin,
      authSupabase: supabaseAdmin,
      sessionId: null,
      userId: null,
      provider: caller.provider,
      prompt: userPrompt,
      systemPrompt,
      skipLanguageInjection: true,
      maxCompletionTokens,
      modelOverride: caller.modelOverride,
      allowGeminiThinking: caller.allowGeminiThinking,
      // Closed-book extra seat — never enable scout search.
      extraPayload: caller.extraPayload,
      anthropicThinking: caller.anthropicThinking,
      timeoutMs,
    })
    const estimate = computeCostUsd(entry, res.promptTokens, res.completionTokens)
    const billed = typeof res.costUsd === 'number' ? res.costUsd : null
    return {
      text: res.text,
      promptTokens: res.promptTokens,
      completionTokens: res.completionTokens,
      costUsd: billed ?? estimate,
      costIsEstimated: billed == null,
      error: res.error,
    }
  }
}

async function callHistoryOnce(
  call: HistoryCaller,
  input: HistoryLeagueInput,
  retry = false,
): Promise<HistoryCallResult> {
  const userPrompt = retry
    ? `${buildHistoryUserPrompt(input)}\n\n${historyRetryInstruction(input.category)}`
    : buildHistoryUserPrompt(input)
  return call({ systemPrompt: buildHistorySystemPrompt(input.category), userPrompt })
}

async function runHistorySeat(
  round: ExtraRoundRow,
  call: HistoryCaller,
  providedSeries: ExtraPriceSeries | null | undefined,
): Promise<ExtraSeatOutcome> {
  const seat = lookupExtraSeat('history')!
  const nonPrice =
    isSportsLedgerCategory(round.category) ||
    isPoliticsLedgerCategory(round.category) ||
    isEntertainmentLedgerCategory(round.category) ||
    isRealEstateLedgerCategory(round.category)
  const series = nonPrice
    ? { bars: [] as HistorySeriesBar[], latestClose: null as number | null, asOf: round.opened_at ?? null }
    : await resolveHistorySeries(round.instrument, providedSeries)
  if (!series) {
    await upsertExtraPrediction({
      roundId: round.id,
      category: round.category,
      model_id: 'history',
      brand: seat.brand,
      direction: null,
      probability: null,
      qualifier_text: null,
      reasoning_snippet: HISTORY_NO_SERIES_REASON,
      cost_usd: 0,
      estimated_cost_usd: 0,
    })
    return {
      ...baseOutcome('history', seat.brand),
      reasoning_snippet: HISTORY_NO_SERIES_REASON,
      status: 'abstain',
    }
  }

  const input = buildHistoryInput(round, series)
  assertHistoryInputShape(input)

  try {
    let raw = await callHistoryOnce(call, input, false)
    if (raw.error) throw new Error(raw.error)
    let parsed = parseHistoryOutput(raw.text)
    if (!parsed || historyRationaleNeedsRetry(parsed.rationale, round.category)) {
      const retryRaw = await callHistoryOnce(call, input, true)
      if (!retryRaw.error) {
        raw = {
          ...retryRaw,
          promptTokens: (raw.promptTokens ?? 0) + (retryRaw.promptTokens ?? 0),
          completionTokens: (raw.completionTokens ?? 0) + (retryRaw.completionTokens ?? 0),
          costUsd: (raw.costUsd ?? 0) + (retryRaw.costUsd ?? 0),
          costIsEstimated: raw.costIsEstimated && retryRaw.costIsEstimated,
        }
        const retryParsed = parseHistoryOutput(retryRaw.text)
        if (retryParsed) parsed = retryParsed
      }
    }
    if (!parsed) throw new Error('history seat: unparseable pattern verdict')

    const direction = leagueSideFromHistory(parsed.verdict, round.proposition_kind)
    const probability = parsed.confidence
    const qualifier = parsed.namedPattern
    const costUsd = Number((raw.costUsd ?? 0).toFixed(6))
    const entry = lookupRosterEntry(HISTORY_ENGINE_MODEL_ID)
    const estimated = entry
      ? Number(computeCostUsd(entry, raw.promptTokens, raw.completionTokens).toFixed(6))
      : costUsd

    await upsertExtraPrediction({
      roundId: round.id,
      category: round.category,
      model_id: 'history',
      brand: seat.brand,
      direction,
      probability,
      qualifier_text: qualifier,
      reasoning_snippet: parsed.rationale,
      cost_usd: costUsd,
      estimated_cost_usd: estimated,
      prompt_tokens: raw.promptTokens,
      completion_tokens: raw.completionTokens,
    })
    return {
      ...baseOutcome('history', seat.brand),
      actual_model: HISTORY_ENGINE_MODEL_ID,
      direction,
      probability,
      qualifier_text: qualifier,
      reasoning_snippet: parsed.rationale,
      cost_usd: costUsd,
      estimated_cost_usd: estimated,
      cost_source: raw.costIsEstimated ? 'estimated' : 'billed',
      prompt_tokens: raw.promptTokens,
      completion_tokens: raw.completionTokens,
      status: 'ok',
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'history seat failed'
    await upsertExtraPrediction({
      roundId: round.id,
      category: round.category,
      model_id: 'history',
      brand: seat.brand,
      direction: null,
      probability: null,
      qualifier_text: null,
      reasoning_snippet: null,
      cost_usd: 0,
      estimated_cost_usd: 0,
      error: message,
    })
    return { ...baseOutcome('history', seat.brand), status: 'error', error: message.slice(0, 500) }
  }
}

function defaultSentimentCaller(): SentimentCaller {
  const entry = lookupRosterEntry(SENTIMENT_ENGINE_MODEL_ID)
  if (!entry || entry.caller.kind !== 'core' || entry.caller.provider !== 'perplexity') {
    throw new Error(`sentiment seat: engine ${SENTIMENT_ENGINE_MODEL_ID} is not the Perplexity scout caller`)
  }
  const caller = entry.caller
  const timeoutMs = entry.timeoutMs && entry.timeoutMs > 0 ? entry.timeoutMs : 60_000
  const maxCompletionTokens = entry.maxCompletionTokens && entry.maxCompletionTokens > 0 ? entry.maxCompletionTokens : 1600
  return async ({ systemPrompt, userPrompt }) => {
    const res = await runSingleAiProvider({
      supabase: supabaseAdmin,
      authSupabase: supabaseAdmin,
      sessionId: null,
      userId: null,
      provider: 'perplexity',
      prompt: userPrompt,
      systemPrompt,
      skipLanguageInjection: true,
      maxCompletionTokens,
      modelOverride: caller.modelOverride,
      timeoutMs,
    })
    const estimate = computeCostUsd(entry, res.promptTokens, res.completionTokens)
    const billed = typeof res.costUsd === 'number' ? res.costUsd : null
    return {
      text: res.text,
      promptTokens: res.promptTokens,
      completionTokens: res.completionTokens,
      costUsd: billed ?? estimate,
      costIsEstimated: billed == null,
      error: res.error,
    }
  }
}

async function callSentimentOnce(
  call: SentimentCaller,
  input: SentimentLeagueInput,
  retry = false,
): Promise<SentimentCallResult> {
  const userPrompt = retry
    ? `${buildSentimentUserPrompt(input)}\n\n${sentimentRetryInstruction(input.category)}`
    : buildSentimentUserPrompt(input)
  return call({ systemPrompt: buildSentimentSystemPrompt(), userPrompt })
}

async function persistSentimentAbstain(
  roundId: string,
  category: string,
  brand: string,
  rationale: string,
  cost?: { costUsd: number; estimated: number; promptTokens: number | null; completionTokens: number | null; costIsEstimated: boolean },
): Promise<ExtraSeatOutcome> {
  await upsertExtraPrediction({
    roundId,
    category,
    model_id: 'sentiment',
    brand,
    direction: null,
    probability: null,
    qualifier_text: null,
    reasoning_snippet: rationale,
    cost_usd: cost?.costUsd ?? 0,
    estimated_cost_usd: cost?.estimated ?? 0,
    prompt_tokens: cost?.promptTokens ?? null,
    completion_tokens: cost?.completionTokens ?? null,
  })
  return {
    ...baseOutcome('sentiment', brand),
    actual_model: SENTIMENT_ENGINE_MODEL_ID,
    reasoning_snippet: rationale,
    cost_usd: cost?.costUsd ?? 0,
    estimated_cost_usd: cost?.estimated ?? 0,
    cost_source: cost && !cost.costIsEstimated ? 'billed' : 'estimated',
    prompt_tokens: cost?.promptTokens ?? null,
    completion_tokens: cost?.completionTokens ?? null,
    status: 'abstain',
  }
}

async function runSentimentSeat(round: ExtraRoundRow, call: SentimentCaller): Promise<ExtraSeatOutcome> {
  const seat = lookupExtraSeat('sentiment')!
  const input = buildSentimentInput(round)
  assertSentimentInputShape(input)

  try {
    let raw = await callSentimentOnce(call, input, false)
    if (raw.error) throw new Error(raw.error)
    let parsed = parseSentimentOutput(raw.text)

    const needsRetry =
      !parsed ||
      (parsed.kind === 'verdict' && sentimentRationaleNeedsRetry(parsed.rationale, round.category, round.instrument))

    if (needsRetry) {
      const retryRaw = await callSentimentOnce(call, input, true)
      if (!retryRaw.error) {
        raw = {
          ...retryRaw,
          promptTokens: (raw.promptTokens ?? 0) + (retryRaw.promptTokens ?? 0),
          completionTokens: (raw.completionTokens ?? 0) + (retryRaw.completionTokens ?? 0),
          costUsd: (raw.costUsd ?? 0) + (retryRaw.costUsd ?? 0),
          costIsEstimated: raw.costIsEstimated && retryRaw.costIsEstimated,
        }
        const retryParsed = parseSentimentOutput(retryRaw.text)
        if (retryParsed) parsed = retryParsed
      }
    }

    const costUsd = Number((raw.costUsd ?? 0).toFixed(6))
    const entry = lookupRosterEntry(SENTIMENT_ENGINE_MODEL_ID)
    const estimated = entry
      ? Number(computeCostUsd(entry, raw.promptTokens, raw.completionTokens).toFixed(6))
      : costUsd
    const cost = {
      costUsd,
      estimated,
      promptTokens: raw.promptTokens,
      completionTokens: raw.completionTokens,
      costIsEstimated: raw.costIsEstimated,
    }

    if (!parsed) {
      return persistSentimentAbstain(round.id, round.category, seat.brand, SENTIMENT_NO_SIGNAL_REASON, cost)
    }
    if (parsed.kind === 'abstain') {
      return persistSentimentAbstain(round.id, round.category, seat.brand, parsed.rationale, cost)
    }
    if (sentimentRationaleNeedsRetry(parsed.rationale, round.category, round.instrument)) {
      return persistSentimentAbstain(round.id, round.category, seat.brand, SENTIMENT_NO_SIGNAL_REASON, cost)
    }

    const direction = leagueSideFromSentiment(parsed.verdict, round.proposition_kind)
    await upsertExtraPrediction({
      roundId: round.id,
      category: round.category,
      model_id: 'sentiment',
      brand: seat.brand,
      direction,
      probability: parsed.confidence,
      qualifier_text: null,
      reasoning_snippet: parsed.rationale,
      cost_usd: costUsd,
      estimated_cost_usd: estimated,
      prompt_tokens: raw.promptTokens,
      completion_tokens: raw.completionTokens,
    })
    return {
      ...baseOutcome('sentiment', seat.brand),
      actual_model: SENTIMENT_ENGINE_MODEL_ID,
      direction,
      probability: parsed.confidence,
      reasoning_snippet: parsed.rationale,
      cost_usd: costUsd,
      estimated_cost_usd: estimated,
      cost_source: raw.costIsEstimated ? 'estimated' : 'billed',
      prompt_tokens: raw.promptTokens,
      completion_tokens: raw.completionTokens,
      status: 'ok',
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'sentiment seat failed'
    await upsertExtraPrediction({
      roundId: round.id,
      category: round.category,
      model_id: 'sentiment',
      brand: seat.brand,
      direction: null,
      probability: null,
      qualifier_text: null,
      reasoning_snippet: null,
      cost_usd: 0,
      estimated_cost_usd: 0,
      error: message,
    })
    return { ...baseOutcome('sentiment', seat.brand), status: 'error', error: message.slice(0, 500) }
  }
}

function defaultConsensusCaller(): ConsensusCaller {
  const entry = lookupRosterEntry(CONSENSUS_ENGINE_MODEL_ID)
  if (!entry || entry.caller.kind !== 'core' || entry.caller.provider !== 'perplexity') {
    throw new Error(`consensus seat: engine ${CONSENSUS_ENGINE_MODEL_ID} is not the Perplexity scout caller`)
  }
  const caller = entry.caller
  const timeoutMs = entry.timeoutMs && entry.timeoutMs > 0 ? entry.timeoutMs : 60_000
  const maxCompletionTokens = entry.maxCompletionTokens && entry.maxCompletionTokens > 0 ? entry.maxCompletionTokens : 1600
  return async ({ systemPrompt, userPrompt }) => {
    const res = await runSingleAiProvider({
      supabase: supabaseAdmin,
      authSupabase: supabaseAdmin,
      sessionId: null,
      userId: null,
      provider: 'perplexity',
      prompt: userPrompt,
      systemPrompt,
      skipLanguageInjection: true,
      maxCompletionTokens,
      modelOverride: caller.modelOverride,
      timeoutMs,
    })
    const estimate = computeCostUsd(entry, res.promptTokens, res.completionTokens)
    const billed = typeof res.costUsd === 'number' ? res.costUsd : null
    return {
      text: res.text,
      promptTokens: res.promptTokens,
      completionTokens: res.completionTokens,
      costUsd: billed ?? estimate,
      costIsEstimated: billed == null,
      error: res.error,
    }
  }
}

async function callConsensusOnce(
  call: ConsensusCaller,
  input: ConsensusLeagueInput,
  retry = false,
): Promise<ConsensusCallResult> {
  const userPrompt = retry
    ? `${buildConsensusUserPrompt(input)}\n\n${consensusRetryInstruction(input.category)}`
    : buildConsensusUserPrompt(input)
  return call({ systemPrompt: buildConsensusSystemPrompt(input.category), userPrompt })
}

async function persistConsensusAbstain(
  roundId: string,
  category: string,
  brand: string,
  rationale: string,
  cost?: { costUsd: number; estimated: number; promptTokens: number | null; completionTokens: number | null; costIsEstimated: boolean },
): Promise<ExtraSeatOutcome> {
  await upsertExtraPrediction({
    roundId,
    category,
    model_id: 'consensus',
    brand,
    direction: null,
    probability: null,
    qualifier_text: null,
    reasoning_snippet: rationale,
    cost_usd: cost?.costUsd ?? 0,
    estimated_cost_usd: cost?.estimated ?? 0,
    prompt_tokens: cost?.promptTokens ?? null,
    completion_tokens: cost?.completionTokens ?? null,
  })
  return {
    ...baseOutcome('consensus', brand),
    actual_model: CONSENSUS_ENGINE_MODEL_ID,
    reasoning_snippet: rationale,
    cost_usd: cost?.costUsd ?? 0,
    estimated_cost_usd: cost?.estimated ?? 0,
    cost_source: cost && !cost.costIsEstimated ? 'billed' : 'estimated',
    prompt_tokens: cost?.promptTokens ?? null,
    completion_tokens: cost?.completionTokens ?? null,
    status: 'abstain',
  }
}

async function runConsensusSeat(round: ExtraRoundRow, call: ConsensusCaller): Promise<ExtraSeatOutcome> {
  const seat = lookupExtraSeat('consensus')!
  if (isRealEstateLedgerCategory(round.category)) {
    return persistConsensusAbstain(
      round.id,
      round.category,
      seat.brand,
      'CME Case-Shiller futures are too thin, and most regions have no housing-index market. Consensus abstains.',
    )
  }
  const input = buildConsensusInput(round)
  assertConsensusInputShape(input)

  try {
    let raw = await callConsensusOnce(call, input, false)
    if (raw.error) throw new Error(raw.error)
    let parsed = parseConsensusOutput(raw.text)

    const needsRetry =
      !parsed ||
      (parsed.kind === 'verdict' && consensusRationaleNeedsRetry(parsed.rationale, round.category))

    if (needsRetry) {
      const retryRaw = await callConsensusOnce(call, input, true)
      if (!retryRaw.error) {
        raw = {
          ...retryRaw,
          promptTokens: (raw.promptTokens ?? 0) + (retryRaw.promptTokens ?? 0),
          completionTokens: (raw.completionTokens ?? 0) + (retryRaw.completionTokens ?? 0),
          costUsd: (raw.costUsd ?? 0) + (retryRaw.costUsd ?? 0),
          costIsEstimated: raw.costIsEstimated && retryRaw.costIsEstimated,
        }
        const retryParsed = parseConsensusOutput(retryRaw.text)
        if (retryParsed) parsed = retryParsed
      }
    }

    const costUsd = Number((raw.costUsd ?? 0).toFixed(6))
    const entry = lookupRosterEntry(CONSENSUS_ENGINE_MODEL_ID)
    const estimated = entry
      ? Number(computeCostUsd(entry, raw.promptTokens, raw.completionTokens).toFixed(6))
      : costUsd
    const cost = {
      costUsd,
      estimated,
      promptTokens: raw.promptTokens,
      completionTokens: raw.completionTokens,
      costIsEstimated: raw.costIsEstimated,
    }

    if (!parsed) {
      return persistConsensusAbstain(round.id, round.category, seat.brand, CONSENSUS_NO_SIGNAL_REASON, cost)
    }
    if (parsed.kind === 'abstain') {
      return persistConsensusAbstain(round.id, round.category, seat.brand, parsed.rationale, cost)
    }
    if (consensusRationaleNeedsRetry(parsed.rationale, round.category)) {
      return persistConsensusAbstain(round.id, round.category, seat.brand, CONSENSUS_NO_SIGNAL_REASON, cost)
    }

    const direction = leagueSideFromConsensus(parsed.verdict, round.proposition_kind)
    await upsertExtraPrediction({
      roundId: round.id,
      category: round.category,
      model_id: 'consensus',
      brand: seat.brand,
      direction,
      probability: parsed.confidence,
      qualifier_text: null,
      reasoning_snippet: parsed.rationale,
      cost_usd: costUsd,
      estimated_cost_usd: estimated,
      prompt_tokens: raw.promptTokens,
      completion_tokens: raw.completionTokens,
    })
    return {
      ...baseOutcome('consensus', seat.brand),
      actual_model: CONSENSUS_ENGINE_MODEL_ID,
      direction,
      probability: parsed.confidence,
      reasoning_snippet: parsed.rationale,
      cost_usd: costUsd,
      estimated_cost_usd: estimated,
      cost_source: raw.costIsEstimated ? 'estimated' : 'billed',
      prompt_tokens: raw.promptTokens,
      completion_tokens: raw.completionTokens,
      status: 'ok',
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'consensus seat failed'
    await upsertExtraPrediction({
      roundId: round.id,
      category: round.category,
      model_id: 'consensus',
      brand: seat.brand,
      direction: null,
      probability: null,
      qualifier_text: null,
      reasoning_snippet: null,
      cost_usd: 0,
      estimated_cost_usd: 0,
      error: message,
    })
    return { ...baseOutcome('consensus', seat.brand), status: 'error', error: message.slice(0, 500) }
  }
}

function defaultCrowCaller(): CrowCaller {
  const entry = lookupRosterEntry(CROW_ENGINE_MODEL_ID)
  if (!entry || entry.caller.kind !== 'core' || entry.caller.provider !== 'mistral') {
    throw new Error(`crow seat: engine ${CROW_ENGINE_MODEL_ID} is not the Mistral caller`)
  }
  const caller = entry.caller
  return async ({ systemPrompt, userPrompt }) => {
    const res = await runSingleAiProvider({
      supabase: supabaseAdmin,
      authSupabase: supabaseAdmin,
      sessionId: null,
      userId: null,
      provider: 'mistral',
      prompt: userPrompt,
      systemPrompt,
      skipLanguageInjection: true,
      maxCompletionTokens: CROW_MAX_COMPLETION_TOKENS,
      modelOverride: caller.modelOverride,
      timeoutMs: CROW_TIMEOUT_MS,
    })
    const estimate = computeCostUsd(entry, res.promptTokens, res.completionTokens)
    const billed = typeof res.costUsd === 'number' ? res.costUsd : null
    return {
      text: res.text,
      promptTokens: res.promptTokens,
      completionTokens: res.completionTokens,
      costUsd: billed ?? estimate,
      costIsEstimated: billed == null,
      error: res.error,
    }
  }
}

async function resolveCrowBrief(
  round: ExtraRoundRow,
  providedSeries: ExtraPriceSeries | null | undefined,
): Promise<string> {
  if (isSportsLedgerCategory(round.category)) {
    const parts = decodeSportsInstrument(round.instrument)
    if (!parts) return 'SPORTS FACTS: instrument undecodable. Do not invent odds.'
    const cache = await readFixtureCache(parts.eventId).catch(() => null)
    return formatSportsCrowBrief(parts, cache)
  }
  if (isPoliticsLedgerCategory(round.category)) {
    const parts = decodePoliticsInstrument(round.instrument)
    if (!parts) return 'POLITICS FACTS: instrument undecodable. Do not invent odds.'
    const slate = readPoliticsSlateCache() ?? []
    const row = slate.find(
      (item) =>
        item.jurisdiction === parts.jurisdiction &&
        item.office === parts.office &&
        item.candidate.toLowerCase() === parts.candidate.toLowerCase(),
    )
    return formatPoliticsCrowBrief(parts, row ? { kalshiPct: row.kalshiPct, polymarketPct: row.polymarketPct } : null)
  }
  if (isEntertainmentLedgerCategory(round.category)) {
    const parts = decodeEntertainmentInstrument(round.instrument)
    if (!parts) return 'ENTERTAINMENT FACTS: instrument undecodable. Do not invent grosses or odds.'
    return formatEntertainmentCrowBrief(parts, { marketPct: null, trackingNote: null })
  }
  if (isRealEstateLedgerCategory(round.category)) {
    const parts = decodePropertyInstrument(round.instrument)
    if (!parts) return 'HOUSING FACTS: instrument undecodable. Do not invent an index or name a complex.'
    return formatPropertyCrowBrief(parts)
  }
  const series = await resolveHistorySeries(round.instrument, providedSeries)
  const priceBrief = formatFinanceCrowBrief(series)
  if (isKrEquityCrowInstrument(round.instrument)) {
    return krEquityCrowBrief(priceBrief, round.closed_book_packet_text)
  }
  return withCrowdingBlock(priceBrief, round.closed_book_packet_text)
}

async function callCrowOnce(call: CrowCaller, input: CrowLeagueInput, retry = false): Promise<CrowCallResult> {
  const userPrompt = retry
    ? `${buildCrowUserPrompt(input)}\n\n${crowRetryInstruction()}`
    : buildCrowUserPrompt(input)
  return call({ systemPrompt: buildCrowSystemPrompt(input.category, input.instrument), userPrompt })
}

async function runCrowSeat(
  round: ExtraRoundRow,
  call: CrowCaller,
  providedSeries: ExtraPriceSeries | null | undefined,
): Promise<ExtraSeatOutcome> {
  const seat = lookupExtraSeat('crow')!
  const factBrief = await resolveCrowBrief(round, providedSeries)
  const input = buildCrowInput(round, factBrief)
  try {
    let raw = await callCrowOnce(call, input, false)
    if (raw.error) throw new Error(raw.error)
    let parsed = parseCrowOutput(raw.text)
    if (!parsed) {
      const retryRaw = await callCrowOnce(call, input, true)
      if (!retryRaw.error) {
        raw = {
          ...retryRaw,
          promptTokens: (raw.promptTokens ?? 0) + (retryRaw.promptTokens ?? 0),
          completionTokens: (raw.completionTokens ?? 0) + (retryRaw.completionTokens ?? 0),
          costUsd: (raw.costUsd ?? 0) + (retryRaw.costUsd ?? 0),
          costIsEstimated: raw.costIsEstimated && retryRaw.costIsEstimated,
        }
        parsed = parseCrowOutput(retryRaw.text)
      }
    }
    if (!parsed) throw new Error('crow seat: empty or unparseable response')
    const costUsd = Number((raw.costUsd ?? 0).toFixed(6))
    const entry = lookupRosterEntry(CROW_ENGINE_MODEL_ID)
    const estimated = entry
      ? Number(computeCostUsd(entry, raw.promptTokens, raw.completionTokens).toFixed(6))
      : costUsd
    const direction = leagueSideFromCrow(parsed.verdict, round.proposition_kind)
    await upsertExtraPrediction({
      roundId: round.id,
      category: round.category,
      model_id: 'crow',
      brand: seat.brand,
      direction,
      probability: parsed.confidence,
      qualifier_text: null,
      reasoning_snippet: parsed.rationale,
      cost_usd: costUsd,
      estimated_cost_usd: estimated,
      prompt_tokens: raw.promptTokens,
      completion_tokens: raw.completionTokens,
    })
    return {
      ...baseOutcome('crow', seat.brand),
      actual_model: CROW_ENGINE_MODEL_ID,
      direction,
      probability: parsed.confidence,
      reasoning_snippet: parsed.rationale,
      cost_usd: costUsd,
      estimated_cost_usd: estimated,
      cost_source: raw.costIsEstimated ? 'estimated' : 'billed',
      prompt_tokens: raw.promptTokens,
      completion_tokens: raw.completionTokens,
      status: 'ok',
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'crow seat failed'
    await upsertExtraPrediction({
      roundId: round.id,
      category: round.category,
      model_id: 'crow',
      brand: seat.brand,
      direction: null,
      probability: null,
      qualifier_text: null,
      reasoning_snippet: null,
      cost_usd: 0,
      estimated_cost_usd: 0,
      error: message,
    })
    return { ...baseOutcome('crow', seat.brand), status: 'error', error: message.slice(0, 500) }
  }
}

export async function generateExtraSeats(opts: GenerateExtraSeatsOpts): Promise<ExtraSeatOutcome[]> {
  const excluded = new Set(opts.excludeModelIds ?? [])
  const pending = getExtraRoster().filter((seat) => !excluded.has(seat.model_id))
  if (pending.length === 0) return []

  const round = await loadRound(opts.roundId)
  const read = opts.divinationReader ?? (async (input) => {
    assertNoPacketOnDivinationInput(input)
    return readLeagueDivinationLive(input)
  })
  const historyCall = opts.historyCaller ?? defaultHistoryCaller()
  const sentimentCall = opts.sentimentCaller ?? defaultSentimentCaller()
  const consensusCall = opts.consensusCaller ?? defaultConsensusCaller()
  const crowCall = opts.crowCaller ?? defaultCrowCaller()
  const out: ExtraSeatOutcome[] = []

  for (const seat of pending) {
    const result =
      seat.kind === 'divination'
        ? await runDivinationSeat(round, read)
        : seat.kind === 'history'
          ? await runHistorySeat(round, historyCall, opts.priceSeries)
          : seat.kind === 'sentiment'
            ? await runSentimentSeat(round, sentimentCall)
            : seat.kind === 'consensus'
              ? await runConsensusSeat(round, consensusCall)
              : await runCrowSeat(round, crowCall, opts.priceSeries)
    out.push(result)
    opts.onSeatResult?.(result)
  }
  return out
}

export function extraSeatIdsForProgress(): string[] {
  return EXTRA_SEAT_IDS.filter((id) => isExtraSeatId(id))
}
