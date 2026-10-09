import { chatContent, emptyExtra, postJson, requireText } from './http'
import { envKey, type ProviderCall, type ProviderResult } from './types'

export async function callOpenAI(call: ProviderCall): Promise<ProviderResult> {
  const { status, json } = await postJson({
    url: 'https://api.openai.com/v1/chat/completions',
    headers: { Authorization: `Bearer ${envKey('OPENAI_API_KEY')}` },
    timeoutMs: call.timeoutMs,
    body: {
      model: call.model,
      messages: [
        ...(call.system ? [{ role: 'system', content: call.system }] : []),
        { role: 'user', content: call.user },
      ],
      max_completion_tokens: call.maxTokens,
      ...(call.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      ...call.extraBody,
    },
  })
  const parsed = chatContent(json)
  const text = requireText(call.model, parsed.text, parsed.finishReason, emptyExtra(parsed.reasoningTokens, parsed.tokensOut))
  return {
    text,
    tokensIn: parsed.tokensIn,
    tokensOut: parsed.tokensOut,
    costUsd: parsed.costUsd,
    httpStatus: status,
    finishReason: parsed.finishReason,
  }
}
