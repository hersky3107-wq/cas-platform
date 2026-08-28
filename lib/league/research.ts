import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import { runSingleAiProvider } from '@/lib/ai/router'
import type { ResearchTier } from './research-tier'
import type { ResearchLang } from './relations'

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

export type ResearchFinding = { query: string; summary: string; lang?: string }

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
  /** v2 (D): budget tier this packet was assembled under. */
  tier: ResearchTier
  /** v2 (D): high-tier numbers-first distillation; null on tight/normal. */
  synthesis: string | null
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
/** High tier emits up to 12 sub-questions — needs more visible output room. */
const DIRECTOR_MAX_TOKENS_HIGH = 1000
const QUERY_MODEL = 'sonar'
const QUERY_MAX_TOKENS = 800
const MAX_FINDING_CHARS = 700
const MAX_BLOCK_CHARS = 3600
/**
 * v2 (D) — dispersion-triggered ENGLISH query budgets per tier. Non-English
 * queries (one per flagged language) are ADDITIVE on top of these.
 */
export const TIGHT_QUERY_BUDGET = 2
export const NORMAL_QUERY_BUDGET = 4
export const HIGH_QUERY_BUDGET = 12
const QUERY_BUDGET: Record<ResearchTier, number> = {
  tight: TIGHT_QUERY_BUDGET,
  normal: NORMAL_QUERY_BUDGET,
  high: HIGH_QUERY_BUDGET,
}
/** Synthesis output cap (the packet trims again at SYNTHESIS_MAX_CHARS). */
const SYNTHESIS_MAX_TOKENS = 600
/** Below this remaining budget the whole research step is skipped. */
const MIN_BUDGET_USD = 0.05
/** Fallback list prices (USD per 1M tokens) for providers that report no billed cost. */
const DIRECTOR_PRICE = { inputPerMTokens: 0.3, outputPerMTokens: 2.5 }
const SONAR_PRICE = { inputPerMTokens: 1, outputPerMTokens: 1 }

const LANG_NAMES: Record<ResearchLang, string> = { ko: 'Korean', ja: 'Japanese', zh: 'Chinese' }

/** In-process fallback cache (durable cache = league_research_packets table). */
const memoryCache = new Map<string, { packet: ResearchPacket; at: number }>()

/** 6-hour UTC bucket — a round re-generated within the bucket reuses research. */
function timeBucket(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(Math.floor(d.getUTCHours() / 6) * 6)}`
}

/**
 * v2 cache key includes the budget tier and language set — a round
 * re-generated in the same bucket under a DIFFERENT tier must not reuse a
 * shallower (or deeper) packet. Old rp_v1 rows simply never hit again.
 */
export function researchCacheKey(
  instrument: string,
  horizon: string,
  now = new Date(),
  tier: ResearchTier = 'normal',
  languages: readonly ResearchLang[] = [],
): string {
  const langs = languages.length ? [...languages].sort().join('+') : 'en'
  return `rp_v2|${instrument}|${horizon}|${tier}|${langs}|${timeBucket(now)}`
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

/**
 * Director system prompt, built per tier + language set.
 *  - tight/normal: the original "N focused queries" contract.
 *  - high: Cassi-style DECOMPOSITION into sub-questions (v2 D), searched
 *    individually and later distilled by ONE synthesis call.
 *  - languages (v2 B): one additional query per flagged language, WRITTEN in
 *    that language, aimed at native-language sources. Findings land in the
 *    SHARED packet — every closed-book model sees the identical block.
 */
function buildDirectorPrompt(tier: ResearchTier, languages: readonly ResearchLang[]): string {
  const budget = QUERY_BUDGET[tier]
  const englishRule =
    tier === 'high'
      ? `- DECOMPOSE the proposition into ${budget - 2} to ${budget} focused sub-questions, in English, each a self-contained web-search query targeting a DIFFERENT causal angle (latest price & drivers; upcoming events/earnings; macro backdrop; sector & peer moves; positioning & flows; analyst/expert expectations; technical levels; key risks; cross-asset signals).`
      : `- ${Math.max(2, budget - 1)} to ${budget} focused web-search queries, in English, each targeting a DIFFERENT angle (latest price/drivers; recent news, earnings or events; analyst/expert expectations; key risks).`
  const langRule = languages.length
    ? `- ADDITIONALLY include exactly one query per language in [${languages
        .map((l) => `${l}: ${LANG_NAMES[l]}`)
        .join(', ')}], WRITTEN IN that language, targeting native-language sources (local news, exchange notices, regulators, filings).`
    : ''
  return [
    'You are the research director for a prediction league. Decide what RECENT, verifiable information would most improve a forecast for the proposition below.',
    '',
    'Output ONLY a JSON object, no markdown, no commentary:',
    '{"queries":[{"q":"...","lang":"en"},{"q":"...","lang":"ko"}]}',
    '',
    'Rules:',
    englishRule,
    ...(langRule ? [langRule] : []),
    '- Each query must be self-contained (include the instrument/topic name).',
    '- Prefer recency: mention "latest" or the current month where relevant.',
    '- lang is the 2-letter code of the language the query is written in.',
  ].join('\n')
}

type DirectorQuery = { q: string; lang: string }

function parseDirectorQueries(raw: unknown, maxQueries: number, allowedLangs: ReadonlySet<string>): DirectorQuery[] {
  const list = Array.isArray(raw) ? raw : []
  const out: DirectorQuery[] = []
  for (const item of list) {
    let q: string | null = null
    let lang = 'en'
    if (typeof item === 'string') {
      q = item
    } else if (item && typeof item === 'object') {
      const obj = item as { q?: unknown; lang?: unknown }
      if (typeof obj.q === 'string') q = obj.q
      if (typeof obj.lang === 'string' && allowedLangs.has(obj.lang)) lang = obj.lang
    }
    if (q && q.trim().length) out.push({ q: q.trim().slice(0, 300), lang })
    if (out.length >= maxQueries) break
  }
  return out
}

async function runDirector(
  round: ResearchRoundInput,
  tier: ResearchTier,
  languages: readonly ResearchLang[],
): Promise<{ queries: DirectorQuery[]; costUsd: number; error?: string }> {
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
    systemPrompt: buildDirectorPrompt(tier, languages),
    skipLanguageInjection: true,
    maxCompletionTokens: tier === 'high' ? DIRECTOR_MAX_TOKENS_HIGH : DIRECTOR_MAX_TOKENS,
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
    const maxQueries = QUERY_BUDGET[tier] + languages.length
    const allowed = new Set<string>(['en', ...languages])
    const queries = parseDirectorQueries(obj.queries, maxQueries, allowed)
    if (!queries.length) return { queries: [], costUsd, error: 'director produced zero usable queries' }
    return { queries, costUsd }
  } catch {
    return { queries: [], costUsd, error: 'director JSON parse failed' }
  }
}

async function runQuery(
  round: ResearchRoundInput,
  query: DirectorQuery,
): Promise<{ summary: string | null; costUsd: number }> {
  const answerRule =
    query.lang === 'en'
      ? 'Answer with a compact factual brief (max 120 words): concrete numbers, dates and named sources. No opinions, no disclaimers.'
      : `The question is in ${LANG_NAMES[query.lang as ResearchLang] ?? query.lang}. Search sources in that language. Answer with (1) ONE key sentence in that language quoting the concrete figure, then (2) an English gloss starting "EN:" with the same numbers, dates and named source. Max 120 words total. No opinions, no disclaimers.`
  const res = await runSingleAiProvider({
    supabase: supabaseAdmin,
    authSupabase: supabaseAdmin,
    sessionId: null,
    userId: null,
    provider: 'perplexity',
    prompt: [
      `Research question: ${query.q}`,
      '',
      `Context: this feeds a forecast for "${round.proposition_text}" (instrument ${round.instrument}, resolves ${round.resolves_at} UTC).`,
      answerRule,
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
 * v2 (D) high tier only: ONE synthesis call distills the sub-question
 * findings into numbers-first lines. Runs once per packet; every closed-book
 * model shares the result. Failure degrades to raw findings (null synthesis).
 */
async function runSynthesis(
  round: ResearchRoundInput,
  findings: readonly ResearchFinding[],
): Promise<{ synthesis: string | null; costUsd: number }> {
  const res = await runSingleAiProvider({
    supabase: supabaseAdmin,
    authSupabase: supabaseAdmin,
    sessionId: null,
    userId: null,
    provider: 'google',
    prompt: [
      `Proposition: ${round.proposition_text} (instrument ${round.instrument}, horizon ${round.horizon}, resolves ${round.resolves_at} UTC)`,
      '',
      'Research findings:',
      ...findings.map((f, i) => `${i + 1}) [${f.lang ?? 'en'}] ${f.query}\n${f.summary}`),
    ].join('\n'),
    systemPrompt:
      'You distill research findings for a forecasting packet. Output AT MOST 10 lines, plain text, no markdown. Each line: metric or event — concrete number — source name — as-of date. Numbers first; drop any finding with no number. Never add opinions, forecasts, or facts not present in the findings.',
    skipLanguageInjection: true,
    maxCompletionTokens: SYNTHESIS_MAX_TOKENS,
    modelOverride: DIRECTOR_MODEL,
    timeoutMs: 45_000,
  })
  const costUsd =
    typeof res.costUsd === 'number'
      ? res.costUsd
      : estimateUsd(DIRECTOR_PRICE, res.promptTokens, res.completionTokens)
  const text = res.error ? null : res.text?.trim() || null
  return { synthesis: text, costUsd }
}

/**
 * Returns the shared research packet for a round, from cache when possible.
 * Never throws — any failure degrades to `available:false` (price-only prompt).
 */
export async function getResearchPacket(args: {
  round: ResearchRoundInput
  /** Remaining kill-switch budget for the run, USD. */
  budgetRemainingUsd: number
  /** v2 (D): dispersion-decided budget tier. Default 'normal' (legacy callers). */
  tier?: ResearchTier
  /** v2 (B): languages to ALSO query (findings go into the shared packet). */
  languages?: readonly ResearchLang[]
}): Promise<ResearchPacket> {
  const { round, budgetRemainingUsd } = args
  const tier: ResearchTier = args.tier ?? 'normal'
  const languages = args.languages ?? []
  const cacheKey = researchCacheKey(round.instrument, round.horizon, new Date(), tier, languages)

  const miss: ResearchPacket = {
    available: false,
    cached: false,
    cacheKey,
    directorModel: null,
    queries: [],
    findings: [],
    promptBlock: '',
    costUsd: 0,
    tier,
    synthesis: null,
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

  const director = await runDirector(round, tier, languages)
  let costUsd = director.costUsd
  if (!director.queries.length) {
    return { ...miss, costUsd, directorModel: DIRECTOR_MODEL, error: director.error ?? 'no queries' }
  }

  const findings: ResearchFinding[] = []
  for (const query of director.queries) {
    if (costUsd >= budgetRemainingUsd) break // kill-switch: stop spending mid-assembly
    const r = await runQuery(round, query)
    costUsd += r.costUsd
    if (r.summary) findings.push({ query: query.q, summary: r.summary, lang: query.lang })
  }

  if (!findings.length) {
    return {
      ...miss,
      costUsd,
      directorModel: DIRECTOR_MODEL,
      queries: director.queries.map((q) => q.q),
      error: 'all research queries failed',
    }
  }

  // v2 (D): high tier distills the decomposition ONCE; shared by all models.
  let synthesis: string | null = null
  if (tier === 'high' && findings.length >= 3 && costUsd < budgetRemainingUsd) {
    const s = await runSynthesis(round, findings)
    costUsd += s.costUsd
    synthesis = s.synthesis
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
    queries: director.queries.map((q) => q.q),
    findings,
    promptBlock,
    costUsd,
    tier,
    synthesis,
  }

  memoryCache.set(cacheKey, { packet, at: Date.now() })
  await writeDurableCache(cacheKey, round, packet)
  return packet
}
