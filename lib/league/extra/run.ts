/**
 * Extra-tier generation. Never builds or receives a research packet.
 * Oracle owns divination cache — this file does not write one.
 */
import 'server-only'

import { readLeagueDivinationLive } from '@/lib/oracle/league-divination/live'
import { supabaseAdmin } from '@/lib/supabase/server'
import type { AnswerSide } from '../answer-contract'
import { extraStubReason } from './stubs'
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
import { EXTRA_SEAT_IDS, getExtraRoster, isExtraSeatId, lookupExtraSeat, type ExtraSeatId } from './seats'

export type ExtraSeatOutcome = {
  model_id: ExtraSeatId
  actual_model: ExtraSeatId
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
  cost_source: 'estimated'
  server_side_tools_used: null
  cost_in_usd_ticks: null
  prompt_tokens: null
  completion_tokens: null
  status: 'ok' | 'abstain' | 'error'
  error?: string
}

type ExtraRoundRow = {
  id: string
  proposition_text: string
  category: string
  instrument: string
  opened_at: string | null
  created_at: string | null
  proposition_kind: string | null
  subject_label: string | null
}

export type GenerateExtraSeatsOpts = {
  roundId: string
  excludeModelIds?: readonly string[]
  onSeatResult?: (result: ExtraSeatOutcome) => void
  /** Test seam — default is readLeagueDivinationLive. */
  divinationReader?: DivinationReader
}

async function loadRound(roundId: string): Promise<ExtraRoundRow> {
  const { data, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id, proposition_text, category, instrument, opened_at, created_at, proposition_kind, subject_label')
    .eq('id', roundId)
    .single()
  if (error || !data) {
    throw new Error(`extra seats: round not found ${roundId}${error ? ` (${error.message})` : ''}`)
  }
  return data as ExtraRoundRow
}

async function upsertExtraPrediction(row: {
  roundId: string
  model_id: ExtraSeatId
  brand: string
  direction: AnswerSide | null
  probability: number | null
  qualifier_text: string | null
  reasoning_snippet: string | null
  cost_usd: number
  estimated_cost_usd: number
}): Promise<void> {
  const { error } = await supabaseAdmin.from('model_predictions').upsert(
    {
      round_id: row.roundId,
      model_id: row.model_id,
      brand: row.brand,
      camp: 'other',
      league_tier: 'extra',
      predicted_direction: row.direction,
      predicted_value: row.probability,
      predicted_magnitude_pct: null,
      predicted_qualifier_text: row.qualifier_text,
      reasoning_snippet: row.reasoning_snippet,
      reasoning_text: null,
      prompt_tokens: null,
      completion_tokens: null,
      reasoning_tokens: null,
      cost_usd: row.cost_usd,
      estimated_cost_usd: row.estimated_cost_usd,
      server_side_tools_used: null,
      predicted_at: new Date().toISOString(),
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

async function runStubSeat(roundId: string, id: Exclude<ExtraSeatId, 'divination'>): Promise<ExtraSeatOutcome> {
  const seat = lookupExtraSeat(id)!
  const snippet = extraStubReason(id)
  await upsertExtraPrediction({
    roundId,
    model_id: id,
    brand: seat.brand,
    direction: null,
    probability: null,
    qualifier_text: null,
    reasoning_snippet: snippet,
    cost_usd: 0,
    estimated_cost_usd: 0,
  })
  return { ...baseOutcome(id, seat.brand), reasoning_snippet: snippet, status: 'abstain' }
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
      model_id: 'divination',
      brand: seat.brand,
      direction: null,
      probability: null,
      qualifier_text: null,
      reasoning_snippet: null,
      cost_usd: 0,
      estimated_cost_usd: 0,
    })
    return { ...baseOutcome('divination', seat.brand), status: 'error', error: message.slice(0, 500) }
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
  const out: ExtraSeatOutcome[] = []

  for (const seat of pending) {
    const result =
      seat.kind === 'divination'
        ? await runDivinationSeat(round, read)
        : await runStubSeat(round.id, seat.kind)
    out.push(result)
    opts.onSeatResult?.(result)
  }
  return out
}

export function extraSeatIdsForProgress(): string[] {
  return EXTRA_SEAT_IDS.filter((id) => isExtraSeatId(id))
}
