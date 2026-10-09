import { asRecord, num, postJson, requireText } from './http'
import { envKey, ProviderHttpError, type ProviderCall, type ProviderResult } from './types'

export async function callAnthropic(call: ProviderCall): Promise<ProviderResult> {
  try {
    return await once(call, Boolean(call.jsonMode))
  } catch (error) {
    if (call.jsonMode && error instanceof ProviderHttpError && error.status === 400) {
      return once(call, false)
    }
    throw error
  }
}

async function once(call: ProviderCall, prefill: boolean): Promise<ProviderResult> {
  const body: Record<string, unknown> = {
    model: call.model,
    max_tokens: call.maxTokens,
    system: call.system || undefined,
    messages: [
      { role: 'user', content: call.user },
      ...(prefill ? [{ role: 'assistant', content: '{' }] : []),
    ],
  }
  if (call.anthropicThinking === 'disabled') {
    body.thinking = { type: 'disabled' }
  }
  const { status, json } = await postJson({
    url: 'https://api.anthropic.com/v1/messages',
    headers: {
      'x-api-key': envKey('ANTHROPIC_API_KEY'),
      'anthropic-version': '2023-06-01',
    },
    timeoutMs: call.timeoutMs,
    body,
  })
  const blocks = Array.isArray(json.content) ? json.content : []
  const text = blocks
    .map((block) => asRecord(block))
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => String(block?.text))
    .join('\n')
  const joined = prefill && text && !text.trimStart().startsWith('{') ? `{${text}` : text
  const usage = asRecord(json.usage)
  const finishReason = typeof json.stop_reason === 'string' ? json.stop_reason : null
  return {
    text: requireText(call.model, joined, finishReason),
    tokensIn: num(usage?.input_tokens) ?? 0,
    tokensOut: num(usage?.output_tokens) ?? 0,
    costUsd: null,
    httpStatus: status,
    finishReason,
  }
}
