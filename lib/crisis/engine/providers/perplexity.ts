import { chatContent, emptyExtra, postJson, requireText } from './http'
import { envKey, type ProviderCall, type ProviderResult } from './types'

export async function callPerplexity(call: ProviderCall): Promise<ProviderResult> {
  const { status, json } = await postJson({
    url: 'https://api.perplexity.ai/chat/completions',
    headers: { Authorization: `Bearer ${envKey('PERPLEXITY_API_KEY')}` },
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
