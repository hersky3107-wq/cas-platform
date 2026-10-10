import type { BaselineRisk, EngineResult, Hypothesis } from '../engine/schema'

/** AI text we translate. Evidence link titles stay in the source language and are omitted. */
export type TranslatedHypothesis = {
  title: string
  what_to_do: string[]
  why_humans_miss: string
}

export type TranslatedBaseline = {
  title: string
  what_to_do: string[]
  reason?: string
}

export type CardTranslationPayload = {
  headline: string
  summary: string
  headlines: TranslatedHypothesis[]
  missed_by_others: TranslatedHypothesis[]
  baseline_risks: TranslatedBaseline[]
}

export function hypothesisText(row: Pick<Hypothesis, 'title' | 'what_to_do' | 'why_humans_miss'>): TranslatedHypothesis {
  return {
    title: row.title,
    what_to_do: [...(row.what_to_do ?? [])],
    why_humans_miss: row.why_humans_miss,
  }
}

export function baselineText(row: Pick<BaselineRisk, 'title' | 'what_to_do' | 'reason'>): TranslatedBaseline {
  return {
    title: row.title,
    what_to_do: [...(row.what_to_do ?? [])],
    ...(row.reason ? { reason: row.reason } : {}),
  }
}

export function englishPayload(result: EngineResult): CardTranslationPayload {
  return {
    headline: result.headline_en?.trim() || result.headline_ko,
    summary: result.summary_en?.trim() || result.summary_ko,
    headlines: (result.headlines ?? []).map(hypothesisText),
    missed_by_others: (result.missed_by_others ?? []).map(hypothesisText),
    baseline_risks: (result.baseline_risks ?? []).map(baselineText),
  }
}

/** Korean headline/summary are produced by the engine; body fields may still be English. */
export function koreanSeedPayload(result: EngineResult): CardTranslationPayload {
  return {
    headline: result.headline_ko?.trim() || result.headline_en,
    summary: result.summary_ko?.trim() || result.summary_en,
    headlines: (result.headlines ?? []).map(hypothesisText),
    missed_by_others: (result.missed_by_others ?? []).map(hypothesisText),
    baseline_risks: (result.baseline_risks ?? []).map(baselineText),
  }
}

export function isCardTranslationPayload(value: unknown): value is CardTranslationPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const rec = value as Record<string, unknown>
  return typeof rec.headline === 'string' && typeof rec.summary === 'string' && Array.isArray(rec.headlines)
}

export const TRANSLATABLE_FIELD_NOTE =
  'Translate headlines, summaries, what_to_do, why_humans_miss, and baseline notes. Do not translate evidence link titles or URLs.'
