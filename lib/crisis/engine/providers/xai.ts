import { asRecord, billedUsd, chatContent, emptyExtra, num, postJson, requireText } from './http'
import { envKey, type ProviderCall, type ProviderResult } from './types'

function key(): string {
  return envKey('XAI_API_KEY', 'GROK_API_KEY')
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
  return {
    text: requireText(call.model, text, finishReason),
    tokensIn: num(usage?.input_tokens) ?? 0,
    tokensOut: num(usage?.output_tokens) ?? 0,
    costUsd: billedUsd(usage),
    httpStatus: status,
    finishReason,
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
