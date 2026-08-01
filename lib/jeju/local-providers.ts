import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import {
  runSingleAiProvider,
  type ExtendedAiProviderName,
} from '@/lib/ai/router'

/**
 * JEJU-LOCAL provider calling helper (Solar / EXAONE).
 *
 * Isolation: 'solar' and 'exaone' stay OUT of lib/ai/router.ts. This file owns
 * their OpenAI-compatible fetch shape (ported from lib/motie/local-providers.ts
 * — do NOT import motie). Nothing here widens shared router types.
 */

export type JejuLocalProvider = 'solar' | 'exaone'

/** Widened provider id for Jeju governance seats / vote panel (router + local). */
export type JejuProvider = ExtendedAiProviderName | JejuLocalProvider

type JejuLocalProviderConfig = {
  baseUrl: string
  model: string
  envKey: string
  timeoutMs?: number
}

/**
 * Per-provider endpoint/model/env — exact values matched to motie:
 *   - solar:  UPSTAGE_API_KEY
 *   - exaone: FRIENDLI_TOKEN
 */
export const JEJU_LOCAL_PROVIDER_CONFIG: Record<JejuLocalProvider, JejuLocalProviderConfig> = {
  solar: {
    baseUrl: 'https://api.upstage.ai/v1',
    model: 'solar-pro3',
    envKey: 'UPSTAGE_API_KEY',
  },
  exaone: {
    baseUrl: 'https://api.friendli.ai/serverless/v1',
    model: 'LGAI-EXAONE/K-EXAONE-236B-A23B',
    envKey: 'FRIENDLI_TOKEN',
    timeoutMs: 120_000,
  },
}

export type JejuLocalProviderResult = {
  text: string | null
  error?: string
}

export function isJejuLocalProvider(provider: string): provider is JejuLocalProvider {
  return provider === 'solar' || provider === 'exaone'
}

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
    console.log('[jeju/local-providers] Retrying AI call after network error')
    await new Promise((r) => setTimeout(r, 2000))
    return await fetch(input, init)
  }
}

const KOREAN_CHAR_RE = /[\uAC00-\uD7A3]/
const REASONING_PREAMBLE_RE =
  /^(okay|ok|alright|well|hmm|wait|so,?|let me|let's|the user|i need to|i should|i think|first,? i|looking at|now,? i|understanding the)\b/i

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
 * Calls Solar or EXAONE. Returns ONLY message.content as text.
 * EXAONE: thinking OFF + 120s timeout; never surfaces reasoning fields as content.
 * max_tokens is caller-supplied — never capped below the caller's value here.
 */
export async function callJejuLocalProvider(params: {
  provider: JejuLocalProvider
  systemPrompt: string
  userPrompt: string
  temperature?: number
  maxCompletionTokens?: number
}): Promise<JejuLocalProviderResult> {
  const { provider, systemPrompt, userPrompt, temperature, maxCompletionTokens } = params
  const config = JEJU_LOCAL_PROVIDER_CONFIG[provider]
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
      const reasoningLeak =
        (typeof message?.reasoning === 'string' && message.reasoning.trim()) ||
        (typeof message?.reasoning_content === 'string' && message.reasoning_content.trim()) ||
        ''
      if (reasoningLeak) {
        console.warn(
          `[jeju/local-providers] ${provider}: message.content was empty but reasoning/reasoning_content held ${reasoningLeak.length} chars — discarding it.`
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
      error: e instanceof Error ? e.message : 'unknown error calling jeju local provider',
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function fallbackSupabase(): SupabaseClient {
  return createClient('http://localhost', 'jeju-local-no-db') as unknown as SupabaseClient
}

/**
 * Single dispatch for Jeju governance AI calls:
 *   solar/exaone → callJejuLocalProvider (model from JEJU_LOCAL_PROVIDER_CONFIG)
 *   everything else → runSingleAiProvider (router.ts, untouched)
 *
 * Call sites consume only `.text` / `.error`.
 */
export async function callJejuAi(params: {
  supabase?: SupabaseClient
  sessionId?: string | null
  userId?: string | null
  provider: JejuProvider
  prompt: string
  systemPrompt: string
  maxCompletionTokens?: number
  temperature?: number
  modelOverride?: string
}): Promise<JejuLocalProviderResult> {
  const {
    provider,
    prompt,
    systemPrompt,
    maxCompletionTokens,
    temperature,
    modelOverride,
    supabase,
    sessionId,
    userId,
  } = params

  if (isJejuLocalProvider(provider)) {
    return callJejuLocalProvider({
      provider,
      systemPrompt,
      userPrompt: prompt,
      maxCompletionTokens,
      temperature,
    })
  }

  const r = await runSingleAiProvider({
    supabase: supabase ?? fallbackSupabase(),
    sessionId: sessionId ?? null,
    userId: userId ?? null,
    provider,
    prompt,
    systemPrompt,
    maxCompletionTokens,
    temperature,
    modelOverride,
  })
  return { text: r.text, error: r.error }
}
