/**
 * Pure rules for the single premium product "AI 심층 리포트".
 * No I/O. The hop runner and the tests both call these.
 */
import { rebuttalsAwaitCounter } from './deep-debate-pairs'
import type { LeagueLocale } from './i18n/locales'
import { OUTPUT_LANGUAGE_NAME } from './output-language-name'

/** Owner pack rate used only to show margin. Not a charge. */
export const LEAGUE_CREDIT_USD = 0.0475

/**
 * Official Perplexity sample for one `sonar-deep-research` call (~$0.82) —
 * kept as the budget for its Agent API successor (preset `high`), which
 * Perplexity prices at or below Sonar Deep Research — plus three
 * grounded-search seats budgeted at $0.05 each.
 * https://docs.perplexity.ai/docs/getting-started/pricing
 */
export const PROJECTED_SONAR_DEEP_RESEARCH_USD = 0.82
export const PROJECTED_GROUNDED_SEARCH_USD = 0.05
export const PROJECTED_DEEP_RESEARCH_USD = PROJECTED_SONAR_DEEP_RESEARCH_USD + PROJECTED_GROUNDED_SEARCH_USD * 3

export const LEAGUE_DEEP_RESEARCH_CAP_USD_DEFAULT = 1

export const DEEP_REPORT_DEBATER_MODELS = [
  { provider: 'anthropic', model: 'claude-sonnet-5' },
  { provider: 'openai', model: 'gpt-5.6-terra' },
  { provider: 'google', model: 'gemini-3.6-flash' },
  { provider: 'xai', model: 'grok-4.3' },
  { provider: 'deepseek', model: 'deepseek-v4-pro' },
  { provider: 'mistral', model: 'mistral-medium-3.5' },
] as const

export const DEEP_REPORT_CHAIR = { provider: 'anthropic', model: 'claude-opus-5-5' } as const

/** Grounded-search seats that run beside Perplexity deep research. */
export const DEEP_RESEARCH_SEATS = [
  { provider: 'google', model: 'gemini-3.6-flash' },
  { provider: 'xai', model: 'grok-4.3' },
  { provider: 'anthropic', model: 'claude-sonnet-5' },
] as const

/** Over the research cap: Perplexity `low` preset plus one grounded seat. */
export const FALLBACK_RESEARCH_SEATS = [{ provider: 'google', model: 'gemini-3.6-flash' }] as const

/**
 * Token caps. Reasoning models spend hidden tokens from the same budget
 * (Opus 5.5 thinking cannot be turned off), so JSON-sized replies still need
 * large caps: the first live run truncated at 1400 (debaters) and 4000 (chair).
 */
export const REPORT_TOKENS = {
  researchSeat: 8000,
  perplexity: 20000,
  debater: 8000,
  chair: 16000,
} as const

/** Wall-clock budget for model work inside one hop (tick budget is 300s). */
export const REPORT_HOP_BUDGET_MS = 250_000
export const REPORT_TIMEOUTS_MS = {
  researchSeat: 150_000,
  debater: 120_000,
  chair: 200_000,
} as const
/** Stop waiting for the background deep-research job after this long. */
export const DEEP_RESEARCH_MAX_WAIT_MS = 15 * 60_000
/** Each call gets one retry after an invalid or truncated reply. */
export const REPORT_MAX_ATTEMPTS = 2

/** Models the report path must not call. */
export const REMOVED_DEEP_REPORT_MODELS = [
  'gpt-4o',
  'grok-3',
  'claude-sonnet-4-6',
  'claude-opus-4-8',
  'mistral-large-latest',
  'solar-pro4',
  'glm-5.2',
] as const

export const RESEARCH_ANGLES = [
  'base_rates',
  'scheduled_events',
  'official_filings',
  'strongest_yes',
  'strongest_no',
  'changed_30d',
] as const

export type ResearchAngle = (typeof RESEARCH_ANGLES)[number]
export type DebateSide = 'yes' | 'no'
export type ResearchPath = 'deep' | 'standard_fallback'

const ANGLE_EN: Record<ResearchAngle, string> = {
  base_rates: 'historical base rates and how often this kind of outcome happens',
  scheduled_events: 'scheduled events, calendars, and deadlines before resolution',
  official_filings: 'official filings, datasets, and primary-source releases',
  strongest_yes: 'the strongest factual case that the proposition resolves YES',
  strongest_no: 'the strongest factual case that the proposition resolves NO',
  changed_30d: 'what materially changed in the last 30 days',
}

const ANGLE_KO: Record<ResearchAngle, string> = {
  base_rates: '이 유형의 결과가 얼마나 자주 나왔는지, 역사적 기준율',
  scheduled_events: '판정 전에 예정된 일정, 캘린더, 마감',
  official_filings: '공식 공시, 데이터셋, 1차 자료',
  strongest_yes: '명제가 예로 끝날 가장 강한 사실 근거',
  strongest_no: '명제가 아니오로 끝날 가장 강한 사실 근거',
  changed_30d: '최근 30일 동안 실질적으로 달라진 점',
}

export function leagueDeepResearchCapUsd(raw: string | undefined = process.env.LEAGUE_DEEP_RESEARCH_CAP_USD): number {
  if (raw == null || raw.trim() === '') return LEAGUE_DEEP_RESEARCH_CAP_USD_DEFAULT
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return LEAGUE_DEEP_RESEARCH_CAP_USD_DEFAULT
  return n
}

/** Deep research only when the projected bundle fits under the cap. */
export function researchPathForCap(capUsd: number, projectedUsd = PROJECTED_DEEP_RESEARCH_USD): ResearchPath {
  return projectedUsd <= capUsd + 1e-9 ? 'deep' : 'standard_fallback'
}

export type PlannedQuery = { angle: ResearchAngle; lang: 'en' | LeagueLocale; text: string }

export function bilingualResearchQueries(proposition: string, locale: LeagueLocale): PlannedQuery[] {
  const subject = proposition.trim() || '(proposition)'
  const out: PlannedQuery[] = []
  for (const angle of RESEARCH_ANGLES) {
    out.push({
      angle,
      lang: 'en',
      text: `Proposition: ${subject}. Find dated evidence on ${ANGLE_EN[angle]}. Cite source URLs. Do not invent dates or numbers. If nothing is found, say none found.`,
    })
    if (locale !== 'en') {
      const local = locale === 'ko' ? ANGLE_KO[angle] : ANGLE_EN[angle]
      out.push({
        angle,
        lang: locale,
        text: `Proposition: ${subject}. Write the answer in ${OUTPUT_LANGUAGE_NAME[locale]}. Find dated evidence on ${local}. Cite source URLs. Do not invent dates or numbers. If nothing is found, say none found.`,
      })
    }
  }
  return out
}

export type DebaterSeat = {
  provider: (typeof DEEP_REPORT_DEBATER_MODELS)[number]['provider']
  model: string
  side: DebateSide
}

/** First three seats vs last three. Which trio is YES rotates with the round id. */
export function assignDebateSides(roundId: string): DebaterSeat[] {
  let hash = 0
  for (const ch of roundId) hash = (hash * 33 + ch.charCodeAt(0)) >>> 0
  const yesFirst = hash % 2 === 0
  return DEEP_REPORT_DEBATER_MODELS.map((seat, index) => ({
    provider: seat.provider,
    model: seat.model,
    side: (index < 3) === yesFirst ? 'yes' : 'no',
  }))
}

export function languageLockLine(locale: LeagueLocale): string {
  return `Write 100% in ${OUTPUT_LANGUAGE_NAME[locale]}. Proper nouns and tickers may stay as-is. Do not invent dates or numbers.`
}

export type StageCost = { billedUsd: number; estimatedUsd: number; calls: number }

export type ReportStageCosts = {
  research: StageCost
  debate: StageCost
  chair: StageCost
}

export function emptyStageCost(): StageCost {
  return { billedUsd: 0, estimatedUsd: 0, calls: 0 }
}

export function emptyReportStageCosts(): ReportStageCosts {
  return { research: emptyStageCost(), debate: emptyStageCost(), chair: emptyStageCost() }
}

export function reportCostBucket(stage: string): keyof ReportStageCosts | null {
  if (stage === 'research') return 'research'
  if (stage === 'opening' || stage === 'rebuttal' || stage === 'counter') return 'debate'
  if (stage === 'chair') return 'chair'
  return null
}

export function addStageCost(prev: StageCost, add: StageCost): StageCost {
  return {
    billedUsd: prev.billedUsd + add.billedUsd,
    estimatedUsd: prev.estimatedUsd + add.estimatedUsd,
    calls: prev.calls + add.calls,
  }
}

export function totalReportCostUsd(costs: ReportStageCosts): number {
  const parts = [costs.research, costs.debate, costs.chair]
  return parts.reduce((sum, row) => sum + row.billedUsd + row.estimatedUsd, 0)
}

export function deepReportMargin(costUsd: number, credits = 100): {
  revenueUsd: number
  costUsd: number
  marginUsd: number
  marginPct: number
} {
  const revenueUsd = credits * LEAGUE_CREDIT_USD
  const marginUsd = revenueUsd - costUsd
  return {
    revenueUsd: Number(revenueUsd.toFixed(4)),
    costUsd: Number(costUsd.toFixed(4)),
    marginUsd: Number(marginUsd.toFixed(4)),
    marginPct: revenueUsd > 0 ? Number(((marginUsd / revenueUsd) * 100).toFixed(1)) : 0,
  }
}

export function reportStageFor(state: {
  research?: unknown
  openings?: unknown
  rebuttals?: unknown
  counters?: unknown
  chairReport?: unknown
}): 'research' | 'opening' | 'rebuttal' | 'counter' | 'chair' {
  if (!state.research) return 'research'
  if (!state.openings) return 'opening'
  if (!state.rebuttals) return 'rebuttal'
  if (!state.counters && rebuttalsAwaitCounter(state.rebuttals)) return 'counter'
  return 'chair'
}
