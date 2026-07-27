import 'server-only'

import type { ExtendedAiProviderName } from '@/lib/ai/router'

/**
 * MOTIE-LOCAL provider calling helper (Path B from the 8-provider recon).
 *
 * WHY THIS FILE EXISTS (isolation): 'solar' and 'exaone' are deliberately kept
 * OUT of lib/ai/router.ts's `AiProviderName` / `ExtendedAiProviderName` unions.
 * Widening those shared types would force new keys into exhaustive
 * `Record<ExtendedAiProviderName, …>` maps in lib/jeju/deep.ts (its own copies
 * of AI_BRAND_STRENGTHS / JEJU_VOTE_BRAND_LABEL) even though jeju never uses
 * these 2 providers — unacceptable touch-surface on the jeju tree during live
 * review. So this file duplicates (does NOT import) the minimal
 * OpenAI-compatible fetch shape from lib/ai/router.ts's
 * callOpenAICompatibleChat, scoped ONLY to 'solar' | 'exaone'. Nothing in this
 * file is imported by lib/jeju/*, lib/festival/*, or lib/ai/router.ts, and
 * lib/ai/router.ts is never modified by this file.
 *
 * Call sites: app/api/gunpo/deliberate/route.ts (callProvider) and
 * lib/motie/open-brief.ts (runOneOpenAnalysis). max_tokens is caller-supplied
 * (open-brief passes ANALYSIS_MAX_TOKENS); this file does not hardcode a
 * global token ceiling for the 6 shared-router providers.
 */

export type MotieLocalProvider = 'solar' | 'exaone'

/**
 * Widened provider id used across MOTIE's own paths — the PARALLEL open-brief
 * analysts AND the SERIAL SYNOD debate / vote panel / persona maps. This union
 * is local to lib/motie/: lib/ai/router.ts's `ExtendedAiProviderName` itself is
 * never widened, so nothing outside motie (jeju's own copies included) is
 * affected. Any call site that receives a MotieProvider must branch through
 * `isMotieLocalProvider` before reaching runSingleAiProvider.
 */
export type MotieProvider = ExtendedAiProviderName | MotieLocalProvider

/** Original name of {@link MotieProvider}, kept for the open-brief call sites. */
export type MotieOpenProvider = MotieProvider

type MotieLocalProviderConfig = {
  baseUrl: string
  model: string
  /** process.env key holding the bearer token for this provider. */
  envKey: string
  /**
   * Optional per-call abort timeout (ms). Left UNSET for providers whose
   * current (unbounded, no-timeout) behavior must not change. Only exaone
   * sets this — see the 236B-slowness note below.
   */
  timeoutMs?: number
}

/** Per-provider endpoint/model/env config. Set the matching env var directly
 * (no local .env file lives inside lib/motie/ or app/api/gunpo/ to add these
 * to — see the recon report for why none was created):
 *   - solar:  UPSTAGE_API_KEY
 *   - exaone: FRIENDLI_TOKEN
 */
export const MOTIE_LOCAL_PROVIDER_CONFIG: Record<MotieLocalProvider, MotieLocalProviderConfig> = {
  solar: {
    baseUrl: 'https://api.upstage.ai/v1',
    model: 'solar-pro3',
    envKey: 'UPSTAGE_API_KEY',
    // No timeoutMs — unchanged/unbounded, per "do not touch other providers".
  },
  exaone: {
    baseUrl: 'https://api.friendli.ai/serverless/v1',
    model: 'LGAI-EXAONE/K-EXAONE-236B-A23B',
    envKey: 'FRIENDLI_TOKEN',
    // 236B model observed taking 76s+ under a long system prompt. 120s gives
    // headroom above the requested >=90s floor without being unbounded.
    timeoutMs: 120_000,
  },
}

export type MotieLocalProviderResult = {
  text: string | null
  error?: string
}

/** Type guard so call sites can branch on a single check. */
export function isMotieLocalProvider(provider: string): provider is MotieLocalProvider {
  return provider === 'solar' || provider === 'exaone'
}

/**
 * Mirrors lib/ai/router.ts's private `fetchWithRetry`: one retry on a
 * network-level failure (TypeError / AbortError), 2s backoff. Duplicated
 * locally because router.ts does not export it and this file must not import
 * from/modify router.ts internals.
 *
 * `isDeliberateTimeout` lets callMotieLocalProvider's own AbortController-based
 * timeout (see below) opt OUT of this retry: retrying an abort that WE
 * triggered on purpose (the model was simply too slow) would just re-issue
 * fetch with an already-aborted signal and fail again immediately — a wasted
 * 2s wait with no chance of success. Genuine network-level aborts still retry.
 */
async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  isDeliberateTimeout?: () => boolean
): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (e: unknown) {
    const name = typeof e === 'object' && e ? (e as { name?: unknown }).name : null
    const retryable = e instanceof TypeError || name === 'AbortError'
    if (!retryable || isDeliberateTimeout?.()) throw e
    console.log('[motie/local-providers] Retrying AI call after network error')
    await new Promise((r) => setTimeout(r, 2000))
    return await fetch(input, init)
  }
}

const KOREAN_CHAR_RE = /[\uAC00-\uD7A3]/
/** Lowercased-first-line openers typical of leaked English chain-of-thought. */
const REASONING_PREAMBLE_RE =
  /^(okay|ok|alright|well|hmm|wait|so,?|let me|let's|the user|i need to|i should|i think|first,? i|looking at|now,? i|understanding the)\b/i

/**
 * Strips leading English chain-of-thought preamble that can leak into
 * `message.content` on some reasoning-tuned OpenAI-compatible models
 * (observed risk on exaone, which also exposes a separate
 * "reasoning"/"reasoning_content" field we never read — see
 * callMotieLocalProvider below).
 *
 * HEURISTIC (deliberately conservative — read before changing):
 *   1. Only engages if the FIRST LINE of the response matches a short
 *      whitelist of reasoning-preamble openers ("Okay,", "Wait,", "Let me",
 *      "The user", …). Any other opening (including Korean, which is what a
 *      correct answer should be under every motie prompt's Korean-only
 *      directive) is returned completely unchanged.
 *   2. When engaged, it locates the FIRST Korean character anywhere in the
 *      text and cuts everything before the start of that character's line —
 *      i.e. it assumes the real (Korean) answer begins there and the English
 *      lines before it are leaked reasoning.
 *   3. If no Korean character exists anywhere in the text, or the remaining
 *      text after cutting would be under 20 characters, it gives up and
 *      returns the ORIGINAL text unchanged — losing the whole answer to an
 *      over-eager strip is worse than leaving some leaked reasoning in.
 * This never touches valid Korean answer text: rule (1) means a response
 * that never opens with an English filler line is never modified at all.
 */
export function stripLeakedReasoningPreamble(raw: string | null): string | null {
  if (!raw) return raw

  const trimmedStart = raw.trimStart()
  if (!trimmedStart) return raw

  const firstLine = trimmedStart.split('\n', 1)[0]!.trim()
  if (!REASONING_PREAMBLE_RE.test(firstLine)) return raw

  const koreanIdx = raw.search(KOREAN_CHAR_RE)
  if (koreanIdx === -1) return raw

  const lineStart = raw.lastIndexOf('\n', koreanIdx) + 1
  const remainder = raw.slice(lineStart).trim()
  if (remainder.length < 20) return raw

  return remainder
}

/**
 * Calls a MOTIE-LOCAL OpenAI-compatible provider ('solar' | 'exaone') and
 * returns ONLY `choices[0].message.content` (as `text`) — mirrors
 * lib/ai/router.ts's callOpenAICompatibleChat error-handling shape (throws
 * become `{ text: null, error }`, never re-thrown to the caller). Any sibling
 * field on `message` (e.g. exaone's "reasoning" / "reasoning_content") is
 * intentionally never read as the answer — see the empty-content fallback
 * below. exaone additionally gets `chat_template_kwargs.enable_thinking:
 * false` (so it answers directly instead of dumping into hidden thinking)
 * and a >=90s abort timeout (config.timeoutMs) — both scoped to exaone only
 * via MOTIE_LOCAL_PROVIDER_CONFIG; solar's request shape/timeout is untouched.
 */
export async function callMotieLocalProvider(params: {
  provider: MotieLocalProvider
  systemPrompt: string
  userPrompt: string
  temperature?: number
  maxCompletionTokens?: number
}): Promise<MotieLocalProviderResult> {
  const { provider, systemPrompt, userPrompt, temperature, maxCompletionTokens } = params
  const config = MOTIE_LOCAL_PROVIDER_CONFIG[provider]
  const apiKey = process.env[config.envKey]

  if (!apiKey) {
    return { text: null, error: `${config.envKey} is not set` }
  }

  const payload: Record<string, unknown> = {
    model: config.model,
    messages: [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      { role: 'user', content: userPrompt },
    ],
  }
  if (typeof temperature === 'number' && !Number.isNaN(temperature)) {
    payload.temperature = temperature
  }
  if (typeof maxCompletionTokens === 'number' && maxCompletionTokens > 0) {
    payload.max_tokens = maxCompletionTokens
  }
  if (provider === 'exaone') {
    // K-EXAONE defaults to reasoning ("thinking") mode. Under a long motie
    // system prompt it was observed spending its entire token budget on the
    // hidden thinking pass and leaving `message.content` empty. Disabling
    // thinking makes it answer directly in `content`. Confirmed top-level
    // field shape (NOT nested under an "extra_body" wrapper — that's an
    // OpenAI-SDK-only convenience key; raw REST sends this at the top level)
    // from FriendliAI's own K-EXAONE quickstart curl example and the model's
    // HuggingFace README (`chat_template_kwargs: { enable_thinking: bool }`).
    payload.chat_template_kwargs = { enable_thinking: false }
  }

  const controller = new AbortController()
  let timedOut = false
  const timeoutMs = config.timeoutMs
  const timer =
    typeof timeoutMs === 'number' && timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true
          controller.abort()
        }, timeoutMs)
      : null

  try {
    const res = await fetchWithRetry(
      `${config.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        ...(timer ? { signal: controller.signal } : {}),
      },
      () => timedOut
    )

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return {
        text: null,
        error: `HTTP ${res.status} ${res.statusText}${errText ? ` - ${errText}` : ''}`,
      }
    }

    const json: any = await res.json()
    const message = json?.choices?.[0]?.message
    const content = message?.content
    const text = typeof content === 'string' ? content : null

    if (!text || !text.trim()) {
      // Never surface a raw reasoning/reasoning_content field as the answer —
      // it is chain-of-thought (often English) and was never requested. If
      // content came back empty despite a reasoning field being populated,
      // that's a clean, loggable failure, not a silent leak.
      const reasoningLeak =
        (typeof message?.reasoning === 'string' && message.reasoning.trim()) ||
        (typeof message?.reasoning_content === 'string' && message.reasoning_content.trim()) ||
        ''
      if (reasoningLeak) {
        console.warn(
          `[motie/local-providers] ${provider}: message.content was empty but reasoning/reasoning_content held ${reasoningLeak.length} chars — discarding it (not used as the answer) and reporting a clean failure instead.`
        )
        return {
          text: null,
          error: `${provider} 응답이 비어 있습니다 (reasoning 필드만 채워짐 — 안전을 위해 사용하지 않음).`,
        }
      }
      return { text: null, error: `${provider} 응답의 content가 비어 있습니다.` }
    }

    return { text: stripLeakedReasoningPreamble(text) }
  } catch (e: unknown) {
    if (timedOut) {
      return {
        text: null,
        error: `${provider} 응답 시간 초과 (${timeoutMs}ms 이내 응답 없음)`,
      }
    }
    return {
      text: null,
      error: e instanceof Error ? e.message : 'unknown error calling motie local provider',
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
