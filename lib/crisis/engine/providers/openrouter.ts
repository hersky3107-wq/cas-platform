import { chatContent, emptyExtra, postJson, requireText } from './http'
import { envKey, ProviderHttpError, type ProviderCall, type ProviderResult } from './types'

/**
 * OpenRouter chat. extraBody carries the league pinning:
 * reasoning.effort=minimal on open reasoning models, and provider.order where
 * the league pins a first-party upstream.
 */
export async function callOpenRouter(call: ProviderCall): Promise<ProviderResult> {
  const body: Record<string, unknown> = {
    model: call.model,
    messages: [
      ...(call.system ? [{ role: 'system', content: call.system }] : []),
      { role: 'user', content: call.user },
    ],
    max_tokens: call.maxTokens,
    usage: { include: true },
    ...(call.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    ...call.extraBody,
  }
  try {
    return await once(call, body)
  } catch (error) {
    if (call.jsonMode && error instanceof ProviderHttpError && error.status === 400) {
      delete body.response_format
      return once(call, body)
    }
    throw error
  }
}

async function once(call: ProviderCall, body: Record<string, unknown>): Promise<ProviderResult> {
  const { status, json } = await postJson({
    url: 'https://openrouter.ai/api/v1/chat/completions',
    headers: { Authorization: `Bearer ${envKey('OPENROUTER_API_KEY')}` },
    timeoutMs: call.timeoutMs,
    body,
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
