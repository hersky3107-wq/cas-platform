import { asRecord, num, postJson, requireText } from './http'
import { envKey, type ProviderCall, type ProviderResult } from './types'

export async function callAnthropic(call: ProviderCall): Promise<ProviderResult> {
  const body: Record<string, unknown> = {
    model: call.model,
    max_tokens: call.maxTokens,
    system: call.system || undefined,
    messages: [{ role: 'user', content: call.user }],
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
  const usage = asRecord(json.usage)
  const finishReason = typeof json.stop_reason === 'string' ? json.stop_reason : null
  return {
    text: requireText(call.model, text, finishReason),
    tokensIn: num(usage?.input_tokens) ?? 0,
    tokensOut: num(usage?.output_tokens) ?? 0,
    costUsd: null,
    httpStatus: status,
    finishReason,
  }
}
