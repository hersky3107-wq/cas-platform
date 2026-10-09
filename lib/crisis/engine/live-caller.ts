import { callEngineProvider } from './providers'
import type { EngineProvider } from './providers/types'
import { listPriceCost } from './prices'
import type { ModelCaller } from './run'

/**
 * Live calls only. Uses the crisis explicit-model callers, not lib/ai.
 * engine-run.ts imports this from the --live branch.
 */
export function liveCaller(): ModelCaller {
  return {
    async complete(call) {
      const result = await callEngineProvider({
        model: call.model,
        provider: call.provider as EngineProvider,
        system: call.system,
        user: call.user,
        maxTokens: call.maxTokens,
        timeoutMs: call.timeoutMs,
        search: call.search,
        maxTurns: call.maxTurns,
        extraBody: call.extraBody,
        googleThinking: call.googleThinking,
        anthropicThinking: call.anthropicThinking,
      })
      return {
        text: result.text,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costUsd: result.costUsd ?? listPriceCost(call.model, result.tokensIn, result.tokensOut),
      }
    },
  }
}
