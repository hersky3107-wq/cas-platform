import 'server-only'

/**
 * PLATFORM-LEVEL LLM providers (OpenRouter, Meta Muse, You.com, NAVER CLOVA
 * Studio) — server-wide keys read from process.env, separate from the
 * per-user BYOK flow in app/settings + user_api_keys (that flow is untouched
 * by this file).
 *
 * ISOLATION (mirrors lib/gunpo/local-providers.ts): this file does NOT
 * import from or modify lib/ai/router.ts. `AiProviderName` /
 * `ExtendedAiProviderName` are NOT widened — these 4 providers are
 * deliberately out-of-band so no exhaustive `Record<AiProviderName, …>` map
 * anywhere in the app needs to change. Nothing here is wired into
 * ai-router's judgment/compare layer; callers must go through
 * `callPlatformModel` / `PLATFORM_MODEL_REGISTRY` explicitly (passthrough
 * only), per the task's Step 3 instruction.
 *
 * Model IDs registered below were confirmed live against each provider's
 * own API/catalog (OpenRouter: GET /api/v1/models with the real
 * OPENROUTER_API_KEY, re-checked 2026-08-09 21:32 KST for the GLM / Kimi /
 * Qwen / Nemotron / ByteDance / Baidu entries; Meta/You.com/NAVER: official
 * docs), NOT guessed from memory. See PLATFORM_MODEL_REGISTRY_TODO at the
 * bottom for requested models that could not be verified.
 */

export type PlatformProviderId = 'openrouter' | 'meta-muse' | 'youcom' | 'clova'

/** process.env key holding the bearer/API token for each platform provider. */
export const PLATFORM_PROVIDER_ENV_KEY: Record<PlatformProviderId, string> = {
  openrouter: 'OPENROUTER_API_KEY',
  'meta-muse': 'META_MUSE_API_KEY',
  youcom: 'YOUCOM_API_KEY',
  clova: 'CLOVA_API_KEY',
}

/**
 * Dashboard league grouping for the admin platform-health page.
 * Core-router models (GPT/Claude/etc.) are NOT in this registry — they are
 * noted separately on the dashboard as "core-router, not health-checked here".
 */
export type PlatformLeague = 'premier' | 'challenger' | 'world' | 'scout' | 'sovereign'

export type PlatformModelEntry = {
  /** Unique registry key, e.g. "openrouter:qwen3.8-max". Passthrough callers address models by this id. */
  id: string
  provider: PlatformProviderId
  /** English brand name (never Korean — UI constraint). */
  brand: string
  /** English display name for a future dashboard. */
  displayName: string
  /** Exact model string sent to the provider's API. */
  model: string
  /** Dashboard league section (premier / challenger / world / scout / sovereign). */
  league: PlatformLeague
  /** True if this exact model string was confirmed live against the provider's own catalog/docs (not guessed). */
  verified: true
  /**
   * Extra body fields merged into the OpenAI-compatible request for models
   * that reason-by-default and silently burn a small `max_tokens` budget on
   * hidden reasoning, returning `content: null` with `finish_reason:
   * "length"` (confirmed live for minimax-m3, mimo-v2.5, muse-spark-1.2 —
   * see the 2026-08-09 health-check investigation). Only set where verified
   * necessary; most entries don't need this.
   */
  extraRequestParams?: Record<string, unknown>
}

/**
 * Passthrough model registry. Router-agnostic: nothing iterates this array
 * to auto-include providers anywhere else, and it is NOT consulted by
 * lib/ai/router.ts's judgment/compare layer. A future dashboard/route can
 * import this to list what's callable via `callPlatformModel`.
 */
export const PLATFORM_MODEL_REGISTRY: PlatformModelEntry[] = [
  // --- OpenRouter (OpenAI-compatible; base https://openrouter.ai/api/v1) ---
  //
  // REASONING-BY-DEFAULT NOTE (investigated 2026-08-09, live against
  // OpenRouter, real key): several of these models spend an unpredictable
  // chunk of `max_tokens` on hidden reasoning before emitting visible
  // `content`, returning `content: null, finish_reason: "length"/"stop"`
  // with usage.completion_tokens_details.reasoning_tokens equal to (or
  // nearly all of) the budget — NOT an auth/endpoint/model-name/billing
  // error. Confirmed fixes, one per model (do not copy blindly — a fix that
  // works for one model can silently regress another, see nova-2-lite):
  //   - `reasoning: { effort: 'minimal' }` reliably leaves room for content
  //     on qwen3.8-max, kimi-k3, glm-5.2, minimax-m3, mimo-v2.5,
  //     nemotron-3-ultra-550b (confirmed via repeated live calls).
  //   - `reasoning: { enabled: false }` is REJECTED (HTTP 400 "Reasoning is
  //     mandatory for this endpoint and cannot be disabled") on qwen3.8-max
  //     — so `effort: 'minimal'` (not `enabled: false`) is the one that
  //     works across all of them and is used uniformly below.
  //   - amazon/nova-2-lite-v1 passes WITHOUT any reasoning override — adding
  //     `reasoning: { effort: 'minimal' }` to it was confirmed to BREAK it
  //     (content: null, finish_reason: "length") — deliberately left alone.
  //   - cohere/command-a, meta-llama/llama-4-maverick, microsoft/phi-4 don't
  //     support the `reasoning` param at all (not in supported_parameters)
  //     and pass reliably unmodified.
  // Health-check maxCompletionTokens was raised to 160 (see
  // healthCheckPlatformModel) to give these models enough room; passthrough
  // callers should pass their own generous maxCompletionTokens for the same
  // reason.
  //
  // Qwen3.8 Max (not 3.7) — confirmed live as the newer of the two non-preview,
  // non-"thinking" Max variants (created timestamp newer than qwen3.7-max).
  { id: 'openrouter:qwen3.8-max', provider: 'openrouter', brand: 'Qwen', displayName: 'Qwen3.8 Max', model: 'qwen/qwen3.8-max', league: 'premier', verified: true, extraRequestParams: { reasoning: { effort: 'minimal' } } },
  { id: 'openrouter:kimi-k3', provider: 'openrouter', brand: 'Moonshot AI', displayName: 'Kimi K3', model: 'moonshotai/kimi-k3', league: 'premier', verified: true, extraRequestParams: { reasoning: { effort: 'minimal' } } },
  { id: 'openrouter:glm-5.2', provider: 'openrouter', brand: 'Z.ai', displayName: 'GLM-5.2', model: 'z-ai/glm-5.2', league: 'premier', verified: true, extraRequestParams: { reasoning: { effort: 'minimal' } } },
  // `provider.order: ['minimax']` pins the first-party MiniMax upstream.
  // Reason (measured live 2026-08-10): of the 10 upstreams OpenRouter routes
  // this model to, Novita intermittently mis-splits the model's think block
  // and returns the whole answer in `message.reasoning` with
  // `message.content` null (also visible on its good calls, which come back
  // as "\n\nOK" rather than "OK"). First-party MiniMax was 6/6 clean, Together
  // 6/6, GMICloud 6/6. `allow_fallbacks: true` keeps availability if MiniMax
  // is down; the empty-content retry then covers a fallback onto Novita.
  { id: 'openrouter:minimax-m3', provider: 'openrouter', brand: 'MiniMax', displayName: 'MiniMax M3', model: 'minimax/minimax-m3', league: 'premier', verified: true, extraRequestParams: { reasoning: { effort: 'minimal' }, provider: { order: ['minimax'], allow_fallbacks: true } } },
  { id: 'openrouter:mimo-v2.5', provider: 'openrouter', brand: 'Xiaomi', displayName: 'MiMo V2.5', model: 'xiaomi/mimo-v2.5', league: 'world', verified: true, extraRequestParams: { reasoning: { effort: 'minimal' } } },
  // Full id is "nemotron-3-ultra-550b-a55b" (not the bare "nemotron-3-ultra" requested) — confirmed live.
  { id: 'openrouter:nemotron-3-ultra-550b', provider: 'openrouter', brand: 'NVIDIA', displayName: 'Nemotron 3 Ultra 550B A55B', model: 'nvidia/nemotron-3-ultra-550b-a55b', league: 'challenger', verified: true, extraRequestParams: { reasoning: { effort: 'minimal' } } },
  { id: 'openrouter:command-a', provider: 'openrouter', brand: 'Cohere', displayName: 'Command A', model: 'cohere/command-a', league: 'challenger', verified: true },
  // Kept at Seed 1.6 — see PLATFORM_MODEL_REGISTRY_TODO: the 2.0 generation
  // only ships as seed-2.0-lite / seed-2.0-mini (smaller variants), no
  // unsuffixed flagship-equivalent to replace this with.
  { id: 'openrouter:seed-1.6', provider: 'openrouter', brand: 'ByteDance', displayName: 'Seed 1.6', model: 'bytedance-seed/seed-1.6', league: 'world', verified: true },
  // Kept at ERNIE 4.5 VL — see PLATFORM_MODEL_REGISTRY_TODO: no ernie-5.0 in the live catalog.
  { id: 'openrouter:ernie-4.5-vl', provider: 'openrouter', brand: 'Baidu', displayName: 'ERNIE 4.5 VL 424B A47B', model: 'baidu/ernie-4.5-vl-424b-a47b', league: 'world', verified: true },
  // Deliberately NO extraRequestParams — confirmed live that adding
  // `reasoning: { effort: 'minimal' }` here BREAKS this model (see the note above).
  { id: 'openrouter:nova-2-lite', provider: 'openrouter', brand: 'Amazon', displayName: 'Nova 2 Lite', model: 'amazon/nova-2-lite-v1', league: 'world', verified: true },
  { id: 'openrouter:llama-4-maverick', provider: 'openrouter', brand: 'Meta', displayName: 'Llama 4 Maverick', model: 'meta-llama/llama-4-maverick', league: 'world', verified: true },
  { id: 'openrouter:phi-4', provider: 'openrouter', brand: 'Microsoft', displayName: 'Phi-4', model: 'microsoft/phi-4', league: 'world', verified: true },
  // NOTE: no AI21 entry — ai21/jamba-large-1.7 is still listed by OpenRouter
  // but its upstream is retired (HTTP 410). See PLATFORM_MODEL_REGISTRY_TODO.

  // --- Meta Muse (OpenAI-compatible; Meta Model API, base https://api.meta.ai/v1) ---
  // Confirmed live 2026-08-09: auth, endpoint, and model string are all
  // correct (HTTP 200). muse-spark-1.2 is a reasoning model that defaults to
  // heavy reasoning and burned 200+ tokens on hidden reasoning with content
  // still null at max_tokens:200. `reasoning_effort: "none"` is REJECTED by
  // this model (HTTP 400: "\"reasoning_effort\" does not support \"none\"
  // with this model") — `reasoning_effort: "minimal"` is the lowest accepted
  // value and confirmed to return visible content (finish_reason: "stop").
  { id: 'meta-muse:muse-spark-1.2', provider: 'meta-muse', brand: 'Meta', displayName: 'Muse Spark 1.2', model: 'muse-spark-1.2', league: 'premier', verified: true, extraRequestParams: { reasoning_effort: 'minimal' } },

  // --- You.com Research (non-standard; POST https://api.you.com/v1/research) ---
  // "model" has no meaning for this endpoint (it's an agent, not a model
  // selector) — kept for registry-shape consistency with the other 3.
  { id: 'youcom:research', provider: 'youcom', brand: 'You.com', displayName: 'You.com Research', model: 'research-agent', league: 'scout', verified: true },

  // --- NAVER CLOVA Studio (non-standard; POST /v3/chat-completions/{modelName}) ---
  { id: 'clova:hcx-007', provider: 'clova', brand: 'NAVER', displayName: 'HyperCLOVA X HCX-007', model: 'HCX-007', league: 'sovereign', verified: true },
]

/**
 * Requested-but-unregistered/unchanged models — verify manually before
 * changing the registry. OpenRouter entries last checked live against
 * GET /api/v1/models on 2026-08-10 17:50 KST.
 */
export const PLATFORM_MODEL_REGISTRY_TODO: { requested: string; note: string }[] = [
  {
    requested: 'AI21 Jamba (OpenRouter) — KNOWN RETIRED, removed from active health check',
    note: "OpenRouter still lists exactly one AI21 model, `ai21/jamba-large-1.7` (expiration_date: null), but calling it returns HTTP 410: \"This API has been retired. The AI21 Gateway is available at https://app.ai21.com — see https://docs.ai21.com/august-deprecation-notice\". Jamba Mini 2 was never on OpenRouter. Confirmed live 2026-08-10: the catalog listing is stale and there is NO working ai21/* route, so the entry was pulled from PLATFORM_MODEL_REGISTRY to avoid a permanent red on /admin/platform-health. To restore AI21, integrate the AI21 Gateway (app.ai21.com) directly as its own platform provider rather than via OpenRouter.",
  },
  {
    requested: 'ByteDance Seed 2.1 / latest (OpenRouter)',
    note: "No `seed-2.1` exists. The 2.0 generation only ships as `bytedance-seed/seed-2.0-lite` and `bytedance-seed/seed-2.0-mini` (smaller variants) — there is no unsuffixed full-size `seed-2.0` to replace the currently-registered `bytedance-seed/seed-1.6` flagship. Confirm with ByteDance/OpenRouter whether a full-size 2.0 is planned before downgrading to lite/mini.",
  },
  {
    requested: 'Baidu ERNIE 5.0 / latest (OpenRouter)',
    note: 'No `ernie-5.0` (or any ERNIE 5.x) exists. Only `baidu/ernie-4.5-vl-424b-a47b` is listed for the baidu author. Re-check https://openrouter.ai/api/v1/models (filter model_authors=baidu) periodically.',
  },
]

function getPlatformEnvKey(provider: PlatformProviderId): string | null {
  const key = process.env[PLATFORM_PROVIDER_ENV_KEY[provider]]
  return key && key.trim() ? key.trim() : null
}

export function getPlatformModelEntry(id: string): PlatformModelEntry | null {
  return PLATFORM_MODEL_REGISTRY.find((m) => m.id === id) ?? null
}

/**
 * Mirrors lib/ai/router.ts's private `fetchWithRetry` (one retry on a
 * network-level failure). Duplicated locally per the isolation note above —
 * this file never imports router.ts internals.
 */
async function fetchWithRetry(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (e: unknown) {
    const name = typeof e === 'object' && e ? (e as { name?: unknown }).name : null
    const retryable = e instanceof TypeError || name === 'AbortError'
    if (!retryable) throw e
    console.log('[platform-providers] Retrying AI call after network error')
    await new Promise((r) => setTimeout(r, 2000))
    return await fetch(input, init)
  }
}

export type PlatformCallResult = {
  text: string | null
  /** Only populated for the You.com Research adapter. */
  citations?: { url: string; title?: string }[]
  usage?: {
    promptTokens: number | null
    completionTokens: number | null
    totalTokens: number | null
  }
  /**
   * Cost in USD for this call. Either the ACTUAL billed cost as reported by the
   * provider (OpenRouter, via `usage: { include: true }`), or a documented
   * flat-rate estimate (You.com Research — see costIsEstimated). Null when
   * neither applies — callers then fall back to their own token×price estimate.
   */
  costUsd?: number | null
  /** True when costUsd is a documented estimate, not a per-call billed figure. */
  costIsEstimated?: boolean
  error?: string
}

type OpenAiCompatibleCallParams = {
  baseUrl: string
  apiKey: string
  model: string
  systemPrompt?: string
  userPrompt: string
  maxCompletionTokens?: number
  /** Merged into the request body — e.g. `{ reasoning: { enabled: false } }` for models that reason-by-default. */
  extraRequestParams?: Record<string, unknown>
  /** OpenRouter only: send `usage: { include: true }` so the response reports the actual billed cost (USD). */
  includeUsageCost?: boolean
}

/**
 * Generic OpenAI-compatible chat-completions caller, scoped to OpenRouter +
 * Meta Muse. Duplicated (not imported) from lib/ai/router.ts's
 * `callOpenAICompatibleChat` per the isolation note above.
 *
 * EMPTY-CONTENT RETRY: some upstreams behind OpenRouter intermittently put a
 * reasoning model's whole answer in `message.reasoning` and leave
 * `message.content` null even on a clean HTTP 200 with a large token budget
 * left unspent (confirmed live 2026-08-10: minimax/minimax-m3 via the Novita
 * upstream failed this way roughly 1 call in 6, at max_tokens:160 while only
 * spending ~31 tokens). That is upstream flakiness, not a budget or config
 * problem, so a single retry is attempted before reporting failure — mirroring
 * the existing one-retry-on-network-error policy in `fetchWithRetry`.
 */
async function callOpenAiCompatiblePlatformModel(
  params: OpenAiCompatibleCallParams
): Promise<PlatformCallResult> {
  const first = await callOpenAiCompatibleOnce(params)
  if (!first.emptyContent) return first.result

  console.log(
    `[platform-providers] ${params.model}: HTTP 200 with empty message.content — retrying once (known upstream flake).`
  )
  const second = await callOpenAiCompatibleOnce(params)
  return second.result
}

async function callOpenAiCompatibleOnce(
  params: OpenAiCompatibleCallParams
): Promise<{ result: PlatformCallResult; emptyContent: boolean }> {
  const { baseUrl, apiKey, model, systemPrompt, userPrompt, maxCompletionTokens, extraRequestParams, includeUsageCost } = params

  const payload: Record<string, unknown> = {
    model,
    messages: [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      { role: 'user', content: userPrompt },
    ],
    ...extraRequestParams,
  }
  // OpenRouter returns `usage.cost` (billed USD) only when asked to include it.
  if (includeUsageCost) payload.usage = { include: true }
  if (typeof maxCompletionTokens === 'number' && maxCompletionTokens > 0) {
    payload.max_tokens = maxCompletionTokens
  }

  try {
    const res = await fetchWithRetry(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const rawBody = await res.text().catch(() => '')

    if (!res.ok) {
      // Never silently pass — surface status + raw body so auth / wrong
      // endpoint / wrong model name / billing errors are all diagnosable.
      return {
        result: { text: null, error: `HTTP ${res.status} ${res.statusText}${rawBody ? ` - ${rawBody.slice(0, 800)}` : ''}` },
        emptyContent: false,
      }
    }

    let json: any
    try {
      json = JSON.parse(rawBody)
    } catch {
      return {
        result: { text: null, error: `HTTP ${res.status} but response body was not valid JSON: ${rawBody.slice(0, 800)}` },
        emptyContent: false,
      }
    }

    const choice = json?.choices?.[0]
    const content = choice?.message?.content
    const usage = json?.usage ?? {}

    if (typeof content !== 'string' || !content.trim().length) {
      // Same failure mode as lib/gunpo/local-providers.ts's solar/exaone bug:
      // either a reasoning-by-default model burned the whole token budget on
      // hidden reasoning, or the upstream dropped the visible answer into
      // `message.reasoning` only. Report it explicitly instead of returning
      // `{ text: null }` with no explanation; the caller retries once.
      const finishReason = choice?.finish_reason ?? 'unknown'
      const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens
      return {
        result: {
          text: null,
          error:
            `HTTP 200 but message.content was empty (finish_reason=${finishReason}` +
            (typeof reasoningTokens === 'number' ? `, reasoning_tokens=${reasoningTokens}/${usage?.completion_tokens ?? '?'}` : '') +
            `). Raw: ${rawBody.slice(0, 500)}`,
        },
        emptyContent: true,
      }
    }

    return {
      result: {
        text: content,
        usage: {
          promptTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : null,
          completionTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : null,
          totalTokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : null,
        },
        // OpenRouter reports the actual billed cost here (USD) when includeUsageCost was set.
        costUsd: typeof usage.cost === 'number' ? usage.cost : null,
      },
      emptyContent: false,
    }
  } catch (e: unknown) {
    return {
      result: { text: null, error: e instanceof Error ? e.message : 'unknown error calling OpenAI-compatible platform model' },
      emptyContent: false,
    }
  }
}

type YouComResearchEffort = 'lite' | 'standard' | 'deep' | 'exhaustive' | 'frontier'

/**
 * You.com's published Research API pricing (USD per 1,000 calls, per effort
 * tier), confirmed live 2026-08-13 against you.com/docs/administration/billing.
 * The Research API response itself does NOT include a per-call billed cost
 * field, so this documented flat rate is the best available figure — always
 * returned with costIsEstimated:true, never presented as a metered/billed cost.
 */
const YOUCOM_PRICE_PER_1K_USD: Record<YouComResearchEffort, number> = {
  lite: 12,
  standard: 50,
  deep: 100,
  exhaustive: 450,
  frontier: 1200,
}

/**
 * You.com Research API adapter. NOT OpenAI-compatible: returns a
 * synthesized Markdown answer + a source list, not chat-completion deltas.
 * Normalized here to `{ text, citations[] }` per the task's requirement.
 * Docs: https://docs.you.com/api-reference/research
 */
async function callYouComResearch(params: {
  apiKey: string
  input: string
  researchEffort?: YouComResearchEffort
}): Promise<PlatformCallResult> {
  const { apiKey, input, researchEffort = 'lite' } = params

  try {
    const res = await fetchWithRetry('https://api.you.com/v1/research', {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input, research_effort: researchEffort }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return { text: null, error: `HTTP ${res.status} ${res.statusText}${errText ? ` - ${errText}` : ''}` }
    }

    const json: any = await res.json()
    // Synchronous ResearchOutput shape: { output: { content, content_type, sources[] }, warnings[] }.
    // (background:true would instead return a ResearchTask handle — not used here.)
    const content = json?.output?.content
    const text = typeof content === 'string' ? content : content != null ? JSON.stringify(content) : null
    const sources: unknown = json?.output?.sources
    const citations = Array.isArray(sources)
      ? sources
          .filter((s): s is { url: string; title?: string } => !!s && typeof s.url === 'string')
          .map((s) => ({ url: s.url, title: typeof s.title === 'string' ? s.title : undefined }))
      : []

    return {
      text,
      citations,
      costUsd: YOUCOM_PRICE_PER_1K_USD[researchEffort] / 1000,
      costIsEstimated: true,
    }
  } catch (e: unknown) {
    return { text: null, citations: [], error: e instanceof Error ? e.message : 'unknown error calling You.com Research' }
  }
}

/**
 * NAVER CLOVA Studio (HyperCLOVA X) adapter — NOT OpenAI format. Auth is a
 * plain `Authorization: Bearer {CLOVA Studio API key}` (despite the
 * different-looking `nv-...` key format, it goes in the same header), and
 * the endpoint path embeds the model name: POST
 * /v3/chat-completions/{modelName}. Response is `{ status, result: {
 * message: { content }, usage } }`, not `choices[]`.
 * Docs: NAVER Cloud CLOVA Studio API guide (Chat Completions v3 / HCX-007).
 */
async function callClovaStudio(params: {
  apiKey: string
  model: string
  systemPrompt?: string
  userPrompt: string
  maxCompletionTokens?: number
  /** 'none' disables the HCX-007 reasoning pass — cheapest/fastest, used for health checks. */
  thinkingEffort?: 'none' | 'low' | 'medium' | 'high'
}): Promise<PlatformCallResult> {
  const { apiKey, model, systemPrompt, userPrompt, maxCompletionTokens, thinkingEffort } = params

  const payload: Record<string, unknown> = {
    messages: [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      { role: 'user', content: userPrompt },
    ],
  }
  if (thinkingEffort) payload.thinking = { effort: thinkingEffort }
  if (typeof maxCompletionTokens === 'number' && maxCompletionTokens > 0) {
    payload.maxCompletionTokens = maxCompletionTokens
  }

  try {
    const res = await fetchWithRetry(
      `https://clovastudio.stream.ntruss.com/v3/chat-completions/${encodeURIComponent(model)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    )

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return { text: null, error: `HTTP ${res.status} ${res.statusText}${errText ? ` - ${errText}` : ''}` }
    }

    const json: any = await res.json()
    const statusCode = json?.status?.code
    if (statusCode && statusCode !== '20000') {
      return { text: null, error: `CLOVA status ${statusCode}: ${json?.status?.message ?? 'unknown error'}` }
    }

    const content = json?.result?.message?.content
    const usage = json?.result?.usage ?? {}

    return {
      text: typeof content === 'string' ? content : null,
      usage: {
        promptTokens: typeof usage.promptTokens === 'number' ? usage.promptTokens : null,
        completionTokens: typeof usage.completionTokens === 'number' ? usage.completionTokens : null,
        totalTokens: typeof usage.totalTokens === 'number' ? usage.totalTokens : null,
      },
    }
  } catch (e: unknown) {
    return { text: null, error: e instanceof Error ? e.message : 'unknown error calling CLOVA Studio' }
  }
}

/**
 * Passthrough dispatcher: given a PLATFORM_MODEL_REGISTRY id, calls the
 * right adapter with the right base URL / auth shape. NOT consulted by
 * ai-router's judgment layer — callers must invoke this explicitly.
 */
export async function callPlatformModel(params: {
  id: string
  systemPrompt?: string
  userPrompt: string
  maxCompletionTokens?: number
}): Promise<PlatformCallResult> {
  const { id, systemPrompt, userPrompt, maxCompletionTokens } = params
  const entry = getPlatformModelEntry(id)
  if (!entry) return { text: null, error: `Unknown platform model id: ${id}` }

  const apiKey = getPlatformEnvKey(entry.provider)
  if (!apiKey) {
    return { text: null, error: `Missing ${PLATFORM_PROVIDER_ENV_KEY[entry.provider]} in environment` }
  }

  if (entry.provider === 'openrouter') {
    return callOpenAiCompatiblePlatformModel({
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey,
      model: entry.model,
      systemPrompt,
      userPrompt,
      maxCompletionTokens,
      extraRequestParams: entry.extraRequestParams,
      // Get the real billed cost back in usage.cost (OpenRouter-specific).
      includeUsageCost: true,
    })
  }

  if (entry.provider === 'meta-muse') {
    return callOpenAiCompatiblePlatformModel({
      baseUrl: 'https://api.meta.ai/v1',
      apiKey,
      model: entry.model,
      systemPrompt,
      userPrompt,
      maxCompletionTokens,
      extraRequestParams: entry.extraRequestParams,
    })
  }

  if (entry.provider === 'youcom') {
    // Research has no separate system/user turn — fold both into `input`.
    const input = systemPrompt ? `${systemPrompt}\n\n${userPrompt}` : userPrompt
    return callYouComResearch({ apiKey, input })
  }

  return callClovaStudio({
    apiKey,
    model: entry.model,
    systemPrompt,
    userPrompt,
    maxCompletionTokens,
    thinkingEffort: 'none',
  })
}

export type PlatformHealthCheckResult = {
  id: string
  provider: PlatformProviderId
  brand: string
  model: string
  league: PlatformLeague
  ok: boolean
  latencyMs: number
  error?: string
}

/** Pings one registry entry with a trivial prompt. Returns pass/fail + the model string used. */
export async function healthCheckPlatformModel(id: string): Promise<PlatformHealthCheckResult> {
  const entry = getPlatformModelEntry(id)
  const startedAt = Date.now()

  if (!entry) {
    return {
      id,
      provider: 'openrouter',
      brand: 'unknown',
      model: 'unknown',
      league: 'world',
      ok: false,
      latencyMs: 0,
      error: `Unknown platform model id: ${id}`,
    }
  }

  // You.com Research has no concept of a "1-token" call (it always runs at
  // least one full research pass); `research_effort: 'lite'` is the
  // cheapest/fastest tier and stands in for a minimal ping here.
  // maxCompletionTokens: 160 — confirmed live (2026-08-09) that reasoning-by-
  // default models (qwen3.8-max, kimi-k3, glm-5.2, minimax-m3, mimo-v2.5,
  // nemotron-3-ultra-550b, muse-spark-1.2) spend a variable, sometimes large
  // number of hidden reasoning tokens even at "minimal" effort (observed up
  // to ~83 reasoning tokens for muse-spark-1.2) before emitting visible
  // content; 8 and 32 were both too tight and produced false-negative
  // health-check failures with content:null, finish_reason:"length"/"stop".
  // 160 is still correct as of 2026-08-10 — the residual intermittent
  // content:null seen on minimax-m3 (~1 call in 6, with the budget barely
  // touched) is upstream flakiness, handled by the empty-content retry in
  // callOpenAiCompatiblePlatformModel, not by raising this number.
  const result = await callPlatformModel({
    id,
    userPrompt: 'Reply with exactly one word: OK',
    maxCompletionTokens: 160,
  })

  return {
    id: entry.id,
    provider: entry.provider,
    brand: entry.brand,
    model: entry.model,
    league: entry.league,
    ok: !result.error && !!result.text,
    latencyMs: Date.now() - startedAt,
    error: result.error,
  }
}

/** Pings every registered platform model in parallel. */
export async function healthCheckAllPlatformModels(): Promise<PlatformHealthCheckResult[]> {
  return Promise.all(PLATFORM_MODEL_REGISTRY.map((entry) => healthCheckPlatformModel(entry.id)))
}
