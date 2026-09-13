import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import { runSingleAiProvider, type SearchResultItem } from '@/lib/ai/router'
import type { ResearchTier } from './research-tier'
import type { ResearchLang } from './relations'
import {
  QUERY_BUDGET,
  TIGHT_QUERY_BUDGET,
  NORMAL_QUERY_BUDGET,
  HIGH_QUERY_BUDGET,
  allNeedsPresent,
  attachSourceUrl,
  buildPacketInventory,
  buildStage1Prompt,
  buildStage2Prompt,
  isAdmissibleFinding,
  parseStage1Needs,
  parseStage2Coverage,
  selectQueriesFromCoverage,
  type DirectorNeed,
  type PacketInventoryInput,
} from './research-director'

export { TIGHT_QUERY_BUDGET, NORMAL_QUERY_BUDGET, HIGH_QUERY_BUDGET }
export type { PacketInventoryInput, DirectorNeed }

/**
 * AI Prediction League — dynamic RESEARCH step (server engine only).
 *
 * Per round, BEFORE the roster fans out:
 *   1. A two-stage "research director" (cheap, fast: gemini-3.5-flash):
 *      Stage 1 lists structural drivers of the asset class AND near-term
 *      catalysts for THIS proposition (inventory-blind, category-agnostic).
 *      Stage 2 marks each need against the packet inventory and emits search
 *      queries only for MISSING needs.
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

export type ResearchFinding = {
  query: string
  summary: string
  lang?: string
  citations?: string[]
  searchResults?: SearchResultItem[]
}

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
const DIRECTOR_MAX_TOKENS = 2000
const QUERY_MODEL = 'sonar'
const QUERY_MAX_TOKENS = 800
const MAX_FINDING_CHARS = 700
const MAX_BLOCK_CHARS = 3600
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
 * v4 cache key: Stage 1 prompt rebuild (structural + near-term). Old
 * rp_v1/rp_v2/rp_v3 rows simply never hit again.
 */
export function researchCacheKey(
  instrument: string,
  horizon: string,
  now = new Date(),
  tier: ResearchTier = 'normal',
  languages: readonly ResearchLang[] = [],
): string {
  const langs = languages.length ? [...languages].sort().join('+') : 'en'
  return `rp_v4|${instrument}|${horizon}|${tier}|${langs}|${timeBucket(now)}`
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

function roundBlock(round: ResearchRoundInput): string {
  return [
    `Proposition: ${round.proposition_text}`,
    `Instrument: ${round.instrument}`,
    `Category: ${round.category}`,
    `Horizon: ${round.horizon}`,
    `Resolution rule: ${round.resolution_rule}`,
    `Resolves at (UTC): ${round.resolves_at}`,
  ].join('\n')
}

type DirectorQuery = { q: string; lang: string }

async function callDirector(
  systemPrompt: string,
  prompt: string,
  model = DIRECTOR_MODEL,
): Promise<{ text: string | null; costUsd: number; error?: string }> {
  const res = await runSingleAiProvider({
    supabase: supabaseAdmin,
    authSupabase: supabaseAdmin,
    sessionId: null,
    userId: null,
    provider: 'google',
    prompt,
    systemPrompt,
    skipLanguageInjection: true,
    maxCompletionTokens: DIRECTOR_MAX_TOKENS,
    modelOverride: model,
    // 3.5-flash accepts thinkingBudget:0; 3.6-flash and 3.1-pro reject it.
    allowGeminiThinking: model !== DIRECTOR_MODEL,
    timeoutMs: 45_000,
  })
  const costUsd =
    typeof res.costUsd === 'number'
      ? res.costUsd
      : estimateUsd(DIRECTOR_PRICE, res.promptTokens, res.completionTokens)
  if (res.error || !res.text) return { text: null, costUsd, error: res.error ?? 'director returned no text' }
  return { text: res.text, costUsd }
}

/** Inventory-blind Stage 1 only — used by the gold-chip audit print. */
export async function runDirectorStage1(
  round: ResearchRoundInput,
  opts?: { modelOverride?: string },
): Promise<{
  needs: DirectorNeed[]
  rawText: string
  costUsd: number
  error?: string
  model: string
}> {
  const model = opts?.modelOverride ?? DIRECTOR_MODEL
  const stage1 = await callDirector(buildStage1Prompt(), roundBlock(round), model)
  if (!stage1.text) return { needs: [], rawText: '', costUsd: stage1.costUsd, error: stage1.error, model }
  const parsed = parseStage1Needs(stage1.text)
  if ('error' in parsed) {
    return { needs: [], rawText: stage1.text, costUsd: stage1.costUsd, error: parsed.error, model }
  }
  return { needs: parsed, rawText: stage1.text, costUsd: stage1.costUsd, model }
}

async function runDirector(
  round: ResearchRoundInput,
  tier: ResearchTier,
  languages: readonly ResearchLang[],
  inventory: PacketInventoryInput | undefined,
): Promise<{ queries: DirectorQuery[]; costUsd: number; allPresent: boolean; needs: DirectorNeed[]; error?: string }> {
  const allowed = new Set<string>(['en', ...languages])
  const maxEnglish = QUERY_BUDGET[tier]

  const stage1 = await callDirector(buildStage1Prompt(), roundBlock(round))
  let costUsd = stage1.costUsd
  if (!stage1.text) return { queries: [], costUsd, allPresent: false, needs: [], error: stage1.error }

  const needs = parseStage1Needs(stage1.text)
  if ('error' in needs) return { queries: [], costUsd, allPresent: false, needs: [], error: needs.error }

  const inventoryText = inventory
    ? buildPacketInventory(inventory)
    : 'PACKET INVENTORY: not supplied — mark every Stage 1 need as missing.'
  const stage2Prompt = [
    roundBlock(round),
    '',
    'STAGE 1 NEEDS:',
    JSON.stringify({ needs }),
    '',
    'PACKET INVENTORY:',
    inventoryText,
  ].join('\n')

  const stage2 = await callDirector(buildStage2Prompt(tier, languages), stage2Prompt)
  costUsd += stage2.costUsd

  let coverage = stage2.text ? parseStage2Coverage(stage2.text) : ({ error: stage2.error ?? 'stage 2 empty' } as const)
  if ('error' in coverage) {
    // Degrade: search the Stage 1 needs themselves, still capped by the tier.
    const queries = selectQueriesFromCoverage([], maxEnglish, allowed, needs, round.instrument)
    return { queries, costUsd, allPresent: false, needs, error: coverage.error }
  }

  const queries = selectQueriesFromCoverage(coverage, maxEnglish, allowed, needs, round.instrument)
  if (allNeedsPresent(coverage)) return { queries: [], costUsd, allPresent: true, needs }
  if (!queries.length) return { queries: [], costUsd, allPresent: false, needs, error: 'director produced zero usable queries' }
  return { queries, costUsd, allPresent: false, needs }
}

async function runQuery(
  round: ResearchRoundInput,
  query: DirectorQuery,
): Promise<{
  summary: string | null
  costUsd: number
  citations?: string[]
  searchResults?: SearchResultItem[]
}> {
  const answerRule =
    query.lang === 'en'
      ? 'Answer with a compact factual brief (max 120 words): concrete numbers, an as-of date (YYYY-MM-DD or "Mon DD, YYYY"), and a source URL. No opinions, no disclaimers. Drop the answer if you cannot cite a number, a date, AND a URL.'
      : `The question is in ${LANG_NAMES[query.lang as ResearchLang] ?? query.lang}. Search sources in that language. Answer with (1) ONE key sentence in that language quoting the concrete figure, then (2) an English gloss starting "EN:" with the same numbers, a date, and a named source URL. Max 120 words total. No opinions, no disclaimers.`
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
  return {
    summary: res.error ? null : summary && summary.length ? summary : null,
    costUsd,
    citations: res.citations,
    searchResults: res.searchResults,
  }
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
  /** Packet field inventory for Stage 2. Omit → every Stage 1 need is missing. */
  inventory?: PacketInventoryInput
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

  const director = await runDirector(round, tier, languages, args.inventory)
  let costUsd = director.costUsd
  if (!director.queries.length) {
    if (director.allPresent) {
      const packet: ResearchPacket = {
        available: true,
        cached: false,
        cacheKey,
        directorModel: DIRECTOR_MODEL,
        queries: [],
        findings: [],
        promptBlock: '',
        costUsd,
        tier,
        synthesis: null,
      }
      memoryCache.set(cacheKey, { packet, at: Date.now() })
      await writeDurableCache(cacheKey, round, packet)
      return packet
    }
    return { ...miss, costUsd, directorModel: DIRECTOR_MODEL, error: director.error ?? 'no queries' }
  }

  const findings: ResearchFinding[] = []
  for (const query of director.queries) {
    if (costUsd >= budgetRemainingUsd) break // kill-switch: stop spending mid-assembly
    const r = await runQuery(round, query)
    costUsd += r.costUsd
    if (r.summary) {
      const citations = [
        ...(r.citations ?? []),
        ...((r.searchResults ?? []).map((s) => s.url).filter((u): u is string => !!u) ?? []),
      ]
      const summary = attachSourceUrl(r.summary, citations)
      if (!isAdmissibleFinding(summary, citations)) continue
      findings.push({
        query: query.q,
        summary,
        lang: query.lang,
        citations: citations.length ? citations : undefined,
        searchResults: r.searchResults,
      })
    }
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
