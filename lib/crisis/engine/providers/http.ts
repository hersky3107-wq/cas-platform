import { EmptyContentError, ProviderHttpError } from './types'

function parseSseJson(raw: string): Record<string, unknown> | null {
  const chunks: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue
    const data = line.slice(5).trim()
    if (!data || data === '[DONE]') continue
    chunks.push(data)
  }
  for (let i = chunks.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(chunks[i]) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch {
      // try earlier chunks
    }
  }
  if (!chunks.length) return null
  try {
    const parsed = JSON.parse(chunks.join('')) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    return null
  }
  return null
}

export function parseHttpBody(raw: string, contentType: string): Record<string, unknown> | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (contentType.includes('text/html') || /^<!DOCTYPE|<html/i.test(trimmed)) return null
  if (contentType.includes('text/event-stream') || trimmed.startsWith('data:')) {
    return parseSseJson(trimmed)
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    return null
  } catch {
    if (trimmed.includes('\ndata:') || trimmed.startsWith('data:')) return parseSseJson(trimmed)
    return null
  }
}

export async function postJson(opts: {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
  timeoutMs: number
}): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(opts.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    body: JSON.stringify(opts.body),
    signal: AbortSignal.timeout(opts.timeoutMs),
  })
  const contentType = res.headers.get('content-type') ?? ''
  const raw = await res.text().catch(() => '')
  const head = raw.slice(0, 400)
  if (!res.ok) {
    console.warn(`provider HTTP ${res.status} content-type=${contentType} body_head=${head}`)
    throw new ProviderHttpError(
      res.status,
      `HTTP ${res.status} ${res.statusText}${raw ? ` - ${head}` : ''}`,
    )
  }
  const json = parseHttpBody(raw, contentType)
  if (!json) {
    console.warn(`provider HTTP ${res.status} body was not JSON content-type=${contentType} body_head=${head}`)
    throw new ProviderHttpError(
      res.status,
      `HTTP ${res.status} but body was not JSON (content-type=${contentType}): ${head}`,
    )
  }
  return { status: res.status, json }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function billedUsd(usage: Record<string, unknown> | null): number | null {
  if (!usage) return null
  const nested = usage.cost
  if (nested && typeof nested === 'object') {
    const total = (nested as Record<string, unknown>).total_cost
    if (typeof total === 'number' && Number.isFinite(total)) return total
  }
  if (typeof nested === 'number' && Number.isFinite(nested)) return nested
  const ticks = usage.cost_in_usd_ticks
  if (typeof ticks === 'number' && Number.isFinite(ticks) && ticks >= 0) return ticks / 10_000_000_000
  return null
}

export function requireText(model: string, text: string | null, finishReason: string | null, extra = ''): string {
  if (text && text.trim()) return text
  throw new EmptyContentError(model, finishReason, extra)
}

export function chatContent(json: Record<string, unknown>): {
  text: string | null
  finishReason: string | null
  tokensIn: number
  tokensOut: number
  costUsd: number | null
  reasoningTokens: number | null
} {
  const choices = Array.isArray(json.choices) ? json.choices : []
  const choice = asRecord(choices[0])
  const message = asRecord(choice?.message)
  const content = message?.content
  const text = typeof content === 'string' ? content : null
  const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : null
  const usage = asRecord(json.usage)
  const details = asRecord(usage?.completion_tokens_details)
  return {
    text,
    finishReason,
    tokensIn: num(usage?.prompt_tokens) ?? 0,
    tokensOut: num(usage?.completion_tokens) ?? 0,
    costUsd: billedUsd(usage),
    reasoningTokens: num(details?.reasoning_tokens),
  }
}

export function emptyExtra(reasoningTokens: number | null, completionTokens: number): string {
  return reasoningTokens == null ? '' : `, reasoning_tokens=${reasoningTokens}/${completionTokens || '?'}`
}
