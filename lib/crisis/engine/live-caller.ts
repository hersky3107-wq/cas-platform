import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExtendedAiProviderName } from '@/lib/ai/router'
import type { ModelCaller } from './run'
import { listPriceCost } from './prices'

/**
 * Live calls only. engine-run.ts imports this from the --live branch.
 * Platform-registry ids go through callPlatformModel. Router ids (Grok live search,
 * Perplexity sonar, Anthropic, OpenAI, Google) go through runSingleAiProvider.
 */
export function liveCaller(supabase: SupabaseClient): ModelCaller {
  return {
    async complete(call) {
      if (call.model.includes(':')) {
        const { callPlatformModel } = await import('@/lib/ai/platform-providers')
        const result = await callPlatformModel({
          id: call.model,
          systemPrompt: call.system,
          userPrompt: call.user,
          maxCompletionTokens: call.maxTokens,
          timeoutMs: call.timeoutMs,
        })
        if (result.error || !result.text) throw new Error(result.error ?? 'empty platform response')
        const tokensIn = result.usage?.promptTokens ?? 0
        const tokensOut = result.usage?.completionTokens ?? 0
        return {
          text: result.text,
          tokensIn,
          tokensOut,
          costUsd: result.costUsd ?? listPriceCost(call.model, tokensIn, tokensOut),
        }
      }
      const { runSingleAiProvider } = await import('@/lib/ai/router')
      const result = await runSingleAiProvider({
        supabase,
        sessionId: null,
        userId: null,
        provider: call.provider as ExtendedAiProviderName,
        prompt: call.user,
        systemPrompt: call.system,
        skipLanguageInjection: true,
        maxCompletionTokens: call.maxTokens,
        timeoutMs: call.timeoutMs,
        modelOverride: call.model,
        searchTool: call.search,
      })
      if (!result.text) throw new Error('empty router response')
      const tokensIn = result.promptTokens ?? 0
      const tokensOut = result.completionTokens ?? 0
      const billed = result.costUsd ?? null
      return {
        text: result.text,
        tokensIn,
        tokensOut,
        costUsd: billed ?? listPriceCost(call.model, tokensIn, tokensOut),
      }
    },
  }
}
