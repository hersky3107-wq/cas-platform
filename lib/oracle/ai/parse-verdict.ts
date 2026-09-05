/**
 * Layer-2 verdict ballot parser.
 *
 * One seer returns ONE ballot. Hard budgets: an over-limit verdict_line
 * fails the parse and the adapter retries once with the strict instruction —
 * soft truncation is deliberately not used, same principle as
 * LAYER1_NARRATIVE_MAX. The panel tally is computed in code from these
 * ballots (runner/ballot.ts); no AI ever aggregates them.
 */
import { extractJsonObject } from './parse-layer1'
import { SEER_MINORITY_OPINION_MAX, verdictLineBudget } from './seer-roster'

export const VERDICT_DIRECTIONS = ['advance', 'hold', 'release'] as const
export type VerdictDirection = (typeof VERDICT_DIRECTIONS)[number]

export const VERDICT_FOCI = ['work', 'money', 'love', 'social', 'energy'] as const
export type VerdictFocus = (typeof VERDICT_FOCI)[number]

export const VERDICT_DOMAINS = ['work', 'money', 'love', 'social', 'energy'] as const
export type VerdictDomain = (typeof VERDICT_DOMAINS)[number]

export type VerdictJson = {
  verdict_line: string
  direction: VerdictDirection
  focus: VerdictFocus
  /** 0–100 integers, all five domains present. */
  domains: Record<VerdictDomain, number>
  minority_opinion: string | null
}

function parseDomains(value: unknown): Record<VerdictDomain, number> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const out = {} as Record<VerdictDomain, number>
  for (const domain of VERDICT_DOMAINS) {
    const raw = record[domain]
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
    if (raw < 0 || raw > 100) return null
    out[domain] = Math.round(raw)
  }
  return out
}

/**
 * `readerCount` sets the verdict_line budget (3→400 / 5→240 / 7→120 / 9→80
 * chars): the panel grows, each voice shrinks, total stays in one band.
 */
export function parseVerdictJson(raw: string, readerCount: number): VerdictJson | null {
  const json = extractJsonObject(raw) ?? raw.trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const record = parsed as Record<string, unknown>

  if (typeof record.verdict_line !== 'string') return null
  const verdictLine = record.verdict_line.trim()
  if (!verdictLine || [...verdictLine].length > verdictLineBudget(readerCount)) return null

  const direction = record.direction
  if (typeof direction !== 'string' || !(VERDICT_DIRECTIONS as readonly string[]).includes(direction)) {
    return null
  }

  const focus = record.focus
  if (typeof focus !== 'string' || !(VERDICT_FOCI as readonly string[]).includes(focus)) {
    return null
  }

  const domains = parseDomains(record.domains)
  if (!domains) return null

  let minorityOpinion: string | null
  if (record.minority_opinion === null || record.minority_opinion === undefined) {
    minorityOpinion = null
  } else if (typeof record.minority_opinion === 'string') {
    const trimmed = record.minority_opinion.trim()
    if (!trimmed) minorityOpinion = null
    else if ([...trimmed].length > SEER_MINORITY_OPINION_MAX) return null
    else minorityOpinion = trimmed
  } else {
    return null
  }

  return {
    verdict_line: verdictLine,
    direction: direction as VerdictDirection,
    focus: focus as VerdictFocus,
    domains,
    minority_opinion: minorityOpinion,
  }
}
