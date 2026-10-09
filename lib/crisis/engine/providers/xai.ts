import { citationRecords } from '../search-items'
import { asRecord, billedUsd, chatContent, emptyExtra, num, postJson, requireText } from './http'
import { envKey, type ProviderCall, type ProviderResult } from './types'

const MAX_SEARCH_SOURCES = 8
const SNIPPET_CHARS = 300

function key(): string {
  return envKey('XAI_API_KEY', 'GROK_API_KEY')
}

function collectGrokCitations(json: Record<string, unknown>): unknown[] {
  const found: unknown[] = []
  if (json.citations) found.push(json.citations)
  if (json.search_results) found.push(json.search_results)
  const output = Array.isArray(json.output) ? json.output : []
  for (const item of output) {
    const record = asRecord(item)
    if (!record) continue
    if (record.citations) found.push(record.citations)
    if (record.annotations) found.push(record.annotations)
    const content = Array.isArray(record.content) ? record.content : []
    for (const part of content) {
      const block = asRecord(part)
      if (block?.annotations) found.push(block.annotations)
      if (block?.citations) found.push(block.citations)
    }
    if (record.type === 'web_search_call' || record.type === 'web_search_result') {
      if (Array.isArray(record.results)) found.push(record.results)
      if (record.result) found.push(record.result)
    }
  }
  return found
}

/** League scout seat: POST /v1/responses, tools web_search, max_turns 1. */
async function callXaiLiveSearch(call: ProviderCall): Promise<ProviderResult> {
  const { status, json } = await postJson({
    url: 'https://api.x.ai/v1/responses',
    headers: { Authorization: `Bearer ${key()}` },
    timeoutMs: call.timeoutMs,
    body: {
      model: call.model,
      input: call.user,
      tools: [{ type: 'web_search' }],
      ...(call.system ? { instructions: call.system } : {}),
      max_output_tokens: call.maxTokens,
      max_turns: call.maxTurns && call.maxTurns > 0 ? call.maxTurns : 1,
      max_search_results: MAX_SEARCH_SOURCES,
      ...call.extraBody,
    },
  })
  const output = Array.isArray(json.output) ? json.output : []
  const text = output
    .map((item) => asRecord(item))
    .filter((item) => item?.type === 'message')
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .map((part) => asRecord(part))
    .map((part) => (part?.type === 'output_text' || part?.type === 'text' ? part.text : null))
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join('\n')
  const usage = asRecord(json.usage)
  const finishReason = typeof json.status === 'string' ? json.status : null
  const searchItems = citationRecords(collectGrokCitations(json), new Date(), MAX_SEARCH_SOURCES, SNIPPET_CHARS)
  return {
    text: requireText(call.model, text, finishReason),
    tokensIn: num(usage?.input_tokens) ?? 0,
    tokensOut: num(usage?.output_tokens) ?? 0,
    costUsd: billedUsd(usage),
    httpStatus: status,
    finishReason,
    searchItems,
  }
}

export async function callXai(call: ProviderCall): Promise<ProviderResult> {
  if (call.search) return callXaiLiveSearch(call)
  const { status, json } = await postJson({
    url: 'https://api.x.ai/v1/chat/completions',
    headers: { Authorization: `Bearer ${key()}` },
    timeoutMs: call.timeoutMs,
    body: {
      model: call.model,
      messages: [
        ...(call.system ? [{ role: 'system', content: call.system }] : []),
        { role: 'user', content: call.user },
      ],
      max_tokens: call.maxTokens,
      ...call.extraBody,
    },
  })
  const parsed = chatContent(json)
  return {
    text: requireText(call.model, parsed.text, parsed.finishReason, emptyExtra(parsed.reasoningTokens, parsed.tokensOut)),
    tokensIn: parsed.tokensIn,
    tokensOut: parsed.tokensOut,
    costUsd: parsed.costUsd,
    httpStatus: status,
    finishReason: parsed.finishReason,
  }
}
