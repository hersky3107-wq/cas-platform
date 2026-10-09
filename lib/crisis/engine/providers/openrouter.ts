import { chatContent, emptyExtra, postJson, requireText } from './http'
import { envKey, type ProviderCall, type ProviderResult } from './types'

/**
 * OpenRouter chat. extraBody carries the league pinning:
 * reasoning.effort=minimal on open reasoning models, and provider.order where
 * the league pins a first-party upstream.
 */
export async function callOpenRouter(call: ProviderCall): Promise<ProviderResult> {
  const { status, json } = await postJson({
    url: 'https://openrouter.ai/api/v1/chat/completions',
    headers: { Authorization: `Bearer ${envKey('OPENROUTER_API_KEY')}` },
    timeoutMs: call.timeoutMs,
    body: {
      model: call.model,
      messages: [
        ...(call.system ? [{ role: 'system', content: call.system }] : []),
        { role: 'user', content: call.user },
      ],
      max_tokens: call.maxTokens,
      usage: { include: true },
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
