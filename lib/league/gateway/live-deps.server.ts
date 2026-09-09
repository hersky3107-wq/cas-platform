import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import { runSingleAiProvider } from '@/lib/ai/router'
import { deductCreditsBalance } from '@/lib/credits-server'
import { adapterForCategoryId } from './adapters/registry.server'
import {
  addQuotaUnits,
  bumpNormalizeCircuit,
  circuitAllowsNormalize,
  readNormalizeCache,
  readQuotaUnits,
  writeNormalizeCache,
} from './abuse.server'
import { normalizeCacheKey, quotaUnitsFor, quotaWouldBreach } from './abuse'
import { searchCategoryCandidates } from './candidate-search.server'
import { createLlmNormalizer, type NormalizerLlmCall } from './normalize-llm'
import { NORMALIZER_MAX_TOKENS, NORMALIZER_MODEL } from './normalize-prompt'
import type { NormalizerRequest, PromptNormalizer } from './normalizer'
import type { GatewayDeps } from './shell'
import type { GatewayViewer } from './types'

export function createLiveNormalizerCall(userId: string | null): NormalizerLlmCall {
  return async ({ system, user, model }) => {
    const res = await runSingleAiProvider({
      supabase: supabaseAdmin,
      authSupabase: supabaseAdmin,
      sessionId: null,
      userId,
      provider: 'google',
      systemPrompt: system,
      prompt: user,
      skipLanguageInjection: true,
      modelOverride: model,
      maxCompletionTokens: NORMALIZER_MAX_TOKENS,
      allowGeminiThinking: true,
      geminiThinkingLevel: 'minimal',
      timeoutMs: 20_000,
    })
    if (res.error || !res.text) return null
    return res.text
  }
}

export function createCachedNormalizer(inner: PromptNormalizer): PromptNormalizer {
  return {
    async normalize(req: NormalizerRequest) {
      const key = normalizeCacheKey(String(req.category_id), req.raw_text, req.locale)
      const cached = await readNormalizeCache(key)
      if (cached !== null && cached !== undefined) return cached
      if (!(await circuitAllowsNormalize())) return null
      await bumpNormalizeCircuit()
      const out = await inner.normalize(req)
      if (out !== null) await writeNormalizeCache(key, out)
      return out
    },
  }
}

export async function reserveNormalizeQuota(args: {
  userId: string
  categoryId: string
  rawText: string
  locale: string
  isClarification: boolean
}): Promise<{ ok: true; cacheHit: boolean } | { ok: false }> {
  const key = normalizeCacheKey(args.categoryId, args.rawText, args.locale)
  const cached = await readNormalizeCache(key)
  const units = quotaUnitsFor({ cacheHit: cached !== null && cached !== undefined, isClarification: args.isClarification })
  const used = await readQuotaUnits(args.userId)
  if (quotaWouldBreach(used, units)) return { ok: false }
  await addQuotaUnits(args.userId, units)
  return { ok: true, cacheHit: cached !== null && cached !== undefined }
}

export function createLiveGatewayDeps(userId: string): GatewayDeps {
  const llm = createLlmNormalizer(createLiveNormalizerCall(userId))
  return {
    adapterFor: (id) => adapterForCategoryId(id),
    normalizer: createCachedNormalizer(llm),
    searchCandidates: searchCategoryCandidates,
    async deductCredits(viewer: GatewayViewer, credits: number) {
      const result = await deductCreditsBalance(supabaseAdmin, viewer.userId, credits, 'league_generate')
      return { ok: result.ok }
    },
  }
}

export { NORMALIZER_MODEL }
