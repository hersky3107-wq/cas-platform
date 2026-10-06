import 'server-only'

import { recordProviderCost } from '@/lib/ai/cost-span'

/**
 * Perplexity Agent API (POST /v1/agent) in background mode.
 *
 * Sonar Chat Completions (`sonar-deep-research`) stopped serving on
 * 2026-09-27; Perplexity's migration guide maps it to the Agent API
 * `high` preset. A deep run takes minutes, so the report submits it with
 * `background: true` in the research hop and polls it by id on later hops.
 */

const AGENT_URL = 'https://api.perplexity.ai/v1/agent'
const HTTP_TIMEOUT_MS = 30_000

export const DEEP_RESEARCH_PRESET = 'high'
export const FALLBACK_RESEARCH_PRESET = 'low'

export type AgentSearchResult = { title: string | null; url: string | null; date: string | null }

export type AgentSnapshot = {
  id: string | null
  status: string
  text: string | null
  searchResults: AgentSearchResult[]
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number | null
  model: string | null
  error: string | null
  requestId: string | null
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'incomplete'])

export function isTerminalAgentStatus(status: string): boolean {
  return TERMINAL.has(status)
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null
}

/** Response JSON → snapshot. Joins every output_text part of every message item. */
export function parseAgentResponse(json: unknown, requestId: string | null = null): AgentSnapshot {
  const body = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>
  const output = Array.isArray(body.output) ? body.output : []
  const texts: string[] = []
  const searchResults: AgentSearchResult[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (row.type === 'message' && Array.isArray(row.content)) {
      for (const part of row.content) {
        const p = part as Record<string, unknown> | null
        if (p && p.type === 'output_text' && typeof p.text === 'string') texts.push(p.text)
      }
    } else if (row.type === 'search_results' && Array.isArray(row.results)) {
      for (const result of row.results) {
        const r = result as Record<string, unknown> | null
        if (!r) continue
        searchResults.push({ title: str(r.title), url: str(r.url), date: str(r.date) })
      }
    }
  }
  const usage = (body.usage && typeof body.usage === 'object' ? body.usage : {}) as Record<string, unknown>
  const cost = (usage.cost && typeof usage.cost === 'object' ? usage.cost : {}) as Record<string, unknown>
  const error = body.error && typeof body.error === 'object' ? str((body.error as Record<string, unknown>).message) : str(body.error)
  const incomplete =
    body.incomplete_details && typeof body.incomplete_details === 'object'
      ? str((body.incomplete_details as Record<string, unknown>).reason)
      : null
  return {
    id: str(body.id),
    status: str(body.status) ?? (error ? 'failed' : 'unknown'),
    text: texts.length ? texts.join('') : null,
    searchResults,
    inputTokens: num(usage.input_tokens),
    outputTokens: num(usage.output_tokens),
    costUsd: num(cost.total_cost),
    model: str(body.model),
    error: error ?? (incomplete ? `incomplete: ${incomplete}` : null),
    requestId,
  }
}

function failed(error: string, requestId: string | null = null, id: string | null = null): AgentSnapshot {
  return {
    id,
    status: 'failed',
    text: null,
    searchResults: [],
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    model: null,
    error,
    requestId,
  }
}

function apiKey(): string | null {
  return process.env.PERPLEXITY_API_KEY?.trim() || null
}

async function call(url: string, init: RequestInit): Promise<AgentSnapshot> {
  const key = apiKey()
  if (!key) return failed('PERPLEXITY_API_KEY is not set')
  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })
  } catch (e) {
    return failed(e instanceof Error ? e.message : 'agent request threw')
  }
  const requestId = res.headers.get('x-request-id') ?? res.headers.get('request-id')
  const raw = await res.text().catch(() => '')
  let json: unknown = null
  try {
    json = raw ? JSON.parse(raw) : null
  } catch {
    json = null
  }
  if (!res.ok) {
    const parsed = json ? parseAgentResponse(json, requestId) : null
    return failed(`HTTP ${res.status}${parsed?.error ? ` - ${parsed.error}` : raw ? ` - ${raw.slice(0, 200)}` : ''}`, requestId, parsed?.id ?? null)
  }
  return parseAgentResponse(json, requestId)
}

export async function submitAgentResearch(params: {
  preset: string
  input: string
  schemaName: string
  schema: Record<string, unknown>
  maxOutputTokens: number
}): Promise<AgentSnapshot> {
  return call(AGENT_URL, {
    method: 'POST',
    body: JSON.stringify({
      preset: params.preset,
      input: params.input,
      background: true,
      max_output_tokens: params.maxOutputTokens,
      response_format: { type: 'json_schema', json_schema: { name: params.schemaName, schema: params.schema } },
    }),
  })
}

export async function getAgentResearch(id: string): Promise<AgentSnapshot> {
  const snap = await call(`${AGENT_URL}/${encodeURIComponent(id)}`, { method: 'GET' })
  if (snap.status === 'completed') {
    recordProviderCost({ costUsd: snap.costUsd, promptTokens: snap.inputTokens, completionTokens: snap.outputTokens })
  }
  return snap
}

export async function cancelAgentResearch(id: string): Promise<void> {
  await call(`${AGENT_URL}/${encodeURIComponent(id)}/cancel`, { method: 'POST' })
}
