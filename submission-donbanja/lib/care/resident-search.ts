/**
 * Perplexity search helper for resident mode.
 *
 * Replicates the DEEP module's Perplexity call PATTERN (OpenAI-compatible chat
 * against api.perplexity.ai, model `sonar`, key from PERPLEXITY_API_KEY) in a
 * fresh, self-contained helper. Does NOT import from the DEEP module.
 *
 * askPerplexity() returns the answer text plus source URLs (citations).
 * Never throws — on any failure it returns empty text + empty citations so
 * callers can degrade gracefully.
 */

const PPLX_URL = 'https://api.perplexity.ai/chat/completions'
const PPLX_MODEL = 'sonar'

export interface PerplexityAnswer {
  text: string
  citations: string[]
}

interface AskOptions {
  systemPrompt?: string
  maxTokens?: number
  timeoutMs?: number
}

export async function askPerplexity(prompt: string, opts: AskOptions = {}): Promise<PerplexityAnswer> {
  const apiKey = process.env.PERPLEXITY_API_KEY
  if (!apiKey || !prompt.trim()) {
    return { text: '', citations: [] }
  }

  const messages: Array<{ role: string; content: string }> = []
  if (opts.systemPrompt) messages.push({ role: 'system', content: opts.systemPrompt })
  messages.push({ role: 'user', content: prompt })

  try {
    const res = await fetch(PPLX_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: PPLX_MODEL,
        messages,
        max_tokens: opts.maxTokens ?? 700,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    })

    if (!res.ok) {
      console.error(`[resident-search] perplexity http ${res.status}`)
      return { text: '', citations: [] }
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      citations?: unknown
      error?: { message?: string }
    }
    if (json.error) {
      console.error('[resident-search] perplexity error:', json.error.message)
      return { text: '', citations: [] }
    }

    const text = json.choices?.[0]?.message?.content ?? ''
    const citations = Array.isArray(json.citations)
      ? json.citations.filter((c): c is string => typeof c === 'string')
      : []

    return { text, citations }
  } catch (e) {
    console.error('[resident-search] perplexity call failed:', e instanceof Error ? e.message : e)
    return { text: '', citations: [] }
  }
}
