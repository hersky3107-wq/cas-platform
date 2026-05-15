import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { decryptText } from '@/lib/db/crypto'

export type AiProviderName =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'xai'
  | 'deepseek'
  | 'mistral'

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
  provider: AiProviderName
  model: string
  text: string | null
  responseTimeMs: number
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
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

export const MODEL_BY_PROVIDER: Record<AiProviderName, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-6',
  google: 'gemini-2.5-flash',
  xai: 'grok-3',
  deepseek: 'deepseek-chat',
  mistral: 'mistral-large-latest',
}

/** Model used when an Anthropic task is routed for maximum depth (DEEP mode orchestration output). */
export const ANTHROPIC_DEEP_TASK_MODEL = 'claude-sonnet-4-6'

function uniqueProviders(providers: AiProviderName[]) {
  return Array.from(new Set(providers))
}

function nowMs() {
  return Date.now()
}

function getEnvKey(provider: AiProviderName) {
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
  provider: AiProviderName
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
}: {
  promptTokens?: number | null
  completionTokens?: number | null
  totalTokens?: number | null
}) {
  const pt = typeof promptTokens === 'number' ? promptTokens : null
  const ct = typeof completionTokens === 'number' ? completionTokens : null
  const tt =
    typeof totalTokens === 'number'
      ? totalTokens
      : pt != null && ct != null
        ? pt + ct
        : null
  return { promptTokens: pt, completionTokens: ct, totalTokens: tt }
}

async function callOpenAICompatibleChat({
  baseUrl,
  apiKey,
  model,
  prompt,
  systemPrompt,
  temperature,
  maxCompletionTokens,
  chatMessages,
}: {
  baseUrl: string
  apiKey: string
  model: string
  prompt: string
  systemPrompt: string
  temperature?: number
  maxCompletionTokens?: number
  chatMessages?: CompareChatMessage[]
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
  }
  if (typeof temperature === 'number' && !Number.isNaN(temperature)) {
    payload.temperature = temperature
  }
  if (typeof maxCompletionTokens === 'number' && maxCompletionTokens > 0) {
    payload.max_tokens = maxCompletionTokens
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
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

  return {
    text: typeof content === 'string' ? content : null,
    usage: normalizeTokens({
      promptTokens: usage?.prompt_tokens,
      completionTokens: usage?.completion_tokens,
      totalTokens: usage?.total_tokens,
    }),
  }
}

async function callAnthropic({
  apiKey,
  model,
  prompt,
  systemPrompt,
  temperature,
  maxCompletionTokens,
  chatMessages,
}: {
  apiKey: string
  model: string
  prompt: string
  systemPrompt: string
  temperature?: number
  maxCompletionTokens?: number
  chatMessages?: CompareChatMessage[]
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

  const res = await fetch('https://api.anthropic.com/v1/messages', {
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

  const json: any = await res.json()
  const text = Array.isArray(json?.content)
    ? json.content.map((b: any) => b?.text).filter(Boolean).join('\n')
    : null

  return {
    text: typeof text === 'string' && text.length ? text : null,
    usage: normalizeTokens({
      promptTokens: json?.usage?.input_tokens,
      completionTokens: json?.usage?.output_tokens,
      totalTokens:
        typeof json?.usage?.input_tokens === 'number' &&
        typeof json?.usage?.output_tokens === 'number'
          ? json.usage.input_tokens + json.usage.output_tokens
          : null,
    }),
  }
}

type GeminiUsageMeta = {
  promptTokenCount?: number
  candidatesTokenCount?: number
  totalTokenCount?: number
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
    if (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string') {
      out += (p as { text: string }).text
    }
  }
  return out
}

async function callGoogleGemini({
  apiKey,
  model,
  prompt,
  systemPrompt,
  temperature,
  maxCompletionTokens,
  chatMessages,
}: {
  apiKey: string
  model: string
  prompt: string
  systemPrompt: string
  temperature?: number
  maxCompletionTokens?: number
  chatMessages?: CompareChatMessage[]
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

  geminiBody.generationConfig = {
    ...generationConfig,
    thinkingConfig: { thinkingBudget: 0 },
  }

  const res = await fetch(url, {
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

  const applyParsedChunk = (parsed: unknown) => {
    const piece = extractGeminiResponseText(parsed)
    if (piece) aggregatedText += piece
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
    usage: normalizeTokens({
      promptTokens: u?.promptTokenCount,
      completionTokens: u?.candidatesTokenCount,
      totalTokens: u?.totalTokenCount,
    }),
  }
}

async function callProvider({
  provider,
  apiKey,
  model: modelParam,
  prompt,
  systemPrompt,
  temperature,
  maxCompletionTokens,
  chatMessages,
}: {
  provider: AiProviderName
  apiKey: string
  /** Defaults to MODEL_BY_PROVIDER[provider]. */
  model?: string
  prompt: string
  systemPrompt: string
  temperature?: number
  maxCompletionTokens?: number
  chatMessages?: CompareChatMessage[]
}) {
  const model = modelParam ?? MODEL_BY_PROVIDER[provider]
  const chatOpts = { chatMessages }

  if (provider === 'openai') {
    const { text, usage } = await callOpenAICompatibleChat({
      baseUrl: 'https://api.openai.com/v1',
      apiKey,
      model,
      prompt,
      systemPrompt,
      temperature,
      maxCompletionTokens,
      ...chatOpts,
    })
    return { model, text, usage }
  }

  if (provider === 'xai') {
    const { text, usage } = await callOpenAICompatibleChat({
      baseUrl: 'https://api.x.ai/v1',
      apiKey,
      model,
      prompt,
      systemPrompt,
      temperature,
      maxCompletionTokens,
      ...chatOpts,
    })
    return { model, text, usage }
  }

  if (provider === 'deepseek') {
    const { text, usage } = await callOpenAICompatibleChat({
      baseUrl: 'https://api.deepseek.com',
      apiKey,
      model,
      prompt,
      systemPrompt,
      temperature,
      maxCompletionTokens,
      ...chatOpts,
    })
    return { model, text, usage }
  }

  if (provider === 'mistral') {
    const { text, usage } = await callOpenAICompatibleChat({
      baseUrl: 'https://api.mistral.ai/v1',
      apiKey,
      model,
      prompt,
      systemPrompt,
      temperature,
      maxCompletionTokens,
      ...chatOpts,
    })
    return { model, text, usage }
  }

  if (provider === 'anthropic') {
    const { text, usage } = await callAnthropic({
      apiKey,
      model,
      prompt,
      systemPrompt,
      temperature,
      maxCompletionTokens,
      ...chatOpts,
    })
    return { model, text, usage }
  }

  const { text, usage } = await callGoogleGemini({
    apiKey,
    model,
    prompt,
    systemPrompt,
    temperature,
    maxCompletionTokens,
    ...chatOpts,
  })
  return { model, text, usage }
}

export type RunSingleProviderParams = {
  supabase: SupabaseClient
  sessionId: string | null
  userId: string | null
  provider: AiProviderName
  prompt: string
  systemPrompt: string
  supabaseAccessToken?: string
  /** Extra Day-2 rows for compare mode: scores + debate_logs assistant entries */
  saveCompareArtifacts?: boolean
  /** Sampling temperature (e.g. 0.1–1); omit for provider defaults */
  temperature?: number
  /** When set (e.g. 300), caps completion length via each provider API. */
  maxCompletionTokens?: number
  /**
   * Overrides the default model for this provider (e.g. DEEP mode: Anthropic uses Opus for assigned parts).
   */
  modelOverride?: string
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
}

async function saveCompareArtifactsRows(
  supabase: SupabaseClient,
  sessionId: string,
  provider: AiProviderName,
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
    sessionId,
    userId,
    provider,
    prompt,
    systemPrompt,
    supabaseAccessToken,
    saveCompareArtifacts,
    temperature,
    maxCompletionTokens,
    modelOverride,
    storedResponseText,
    aiResponseExtras,
    transformPersist,
    chatMessages,
  } = params

  const started = nowMs()
  const model = modelOverride ?? MODEL_BY_PROVIDER[provider]

  try {
    const byok =
      userId && supabaseAccessToken
        ? await getUserByokKey({ supabase, userId, provider })
        : null
    const platform = getEnvKey(provider)
    const apiKey = byok ?? platform

    if (!apiKey) {
      throw new Error(`Missing API key for ${provider}. Set env var or save BYOK in user_api_keys.`)
    }

    const { text, usage } = await callProvider({
      provider,
      apiKey,
      model,
      prompt,
      systemPrompt,
      temperature,
      maxCompletionTokens,
      chatMessages,
    })

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

    return {
      provider,
      model,
      text,
      responseTimeMs,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
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
      provider,
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
  saveCompareArtifacts?: boolean
  temperature?: number
  maxCompletionTokens?: number
  /** Prior Compare turns (capped to last 10 user exchanges server-side). */
  conversationHistory?: CompareConversationMessage[]
}): AsyncGenerator<RouterResult, void, unknown> {
  const providers = uniqueProviders(input.providers)
  const supabase = getAuthedSupabase(input.supabaseAccessToken)
  const userId = input.supabaseAccessToken ? await getUserIdFromToken(supabase) : null

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
        supabase,
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

