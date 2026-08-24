import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import {
  decideDeepRunAction,
  isUnseededState,
  nextUnseededState,
  placeholderUnseededState,
  runIsBusy,
  MAX_SEED_ATTEMPTS,
  type DeepRunAction,
  type UnseededState,
} from './deep-run-policy'

export { decideDeepRunAction, runIsBusy, isUnseededState, nextUnseededState, placeholderUnseededState, MAX_SEED_ATTEMPTS }
export type { DeepRunAction, UnseededState }

export const LEAGUE_DEEP_RUNS_TABLE = 'league_deep_runs'

export type DeepProduct = 'open' | 'debate'
export type DeepRunStatus = 'running' | 'done' | 'error'

export type DeepProviderMeta = { provider: string; roleLabel: string }

export type DeepRunRow = {
  id: string
  round_id: string
  product: DeepProduct
  user_id: string
  status: DeepRunStatus
  stage: string
  result: Record<string, unknown> | null
  providers: DeepProviderMeta[]
  state: Record<string, unknown>
  charged: boolean
  charged_cost: number
  deduct_skipped: boolean
  refunded: boolean
  billed_usd: number
  estimated_usd: number
  provider_calls: number
  busy_until: string | null
  created_at: string
  updated_at: string
}

const COLUMNS =
  'id, round_id, product, user_id, status, stage, result, providers, state, charged, charged_cost, deduct_skipped, refunded, billed_usd, estimated_usd, provider_calls, busy_until, created_at, updated_at'

function asRow(data: Record<string, unknown>): DeepRunRow {
  return {
    id: String(data.id),
    round_id: String(data.round_id),
    product: data.product as DeepProduct,
    user_id: String(data.user_id),
    status: data.status as DeepRunStatus,
    stage: String(data.stage ?? 'start'),
    result: (data.result as Record<string, unknown> | null) ?? null,
    providers: Array.isArray(data.providers) ? (data.providers as DeepProviderMeta[]) : [],
    state: (data.state as Record<string, unknown>) ?? {},
    charged: data.charged === true,
    charged_cost: typeof data.charged_cost === 'number' ? data.charged_cost : 0,
    deduct_skipped: data.deduct_skipped === true,
    refunded: data.refunded === true,
    billed_usd: typeof data.billed_usd === 'number' ? Number(data.billed_usd) : 0,
    estimated_usd: typeof data.estimated_usd === 'number' ? Number(data.estimated_usd) : 0,
    provider_calls: typeof data.provider_calls === 'number' ? data.provider_calls : 0,
    busy_until: typeof data.busy_until === 'string' ? data.busy_until : null,
    created_at: String(data.created_at ?? ''),
    updated_at: String(data.updated_at ?? ''),
  }
}

export async function loadDeepRun(
  roundId: string,
  product: DeepProduct,
  userId: string
): Promise<DeepRunRow | null> {
  const { data, error } = await supabaseAdmin
    .from(LEAGUE_DEEP_RUNS_TABLE)
    .select(COLUMNS)
    .eq('round_id', roundId)
    .eq('product', product)
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data) return null
  return asRow(data as Record<string, unknown>)
}

export async function loadDeepRunById(id: string): Promise<DeepRunRow | null> {
  const { data, error } = await supabaseAdmin.from(LEAGUE_DEEP_RUNS_TABLE).select(COLUMNS).eq('id', id).maybeSingle()
  if (error || !data) return null
  return asRow(data as Record<string, unknown>)
}

export type InsertDeepRunInput = {
  roundId: string
  product: DeepProduct
  userId: string
  state: Record<string, unknown>
}

/**
 * Inserts a claim row (charged=false, state=unseeded placeholder). On
 * unique-key collision, returns the existing row so the caller can
 * replay/resume instead of charging twice. On a foreign-key violation
 * (round_id doesn't exist in prediction_rounds), returns `noRound: true` —
 * this IS the round-existence check now: the claim insert rejects a bad
 * round atomically, before any charge, with no separate query needed.
 */
export async function insertDeepRunClaim(
  input: InsertDeepRunInput
): Promise<
  | { row: DeepRunRow; created: boolean }
  | { error: string; missingTable: boolean; noRound: boolean }
> {
  const ins = await supabaseAdmin
    .from(LEAGUE_DEEP_RUNS_TABLE)
    .insert([
      {
        round_id: input.roundId,
        product: input.product,
        user_id: input.userId,
        status: 'running',
        stage: 'start',
        state: input.state,
        charged: false,
        refunded: false,
      },
    ])
    .select(COLUMNS)
    .single()

  if (!ins.error && ins.data) {
    return { row: asRow(ins.data as Record<string, unknown>), created: true }
  }

  const code = (ins.error as { code?: string } | null)?.code
  if (code === '23505') {
    const existing = await loadDeepRun(input.roundId, input.product, input.userId)
    if (existing) return { row: existing, created: false }
  }

  const message = ins.error?.message ?? 'could not create deep run'
  const noRound = code === '23503'
  // A foreign-key violation's own message mentions "league_deep_runs" (the
  // constrained table), so it would otherwise false-match the missing-table
  // regex below — noRound must be checked first and wins outright.
  const missingTable = !noRound && /league_deep_runs|schema cache|does not exist/i.test(message)
  return { error: message, missingTable, noRound }
}

export async function resetDeepRun(
  id: string,
  state: Record<string, unknown>
): Promise<DeepRunRow | null> {
  const { data, error } = await supabaseAdmin
    .from(LEAGUE_DEEP_RUNS_TABLE)
    .update({
      status: 'running',
      stage: 'start',
      result: null,
      providers: [],
      state,
      charged: false,
      charged_cost: 0,
      deduct_skipped: false,
      refunded: false,
      billed_usd: 0,
      estimated_usd: 0,
      provider_calls: 0,
      busy_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select(COLUMNS)
    .single()
  if (error || !data) return null
  return asRow(data as Record<string, unknown>)
}

export async function markDeepRunCharged(
  id: string,
  cost: number,
  deductSkipped: boolean
): Promise<void> {
  await supabaseAdmin
    .from(LEAGUE_DEEP_RUNS_TABLE)
    .update({
      charged: true,
      charged_cost: cost,
      deduct_skipped: deductSkipped,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
}

export async function deleteUnchargedRun(id: string): Promise<void> {
  await supabaseAdmin.from(LEAGUE_DEEP_RUNS_TABLE).delete().eq('id', id).eq('charged', false)
}

const BUSY_MS = 280_000

export async function markDeepRunBusy(id: string): Promise<void> {
  await supabaseAdmin
    .from(LEAGUE_DEEP_RUNS_TABLE)
    .update({
      busy_until: new Date(Date.now() + BUSY_MS).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
}

export async function saveDeepRunProgress(opts: {
  id: string
  stage: string
  status: DeepRunStatus
  state: Record<string, unknown>
  result?: Record<string, unknown> | null
  providers?: DeepProviderMeta[]
  billedUsd: number
  estimatedUsd: number
  providerCalls: number
  refunded?: boolean
}): Promise<void> {
  await supabaseAdmin
    .from(LEAGUE_DEEP_RUNS_TABLE)
    .update({
      stage: opts.stage,
      status: opts.status,
      state: opts.state,
      result: opts.result ?? null,
      ...(opts.providers ? { providers: opts.providers } : {}),
      billed_usd: opts.billedUsd,
      estimated_usd: opts.estimatedUsd,
      provider_calls: opts.providerCalls,
      busy_until: null,
      ...(opts.refunded !== undefined ? { refunded: opts.refunded } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', opts.id)
}

export function addSpanTotals(
  row: Pick<DeepRunRow, 'billed_usd' | 'estimated_usd' | 'provider_calls'>,
  span: { billedUsd: number; estimatedUsd: number; calls: number }
): { billedUsd: number; estimatedUsd: number; providerCalls: number } {
  return {
    billedUsd: row.billed_usd + span.billedUsd,
    estimatedUsd: row.estimated_usd + span.estimatedUsd,
    providerCalls: row.provider_calls + span.calls,
  }
}
