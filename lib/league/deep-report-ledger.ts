/**
 * Per-call cost ledger for the deep report. Pure: no I/O.
 *
 * billedUsd is what the provider reported (Perplexity total_cost, xAI
 * ticks). Everything else is estimated from tokens × that model's own list
 * price — never the flat router fallback — so the chair (Anthropic reports
 * no USD) shows a real figure instead of $0.
 */
import { lookupRosterEntry, type RosterPrice } from './roster'
import {
  addStageCost,
  emptyReportStageCosts,
  reportCostBucket,
  type ReportStageCosts,
} from './deep-report-policy'

export type ReportLedgerStage = 'research' | 'opening' | 'rebuttal' | 'chair'

export type ReportLedgerEntry = {
  stage: ReportLedgerStage
  provider: string
  model: string
  ok: boolean
  attempt: number
  promptTokens: number | null
  completionTokens: number | null
  billedUsd: number | null
  estimatedUsd: number
  ms: number
  finishReason?: string | null
  error?: string | null
  requestId?: string | null
  responseId?: string | null
}

/** Models the report calls that are not (or not at this price) on the league roster. */
const REPORT_PRICES: Record<string, RosterPrice> = {
  // platform.claude.com/docs/en/about-claude/pricing (2026-10): $4 / $20 per MTok.
  'claude-opus-5-5': { inputPerMTokens: 4, outputPerMTokens: 20 },
}

/** Same mid-flagship fallback as cost-span, for a model with no listed price. */
const UNKNOWN_MODEL_PRICE: RosterPrice = { inputPerMTokens: 2.5, outputPerMTokens: 12.5 }

export function reportModelPrice(model: string): RosterPrice | null {
  return REPORT_PRICES[model] ?? lookupRosterEntry(model)?.price ?? null
}

/** Token × list price (+ tool fee the provider did not fold into a billed figure). */
export function estimateReportCallUsd(
  model: string,
  promptTokens: number | null,
  completionTokens: number | null,
  toolFeeUsd: number | null = null,
): number {
  const price = reportModelPrice(model) ?? UNKNOWN_MODEL_PRICE
  const pt = promptTokens ?? 0
  const ct = completionTokens ?? 0
  const long = price.longContext
  const useLong = !!long && pt >= long.promptTokens
  const inRate = useLong ? long.inputPerMTokens : price.inputPerMTokens
  const outRate = useLong ? long.outputPerMTokens : price.outputPerMTokens
  return (pt / 1_000_000) * inRate + (ct / 1_000_000) * outRate + (toolFeeUsd ?? 0)
}

export function ledgerEntry(input: {
  stage: ReportLedgerStage
  provider: string
  model: string
  ok: boolean
  attempt: number
  ms: number
  promptTokens?: number | null
  completionTokens?: number | null
  billedUsd?: number | null
  toolFeeUsd?: number | null
  finishReason?: string | null
  error?: string | null
  requestId?: string | null
  responseId?: string | null
}): ReportLedgerEntry {
  const billed = typeof input.billedUsd === 'number' && input.billedUsd > 0 ? input.billedUsd : null
  const promptTokens = input.promptTokens ?? null
  const completionTokens = input.completionTokens ?? null
  return {
    stage: input.stage,
    provider: input.provider,
    model: input.model,
    ok: input.ok,
    attempt: input.attempt,
    promptTokens,
    completionTokens,
    billedUsd: billed,
    estimatedUsd: billed !== null ? 0 : estimateReportCallUsd(input.model, promptTokens, completionTokens, input.toolFeeUsd ?? null),
    ms: input.ms,
    ...(input.finishReason ? { finishReason: input.finishReason } : {}),
    ...(input.error ? { error: input.error.slice(0, 300) } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.responseId ? { responseId: input.responseId } : {}),
  }
}

export function stageCostsFromLedger(entries: readonly ReportLedgerEntry[]): ReportStageCosts {
  let costs = emptyReportStageCosts()
  for (const entry of entries) {
    const bucket = reportCostBucket(entry.stage)
    if (!bucket) continue
    costs = {
      ...costs,
      [bucket]: addStageCost(costs[bucket], {
        billedUsd: entry.billedUsd ?? 0,
        estimatedUsd: entry.estimatedUsd,
        calls: 1,
      }),
    }
  }
  return costs
}

export function ledgerTotals(entries: readonly ReportLedgerEntry[]): {
  billedUsd: number
  estimatedUsd: number
  providerCalls: number
} {
  return entries.reduce(
    (sum, entry) => ({
      billedUsd: sum.billedUsd + (entry.billedUsd ?? 0),
      estimatedUsd: sum.estimatedUsd + entry.estimatedUsd,
      providerCalls: sum.providerCalls + 1,
    }),
    { billedUsd: 0, estimatedUsd: 0, providerCalls: 0 },
  )
}

/**
 * Report hop costs come from the ledger entries this hop appended, added on
 * top of what the row (and its stageCosts) carried before the hop.
 */
export function reportHopAccounting(
  row: { billed_usd: number; estimated_usd: number; provider_calls: number },
  before: { ledger?: readonly ReportLedgerEntry[]; stageCosts?: ReportStageCosts },
  after: { ledger?: readonly ReportLedgerEntry[] },
): { stageCosts: ReportStageCosts; totals: { billedUsd: number; estimatedUsd: number; providerCalls: number } } {
  const fresh = (after.ledger ?? []).slice(before.ledger?.length ?? 0)
  const prev = before.stageCosts ?? emptyReportStageCosts()
  const add = stageCostsFromLedger(fresh)
  const delta = ledgerTotals(fresh)
  return {
    stageCosts: {
      research: addStageCost(prev.research, add.research),
      debate: addStageCost(prev.debate, add.debate),
      chair: addStageCost(prev.chair, add.chair),
    },
    totals: {
      billedUsd: row.billed_usd + delta.billedUsd,
      estimatedUsd: row.estimated_usd + delta.estimatedUsd,
      providerCalls: row.provider_calls + delta.providerCalls,
    },
  }
}

/** One log line per call: ids, tokens, billed vs estimated. */
export function ledgerLogLine(runId: string, entry: ReportLedgerEntry): string {
  const usd = entry.billedUsd !== null ? `billed=$${entry.billedUsd.toFixed(4)}` : `est=$${entry.estimatedUsd.toFixed(4)}`
  const ids = [entry.requestId ? `request=${entry.requestId}` : '', entry.responseId ? `response=${entry.responseId}` : '']
    .filter(Boolean)
    .join(' ')
  return [
    `[league-deep] report run=${runId} stage=${entry.stage} model=${entry.model} attempt=${entry.attempt} ok=${entry.ok}`,
    `in=${entry.promptTokens ?? '-'} out=${entry.completionTokens ?? '-'} ${usd} ms=${entry.ms}`,
    entry.finishReason ? `finish=${entry.finishReason}` : '',
    ids,
    entry.error ? `error=${entry.error.slice(0, 160)}` : '',
  ]
    .filter(Boolean)
    .join(' ')
}
