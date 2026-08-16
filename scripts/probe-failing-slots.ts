/**
 * One-off probe for the 4 roster slots that failed verify-roster-ping:
 *  - gemini-3.6-flash / gemini-3.5-flash-lite: is thinkingConfig:budget0 the problem?
 *  - gemini-3.6-flash + grounding: which tool shape is accepted?
 *  - grok live search: xAI says search_parameters is deprecated -> probe the
 *    Agent Tools API (POST /v1/responses with tools:[{type:'web_search'}]).
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/probe-failing-slots.ts
 */

async function gemini(model: string, opts: { thinking?: boolean; tools?: Record<string, unknown>[] }) {
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: 'Reply with exactly one word: OK' }] }],
    generationConfig: {
      maxOutputTokens: 200,
      ...(opts.thinking ? {} : { thinkingConfig: { thinkingBudget: 0 } }),
    },
    ...(opts.tools ? { tools: opts.tools } : {}),
  }
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GOOGLE_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  )
  const text = await res.text()
  const snippet = res.ok ? 'OK' : text.slice(0, 200)
  console.log(`gemini ${model} thinking=${!!opts.thinking} tools=${JSON.stringify(opts.tools ?? null)} -> HTTP ${res.status} ${snippet}`)
}

async function xaiResponses(model: string) {
  const res = await fetch('https://api.x.ai/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      input: 'Reply with exactly one word: OK',
      tools: [{ type: 'web_search' }],
      max_output_tokens: 200,
    }),
  })
  const text = await res.text()
  console.log(`xai /v1/responses ${model} web_search -> HTTP ${res.status} ${text.slice(0, 300)}`)
}

async function main() {
  await gemini('gemini-3.6-flash', { thinking: true })
  await gemini('gemini-3.5-flash-lite', { thinking: true })
  await gemini('gemini-3.6-flash', { thinking: true, tools: [{ google_search: {} }] })
  await gemini('gemini-3.6-flash', { thinking: true, tools: [{ googleSearch: {} }] })
  await xaiResponses('grok-4.6')
}

main()
