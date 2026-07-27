import 'server-only'

/**
 * MOTIE-LOCAL DeepSeek chat helper — thinking-OFF debate statements.
 *
 * WHY THIS FILE EXISTS (bug it fixes): DeepSeek V4 (`deepseek-v4-pro`) has
 * thinking ENABLED BY DEFAULT, and its reasoning tokens are drawn from the SAME
 * completion budget as the visible answer. On a debate turn capped at ~1600
 * tokens the model spent that budget on the hidden reasoning pass, so its
 * `message.content` came back truncated mid-sentence — and, as the prompt grew
 * with each round, eventually empty. Observed live: round 2 cut off at
 * "…전면 1", rounds 3-5 produced nothing at all. Same root cause we already
 * fixed for exaone.
 *
 * WHY NOT FIX IT IN THE SHARED ROUTER: lib/ai/router.ts's
 * callOpenAICompatibleChat sends only model/messages/temperature/max_tokens and
 * exposes no pass-through for provider-specific body fields (its one exception,
 * `allowGeminiThinking`, is gemini-only). Adding one would change a file shared
 * with the jeju tree. So this file duplicates the minimal OpenAI-compatible
 * fetch shape for DeepSeek alone, exactly as lib/motie/local-providers.ts does
 * for solar/exaone. Nothing here is imported by lib/jeju/*, lib/festival/*, or
 * lib/ai/router.ts, and lib/ai/router.ts is never modified.
 *
 * SCOPE: called from app/api/gunpo/deliberate/route.ts's callProvider (SERIAL
 * debate opening + per-round turns) and from lib/motie/deep.ts runOneVote
 * (ballot only). DeepSeek's open-brief parallel analyses still go through
 * runSingleAiProvider with ANALYSIS_MAX_TOKENS (8000) and thinking ON.
 *
 * PARAMETER SHAPE (verified against DeepSeek's API docs, NOT invented): V4
 * collapses the old chat/reasoner split into a request parameter —
 * `{"thinking": {"type": "disabled"}}`. The `extra_body` wrapper seen in the
 * docs' Python samples is an OpenAI-SDK convenience for passing non-OpenAI
 * fields; over raw REST the object goes at the TOP LEVEL of the JSON body, as
 * the docs' own curl example shows. (Same SDK-vs-REST distinction already
 * documented for exaone's chat_template_kwargs.)
 */

/** DeepSeek's OpenAI-compatible base URL (same one lib/ai/router.ts uses). */
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'

/** Fallback model when the caller passes no override. Mirrors MOTIE_FLAGSHIP_BY_PROVIDER.deepseek. */
const DEFAULT_MODEL = 'deepseek-v4-pro'

/**
 * Floor for a debate statement's completion budget. With thinking OFF the
 * visible answer is the ONLY consumer of this budget, so the shared 1600-token
 * turn cap would already be enough; the floor is belt-and-braces headroom so a
 * long Korean turn can never clip again.
 */
export const MOTIE_DEEPSEEK_DEBATE_MIN_TOKENS = 3000

/**
 * A slow-but-not-hung ceiling. Without it a stalled DeepSeek call would block
 * the SERIAL round loop until the route's own maxDuration killed the whole
 * stage; with it the seat fails visibly and the round continues.
 */
const DEEPSEEK_TIMEOUT_MS = 120_000

/**
 * Copied verbatim from lib/ai/router.ts's private
 * DEEPSEEK_MATCH_EXACT_LANGUAGE_REINFORCEMENT (not exported there). The router
 * prepends this to every DeepSeek prompt containing non-Latin text — which is
 * every motie prompt — so bypassing the router would silently drop it.
 * Replicated to keep this path's language behavior equivalent.
 */
const DEEPSEEK_MATCH_EXACT_LANGUAGE_REINFORCEMENT =
  "[CRITICAL] You MUST respond in the EXACT same language as the user's message. Match the language exactly. This is mandatory."

/** Copied verbatim from lib/ai/router.ts's private UNIVERSAL_LANGUAGE_PROMPT_RULE, same reason. */
const UNIVERSAL_LANGUAGE_PROMPT_RULE = `IMPORTANT: Always respond in the same language the user wrote their message in. If the user writes in Japanese, respond in Japanese. If in French, respond in French. If in English, respond in English. Match the user's language exactly.`

export type MotieDeepseekResult = {
  text: string | null
  error?: string
}

/**
 * Calls DeepSeek with thinking DISABLED and returns only
 * `choices[0].message.content`. Never throws — failures come back as
 * `{ text: null, error }`, matching callMotieLocalProvider's contract so the
 * route's callProvider can treat every provider identically.
 *
 * Logs the usage breakdown (including `reasoning_tokens` when the API reports
 * it) so the thinking-off behavior stays verifiable in the server log: with
 * thinking disabled that figure should be 0 or absent, and completion_tokens
 * should sit comfortably under the cap rather than pinned to it.
 */
export async function callMotieDeepseekChat(params: {
  systemPrompt: string
  userPrompt: string
  maxCompletionTokens: number
  model?: string
  temperature?: number
}): Promise<MotieDeepseekResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) return { text: null, error: 'DEEPSEEK_API_KEY is not set' }

  const model = params.model ?? DEFAULT_MODEL
  const maxTokens = Math.max(params.maxCompletionTokens, MOTIE_DEEPSEEK_DEBATE_MIN_TOKENS)

  const payload: Record<string, unknown> = {
    model,
    messages: [
      ...(params.systemPrompt ? [{ role: 'system', content: params.systemPrompt }] : []),
      {
        role: 'user',
        content: [
          DEEPSEEK_MATCH_EXACT_LANGUAGE_REINFORCEMENT,
          UNIVERSAL_LANGUAGE_PROMPT_RULE,
          params.userPrompt,
        ].join('\n\n'),
      },
    ],
    max_tokens: maxTokens,
    // The fix. Top-level (raw REST), per DeepSeek's own curl example.
    thinking: { type: 'disabled' },
  }
  if (typeof params.temperature === 'number' && !Number.isNaN(params.temperature)) {
    payload.temperature = params.temperature
  }

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, DEEPSEEK_TIMEOUT_MS)

  try {
    const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return {
        text: null,
        error: `HTTP ${res.status} ${res.statusText}${errText ? ` - ${errText}` : ''}`,
      }
    }

    const json: any = await res.json()
    const usage = json?.usage ?? {}
    console.log(
      `[motie/deepseek] model=${model} max_tokens=${maxTokens} thinking=disabled` +
        ` prompt=${usage?.prompt_tokens ?? '?'} completion=${usage?.completion_tokens ?? '?'}` +
        ` reasoning=${usage?.completion_tokens_details?.reasoning_tokens ?? 0}` +
        ` finish=${json?.choices?.[0]?.finish_reason ?? '?'}`
    )

    const content = json?.choices?.[0]?.message?.content
    const text = typeof content === 'string' ? content : null
    if (!text || !text.trim()) {
      return { text: null, error: 'deepseek 응답의 content가 비어 있습니다.' }
    }
    return { text }
  } catch (e: unknown) {
    if (timedOut) {
      return { text: null, error: `deepseek 응답 시간 초과 (${DEEPSEEK_TIMEOUT_MS}ms 이내 응답 없음)` }
    }
    return { text: null, error: e instanceof Error ? e.message : 'unknown error calling deepseek' }
  } finally {
    clearTimeout(timer)
  }
}
