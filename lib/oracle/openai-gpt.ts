/**
 * GPT-4.1 oracle synthesizer (OpenAI-compatible). Omit temperature/top_p/top_k.
 */
export async function oracleGptCompletion({
  model,
  systemPrompt,
  userPrompt,
  maxTokens,
}: {
  model: string
  systemPrompt: string
  userPrompt: string
  maxTokens: number
}) {
  const apiKey = process.env.OPENAI_API_KEY ?? null
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured.')
  }

  const todayStr = new Date().toISOString().split('T')[0]
  const datedSystemPrompt = `Today's date is ${todayStr}.\n\n${systemPrompt}`

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: datedSystemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`OpenAI oracle ${res.status}${text ? ` - ${text.slice(0, 400)}` : ''}`)
  }

  const json: any = await res.json()
  const content = json?.choices?.[0]?.message?.content ?? null
  const u = json?.usage ?? {}

  const promptTokens = typeof u.prompt_tokens === 'number' ? u.prompt_tokens : null
  const completionTokens = typeof u.completion_tokens === 'number' ? u.completion_tokens : null

  return {
    text: typeof content === 'string' ? content : null,
    promptTokens,
    completionTokens,
  }
}
