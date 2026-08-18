/**
 * STEP 1 diagnostic: call each Scout roster entry with the real league scout
 * prompt and report WHY direction ends up null (API error / empty / parse fail /
 * intentional DB nulling — checked separately in orchestrator).
 *
 * Run:
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/diagnose-scout-tier.ts
 */
import { supabaseAdmin } from '../lib/supabase/server'
import { runSingleAiProvider } from '../lib/ai/router'
import { callPlatformModel } from '../lib/ai/platform-providers'
import { getRoster, type RosterEntry } from '../lib/league/roster'
import { fetchDataPacket } from '../lib/league/market-data'
import { getResearchPacket } from '../lib/league/research'

const PREDICTION_SYSTEM_PROMPT = `You are an independent forecasting model in a prediction league. You answer ALONE; you never see any other model's answer. You may reason internally, but your VISIBLE output MUST be exactly ONE line of strict JSON and nothing else — no markdown, no code fences, no preamble, no trailing text.

Output schema (all keys required):
{"direction":"up|down|flat|abstain","probability":<integer 0-100>,"rationale":"<one line, max 200 chars>"}

- direction: your single best call for how the proposition resolves. Use "flat" only if you genuinely expect ~no change. Use "abstain" ONLY if you truly cannot form any view — abstaining is never penalized, but a real call is preferred.
- probability: your confidence in the stated direction, integer 0-100.
- rationale: one concise sentence of reasoning or a key citation.
Return the JSON object only.`

function buildScoutPrompt(round: {
  proposition_text: string
  instrument: string
  category: string
  horizon: string
  resolution_rule: string
  resolves_at: string
}): string {
  const block = [
    `Proposition: ${round.proposition_text}`,
    `Instrument: ${round.instrument}`,
    `Category: ${round.category}`,
    `Horizon: ${round.horizon}`,
    `Resolution rule: ${round.resolution_rule}`,
    `Resolves at (UTC): ${round.resolves_at}`,
  ].join('\n')
  return [
    block,
    '',
    'Use live web search to gather the most recent price/context for this instrument, then make a directional call and cite your key source in the rationale.',
    'Respond with the single-line JSON object described in the system message.',
  ].join('\n')
}

function parsePrediction(text: string | null): {
  direction: 'up' | 'down' | 'flat' | null
  probability: number | null
  rationale: string | null
} | null {
  if (!text) return null
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>
    const dirRaw = typeof obj.direction === 'string' ? obj.direction.trim().toLowerCase() : ''
    const direction =
      dirRaw === 'up' || dirRaw === 'down' || dirRaw === 'flat' ? (dirRaw as 'up' | 'down' | 'flat') : null
    let probability: number | null = null
    const p = Number(obj.probability)
    if (Number.isFinite(p)) probability = Math.max(0, Math.min(100, Math.round(p)))
    const rationale =
      typeof obj.rationale === 'string' && obj.rationale.trim().length
        ? obj.rationale.trim().slice(0, 500)
        : null
    return { direction, probability, rationale }
  } catch {
    return null
  }
}

function searchMechanism(entry: RosterEntry): string {
  if (entry.caller.kind === 'platform') return 'You.com Research API (POST /v1/research)'
  const m = entry.caller.modelOverride ?? entry.model_id
  switch (entry.caller.provider) {
    case 'openai':
      return `OpenAI native search model (${m})`
    case 'google':
      return entry.caller.searchTool ? `Google Gemini grounding (${m})` : `Google (${m})`
    case 'xai':
      return entry.caller.searchTool ? `xAI Agent Tools /v1/responses web_search (${m})` : `xAI chat (${m})`
    case 'anthropic':
      return entry.caller.searchTool ? `Anthropic web_search tool (${m})` : `Anthropic (${m})`
    case 'perplexity':
      return `Perplexity live search (${m})`
    default:
      return entry.caller.provider
  }
}

async function callScout(entry: RosterEntry, userPrompt: string, timeoutMs: number) {
  const maxCompletionTokens = entry.maxCompletionTokens ?? 1600
  if (entry.caller.kind === 'core') {
    return runSingleAiProvider({
      supabase: supabaseAdmin,
      authSupabase: supabaseAdmin,
      sessionId: null,
      userId: null,
      provider: entry.caller.provider,
      prompt: userPrompt,
      systemPrompt: PREDICTION_SYSTEM_PROMPT,
      skipLanguageInjection: true,
      maxCompletionTokens,
      modelOverride: entry.caller.modelOverride,
      allowGeminiThinking: entry.caller.allowGeminiThinking,
      searchTool: entry.caller.searchTool,
      timeoutMs,
    })
  }
  return callPlatformModel({
    id: entry.caller.platformId,
    systemPrompt: PREDICTION_SYSTEM_PROMPT,
    userPrompt,
    maxCompletionTokens,
  })
}

function whyNull(params: {
  error?: string
  text: string | null
  parsed: ReturnType<typeof parsePrediction>
}): string {
  if (params.error) return `API error: ${params.error.slice(0, 200)}`
  if (!params.text?.trim()) return 'Empty response (no text returned)'
  if (!params.parsed) return 'Parse failure — response has no extractable JSON object'
  if (params.parsed.direction === null) {
    const raw = params.text.match(/\{[\s\S]*\}/)?.[0] ?? ''
    if (raw.includes('abstain')) return 'Parsed JSON but direction=abstain'
    return 'Parsed JSON but direction field missing/invalid'
  }
  return 'Would parse OK (orchestrator still forces DB direction=null for scout — separate bug)'
}

async function main() {
  const { data: round, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id, proposition_text, category, instrument, horizon, resolution_rule, resolves_at')
    .eq('instrument', 'AAPL')
    .eq('item_type', 'ranked')
    .order('opened_at', { ascending: false })
    .limit(1)
    .single()

  if (error || !round) {
    console.error('No AAPL round:', error?.message)
    process.exit(1)
  }

  const scout = getRoster(['scout'])
  const userPrompt = buildScoutPrompt(round)
  console.log(`Round: ${round.id}`)
  console.log(`Scout models: ${scout.length}\n`)
  console.log('| model | search mechanism | status | parsed dir | why null |')
  console.log('|-------|------------------|--------|------------|----------|')

  for (const entry of scout) {
    const timeoutMs = entry.timeoutMs ?? 120_000
    const started = Date.now()
    const res = await callScout(entry, userPrompt, timeoutMs)
    const elapsed = ((Date.now() - started) / 1000).toFixed(1)
    const parsed = parsePrediction(res.text ?? null)
    const status = res.error ? 'ERROR' : res.text?.trim() ? 'OK' : 'EMPTY'
    const parsedDir = parsed?.direction ?? '—'
    const reason = whyNull({ error: res.error, text: res.text ?? null, parsed })
    console.log(
      `| ${entry.model_id} | ${searchMechanism(entry).slice(0, 40)} | ${status} (${elapsed}s) | ${parsedDir} | ${reason.slice(0, 80)} |`,
    )
    const preview = (res.text ?? '').trim().slice(0, 280).replace(/\n/g, ' ')
    if (preview) console.log(`  raw preview: ${preview}${(res.text?.length ?? 0) > 280 ? '…' : ''}`)
    console.log('')
  }

  // Show orchestrator behavior note
  console.log('\nNOTE: orchestrator.ts runOneModel sets usableDirection=null for ALL scout rows')
  console.log('even when parse succeeds — card always shows "no opinion" regardless of parse.')
}

main()
