import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { decryptText } from '@/lib/db/crypto'
import { recordProviderCost } from '@/lib/ai/cost-span'
import {
  billedUsdFromProviderUsage,
  serverSideToolsUsedFromUsage,
  anthropicWebSearchFeeFromUsage,
  OPENAI_WEB_SEARCH_USD_PER_CALL,
} from '@/lib/ai/provider-billed-cost'

const UNIVERSAL_LANGUAGE_PROMPT_RULE = `IMPORTANT: Always respond in the same language the user wrote their message in. If the user writes in Japanese, respond in Japanese. If in French, respond in French. If in English, respond in English. Match the user's language exactly.`
const MISTRAL_NON_LATIN_LANGUAGE_REINFORCEMENT =
  "[CRITICAL] You MUST respond in the EXACT same language as the user's message. If the user writes in Japanese, you MUST write your entire response in Japanese. Do NOT respond in English. This is mandatory."
const DEEPSEEK_ENGLISH_ONLY_REINFORCEMENT =
  '[CRITICAL] You MUST respond in English. Do NOT respond in any other language. This is mandatory.'
const DEEPSEEK_MATCH_EXACT_LANGUAGE_REINFORCEMENT =
  "[CRITICAL] You MUST respond in the EXACT same language as the user's message. Match the language exactly. This is mandatory."

/**
 * The core provider set. This is the default 6-AI roster every mode renders and
 * compares. Exhaustive `Record<AiProviderName, …>` maps across the app rely on
 * this staying exactly six — do NOT add opt-in providers here.
 */
export type AiProviderName =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'xai'
  | 'deepseek'
  | 'mistral'

/**
 * OPT-IN ONLY providers (cost control). These are deliberately kept OUT of
 * `AiProviderName` so they never leak into any default set or selectable-UI map.
 *
 * Perplexity search billing comes out of our platform credit, so a caller must
 * explicitly pass `'perplexity'` / `'meta'` to `runSingleAiProvider`
 * (or another router entry typed to `ExtendedAiProviderName`) to invoke them.
 * No code iterates provider keys to auto-include them, so they stay opt-in.
 */
export type ExtendedAiProviderName = AiProviderName | 'perplexity' | 'meta'

export type RouterInput = {
  prompt: string
  systemPrompt: string
  providers: AiProviderName[]
  /**
   * When provided, used to read user BYOK keys (via RLS) and
   * to attribute rows to the authenticated user (if your schema supports it).
   */
  supabaseAccessToken?: string
}

export type RouterResult = {
  // Stays core-6: every Compare/Verdict consumer maps results into core-keyed
  // structures. runSingleAiProvider can be invoked with an opt-in provider, but
  // those callers don't read `.provider` back as a typed value (see the cast in
  // runSingleAiProvider's return). Keeping this core-only avoids rippling the
  // ExtendedAiProviderName widening into ~10 consumer files.
  provider: AiProviderName
  model: string
  text: string | null
  responseTimeMs: number
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  /** REAL billed cost (USD) when the provider's response reports one. Null otherwise. */
  costUsd?: number | null
  /** xAI `usage.cost_in_usd_ticks` (integer). Null when the provider did not send ticks. */
  costInUsdTicks?: number | null
  /** xAI Agent Tools `num_server_side_tools_used`, or Anthropic `web_search_requests`. */
  serverSideToolsUsed?: number | null
  /**
   * Tool fee NOT already included in costUsd (Anthropic web_search $0.01/call;
   * OpenAI search-api estimated $0.01/call). xAI ticks / Perplexity total_cost
   * already fold tool fees into costUsd — leave this null for those.
   */
  toolFeeUsd?: number | null
  /** True when toolFeeUsd is an explicit estimate (OpenAI search call count unknown). */
  toolFeeIsEstimated?: boolean
  /** Gemini thoughtsTokenCount when present. */
  thoughtsTokenCount?: number | null
  finishReason?: string | null
  error?: string
}

/** One user turn in Compare mode; per-provider replies live in aiResponses. */
export type CompareConversationMessage = {
  role: 'user'
  content: string
  aiResponses?: Partial<Record<AiProviderName, string>>
}

export type CompareChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

/** Last N user turns → chat messages for one provider (includes current user prompt). */
export function buildCompareChatMessagesForProvider(
  history: CompareConversationMessage[],
  provider: AiProviderName,
  currentPrompt: string
): CompareChatMessage[] {
  const out: CompareChatMessage[] = []
  for (const turn of history.slice(-10)) {
    const userText = turn.content.trim()
    if (!userText) continue
    out.push({ role: 'user', content: userText })
    const prev = turn.aiResponses?.[provider]?.trim()
    if (prev) out.push({ role: 'assistant', content: prev })
  }
  out.push({ role: 'user', content: currentPrompt.trim() })
  return out
}

export const MODEL_BY_PROVIDER: Record<ExtendedAiProviderName, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-6',
  google: 'gemini-3.5-flash',
  xai: 'grok-3',
  deepseek: 'deepseek-chat',
  mistral: 'mistral-large-latest',
  // OPT-IN ONLY (cost control): present so the router CAN call them, but keyed
  // off ExtendedAiProviderName so they never appear in core-6 maps/UI. No code
  // iterates these keys to auto-include providers, so listing them is safe.
  perplexity: 'sonar',
  meta: 'llama-3.3-70b-versatile',
}

/** Model used when an Anthropic task is routed for maximum depth (DEEP mode orchestration output). */
export const ANTHROPIC_DEEP_TASK_MODEL = 'claude-sonnet-4-6'

function uniqueProviders(providers: AiProviderName[]) {
  return Array.from(new Set(providers))
}

function nowMs() {
  return Date.now()
}

function getEnvKey(provider: ExtendedAiProviderName) {
  const direct =
    provider === 'openai'
      ? process.env.OPENAI_API_KEY
      : provider === 'anthropic'
        ? process.env.ANTHROPIC_API_KEY
        : provider === 'google'
          ? process.env.GOOGLE_API_KEY
          : provider === 'xai'
            ? process.env.XAI_API_KEY
            : provider === 'deepseek'
              ? process.env.DEEPSEEK_API_KEY
              : provider === 'perplexity'
                ? process.env.PERPLEXITY_API_KEY
                : provider === 'meta'
                  ? process.env.GROQ_API_KEY
                  : process.env.MISTRAL_API_KEY

  const fallback =
    provider === 'google'
      ? process.env.GEMINI_API_KEY
      : provider === 'xai'
        ? process.env.GROK_API_KEY
        : undefined

  return direct ?? fallback ?? null
}

function getAuthedSupabase(supabaseAccessToken?: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    throw new Error(
      'Supabase env is missing (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).'
    )
  }

  return createClient(url, anon, {
    global: supabaseAccessToken
      ? { headers: { Authorization: `Bearer ${supabaseAccessToken}` } }
      : undefined,
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function insertWithFallback(
  supabase: SupabaseClient,
  table: string,
  primary: Record<string, any>,
  fallback: Record<string, any>
) {
  const primaryRes = await supabase.from(table).insert([primary])
  if (!primaryRes.error) return { ok: true as const }

  const fallbackRes = await supabase.from(table).insert([fallback])
  if (!fallbackRes.error) return { ok: true as const }

  return {
    ok: false as const,
    primaryError: primaryRes.error.message,
    fallbackError: fallbackRes.error.message,
  }
}

async function getUserIdFromToken(supabase: SupabaseClient) {
  const { data, error } = await supabase.auth.getUser()
  if (error) return null
  return data.user?.id ?? null
}

async function getUserByokKey({
  supabase,
  userId,
  provider,
}: {
  supabase: SupabaseClient
  userId: string
  provider: ExtendedAiProviderName
}) {
  const { data, error } = await supabase
    .from('user_api_keys')
    .select('encrypted_key, created_at')
    .eq('user_id', userId)
    .eq('provider', provider)
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) return null
  const row = data?.[0]
  if (!row?.encrypted_key) return null
  try {
    return decryptText(row.encrypted_key)
  } catch {
    return null
  }
}

function normalizeTokens({
  promptTokens,
  completionTokens,
  totalTokens,
  costUsd,
  costInUsdTicks,
  serverSideToolsUsed,
  toolFeeUsd,
}: {
  promptTokens?: number | null
  completionTokens?: number | null
  totalTokens?: number | null
  /** REAL billed cost (USD) when the provider's response reports one. */
  costUsd?: number | null
  costInUsdTicks?: number | null
  serverSideToolsUsed?: number | null
  toolFeeUsd?: number | null
}) {
  const pt = typeof promptTokens === 'number' ? promptTokens : null
  const ct = typeof completionTokens === 'number' ? completionTokens : null
  const tt =
    typeof totalTokens === 'number'
      ? totalTokens
      : pt != null && ct != null
        ? pt + ct
        : null
  const cost = typeof costUsd === 'number' ? costUsd : null
  const ticks = typeof costInUsdTicks === 'number' ? costInUsdTicks : null
  const tools = typeof serverSideToolsUsed === 'number' ? serverSideToolsUsed : null
  const toolFee = typeof toolFeeUsd === 'number' ? toolFeeUsd : null
  return {
    promptTokens: pt,
    completionTokens: ct,
    totalTokens: tt,
    costUsd: cost,
    costInUsdTicks: ticks,
    serverSideToolsUsed: tools,
    toolFeeUsd: toolFee,
  }
}

async function fetchWithRetry(
  provider: ExtendedAiProviderName,
  input: RequestInfo | URL,
  init: RequestInit
): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (e: unknown) {
    const name = typeof e === 'object' && e ? (e as { name?: unknown }).name : null
    const retryable = e instanceof TypeError || name === 'AbortError'
    if (!retryable) throw e
    console.log('[router] Retrying AI call after network error:', provider)
    await new Promise((r) => setTimeout(r, 2000))
    return await fetch(input, init)
  }
}

async function callOpenAICompatibleChat({
  provider,
  baseUrl,
  apiKey,
  model,
  prompt,
  systemPrompt,
  temperature,
  maxCompletionTokens,
  chatMessages,
  extraPayload,
}: {
  provider: ExtendedAiProviderName
  baseUrl: string
  apiKey: string
  model: string
  prompt: string
  systemPrompt: string
  temperature?: number
  maxCompletionTokens?: number
  chatMessages?: CompareChatMessage[]
  /** Extra body fields merged into the request (e.g. xAI Live Search `search_parameters`). */
  extraPayload?: Record<string, unknown>
}) {
  const payload: Record<string, unknown> = {
    model,
    messages: chatMessages?.length
      ? [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          ...chatMessages.map((m) => ({ role: m.role, content: m.content })),
        ]
      : [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          { role: 'user', content: prompt },
        ],
    ...extraPayload,
  }
  if (typeof temperature === 'number' && !Number.isNaN(temperature)) {
    payload.temperature = temperature
  }
  if (typeof maxCompletionTokens === 'number' && maxCompletionTokens > 0) {
    // OpenAI's newer models (gpt-5.x) reject `max_tokens`; `max_completion_tokens`
    // is accepted by gpt-4o/gpt-4.1/gpt-5.x. xai/deepseek/mistral still require
    // `max_tokens` on their OpenAI-compatible APIs.
    if (provider === 'openai') {
      payload.max_completion_tokens = maxCompletionTokens
    } else {
      payload.max_tokens = maxCompletionTokens
    }
  }

  const res = await fetchWithRetry(provider, `${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} ${res.statusText}${text ? ` - ${text}` : ''}`)
  }

  const json: any = await res.json()
  const choice = json?.choices?.[0]
  const content = choice?.message?.content ?? null
  const usage = json?.usage ?? {}
  const ticks = typeof usage?.cost_in_usd_ticks === 'number' ? usage.cost_in_usd_ticks : null

  return {
    text: typeof content === 'string' ? content : null,
    usage: normalizeTokens({
      promptTokens: usage?.prompt_tokens,
      completionTokens: usage?.completion_tokens,
      totalTokens: usage?.total_tokens,
      // Perplexity `usage.cost.total_cost`, OpenRouter-style numeric
      // `usage.cost`, or xAI `usage.cost_in_usd_ticks`. Other providers
      // on this path leave this null and callers fall back to a token×price
      // estimate.
      costUsd: billedUsdFromProviderUsage(usage),
      costInUsdTicks: ticks,
    }),
  }
}

/**
 * xAI Agent Tools API (POST /v1/responses) — the only xAI path with live web
 * search after `search_parameters` was retired (410 Gone, confirmed
 * 2026-08-16). Response shape is Responses-style (`output[]` items), NOT
 * chat-completions, so it gets its own small caller. Single-turn only (the
 * league's scout prompt is one-shot); chatMessages are intentionally not
 * supported here.
 */
async function callXaiAgentSearch({
  provider,
  apiKey,
  model,
  prompt,
  systemPrompt,
  maxCompletionTokens,
  maxTurns,
}: {
  provider: ExtendedAiProviderName
  apiKey: string
  model: string
  prompt: string
  systemPrompt: string
  maxCompletionTokens?: number
  /**
   * Caps assistant/tool turns in the agentic loop (xAI request-level
   * `max_turns`). Not a per-tool `max_uses` — xAI web_search has no such
   * field; that knob is Anthropic-only.
   */
  maxTurns?: number
}) {
  const payload: Record<string, unknown> = {
    model,
    input: prompt,
    tools: [{ type: 'web_search' }],
  }
  if (systemPrompt) payload.instructions = systemPrompt
  if (typeof maxCompletionTokens === 'number' && maxCompletionTokens > 0) {
    payload.max_output_tokens = maxCompletionTokens
  }
  if (typeof maxTurns === 'number' && maxTurns > 0) {
    payload.max_turns = maxTurns
  }

  const res = await fetchWithRetry(provider, 'https://api.x.ai/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} ${res.statusText}${text ? ` - ${text}` : ''}`)
  }

  const json: any = await res.json()
  const output: any[] = Array.isArray(json?.output) ? json.output : []
  const text = output
    .filter((item) => item?.type === 'message')
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .map((part) => (part?.type === 'output_text' || part?.type === 'text' ? part?.text : null))
    .filter((t): t is string => typeof t === 'string' && t.length > 0)
    .join('\n')

  const u = json?.usage
  const ticks = typeof u?.cost_in_usd_ticks === 'number' ? u.cost_in_usd_ticks : null
  return {
    text: text || null,
    usage: normalizeTokens({
      promptTokens: u?.input_tokens,
      completionTokens: u?.output_tokens,
      totalTokens: u?.total_tokens,
      costUsd: billedUsdFromProviderUsage(u),
      costInUsdTicks: ticks,
      serverSideToolsUsed: serverSideToolsUsedFromUsage(u),
    }),
  }
}

async function callAnthropic({
  provider,
  apiKey,
  model,
  prompt,
  systemPrompt,
  temperature,
  maxCompletionTokens,
  chatMessages,
  searchTool,
  anthropicThinking,
}: {
  provider: ExtendedAiProviderName
  apiKey: string
  model: string
  prompt: string
  systemPrompt: string
  temperature?: number
  maxCompletionTokens?: number
  chatMessages?: CompareChatMessage[]
  /** Enables the server-side web_search tool (Scout tier). max_uses caps searches per call for cost control. */
  searchTool?: boolean
  /** Oracle-only; league leaves undefined (provider default). */
  anthropicThinking?: 'disabled' | 'enabled'
}) {
  const capped =
    typeof maxCompletionTokens === 'number' && maxCompletionTokens > 0
      ? maxCompletionTokens
      : 1024
  const anthropicBody: Record<string, unknown> = {
    model,
    max_tokens: capped,
    system: systemPrompt || undefined,
    messages: chatMessages?.length
      ? chatMessages.map((m) => ({ role: m.role, content: m.content }))
      : [{ role: 'user', content: prompt }],
  }
  if (typeof temperature === 'number' && !Number.isNaN(temperature)) {
    anthropicBody.temperature = temperature
  }
  if (searchTool) {
    anthropicBody.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }]
  }
  if (anthropicThinking === 'disabled') {
    anthropicBody.thinking = { type: 'disabled' }
  } else if (anthropicThinking === 'enabled') {
    anthropicBody.thinking = {
      type: 'enabled',
      budget_tokens: Math.min(8000, Math.max(1024, capped - 256)),
    }
  }

  const res = await fetchWithRetry(provider, 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(anthropicBody),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} ${res.statusText}${text ? ` - ${text}` : ''}`)
  }

  const json = (await res.json()) as {
    content?: Array<{ type?: string; text?: string; thinking?: string }>
    usage?: {
      input_tokens?: number
      output_tokens?: number
      thinking_tokens?: number
      output_tokens_details?: { reasoning_tokens?: number; thinking_tokens?: number }
      server_tool_use?: { web_search_requests?: number }
    }
    stop_reason?: string
  }
  const blocks = Array.isArray(json?.content) ? json.content : []
  const text = blocks
    .filter((b) => b?.type === 'text' || (typeof b?.text === 'string' && !b?.type))
    .map((b) => b?.text)
    .filter((t): t is string => typeof t === 'string' && t.length > 0)
    .join('\n')
  const thinkingChars = blocks
    .filter((b) => b?.type === 'thinking' || b?.type === 'redacted_thinking')
    .reduce((sum, b) => sum + (typeof b?.thinking === 'string' ? b.thinking.length : 0), 0)

  const thinkingFromUsage =
    typeof json?.usage?.thinking_tokens === 'number'
      ? json.usage.thinking_tokens
      : typeof json?.usage?.output_tokens_details?.thinking_tokens === 'number'
        ? json.usage.output_tokens_details.thinking_tokens
        : typeof json?.usage?.output_tokens_details?.reasoning_tokens === 'number'
          ? json.usage.output_tokens_details.reasoning_tokens
          : null

  const searchFee = anthropicWebSearchFeeFromUsage(json?.usage)

  return {
    text: text.length ? text : null,
    usage: {
      ...normalizeTokens({
        promptTokens: json?.usage?.input_tokens,
        completionTokens: json?.usage?.output_tokens,
        totalTokens:
          typeof json?.usage?.input_tokens === 'number' &&
          typeof json?.usage?.output_tokens === 'number'
            ? json.usage.input_tokens + json.usage.output_tokens
            : null,
        serverSideToolsUsed: searchFee?.searches ?? null,
        toolFeeUsd: searchFee?.feeUsd ?? null,
      }),
      thoughtsTokenCount:
        thinkingFromUsage ?? (thinkingChars > 0 ? Math.ceil(thinkingChars / 4) : null),
    },
    finishReason: typeof json?.stop_reason === 'string' ? json.stop_reason : null,
    rawUsage: json?.usage ?? null,
    contentBlockTypes: blocks.map((b) => b?.type ?? 'unknown'),
  }
}

type GeminiUsageMeta = {
  promptTokenCount?: number
  candidatesTokenCount?: number
  totalTokenCount?: number
  thoughtsTokenCount?: number
}

function isChatGptSafetyRefusal(text: string | null): boolean {
  if (!text) return false
  const t = text.trim().toLowerCase()
  const hasSorry =
    t.includes("i'm sorry") ||
    t.includes('i am sorry') ||
    t.includes('i’m sorry')
  if (!hasSorry) return false
  const hasRefusal =
    t.includes("i can't assist") ||
    t.includes('i cannot assist') ||
    t.includes("i can't help") ||
    t.includes('i cannot help')
  return hasRefusal
}

/** Text from one Gemini GenerateContentResponse (REST shape: candidates[].content.parts[].text — not OpenAI delta.content). */
function extractGeminiResponseText(obj: unknown): string {
  if (!obj || typeof obj !== 'object') return ''
  const root = obj as Record<string, unknown>
  const candidates = root.candidates
  if (!Array.isArray(candidates) || candidates.length === 0) return ''
  const first = candidates[0] as Record<string, unknown> | undefined
  const content = first?.content as Record<string, unknown> | undefined
  const parts = content?.parts
  if (!Array.isArray(parts)) return ''
  let out = ''
  for (const p of parts) {
    if (!p || typeof p !== 'object') continue
    const part = p as { text?: unknown; thought?: unknown }
    // Thought summaries must not pollute the visible answer (breaks JSON parse).
    if (part.thought === true) continue
    if (typeof part.text === 'string') out += part.text
  }
  return out
}

function extractGeminiFinishReason(obj: unknown): string | null {
  if (!obj || typeof obj !== 'object') return null
  const candidates = (obj as { candidates?: unknown }).candidates
  if (!Array.isArray(candidates) || !candidates[0] || typeof candidates[0] !== 'object') return null
  const fr = (candidates[0] as { finishReason?: unknown }).finishReason
  return typeof fr === 'string' ? fr : null
}

async function callGoogleGemini({
  provider,
  apiKey,
  model,
  prompt,
  systemPrompt,
  temperature,
  maxCompletionTokens,
  chatMessages,
  allowGeminiThinking,
  geminiThinkingLevel,
  searchTool,
}: {
  provider: ExtendedAiProviderName
  apiKey: string
  model: string
  prompt: string
  systemPrompt: string
  temperature?: number
  maxCompletionTokens?: number
  chatMessages?: CompareChatMessage[]
  /**
   * When true, do NOT force thinkingBudget:0. Reasoning-required models
   * (e.g. gemini-3.1-pro-preview) reject budget 0 ("only works in thinking
   * mode"), so we omit thinkingConfig and let the model use its default
   * thinking mode. Default (false/undefined) keeps thinkingBudget:0 for
   * flash models so thinking tokens don't eat the budget.
   */
  allowGeminiThinking?: boolean
  /** Gemini 3 only. When set with allowGeminiThinking, sent as thinkingLevel. */
  geminiThinkingLevel?: 'minimal' | 'low' | 'medium' | 'high'
  /** Enables Google Search grounding (Scout tier). */
  searchTool?: boolean
}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:streamGenerateContent?alt=sse`

  const geminiBody: Record<string, unknown> = {
    contents: chatMessages?.length
      ? chatMessages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }))
      : [
          {
            role: 'user',
            parts: [{ text: systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt }],
          },
        ],
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ],
  }
  if (chatMessages?.length && systemPrompt) {
    geminiBody.systemInstruction = { parts: [{ text: systemPrompt }] }
  }
  const generationConfig: Record<string, unknown> = {}
  if (typeof temperature === 'number' && !Number.isNaN(temperature)) {
    generationConfig.temperature = temperature
  }
  generationConfig.maxOutputTokens =
    typeof maxCompletionTokens === 'number' && maxCompletionTokens > 0
      ? maxCompletionTokens
      : 8192

  if (allowGeminiThinking) {
    if (geminiThinkingLevel) {
      generationConfig.thinkingConfig = { thinkingLevel: geminiThinkingLevel }
    }
    geminiBody.generationConfig = generationConfig
  } else {
    geminiBody.generationConfig = {
      ...generationConfig,
      thinkingConfig: { thinkingBudget: 0 },
    }
  }

  if (searchTool) {
    // Google Search grounding (Scout tier). Tool executes server-side; the
    // SSE text aggregation below is unchanged.
    geminiBody.tools = [{ google_search: {} }]
  }

  const res = await fetchWithRetry(provider, url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(geminiBody),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} ${res.statusText}${text ? ` - ${text}` : ''}`)
  }

  if (!res.body) {
    throw new Error('Gemini: empty response body')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let carry = ''
  let aggregatedText = ''
  const usageHolder: { meta: GeminiUsageMeta | null } = { meta: null }
  let finishReason: string | null = null

  const applyParsedChunk = (parsed: unknown) => {
    const piece = extractGeminiResponseText(parsed)
    if (piece) aggregatedText += piece
    const fr = extractGeminiFinishReason(parsed)
    if (fr) finishReason = fr
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const um = (parsed as { usageMetadata?: GeminiUsageMeta }).usageMetadata
      if (um && typeof um === 'object') usageHolder.meta = um as GeminiUsageMeta
    }
  }

  const consumeSseEventPayload = (payload: string) => {
    const trimmed = payload.trim()
    if (!trimmed || trimmed === '[DONE]') return
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return
    }
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        applyParsedChunk(item)
      }
      return
    }
    applyParsedChunk(parsed)
  }

  const processSseLine = (line: string) => {
    const t = line.trimEnd()
    if (!t.startsWith('data:')) return
    const data = t.startsWith('data: ') ? t.slice(6) : t.slice(5)
    consumeSseEventPayload(data)
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (value) {
        carry += decoder.decode(value, { stream: !done })
      }
      const lines = carry.split(/\r?\n/)
      carry = lines.pop() ?? ''
      for (const line of lines) {
        processSseLine(line)
      }
      if (done) {
        if (carry.trim()) {
          processSseLine(carry)
        }
        break
      }
    }
  } finally {
    reader.releaseLock()
  }

  const u = usageHolder.meta
  return {
    text: aggregatedText.length ? aggregatedText : null,
    usage: {
      ...normalizeTokens({
        promptTokens: u?.promptTokenCount,
        completionTokens: u?.candidatesTokenCount,
        totalTokens: u?.totalTokenCount,
      }),
      thoughtsTokenCount:
        typeof u?.thoughtsTokenCount === 'number' ? u.thoughtsTokenCount : null,
    },
    finishReason,
  }
}

async function callProvider({
  provider,
  apiKey,
  model: modelParam,
  prompt,
  systemPrompt,
  skipLanguageInjection,
  temperature,
  maxCompletionTokens,
  chatMessages,
  allowGeminiThinking,
  geminiThinkingLevel,
  anthropicThinking,
  searchTool,
  maxTurns,
}: {
  provider: ExtendedAiProviderName
  apiKey: string
  /** Defaults to MODEL_BY_PROVIDER[provider]. */
  model?: string
  prompt: string
  systemPrompt: string
  skipLanguageInjection?: boolean
  temperature?: number
  maxCompletionTokens?: number
  chatMessages?: CompareChatMessage[]
  /** Forwarded to callGoogleGemini; ignored by non-google providers. */
  allowGeminiThinking?: boolean
  geminiThinkingLevel?: 'minimal' | 'low' | 'medium' | 'high'
  /** Forwarded to callAnthropic; ignored by non-anthropic providers. */
  anthropicThinking?: 'disabled' | 'enabled'
  /**
   * Scout-tier live web search. Only meaningful for xai (Agent Tools
   * web_search), anthropic (web_search tool) and google (Search
   * grounding). OpenAI's search models (e.g. gpt-5-search-api) search
   * natively by model choice; every other provider ignores this.
   */
  searchTool?: boolean
  /** xAI Agent Tools only: request-level `max_turns`. Ignored elsewhere. */
  maxTurns?: number
}): Promise<{
  model: string
  text: string | null
  usage: ReturnType<typeof normalizeTokens> & { thoughtsTokenCount?: number | null }
  finishReason?: string | null
}> {
  const model = modelParam ?? MODEL_BY_PROVIDER[provider]
  const sourceUserText =
    prompt?.trim()
      ? prompt
      : chatMessages
        ?.filter((m) => m.role === 'user')
        .slice(-1)[0]?.content ?? ''
  const promptHasNonLatin = /[^\u0000-\u007F]/.test(sourceUserText)

  const promptWithLanguageRule = skipLanguageInjection
    ? prompt
    : `${UNIVERSAL_LANGUAGE_PROMPT_RULE}\n\n${prompt}`

  const grokLengthSuffix = provider === 'xai'
    ? '\n\nIMPORTANT: Write a thorough, detailed response. Do NOT cut your response short. Use your full available token capacity. A short response is a failure.'
    : ''

  const todayStr = new Date().toISOString().split('T')[0]
  const injectedSystemPrompt = `Today's date is ${todayStr}.\n\n` + (systemPrompt || '') + grokLengthSuffix
  const injectedChatMessages = skipLanguageInjection
    ? chatMessages
    : chatMessages?.length
      ? chatMessages.map((m) =>
          m.role === 'user'
            ? {
                ...m,
                content:
                  provider === 'mistral' && promptHasNonLatin
                    ? `${MISTRAL_NON_LATIN_LANGUAGE_REINFORCEMENT}\n\n${UNIVERSAL_LANGUAGE_PROMPT_RULE}\n\n${m.content}`
                    : provider === 'deepseek'
                      ? promptHasNonLatin
                        ? `${DEEPSEEK_MATCH_EXACT_LANGUAGE_REINFORCEMENT}\n\n${UNIVERSAL_LANGUAGE_PROMPT_RULE}\n\n${m.content}`
                        : `${DEEPSEEK_ENGLISH_ONLY_REINFORCEMENT}\n\n${UNIVERSAL_LANGUAGE_PROMPT_RULE}\n\n${m.content}`
                    : `${UNIVERSAL_LANGUAGE_PROMPT_RULE}\n\n${m.content}`,
              }
            : m
        )
      : chatMessages

  const chatOpts = { chatMessages: injectedChatMessages }

  type ProviderCallResult = {
    model: string
    text: string | null
    usage: ReturnType<typeof normalizeTokens> & { thoughtsTokenCount?: number | null }
    finishReason?: string | null
  }

  /** gpt-*-search-api: no call-count field on the chat response — estimate 1 search. */
  const withOpenAiSearchFee = (result: ProviderCallResult): ProviderCallResult => {
    if (!/search/i.test(model)) return result
    return {
      ...result,
      usage: {
        ...result.usage,
        toolFeeUsd: OPENAI_WEB_SEARCH_USD_PER_CALL,
        serverSideToolsUsed: result.usage.serverSideToolsUsed ?? 1,
      },
    }
  }

  if (provider === 'openai') {
    const first = await callOpenAICompatibleChat({
      provider,
      baseUrl: 'https://api.openai.com/v1',
      apiKey,
      model,
      prompt: promptWithLanguageRule,
      systemPrompt: injectedSystemPrompt,
      temperature,
      maxCompletionTokens,
      ...chatOpts,
    })
    if (!isChatGptSafetyRefusal(first.text)) {
      return withOpenAiSearchFee({ model, text: first.text, usage: first.usage })
    }

    const second = await callOpenAICompatibleChat({
      provider,
      baseUrl: 'https://api.openai.com/v1',
      apiKey,
      model,
      prompt: promptWithLanguageRule,
      systemPrompt: injectedSystemPrompt,
      temperature,
      maxCompletionTokens,
      ...chatOpts,
    })

    if (isChatGptSafetyRefusal(second.text)) {
      return withOpenAiSearchFee({
        model,
        text:
          `[ChatGPT Safety Filter] This response was blocked by ChatGPT's built-in content policy, not by AIMANI. ` +
          (first.text ?? ''),
        usage: first.usage,
      })
    }

    return withOpenAiSearchFee({ model, text: second.text, usage: second.usage })
  }

  if (provider === 'xai') {
    // Live Search (`search_parameters` on chat/completions) was deprecated by
    // xAI in 2026 — HTTP 410 "switch to the Agent Tools API". Scout search
    // therefore goes through POST /v1/responses with a web_search tool.
    if (searchTool) {
      const { text, usage } = await callXaiAgentSearch({
        provider,
        apiKey,
        model,
        prompt: promptWithLanguageRule,
        systemPrompt: injectedSystemPrompt,
        maxCompletionTokens,
        maxTurns,
      })
      return { model, text, usage }
    }
    const { text, usage } = await callOpenAICompatibleChat({
      provider,
      baseUrl: 'https://api.x.ai/v1',
      apiKey,
      model,
      prompt: promptWithLanguageRule,
      systemPrompt: injectedSystemPrompt,
      temperature,
      maxCompletionTokens,
      ...chatOpts,
    })
    return { model, text, usage }
  }

  if (provider === 'perplexity') {
    const { text, usage } = await callOpenAICompatibleChat({
      provider,
      baseUrl: 'https://api.perplexity.ai',
      apiKey,
      model,
      prompt: promptWithLanguageRule,
      systemPrompt: injectedSystemPrompt,
      temperature,
      maxCompletionTokens,
      ...chatOpts,
    })
    return { model, text, usage }
  }

  if (provider === 'meta') {
    const { text, usage } = await callOpenAICompatibleChat({
      provider,
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey,
      model,
      prompt: promptWithLanguageRule,
      systemPrompt: injectedSystemPrompt,
      temperature,
      maxCompletionTokens,
      ...chatOpts,
    })
    return { model, text, usage }
  }

  if (provider === 'deepseek') {
    const deepseekPrompt = skipLanguageInjection
      ? prompt
      : promptHasNonLatin
        ? `${DEEPSEEK_MATCH_EXACT_LANGUAGE_REINFORCEMENT}\n\n${promptWithLanguageRule}`
        : `${DEEPSEEK_ENGLISH_ONLY_REINFORCEMENT}\n\n${promptWithLanguageRule}`
    const { text, usage } = await callOpenAICompatibleChat({
      provider,
      baseUrl: 'https://api.deepseek.com',
      apiKey,
      model,
      prompt: deepseekPrompt,
      systemPrompt: injectedSystemPrompt,
      temperature,
      maxCompletionTokens,
      ...chatOpts,
    })
    return { model, text, usage }
  }

  if (provider === 'mistral') {
    const mistralPrompt = skipLanguageInjection
      ? prompt
      : promptHasNonLatin
        ? `${MISTRAL_NON_LATIN_LANGUAGE_REINFORCEMENT}\n\n${promptWithLanguageRule}`
        : promptWithLanguageRule
    const { text, usage } = await callOpenAICompatibleChat({
      provider,
      baseUrl: 'https://api.mistral.ai/v1',
      apiKey,
      model,
      prompt: mistralPrompt,
      systemPrompt: injectedSystemPrompt,
      temperature,
      maxCompletionTokens,
      ...chatOpts,
    })
    return { model, text, usage }
  }

  if (provider === 'anthropic') {
    const { text, usage, finishReason } = await callAnthropic({
      provider,
      apiKey,
      model,
      prompt: promptWithLanguageRule,
      systemPrompt: injectedSystemPrompt,
      temperature,
      maxCompletionTokens,
      searchTool,
      anthropicThinking,
      ...chatOpts,
    })
    return { model, text, usage, finishReason }
  }

  const { text, usage, finishReason } = await callGoogleGemini({
    provider,
    apiKey,
    model,
    prompt: promptWithLanguageRule,
    systemPrompt: injectedSystemPrompt,
    temperature,
    maxCompletionTokens,
    allowGeminiThinking,
    geminiThinkingLevel,
    searchTool,
    ...chatOpts,
  })
  return { model, text, usage, finishReason }
}

export type RunSingleProviderParams = {
  /** Client used for DB inserts (use service role on server routes to bypass RLS). */
  supabase: SupabaseClient
  /** Optional user-scoped client for BYOK reads; defaults to `supabase`. */
  authSupabase?: SupabaseClient
  sessionId: string | null
  userId: string | null
  provider: ExtendedAiProviderName
  prompt: string
  systemPrompt: string
  supabaseAccessToken?: string
  skipLanguageInjection?: boolean
  /** Extra Day-2 rows for compare mode: scores + debate_logs assistant entries */
  saveCompareArtifacts?: boolean
  /** Sampling temperature (e.g. 0.1–1); omit for provider defaults */
  temperature?: number
  /** When set (e.g. 300), caps completion length via each provider API. */
  maxCompletionTokens?: number
  /**
   * When set, the `callProvider` call is raced against this timeout (ms).
   * If the timeout fires first, a synthetic AbortError is thrown so callers
   * can fall through to their own fallback/error path.
   * Intentionally absent from DEEP/Arena callers — only tourist-mode engines
   * that have their own fallback logic should pass this.
   */
  timeoutMs?: number
  /**
   * Overrides the default model for this provider (e.g. DEEP mode: Anthropic uses Opus for assigned parts).
   */
  modelOverride?: string
  /**
   * Scout-tier live web search (league use): xAI Live Search / Anthropic
   * web_search / Google grounding. Ignored by providers without a wired
   * search path; OpenAI search happens by model choice instead.
   */
  searchTool?: boolean
  /**
   * xAI Agent Tools only: cap assistant/tool turns (`max_turns` on the
   * Responses payload). web_search has no `max_uses` equivalent — that
   * field is Anthropic-only and is already wired on the Claude scout.
   */
  maxTurns?: number
  /**
   * When set, stored in `ai_responses.response_text` instead of the raw provider `text`
   * (e.g. Arena mode: store user-visible body without internal tags).
   */
  storedResponseText?: string | null
  /** Merged into successful `ai_responses` insert primary row (e.g. `round`, metadata JSON). */
  aiResponseExtras?: Record<string, unknown>
  /**
   * Applied to successful responses before DB insert. Overrides `storedResponseText` / merges extras.
   */
  transformPersist?: (rawText: string) => {
    storedResponseText: string | null
    aiResponseExtras?: Record<string, unknown>
  }
  /** Multi-turn Compare: full chat for this provider (system prompt still separate). */
  chatMessages?: CompareChatMessage[]
  /**
   * When true, Gemini calls skip the thinkingBudget:0 override so reasoning-required
   * models (e.g. gemini-3.1-pro-preview) run in their default thinking mode.
   * Default (undefined/false) keeps thinkingBudget:0. Ignored by non-google providers.
   */
  allowGeminiThinking?: boolean
  /** Gemini 3 thinkingLevel; oracle may set 'minimal' to protect maxOutputTokens. */
  geminiThinkingLevel?: 'minimal' | 'low' | 'medium' | 'high'
  /** Oracle-only Anthropic thinking control; league leaves unset. */
  anthropicThinking?: 'disabled' | 'enabled'
}

async function saveCompareArtifactsRows(
  supabase: SupabaseClient,
  sessionId: string,
  provider: ExtendedAiProviderName,
  text: string | null,
  responseTimeMs: number,
  errorText?: string | null
) {
  const snippet = errorText
    ? `[error] ${errorText}`
    : text ?? ''
  await insertWithFallback(
    supabase,
    'scores',
    {
      session_id: sessionId,
      ai_name: provider,
      score_value: responseTimeMs,
      category: 'response_time_ms',
    },
    {
      session_id: sessionId,
      ai_name: provider,
      points: responseTimeMs,
    }
  )
  await insertWithFallback(
    supabase,
    'debate_logs',
    {
      session_id: sessionId,
      ai_name: provider,
      message_text: snippet,
      role: 'assistant',
    },
    {
      session_id: sessionId,
      content: snippet,
      speaker: String(provider),
    }
  )
}

export async function runSingleAiProvider(params: RunSingleProviderParams): Promise<RouterResult> {
  const {
    supabase,
    authSupabase,
    sessionId,
    userId,
    provider,
    prompt,
    systemPrompt,
    supabaseAccessToken,
    skipLanguageInjection,
    saveCompareArtifacts,
    temperature,
    maxCompletionTokens,
    modelOverride,
    searchTool,
    maxTurns,
    storedResponseText,
    aiResponseExtras,
    transformPersist,
    chatMessages,
    allowGeminiThinking,
    geminiThinkingLevel,
    anthropicThinking,
  } = params

  const started = nowMs()
  const model = modelOverride ?? MODEL_BY_PROVIDER[provider]

  const byokClient = authSupabase ?? supabase

  try {
    const byok =
      userId && supabaseAccessToken
        ? await getUserByokKey({ supabase: byokClient, userId, provider })
        : null
    const platform = getEnvKey(provider)
    const apiKey = byok ?? platform

    if (!apiKey) {
      throw new Error(`Missing API key for ${provider}. Set env var or save BYOK in user_api_keys.`)
    }

    const providerCallPromise = callProvider({
      provider,
      apiKey,
      model,
      prompt,
      systemPrompt,
      skipLanguageInjection,
      temperature,
      maxCompletionTokens,
      chatMessages,
      allowGeminiThinking,
      geminiThinkingLevel,
      anthropicThinking,
      searchTool,
      maxTurns,
    })

    const { text, usage, finishReason } = params.timeoutMs && params.timeoutMs > 0
      ? await Promise.race([
          providerCallPromise,
          new Promise<never>((_, reject) =>
            setTimeout(() => {
              const e = new Error(`Tourist sonar timeout after ${params.timeoutMs}ms`)
              e.name = 'AbortError'
              reject(e)
            }, params.timeoutMs)
          ),
        ])
      : await providerCallPromise

    const responseTimeMs = nowMs() - started
    let textForRow = text
    let mergeExtras: Record<string, unknown> = { ...(aiResponseExtras ?? {}) }
    if (typeof text === 'string' && text.length && transformPersist) {
      const t = transformPersist(text)
      textForRow = t.storedResponseText ?? text
      mergeExtras = { ...mergeExtras, ...(t.aiResponseExtras ?? {}) }
    } else if (storedResponseText !== undefined) {
      textForRow = storedResponseText
    }

    const rowPrimary = {
      session_id: sessionId,
      ai_name: provider,
      model_name: model,
      response_text: textForRow,
      response_time_ms: responseTimeMs,
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      total_tokens: usage.totalTokens,
      error_text: null,
      ...mergeExtras,
    }
    const rowFallback = {
      session_id: sessionId,
      ai_name: provider,
      model_name: model,
      response_text: textForRow,
    }

    if (sessionId) {
      await insertWithFallback(supabase, 'ai_responses', rowPrimary, rowFallback)
      await insertWithFallback(
        supabase,
        'model_cost_logs',
        {
          session_id: sessionId,
          ai_name: provider,
          model_name: model,
          prompt_tokens: usage.promptTokens,
          completion_tokens: usage.completionTokens,
          total_tokens: usage.totalTokens,
          response_time_ms: responseTimeMs,
          cost_usd: 0,
        },
        {
          session_id: sessionId,
          model_name: model,
          total_tokens: usage.totalTokens,
        }
      )
      if (saveCompareArtifacts) {
        await saveCompareArtifactsRows(supabase, sessionId, provider, text, responseTimeMs, null)
      }
    }

    const costUsd = usage.costUsd ?? null
    const toolFeeUsd = usage.toolFeeUsd ?? null
    // OpenAI search-api fee is an explicit estimate (no call-count field).
    const toolFeeIsEstimated =
      typeof toolFeeUsd === 'number' && provider === 'openai' && /search/i.test(model)
    recordProviderCost({
      costUsd: typeof costUsd === 'number' || typeof toolFeeUsd === 'number'
        ? (costUsd ?? 0) + (toolFeeUsd ?? 0)
        : null,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
    })

    return {
      // Runtime value is the exact provider passed in (core or opt-in). Cast to
      // keep RouterResult core-typed; opt-in callers don't consume `.provider`.
      provider: provider as AiProviderName,
      model,
      text,
      responseTimeMs,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      costUsd,
      costInUsdTicks: usage.costInUsdTicks ?? null,
      serverSideToolsUsed: usage.serverSideToolsUsed ?? null,
      toolFeeUsd,
      toolFeeIsEstimated,
      thoughtsTokenCount:
        typeof (usage as { thoughtsTokenCount?: unknown }).thoughtsTokenCount === 'number'
          ? (usage as { thoughtsTokenCount?: number }).thoughtsTokenCount!
          : null,
      finishReason: finishReason ?? null,
    }
  } catch (e: any) {
    const responseTimeMs = nowMs() - started
    const error = e?.message ? String(e.message) : 'Unknown error'

    if (sessionId) {
      await insertWithFallback(
        supabase,
        'ai_responses',
        {
          session_id: sessionId,
          ai_name: provider,
          model_name: model,
          response_text: null,
          response_time_ms: responseTimeMs,
          prompt_tokens: null,
          completion_tokens: null,
          total_tokens: null,
          error_text: error,
        },
        {
          session_id: sessionId,
          ai_name: provider,
          model_name: model,
          response_text: `ERROR: ${error}`,
        }
      )

      await insertWithFallback(
        supabase,
        'model_cost_logs',
        {
          session_id: sessionId,
          ai_name: provider,
          model_name: model,
          prompt_tokens: null,
          completion_tokens: null,
          total_tokens: null,
          response_time_ms: responseTimeMs,
          cost_usd: 0,
          error_text: error,
        },
        {
          session_id: sessionId,
          model_name: model,
        }
      )
      if (saveCompareArtifacts) {
        await saveCompareArtifactsRows(supabase, sessionId, provider, null, responseTimeMs, error)
      }
    }

    return {
      // See note on the success-path return above: cast keeps RouterResult core.
      provider: provider as AiProviderName,
      model,
      text: null,
      responseTimeMs,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      error,
    }
  }
}

export async function* iterateCompareProviderResults(input: {
  prompt: string
  /** Ignored when getSystemPrompt is set */
  systemPrompt?: string
  /** Overrides systemPrompt when provided (one system string per AI). */
  getSystemPrompt?: (provider: AiProviderName) => string
  providers: AiProviderName[]
  sessionId: string
  supabaseAccessToken?: string
  /** Service-role client for server-side persistence (bypasses RLS). */
  persistSupabase?: SupabaseClient
  saveCompareArtifacts?: boolean
  temperature?: number
  maxCompletionTokens?: number
  /** Prior Compare turns (capped to last 10 user exchanges server-side). */
  conversationHistory?: CompareConversationMessage[]
}): AsyncGenerator<RouterResult, void, unknown> {
  const providers = uniqueProviders(input.providers)
  const authSupabase = getAuthedSupabase(input.supabaseAccessToken)
  const persistSupabase = input.persistSupabase ?? authSupabase
  const userId = input.supabaseAccessToken ? await getUserIdFromToken(authSupabase) : null

  const resolveSystemPrompt = (provider: AiProviderName) => {
    if (input.getSystemPrompt) return input.getSystemPrompt(provider)
    if (input.systemPrompt != null && input.systemPrompt !== '') return input.systemPrompt
    throw new Error('iterateCompareProviderResults: provide systemPrompt or getSystemPrompt')
  }

  const history = input.conversationHistory?.slice(-10) ?? []

  const inflight = new Map(
    providers.map((provider) => {
      const chatMessages =
        history.length > 0
          ? buildCompareChatMessagesForProvider(history, provider, input.prompt)
          : undefined
      const p = runSingleAiProvider({
        supabase: persistSupabase,
        authSupabase,
        sessionId: input.sessionId,
        userId,
        provider,
        prompt: input.prompt,
        systemPrompt: resolveSystemPrompt(provider),
        supabaseAccessToken: input.supabaseAccessToken,
        saveCompareArtifacts: input.saveCompareArtifacts,
        temperature: input.temperature,
        maxCompletionTokens: input.maxCompletionTokens,
        chatMessages,
      })
      return [provider, p] as const
    })
  )

  while (inflight.size) {
    const next = await Promise.race(
      [...inflight.entries()].map(([provider, pr]) => pr.then((r) => ({ provider, r })))
    )
    inflight.delete(next.provider)
    yield next.r
  }
}

export async function routeAI(input: RouterInput) {
  const providers = uniqueProviders(input.providers)
  const supabase = getAuthedSupabase(input.supabaseAccessToken)

  const userId = input.supabaseAccessToken ? await getUserIdFromToken(supabase) : null

  const { data: sessionRow } = await supabase
    .from('sessions')
    .insert([{ mode: 'router', prompt: input.prompt }])
    .select()
    .single()
  const sessionId = sessionRow?.id ?? null

  const settled = await Promise.allSettled(
    providers.map((provider) =>
      runSingleAiProvider({
        supabase,
        sessionId,
        userId,
        provider,
        prompt: input.prompt,
        systemPrompt: input.systemPrompt,
        supabaseAccessToken: input.supabaseAccessToken,
      })
    )
  )

  const results = settled.map((r, idx) => {
    const provider = providers[idx]
    const model = MODEL_BY_PROVIDER[provider]

    if (r.status === 'fulfilled') return r.value

    return {
      provider,
      model,
      text: null,
      responseTimeMs: 0,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      error: r.reason ? String(r.reason) : 'Unknown error',
    } satisfies RouterResult
  })

  return { sessionId, results }
}

