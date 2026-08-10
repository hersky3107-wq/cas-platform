import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import { MODEL_BY_PROVIDER, runSingleAiProvider } from '@/lib/ai/router'
import type { PlatformLeague } from '@/lib/ai/platform-providers'

/**
 * Admin health-check mirror for league-roster providers that live OUTSIDE
 * lib/ai/platform-providers.ts and lib/ai/router.ts's core-6 union:
 *
 *   - Perplexity (Scout): platform env `PERPLEXITY_API_KEY`, pinged via the
 *     existing `runSingleAiProvider` path (same as production search modules).
 *   - Upstage Solar / LG EXAONE (World): platform env keys, pinged via a
 *     read-only mirror of lib/gunpo/local-providers.ts's request shape — this
 *     file does NOT import or modify local-providers.ts or router.ts.
 *
 * Confirmed live 2026-08-10 against real keys before registering model strings.
 */

export type LeagueLocalProviderId = 'perplexity' | 'solar' | 'exaone'

/** Distinguishes production vs league-listed candidate (Perplexity only). */
export type LeagueLocalTier = 'production' | 'league-candidate'

export type LeagueLocalHealthResult = {
  id: string
  provider: LeagueLocalProviderId
  brand: string
  model: string
  league: PlatformLeague
  ok: boolean
  latencyMs: number
  error?: string
  /** True when the platform env key for this provider is not set. */
  keyMissing?: boolean
  tier?: LeagueLocalTier
}

type LocalProviderMirrorId = 'solar' | 'exaone'

type LocalProviderMirrorConfig = {
  brand: string
  league: PlatformLeague
  baseUrl: string
  model: string
  envKey: string
  timeoutMs?: number
}

/**
 * Read-only mirror of lib/gunpo/local-providers.ts MOTIE_LOCAL_PROVIDER_CONFIG
 * (endpoint, model, env key, exaone timeout). Deliberately NOT imported — same
 * isolation principle as platform-providers.ts vs router.ts.
 */
const LOCAL_PROVIDER_MIRROR: Record<LocalProviderMirrorId, LocalProviderMirrorConfig> = {
  solar: {
    brand: 'Upstage',
    league: 'world',
    baseUrl: 'https://api.upstage.ai/v1',
    model: 'solar-pro3',
    envKey: 'UPSTAGE_API_KEY',
  },
  exaone: {
    brand: 'LG',
    league: 'world',
    baseUrl: 'https://api.friendli.ai/serverless/v1',
    model: 'LGAI-EXAONE/K-EXAONE-2.0-750B-A37B',
    envKey: 'FRIENDLI_TOKEN',
    timeoutMs: 120_000,
  },
}

const PERPLEXITY_HEALTH: {
  tier: LeagueLocalTier
  model: string
  maxCompletionTokens: number
}[] = [
  { tier: 'production', model: MODEL_BY_PROVIDER.perplexity, maxCompletionTokens: 32 },
  // League display name "Sonar Reasoning Pro" -> exact live id `sonar-reasoning-pro`.
  // 32 returns empty content; 160 confirmed live (2026-08-10).
  { tier: 'league-candidate', model: 'sonar-reasoning-pro', maxCompletionTokens: 160 },
]

async function fetchWithRetry(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (e: unknown) {
    const name = typeof e === 'object' && e ? (e as { name?: unknown }).name : null
    const retryable = e instanceof TypeError || name === 'AbortError'
    if (!retryable) throw e
    await new Promise((r) => setTimeout(r, 2000))
    return await fetch(input, init)
  }
}

async function pingLocalProviderMirror(provider: LocalProviderMirrorId): Promise<LeagueLocalHealthResult> {
  const config = LOCAL_PROVIDER_MIRROR[provider]
  const startedAt = Date.now()
  const base = {
    id: `league-local:${provider}`,
    provider,
    brand: config.brand,
    model: config.model,
    league: config.league,
  }

  const apiKey = process.env[config.envKey]?.trim()
  if (!apiKey) {
    return { ...base, ok: false, latencyMs: 0, keyMissing: true }
  }

  const maxCompletionTokens = 160
  const payload: Record<string, unknown> = {
    model: config.model,
    messages: [{ role: 'user', content: 'Reply with exactly one word: OK' }],
    max_tokens: maxCompletionTokens,
  }

  if (provider === 'exaone') {
    payload.chat_template_kwargs = { enable_thinking: false }
  }
  if (provider === 'solar') {
    payload.reasoning_effort = 'low'
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
    const res = await fetchWithRetry(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      ...(timer ? { signal: controller.signal } : {}),
    })

    const rawBody = await res.text().catch(() => '')

    if (!res.ok) {
      return {
        ...base,
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: `HTTP ${res.status} ${res.statusText}${rawBody ? ` - ${rawBody.slice(0, 400)}` : ''}`,
      }
    }

    let json: any
    try {
      json = JSON.parse(rawBody)
    } catch {
      return {
        ...base,
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: `HTTP ${res.status} but response body was not valid JSON`,
      }
    }

    const content = json?.choices?.[0]?.message?.content
    const text = typeof content === 'string' && content.trim().length ? content : null

    if (!text) {
      return {
        ...base,
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: `HTTP 200 but message.content was empty. Raw: ${rawBody.slice(0, 400)}`,
      }
    }

    return {
      ...base,
      ok: true,
      latencyMs: Date.now() - startedAt,
    }
  } catch (e: unknown) {
    if (timedOut) {
      return {
        ...base,
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: `${provider} timed out after ${timeoutMs}ms`,
      }
    }
    return {
      ...base,
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: e instanceof Error ? e.message : 'unknown error calling local provider mirror',
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function pingPerplexityTier(entry: (typeof PERPLEXITY_HEALTH)[number]): Promise<LeagueLocalHealthResult> {
  const startedAt = Date.now()
  const base = {
    id: `league-local:perplexity:${entry.tier}`,
    provider: 'perplexity' as const,
    brand: 'Perplexity',
    model: entry.model,
    league: 'scout' as PlatformLeague,
    tier: entry.tier,
  }

  if (!process.env.PERPLEXITY_API_KEY?.trim()) {
    return { ...base, ok: false, latencyMs: 0, keyMissing: true }
  }

  const result = await runSingleAiProvider({
    supabase: supabaseAdmin,
    sessionId: null,
    userId: null,
    provider: 'perplexity',
    prompt: 'Reply with exactly one word: OK',
    systemPrompt: '',
    skipLanguageInjection: true,
    maxCompletionTokens: entry.maxCompletionTokens,
    modelOverride: entry.model,
  })

  return {
    ...base,
    ok: !result.error && !!result.text,
    latencyMs: Date.now() - startedAt,
    error: result.error,
  }
}

/** Pings Perplexity (2 tiers), Upstage Solar, and LG EXAONE for the admin dashboard. */
export async function healthCheckAllLeagueLocalProviders(): Promise<LeagueLocalHealthResult[]> {
  const [perplexityResults, solar, exaone] = await Promise.all([
    Promise.all(PERPLEXITY_HEALTH.map((entry) => pingPerplexityTier(entry))),
    pingLocalProviderMirror('solar'),
    pingLocalProviderMirror('exaone'),
  ])

  return [...perplexityResults, solar, exaone]
}
