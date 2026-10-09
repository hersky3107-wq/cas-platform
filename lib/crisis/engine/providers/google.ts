import { asRecord, num, postJson, requireText } from './http'
import { envKey, type ProviderCall, type ProviderResult } from './types'

export async function callGoogle(call: ProviderCall): Promise<ProviderResult> {
  const generationConfig: Record<string, unknown> = { maxOutputTokens: call.maxTokens }
  if (call.jsonMode) generationConfig.responseMimeType = 'application/json'
  if (call.googleThinking === 'off') {
    generationConfig.thinkingConfig = { thinkingBudget: 0 }
  } else if (call.googleThinking === 'minimal') {
    generationConfig.thinkingConfig = { thinkingLevel: 'minimal' }
  }
  const { status, json } = await postJson({
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(call.model)}:generateContent`,
    headers: { 'x-goog-api-key': envKey('GOOGLE_API_KEY', 'GEMINI_API_KEY') },
    timeoutMs: call.timeoutMs,
    body: {
      contents: [
        {
          role: 'user',
          parts: [{ text: call.system ? `${call.system}\n\n${call.user}` : call.user }],
        },
      ],
      generationConfig,
    },
  })
  const candidates = Array.isArray(json.candidates) ? json.candidates : []
  const first = asRecord(candidates[0])
  const content = asRecord(first?.content)
  const parts = Array.isArray(content?.parts) ? content.parts : []
  const text = parts
    .map((part) => asRecord(part))
    .filter((part) => part && part.thought !== true && typeof part.text === 'string')
    .map((part) => String(part?.text))
    .join('')
  const finishReason = typeof first?.finishReason === 'string' ? first.finishReason : null
  const usage = asRecord(json.usageMetadata)
  return {
    text: requireText(call.model, text, finishReason),
    tokensIn: num(usage?.promptTokenCount) ?? 0,
    tokensOut: num(usage?.candidatesTokenCount) ?? 0,
    costUsd: null,
    httpStatus: status,
    finishReason,
  }
}
