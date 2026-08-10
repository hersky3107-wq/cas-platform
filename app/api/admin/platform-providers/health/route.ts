import { NextResponse } from 'next/server'
import { requireAdmin, ADMIN_EMAIL } from '@/lib/admin/require-admin'
import { supabaseAdmin } from '@/lib/supabase/server'
import {
  PLATFORM_MODEL_REGISTRY,
  PLATFORM_MODEL_REGISTRY_TODO,
  healthCheckAllPlatformModels,
  healthCheckPlatformModel,
  type PlatformLeague,
} from '@/lib/ai/platform-providers'
import { runSingleAiProvider, MODEL_BY_PROVIDER, type AiProviderName } from '@/lib/ai/router'

/** Fan-out can take 30–90s when You.com Research is included. */
export const maxDuration = 180

/**
 * Admin-only health check.
 *
 * - The 15 platform-level models (OpenRouter, Meta Muse, You.com, CLOVA) are
 *   pinged directly via lib/ai/platform-providers.ts.
 * - The 6 core-router models (GPT/Claude/Gemini/Grok/DeepSeek/Mistral) are
 *   pinged through the EXISTING production path, `runSingleAiProvider`, using
 *   the admin's own BYOK keys from `user_api_keys` (the same keys /settings
 *   writes to) — not the platform-wide env keys, and with `sessionId: null`
 *   so no DB rows are written. This is read-only monitoring; production call
 *   sites in router.ts are untouched.
 *
 * GET /api/admin/platform-providers/health         -> pings all registered models
 * GET /api/admin/platform-providers/health?id=<id> -> pings one platform model by registry id
 */
export async function GET(req: Request) {
  const forbidden = await requireAdmin(req)
  if (forbidden) return forbidden

  const url = new URL(req.url)
  const id = url.searchParams.get('id')

  if (id) {
    const result = await healthCheckPlatformModel(id)
    return NextResponse.json({ result, todo: PLATFORM_MODEL_REGISTRY_TODO })
  }

  const [platformResults, coreResults] = await Promise.all([
    healthCheckAllPlatformModels(),
    healthCheckCoreProviders(req),
  ])

  const coreTopTierNotes = CORE_PROVIDERS.filter((c) => c.topTier.note).map(
    (c) => `${c.brand} (${c.topTier.model}): ${c.topTier.note}`
  )

  return NextResponse.json({
    registryCount: PLATFORM_MODEL_REGISTRY.length + coreResults.length,
    results: [...platformResults, ...coreResults],
    todo: [...PLATFORM_MODEL_REGISTRY_TODO, ...coreTopTierNotes.map((note) => ({ requested: 'core top-tier note', note }))],
  })
}

type CoreTier = 'current' | 'top-tier'

type CoreHealthResult = {
  id: string
  provider: AiProviderName
  brand: string
  model: string
  league: PlatformLeague
  ok: boolean
  latencyMs: number
  error?: string
  /** True when the admin has no BYOK key saved for this provider in /settings. */
  keyMissing?: boolean
  tier: CoreTier
}

type CoreProviderConfig = {
  provider: AiProviderName
  brand: string
  league: PlatformLeague
  /**
   * Intended flagship for the stock-comparison module, kept separate from
   * MODEL_BY_PROVIDER (which stays pinned to the current production model —
   * do NOT change it here). Every id below was confirmed live against the
   * provider's own /models (or /v1/models) endpoint on 2026-08-10 before
   * being hardcoded — none are guessed from a league display name.
   */
  topTier: { model: string; allowGeminiThinking?: boolean; note?: string }
}

const CORE_PROVIDERS: CoreProviderConfig[] = [
  // League name "GPT-5.6 Sol" -> confirmed exact id `gpt-5.6-sol` in GET /v1/models.
  { provider: 'openai', brand: 'OpenAI', league: 'premier', topTier: { model: 'gpt-5.6-sol' } },
  // League name "Claude Fable 5" -> confirmed exact id `claude-fable-5` in GET /v1/models.
  { provider: 'anthropic', brand: 'Anthropic', league: 'premier', topTier: { model: 'claude-fable-5' } },
  // League name "Gemini 3.1 Pro" -> only live id is the preview SKU
  // `gemini-3.1-pro-preview` (confirmed in ListModels); there is no
  // non-preview "gemini-3.1-pro" yet. Requires allowGeminiThinking:true —
  // this reasoning-required model rejects thinkingBudget:0 (see the note on
  // callGoogleGemini in lib/ai/router.ts).
  {
    provider: 'google',
    brand: 'Google',
    league: 'premier',
    topTier: {
      model: 'gemini-3.1-pro-preview',
      allowGeminiThinking: true,
      note: 'Live id is the preview SKU — no non-preview "gemini-3.1-pro" exists yet.',
    },
  },
  // League name "Grok 4.5" -> confirmed exact id `grok-4.5` in GET /v1/models.
  { provider: 'xai', brand: 'xAI', league: 'premier', topTier: { model: 'grok-4.5' } },
  // `deepseek-v4-pro` -> confirmed exact id in GET /v1/models (alongside deepseek-v4-flash).
  { provider: 'deepseek', brand: 'DeepSeek', league: 'challenger', topTier: { model: 'deepseek-v4-pro' } },
  // "<latest large>" -> catalog's "large" line is only `mistral-large-2512`
  // and the `mistral-large-latest` alias (which is what MODEL_BY_PROVIDER.mistral
  // already points production at) — no newer large exists. Pinned to the
  // dated id so this row is a stable, explicit check rather than an alias
  // that could silently drift; it currently resolves to the same model as
  // "current" below.
  {
    provider: 'mistral',
    brand: 'Mistral',
    league: 'challenger',
    topTier: {
      model: 'mistral-large-2512',
      note: 'No large model newer than this exists yet — same underlying model as "current" (mistral-large-latest).',
    },
  },
]

/** Duplicates requireAdmin's jwt-extraction (kept local, not exported) so we can also learn *who* the admin is. */
async function getAdminUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('authorization')
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined
  let jwt = bearer
  if (!jwt) {
    // Fall back to the cookie session the same way requireAdmin does.
    const { createSupabaseRouteAuthClient } = await import('@/lib/supabase/route-auth')
    const authClient = await createSupabaseRouteAuthClient(req)
    const {
      data: { session },
    } = await authClient.auth.getSession()
    jwt = session?.access_token
  }
  if (!jwt) return null
  const { data, error } = await supabaseAdmin.auth.getUser(jwt)
  if (error || !data.user?.email || data.user.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    return null
  }
  return data.user.id
}

async function healthCheckCoreProviders(req: Request): Promise<CoreHealthResult[]> {
  const userId = await getAdminUserId(req)

  if (!userId) {
    // requireAdmin already passed, so this should not happen — fail closed per-model rather than throwing.
    return CORE_PROVIDERS.flatMap(({ provider, brand, league, topTier }) => [
      {
        id: `core:${provider}:current`,
        provider,
        brand,
        model: MODEL_BY_PROVIDER[provider],
        league,
        ok: false,
        latencyMs: 0,
        error: 'Could not resolve admin user id for BYOK lookup',
        tier: 'current' as const,
      },
      {
        id: `core:${provider}:top-tier`,
        provider,
        brand,
        model: topTier.model,
        league,
        ok: false,
        latencyMs: 0,
        error: 'Could not resolve admin user id for BYOK lookup',
        tier: 'top-tier' as const,
      },
    ])
  }

  // Service-role existence check (bypasses RLS — caller is already admin-gated).
  // Only providers with a saved row get a live ping; the rest are reported as
  // "key not set" instead of a false failure. Both tiers of a brand share the
  // same BYOK key, so one lookup covers both rows.
  const { data: keyRows } = await supabaseAdmin
    .from('user_api_keys')
    .select('provider')
    .eq('user_id', userId)
    .in(
      'provider',
      CORE_PROVIDERS.map((c) => c.provider)
    )
  const providersWithKey = new Set((keyRows ?? []).map((r) => r.provider as string))

  const pingTier = async (
    { provider, brand, league }: CoreProviderConfig,
    tier: CoreTier,
    model: string,
    allowGeminiThinking: boolean | undefined
  ): Promise<CoreHealthResult> => {
    const base = { id: `core:${provider}:${tier}`, provider, brand, model, league, tier }

    if (!providersWithKey.has(provider)) {
      return { ...base, ok: false, latencyMs: 0, keyMissing: true }
    }

    const result = await runSingleAiProvider({
      supabase: supabaseAdmin,
      authSupabase: supabaseAdmin,
      sessionId: null,
      userId,
      provider,
      prompt: 'Reply with exactly one word: OK',
      systemPrompt: '',
      // Only used for a truthiness check inside runSingleAiProvider — the
      // actual RLS bypass comes from passing supabaseAdmin as authSupabase.
      supabaseAccessToken: 'admin-health-check',
      skipLanguageInjection: true,
      // Top-tier candidates are newer, sometimes reasoning-by-default models
      // (mirrors the pattern already seen in platform-providers.ts) — 32
      // tokens was enough for the current-gen models but too tight for those,
      // so both tiers use the same generous budget for a fair comparison.
      maxCompletionTokens: 200,
      modelOverride: model,
      allowGeminiThinking,
    })

    return {
      ...base,
      ok: !result.error && !!result.text,
      latencyMs: result.responseTimeMs,
      error: result.error,
    }
  }

  return Promise.all(
    CORE_PROVIDERS.flatMap((cfg) => [
      pingTier(cfg, 'current', MODEL_BY_PROVIDER[cfg.provider], undefined),
      pingTier(cfg, 'top-tier', cfg.topTier.model, cfg.topTier.allowGeminiThinking),
    ])
  )
}
