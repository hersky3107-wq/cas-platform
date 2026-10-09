import { callAnthropic } from './anthropic'
import { callGoogle } from './google'
import { callOpenAI } from './openai'
import { callOpenRouter } from './openrouter'
import { callPerplexity } from './perplexity'
import { callUpstage } from './upstage'
import { callXai } from './xai'
import type { ProviderCall, ProviderResult } from './types'

export type { ProviderCall, ProviderResult } from './types'
export { EmptyContentError, ProviderHttpError } from './types'

export async function callEngineProvider(call: ProviderCall): Promise<ProviderResult> {
  switch (call.provider) {
    case 'openai':
      return callOpenAI(call)
    case 'anthropic':
      return callAnthropic(call)
    case 'google':
      return callGoogle(call)
    case 'xai':
      return callXai(call)
    case 'openrouter':
      return callOpenRouter(call)
    case 'upstage':
      return callUpstage(call)
    case 'perplexity':
      return callPerplexity(call)
    default:
      throw new Error(`unsupported provider ${call.provider}`)
  }
}
