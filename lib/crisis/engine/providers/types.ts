export type EngineProvider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'xai'
  | 'openrouter'
  | 'upstage'
  | 'perplexity'

export type GoogleThinking = 'off' | 'minimal' | 'default'
export type AnthropicThinking = 'disabled' | 'default'

export interface ProviderCall {
  model: string
  provider: EngineProvider
  system: string
  user: string
  maxTokens: number
  timeoutMs: number
  search?: boolean
  maxTurns?: number
  extraBody?: Record<string, unknown>
  googleThinking?: GoogleThinking
  anthropicThinking?: AnthropicThinking
}

export interface ProviderResult {
  text: string
  tokensIn: number
  tokensOut: number
  costUsd: number | null
  httpStatus: number
  finishReason: string | null
}

export class ProviderHttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export class EmptyContentError extends Error {
  readonly finishReason: string | null
  constructor(model: string, finishReason: string | null, extra = '') {
    super(
      `${model}: HTTP 200 but message.content was empty (finish_reason=${finishReason ?? 'unknown'})${extra}`,
    )
    this.finishReason = finishReason
  }
}

export function envKey(name: string, fallback?: string): string {
  const value = process.env[name]?.trim() || (fallback ? process.env[fallback]?.trim() : '')
  if (!value) {
    throw new Error(`Missing ${name}${fallback ? ` or ${fallback}` : ''} in environment`)
  }
  return value
}
