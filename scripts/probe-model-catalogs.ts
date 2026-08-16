/**
 * READ-ONLY catalog probe: lists available model IDs from each provider's
 * free /models endpoint (no inference cost). Used to map the official
 * 40-model league roster to actually-wired model strings.
 *
 * Run: npx tsx scripts/probe-model-catalogs.ts
 */

const KEEP =
  /gpt-5|gpt-4o|o4-|search|claude|gemini|grok|qwen|deepseek|kimi|moonshot|glm|minimax|mistral|command|cohere|nemotron|llama|nova|phi|ernie|seed|mimo|sonar/i

async function listModels(name: string, url: string, headers: Record<string, string>, pick: (j: any) => string[]) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) })
    if (!res.ok) {
      console.log(`\n### ${name}: HTTP ${res.status}`)
      return
    }
    const ids = pick(await res.json()).filter((id) => KEEP.test(id))
    console.log(`\n### ${name} (${ids.length} relevant)`)
    for (const id of ids.sort()) console.log('  ', id)
  } catch (e) {
    console.log(`\n### ${name}: FAILED ${e instanceof Error ? e.message : e}`)
  }
}

async function main() {
  await listModels(
    'OpenAI',
    'https://api.openai.com/v1/models',
    { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    (j) => (j?.data ?? []).map((m: any) => m.id),
  )
  await listModels(
    'Anthropic',
    'https://api.anthropic.com/v1/models?limit=100',
    { 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
    (j) => (j?.data ?? []).map((m: any) => m.id),
  )
  await listModels(
    'Google',
    `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GOOGLE_API_KEY}&pageSize=200`,
    {},
    (j) => (j?.models ?? []).map((m: any) => String(m.name).replace(/^models\//, '')),
  )
  await listModels(
    'xAI',
    'https://api.x.ai/v1/models',
    { Authorization: `Bearer ${process.env.XAI_API_KEY}` },
    (j) => (j?.data ?? []).map((m: any) => m.id),
  )
  await listModels(
    'OpenRouter',
    'https://openrouter.ai/api/v1/models',
    { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
    (j) => (j?.data ?? []).map((m: any) => m.id),
  )
}

main()
