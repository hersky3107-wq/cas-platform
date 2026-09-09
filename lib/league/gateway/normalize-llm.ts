/**
 * Live slot-filler. Model: gemini-3.5-flash-lite (first-party Google).
 *
 * Why this one: cheapest first-party model already wired that reliably emits
 * short JSON. qwen3.5-flash is cheaper on list price but rides OpenRouter and
 * is weaker on a security-sensitive output contract. Research already uses
 * the 3.5-flash family as director. flash-lite is the same price band
 * ($0.30 / $2.50 per 1M) at a smaller footprint.
 *
 * Cost per call (typical 1.1k in / 120 out, list price, no billed USD):
 *   ~$0.0006 one-shot; one retry ≈ $0.0012. Cache hits $0.
 */
import { PUBLIC_CATEGORY_IDS, type PublicCategoryId } from '../catalog'
import {
  buildNormalizerSystemPrompt,
  buildNormalizerUserPrompt,
  extractJsonObject,
  NORMALIZER_FALLBACK_MODEL,
  NORMALIZER_MAX_TOKENS,
  NORMALIZER_MODEL,
  NORMALIZER_RETRY_INSTRUCTION,
} from './normalize-prompt'
import type { NormalizerRequest, PromptNormalizer } from './normalizer'

export type NormalizerLlmCall = (args: {
  system: string
  user: string
  model: string
  isRetry: boolean
}) => Promise<string | null>

export function createLlmNormalizer(call: NormalizerLlmCall): PromptNormalizer {
  return {
    async normalize(req: NormalizerRequest): Promise<unknown | null> {
      if (!(PUBLIC_CATEGORY_IDS as readonly string[]).includes(String(req.category_id))) {
        return null
      }
      const categoryId = req.category_id as PublicCategoryId
      const system = buildNormalizerSystemPrompt(categoryId)
      const user = buildNormalizerUserPrompt(req.raw_text, categoryId, req.locale)

      const first = await call({ system, user, model: NORMALIZER_MODEL, isRetry: false })
      const parsed = first ? extractJsonObject(first) : null
      if (parsed !== null) return parsed

      const retryUser = `${user}\n\n${NORMALIZER_RETRY_INSTRUCTION}`
      const second = await call({
        system,
        user: retryUser,
        model: NORMALIZER_FALLBACK_MODEL,
        isRetry: true,
      })
      return second ? extractJsonObject(second) : null
    },
  }
}
