/**
 * PACKET-stage multi-provider RESEARCH runner (pure orchestrator).
 * The live HTTP caller is injected so tests can fail a provider or hit the cap.
 */

import {
  formatMultiSourceSection,
  mergeResearchFindings,
  type MergedResearch,
  type MultiSourceLog,
  type RawResearchFinding,
} from './research-merge'

export const RESEARCH_PROVIDER_IDS = ['perplexity', 'xai', 'gemini', 'openai', 'youcom', 'claude'] as const
export type ResearchProviderId = (typeof RESEARCH_PROVIDER_IDS)[number]

/** OpenAI web search is off by default — it 429s scout seats that share the same quota. Override via LEAGUE_RESEARCH_PROVIDERS. */
export const DEFAULT_RESEARCH_PROVIDERS: ResearchProviderId[] = ['perplexity', 'xai', 'gemini', 'youcom']
export const DEFAULT_RESEARCH_CAP_USD = 0.15
export const RESEARCH_PROVIDER_TIMEOUT_MS = 45_000
export const MAX_OTHER_RESEARCH_PROVIDERS = 3

export const DEFAULT_PROVIDER_ESTIMATE_USD: Record<ResearchProviderId, number> = {
  perplexity: 0.03,
  xai: 0.04,
  gemini: 0.02,
  openai: 0.04,
  youcom: 0.03,
  claude: 0.05,
}

export const RESEARCH_MODE_SYSTEM = [
  'You are a research clerk for a shared forecasting packet.',
  'Do NOT predict, guess probabilities, or invent dates.',
  'Search the web for the questions. Return ONLY JSON:',
  '{"findings":[{"claim":"...","date":"YYYY-MM-DD","url":"https://...","side":"occurs"|"does_not_occur"|"neutral","rumor":false}]}',
  'Rules:',
  '- Every finding needs a source URL you actually retrieved.',
  '- Include a date only when the source states it. Omit the field otherwise. Never invent dates.',
  '- Label leaker / unofficial reporter notes rumor:true.',
  '- Include BOTH sides when sources exist (occurs / does not occur).',
  '- If nothing is found, return {"findings":[]}.',
].join('\n')

export type ResearchProviderCallArgs = {
  provider: ResearchProviderId
  queries: readonly string[]
  proposition: string
  instrument: string
  deadline: string
  timeoutMs: number
}

export type ResearchProviderCallResult = {
  findings: RawResearchFinding[]
  costUsd: number
  error?: string
}

export type ResearchProviderCaller = (args: ResearchProviderCallArgs) => Promise<ResearchProviderCallResult>

export type ProviderSelection = {
  selected: ResearchProviderId[]
  skippedForCap: ResearchProviderId[]
  estimatedCostUsd: number
}

export type MultiSourceResearchResult = {
  merged: MergedResearch
  log: MultiSourceLog
  section: string
  skippedForCap: ResearchProviderId[]
}

export function isResearchProviderId(value: string): value is ResearchProviderId {
  return (RESEARCH_PROVIDER_IDS as readonly string[]).includes(value)
}

export function parseResearchProviderList(raw: string | undefined | null): ResearchProviderId[] {
  const bits = (raw ?? DEFAULT_RESEARCH_PROVIDERS.join(','))
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(isResearchProviderId)
  return orderProviders(bits.length ? bits : DEFAULT_RESEARCH_PROVIDERS)
}

export function parseResearchCapUsd(raw: string | undefined | null, fallback = DEFAULT_RESEARCH_CAP_USD): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return n
}

export function orderProviders(list: readonly ResearchProviderId[]): ResearchProviderId[] {
  const seen = new Set<ResearchProviderId>()
  const out: ResearchProviderId[] = []
  const push = (id: ResearchProviderId) => {
    if (seen.has(id)) return
    seen.add(id)
    out.push(id)
  }
  if (list.includes('perplexity')) push('perplexity')
  for (const id of list) push(id)
  return out
}

export function selectResearchProviders(args: {
  configured: readonly ResearchProviderId[]
  costCapUsd: number
  estimates?: Partial<Record<ResearchProviderId, number>>
}): ProviderSelection {
  const estimates = { ...DEFAULT_PROVIDER_ESTIMATE_USD, ...args.estimates }
  const ordered = orderProviders(args.configured)
  const selected: ResearchProviderId[] = []
  const skippedForCap: ResearchProviderId[] = []
  let estimatedCostUsd = 0
  const maxTotal = 1 + MAX_OTHER_RESEARCH_PROVIDERS

  for (const id of ordered) {
    if (selected.length >= maxTotal) {
      skippedForCap.push(id)
      continue
    }
    const estimate = estimates[id] ?? 0.03
    const wouldExceed = selected.length > 0 && estimatedCostUsd + estimate > args.costCapUsd + 1e-9
    if (wouldExceed) {
      skippedForCap.push(id)
      continue
    }
    selected.push(id)
    estimatedCostUsd += estimate
  }
  return { selected, skippedForCap, estimatedCostUsd }
}

export function researchModeUserPrompt(args: {
  queries: readonly string[]
  proposition: string
  instrument: string
  deadline: string
}): string {
  return [
    `Proposition: ${args.proposition}`,
    `Instrument: ${args.instrument}`,
    `Deadline: ${args.deadline}`,
    '',
    'Search these questions. Return dated findings with source URLs, not predictions.',
    ...args.queries.map((q, i) => `${i + 1}. ${q}`),
  ].join('\n')
}

export async function runMultiSourceResearch(args: {
  queries: readonly string[]
  proposition: string
  instrument: string
  deadline: string
  configured: readonly ResearchProviderId[]
  costCapUsd: number
  timeoutMs?: number
  estimates?: Partial<Record<ResearchProviderId, number>>
  caller: ResearchProviderCaller
  nowMs?: () => number
}): Promise<MultiSourceResearchResult> {
  const timeoutMs = args.timeoutMs ?? RESEARCH_PROVIDER_TIMEOUT_MS
  const { selected, skippedForCap } = selectResearchProviders({
    configured: args.configured,
    costCapUsd: args.costCapUsd,
    estimates: args.estimates,
  })
  const started = (args.nowMs ?? Date.now)()

  const settled = await Promise.all(
    selected.map(async (provider) => {
      try {
        const result = await withTimeout(
          args.caller({
            provider,
            queries: args.queries,
            proposition: args.proposition,
            instrument: args.instrument,
            deadline: args.deadline,
            timeoutMs,
          }),
          timeoutMs,
        )
        if (result.error) {
          return { provider, findings: [] as RawResearchFinding[], costUsd: result.costUsd, error: result.error }
        }
        return { provider, findings: result.findings, costUsd: result.costUsd }
      } catch (error) {
        return {
          provider,
          findings: [] as RawResearchFinding[],
          costUsd: 0,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }),
  )

  const findingsPerProvider: Record<string, number> = {}
  const providersUsed: string[] = []
  const providersFailed: Array<{ provider: string; error: string }> = []
  let costUsd = 0
  const raw: RawResearchFinding[] = []
  for (const row of settled) {
    findingsPerProvider[row.provider] = row.findings.length
    costUsd += row.costUsd
    if (row.error) {
      providersFailed.push({ provider: row.provider, error: row.error })
      continue
    }
    providersUsed.push(row.provider)
    raw.push(...row.findings)
  }

  const merged = mergeResearchFindings(raw)
  const log: MultiSourceLog = {
    providersUsed,
    providersFailed,
    findingsPerProvider,
    mergedCount: merged.facts.length,
    costUsd,
    wallMs: (args.nowMs ?? Date.now)() - started,
  }
  return {
    merged,
    log,
    section: formatMultiSourceSection({ merged, log }),
    skippedForCap,
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
