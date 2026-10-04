/**
 * Provider name unions — safe for client modules that only need the type.
 * Runtime router / cost-span stay server-only.
 */

/** The core provider set. Exhaustive `Record<AiProviderName, …>` maps rely on this staying exactly six. */
export type AiProviderName =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'xai'
  | 'deepseek'
  | 'mistral'

/** OPT-IN ONLY providers (cost control). Kept out of `AiProviderName`. */
export type ExtendedAiProviderName = AiProviderName | 'perplexity' | 'meta'
