import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import { runSingleAiProvider } from '@/lib/ai/router'

/**
 * AI Prediction League — dynamic RESEARCH step (server engine only).
 *
 * Per round, BEFORE the roster fans out:
 *   1. A "research director" model (cheap, fast: gemini-3.5-flash) reads the
 *      proposition and decides which recent facts are needed, emitting a
 *      small set of web-search queries.
 *   2. Each query is run through Perplexity Sonar (already the wired search
 *      provider) and compressed into a short factual brief.
 *   3. The findings are assembled into ONE shared RESEARCH PACKET that is
 *      injected IDENTICALLY into the closed-book tiers (premier/challenger/
 *      world) — same inputs for all of them keeps the league fair. The Scout
 *      tier never sees this packet: independent live search is Scout's whole
 *      experiment ("does self-directed search beat reasoning from a fixed
 *      packet?").
 *
 * COST CONTROL: the packet is cached per (instrument, horizon, 6-hour UTC
 * time bucket) — repeated generations/views of the same round in the same
 * bucket reuse it at cost 0. The cache is durable (league_research_packets
 * table, see migration 20260816000002) with an in-process fallback so dev
 * works before the migration is applied. The caller passes the remaining
 * kill-switch budget; below MIN_BUDGET_USD the step is skipped entirely and
 * the run degrades to the price-only prompt (previous behavior).
 */

export type ResearchFinding = { query: string; summary: string }

export type ResearchPacket = {
  /** True when a usable packet exists (cache hit or fresh fetch). */
  available: boolean
  /** True when served from cache (no spend this run). */
  cached: boolean
  cacheKey: string
  directorModel: string | null
  queries: string[]
  findings: ResearchFinding[]
  /** Prompt-ready block; '' when unavailable. */
  promptBlock: string
  /** USD spent assembling THIS packet (0 on cache hit). */
  costUsd: number
  error?: string
}

export type ResearchRoundInput = {
  instrument: string
  category: string
  proposition_text: string
  horizon: string
  resolution_rule: string
  resolves_at: string
}

const DIRECTOR_MODEL = 'gemini-3.5-flash'
const DIRECTOR_MAX_TOKENS = 500
const QUERY_MODEL = 'sonar'
const QUERY_MAX_TOKENS = 800
const MAX_QUERIES = 4
const MAX_FINDING_CHARS = 700
const MAX_BLOCK_CHARS = 3600
/** Below this remaining budget the whole research step is skipped. */
const MIN_BUDGET_USD = 0.05
/** Fallback list prices (USD per 1M tokens) for providers that report no billed cost. */
const DIRECTOR_PRICE = { inputPerMTokens: 0.3, outputPerMTokens: 2.5 }
const SONAR_PRICE = { inputPerMTokens: 1, outputPerMTokens: 1 }

/** In-process fallback cache (durable cache = league_research_packets table). */
const memoryCache = new Map<string, { packet: ResearchPacket; at: number }>()

/** 6-hour UTC bucket — a round re-generated within the bucket reuses research. */
function timeBucket(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(Math.floor(d.getUTCHours() / 6) * 6)}`
}

export function researchCacheKey(instrument: string, horizon: string, now = new Date()): string {
  return `rp_v1|${instrument}|${horizon}|${timeBucket(now)}`
}

function estimateUsd(
  price: { inputPerMTokens: number; outputPerMTokens: number },
  promptTokens: number | null,
  completionTokens: number | null,
): number {
  return (
    (((promptTokens ?? 0) / 1_000_000) * price.inputPerMTokens) +
    (((completionTokens ?? 0) / 1_000_000) * price.outputPerMTokens)
  )
}

async function readDurableCache(cacheKey: string): Promise<ResearchPacket | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('league_research_packets')
      .select('payload')
      .eq('cache_key', cacheKey)
      .maybeSingle()
    if (error) {
      // A failure is NOT a miss: a miss returns no row with no error. Log
      // loudly so a broken durable cache (missing table, RLS, network) is
      // visible instead of silently re-paying research per process.
      console.error(
        `[league/research] league_research_packets cache-read FAILED (not a cache miss), key=${cacheKey}: ${error.message}`,
      )
      return null
    }
    const payload = data?.payload as ResearchPacket | undefined
    return payload && payload.available ? { ...payload, cached: true, costUsd: 0 } : null
  } catch (e) {
    console.error(
      `[league/research] league_research_packets cache-read THREW, key=${cacheKey}: ${e instanceof Error ? e.message : String(e)}`,
    )
    return null
  }
}

async function writeDurableCache(cacheKey: string, round: ResearchRoundInput, packet: ResearchPacket): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from('league_research_packets').upsert(
      {
        cache_key: cacheKey,
        instrument: round.instrument,
        horizon: round.horizon,
        payload: packet,
        cost_usd: packet.costUsd,
      },
      { onConflict: 'cache_key' },
    )
    if (error) {
      // The packet was still returned to the caller and the in-process cache
      // holds it; but every OTHER server instance will re-pay for research.
      console.error(
        `[league/research] league_research_packets cache-write FAILED, key=${cacheKey}: ${error.message}`,
      )
    }
  } catch (e) {
    console.error(
      `[league/research] league_research_packets cache-write THREW, key=${cacheKey}: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
}

const DIRECTOR_PROMPT = `You are the research director for a prediction league. Decide what RECENT, verifiable information would most improve a forecast for the proposition below.

Output ONLY a JSON object, no markdown, no commentary:
{"queries":["...","..."]}

Rules:
- 3 to 4 focused web-search queries, in English, each targeting a DIFFERENT angle (latest price/drivers; recent news, earnings or events; analyst/expert expectations; key risks).
- Each query must be self-contained (include the instrument/topic name).
- Prefer recency: mention "latest" or the current month where relevant.`

async function runDirector(round: ResearchRoundInput): Promise<{ queries: string[]; costUsd: number; error?: string }> {
  const res = await runSingleAiProvider({
    supabase: supabaseAdmin,
    authSupabase: supabaseAdmin,
    sessionId: null,
    userId: null,
    provider: 'google',
    prompt: [
      `Proposition: ${round.proposition_text}`,
      `Instrument: ${round.instrument}`,
      `Category: ${round.category}`,
      `Horizon: ${round.horizon}`,
      `Resolution rule: ${round.resolution_rule}`,
      `Resolves at (UTC): ${round.resolves_at}`,
    ].join('\n'),
    systemPrompt: DIRECTOR_PROMPT,
    skipLanguageInjection: true,
    maxCompletionTokens: DIRECTOR_MAX_TOKENS,
    modelOverride: DIRECTOR_MODEL,
    timeoutMs: 45_000,
  })

  const costUsd =
    typeof res.costUsd === 'number'
      ? res.costUsd
      : estimateUsd(DIRECTOR_PRICE, res.promptTokens, res.completionTokens)

  if (res.error || !res.text) return { queries: [], costUsd, error: res.error ?? 'director returned no text' }

  const match = res.text.match(/\{[\s\S]*\}/)
  if (!match) return { queries: [], costUsd, error: 'director output was not JSON' }
  try {
    const obj = JSON.parse(match[0]) as { queries?: unknown }
    const queries = (Array.isArray(obj.queries) ? obj.queries : [])
      .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
      .map((q) => q.trim().slice(0, 300))
      .slice(0, MAX_QUERIES)
    if (!queries.length) return { queries: [], costUsd, error: 'director produced zero usable queries' }
    return { queries, costUsd }
  } catch {
    return { queries: [], costUsd, error: 'director JSON parse failed' }
  }
}

async function runQuery(round: ResearchRoundInput, query: string): Promise<{ summary: string | null; costUsd: number }> {
  const res = await runSingleAiProvider({
    supabase: supabaseAdmin,
    authSupabase: supabaseAdmin,
    sessionId: null,
    userId: null,
    provider: 'perplexity',
    prompt: [
      `Research question: ${query}`,
      '',
      `Context: this feeds a forecast for "${round.proposition_text}" (instrument ${round.instrument}, resolves ${round.resolves_at} UTC).`,
      'Answer with a compact factual brief (max 120 words): concrete numbers, dates and named sources. No opinions, no disclaimers.',
    ].join('\n'),
    systemPrompt: '',
    skipLanguageInjection: true,
    maxCompletionTokens: QUERY_MAX_TOKENS,
    modelOverride: QUERY_MODEL,
    timeoutMs: 60_000,
  })

  const costUsd =
    typeof res.costUsd === 'number'
      ? res.costUsd
      : estimateUsd(SONAR_PRICE, res.promptTokens, res.completionTokens)

  const summary = res.text?.trim().slice(0, MAX_FINDING_CHARS)
  return { summary: res.error ? null : summary && summary.length ? summary : null, costUsd }
}

/**
 * Returns the shared research packet for a round, from cache when possible.
 * Never throws — any failure degrades to `available:false` (price-only prompt).
 */
export async function getResearchPacket(args: {
  round: ResearchRoundInput
  /** Remaining kill-switch budget for the run, USD. */
  budgetRemainingUsd: number
}): Promise<ResearchPacket> {
  const { round, budgetRemainingUsd } = args
  const cacheKey = researchCacheKey(round.instrument, round.horizon)

  const miss: ResearchPacket = {
    available: false,
    cached: false,
    cacheKey,
    directorModel: null,
    queries: [],
    findings: [],
    promptBlock: '',
    costUsd: 0,
  }

  if (budgetRemainingUsd < MIN_BUDGET_USD) {
    return { ...miss, error: `skipped: budget remaining $${budgetRemainingUsd.toFixed(4)} < $${MIN_BUDGET_USD}` }
  }

  const memHit = memoryCache.get(cacheKey)
  if (memHit) return { ...memHit.packet, cached: true, costUsd: 0 }

  const durableHit = await readDurableCache(cacheKey)
  if (durableHit) {
    memoryCache.set(cacheKey, { packet: durableHit, at: Date.now() })
    return durableHit
  }

  const director = await runDirector(round)
  let costUsd = director.costUsd
  if (!director.queries.length) {
    return { ...miss, costUsd, directorModel: DIRECTOR_MODEL, error: director.error ?? 'no queries' }
  }

  const findings: ResearchFinding[] = []
  for (const query of director.queries) {
    if (costUsd >= budgetRemainingUsd) break // kill-switch: stop spending mid-assembly
    const r = await runQuery(round, query)
    costUsd += r.costUsd
    if (r.summary) findings.push({ query, summary: r.summary })
  }

  if (!findings.length) {
    return {
      ...miss,
      costUsd,
      directorModel: DIRECTOR_MODEL,
      queries: director.queries,
      error: 'all research queries failed',
    }
  }

  let promptBlock = [
    `RESEARCH PACKET (live web research compiled ${timeBucket()}:00 UTC — treat as recent context, verify against the price data):`,
    ...findings.map((f, i) => `${i + 1}) ${f.query}\n   ${f.summary}`),
  ].join('\n')
  if (promptBlock.length > MAX_BLOCK_CHARS) promptBlock = promptBlock.slice(0, MAX_BLOCK_CHARS)

  const packet: ResearchPacket = {
    available: true,
    cached: false,
    cacheKey,
    directorModel: DIRECTOR_MODEL,
    queries: director.queries,
    findings,
    promptBlock,
    costUsd,
  }

  memoryCache.set(cacheKey, { packet, at: Date.now() })
  await writeDurableCache(cacheKey, round, packet)
  return packet
}
