import type { SupabaseClient } from '@supabase/supabase-js'
import type { EngineRunRecord } from './run'
import type { EngineResult } from './schema'

const APPLY = 'Paste docs/crisis/APPLY_ENGINE.md before saving an engine run.'

interface RunRow {
  id: string
  region_id: number | null
  horizon: EngineRunRecord['horizon']
  mode: EngineRunRecord['mode']
  status: 'done' | 'error' | 'partial'
  roster: EngineRunRecord['roster']
  cost_usd: number | null
  tokens_in: number | null
  tokens_out: number | null
  error: string | null
  result: (EngineResult & { card?: EngineRunRecord['card']; search_urls?: string[] }) | null
  cache_key: string | null
}

function fromRow(row: RunRow): EngineRunRecord | null {
  if (!row.result || row.region_id == null || !row.cache_key || !row.result.card) return null
  return {
    id: row.id,
    cacheKey: row.cache_key,
    cacheHit: true,
    regionId: row.region_id,
    horizon: row.horizon,
    mode: row.mode,
    status: row.status,
    roster: row.roster,
    costUsd: Number(row.cost_usd ?? 0),
    tokensIn: row.tokens_in ?? 0,
    tokensOut: row.tokens_out ?? 0,
    result: row.result,
    steps: [],
    card: row.result.card,
    searchUrls: row.result.search_urls ?? [],
    queries: Array.isArray((row.result as unknown as { queries?: string[] }).queries) ? (row.result as unknown as { queries: string[] }).queries : [],
    error: row.error,
    dryRun: false,
  }
}

export async function loadCachedRun(client: SupabaseClient, key: string): Promise<EngineRunRecord | null> {
  const { data, error } = await client
    .from('crisis_engine_runs')
    .select('id,region_id,horizon,mode,status,roster,cost_usd,tokens_in,tokens_out,error,result,cache_key')
    .eq('cache_key', key)
    .eq('status', 'done')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    if (/crisis_engine_runs|schema cache|does not exist/i.test(error.message)) throw new Error(`${error.message}. ${APPLY}`)
    throw new Error(error.message)
  }
  const hit = data ? fromRow(data as RunRow) : null
  if (!hit || hit.status !== 'done' || hit.result?.partial) return null
  return hit
}

export async function persistRun(client: SupabaseClient, record: EngineRunRecord, triggeredBy: 'admin' | 'system' | 'user'): Promise<string> {
  const now = new Date().toISOString()
  const { data, error } = await client
    .from('crisis_engine_runs')
    .insert({
      region_id: record.regionId,
      horizon: record.horizon,
      mode: record.mode,
      status: record.status === 'partial' ? 'error' : record.status,
      triggered_by: triggeredBy,
      user_id: null,
      roster: record.roster,
      cost_usd: record.costUsd,
      tokens_in: record.tokensIn,
      tokens_out: record.tokensOut,
      started_at: now,
      finished_at: now,
      error: record.status === 'partial' ? record.error ?? 'partial' : record.error,
      result: record.result
        ? { ...record.result, card: record.card, search_urls: record.searchUrls, queries: record.queries }
        : null,
      cache_key: record.status === 'done' && !record.result?.partial ? record.cacheKey : null,
    })
    .select('id')
    .single()
  if (error) {
    if (/crisis_engine_runs|schema cache|does not exist/i.test(error.message)) throw new Error(`${error.message}. ${APPLY}`)
    throw new Error(error.message)
  }
  const id = String((data as { id: string }).id)
  if (record.steps.length > 0) {
    const { error: stepError } = await client.from('crisis_engine_steps').insert(
      record.steps.map((step) => ({
        run_id: id,
        role: step.role,
        model: step.model,
        provider: step.provider,
        prompt_hash: step.promptHash,
        input_tokens: step.inputTokens,
        output_tokens: step.outputTokens,
        cost_usd: step.costUsd,
        latency_ms: step.latencyMs,
        output: step.output,
        error: step.error,
      })),
    )
    if (stepError) throw new Error(stepError.message)
  }
  return id
}

export async function loadRun(client: SupabaseClient, id: string): Promise<EngineRunRecord | null> {
  const { data, error } = await client
    .from('crisis_engine_runs')
    .select('id,region_id,horizon,mode,status,roster,cost_usd,tokens_in,tokens_out,error,result,cache_key')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? fromRow(data as RunRow) : null
}

export async function insertHypothesis(
  client: SupabaseClient,
  row: {
    created_at: string
    region_ids: number[]
    stage: number
    confidence: string
    novelty: string
    title: string
    body: string
    evidence_snapshot: Record<string, unknown>
    ai_roster: unknown
  },
): Promise<{ id: number; prev_hash: string | null; content_hash: string }> {
  const { data, error } = await client
    .from('crisis_hypotheses')
    .insert({
      created_at: row.created_at,
      region_ids: row.region_ids,
      stage: row.stage,
      confidence: row.confidence,
      novelty: row.novelty,
      title: row.title,
      body: row.body,
      evidence_signal_ids: [],
      evidence_snapshot: row.evidence_snapshot,
      ai_roster: row.ai_roster,
    })
    .select('id,prev_hash,content_hash')
    .single()
  if (error) throw new Error(error.message)
  const saved = data as { id: number; prev_hash: string | null; content_hash: string }
  if (!saved.content_hash) throw new Error('crisis_hypotheses trigger did not set content_hash')
  return saved
}

export async function markPublished(client: SupabaseClient, runId: string, hypothesisIds: number[]): Promise<void> {
  const { error } = await client
    .from('crisis_engine_runs')
    .update({ published_hypothesis_ids: hypothesisIds })
    .eq('id', runId)
  if (error) throw new Error(error.message)
}
