import type { BaselineRisk, EngineResult, Hypothesis } from '../engine/schema'
import type { LockedBriefCard, PublicHypothesis, UnlockedBriefCard } from '../public/card'
import { noveltyBadge } from '../public/labels'
import type { CardTranslationPayload } from './payload'

function overlayHypothesis(row: Hypothesis, text: CardTranslationPayload['headlines'][number] | undefined): Hypothesis {
  if (!text) return row
  return {
    ...row,
    title: text.title || row.title,
    what_to_do: text.what_to_do.length ? text.what_to_do : row.what_to_do,
    why_humans_miss: text.why_humans_miss || row.why_humans_miss,
  }
}

function overlayBaseline(row: BaselineRisk, text: CardTranslationPayload['baseline_risks'][number] | undefined): BaselineRisk {
  if (!text) return row
  return {
    ...row,
    title: text.title || row.title,
    what_to_do: text.what_to_do.length ? text.what_to_do : row.what_to_do,
    reason: text.reason ?? row.reason,
  }
}

export function applyPayloadToResult(result: EngineResult, payload: CardTranslationPayload | null): EngineResult {
  if (!payload) return result
  return {
    ...result,
    headline_ko: payload.headline || result.headline_ko,
    headline_en: payload.headline || result.headline_en,
    summary_ko: payload.summary || result.summary_ko,
    summary_en: payload.summary || result.summary_en,
    headlines: result.headlines.map((row, i) => overlayHypothesis(row, payload.headlines[i])),
    missed_by_others: result.missed_by_others.map((row, i) => overlayHypothesis(row, payload.missed_by_others[i])),
    baseline_risks: result.baseline_risks.map((row, i) => overlayBaseline(row, payload.baseline_risks[i])),
  }
}

export function applyPayloadToPublicHypothesis(
  row: PublicHypothesis,
  text: CardTranslationPayload['headlines'][number] | undefined,
): PublicHypothesis {
  if (!text) return row
  const what = text.what_to_do.length ? text.what_to_do : row.what_to_do_ko
  return {
    ...row,
    title: text.title || row.title,
    why_humans_miss: text.why_humans_miss || row.why_humans_miss,
    what_to_do_ko: what,
    what_to_do_local: row.what_to_do_local.length ? row.what_to_do_local : row.what_to_do_ko,
    noveltyBadge: noveltyBadge(row.novelty),
  }
}

export function applyPayloadToUnlockedCard(card: UnlockedBriefCard, payload: CardTranslationPayload | null): UnlockedBriefCard {
  if (!payload) return card
  return {
    ...card,
    headline_ko: payload.headline || card.headline_ko,
    headline_en: payload.headline || card.headline_en,
    summary_ko: payload.summary || card.summary_ko,
    summary_en: payload.summary || card.summary_en,
    headlines: card.headlines.map((row, i) => applyPayloadToPublicHypothesis(row, payload.headlines[i])),
    missed_by_others: card.missed_by_others.map((row, i) =>
      applyPayloadToPublicHypothesis(row, payload.missed_by_others[i]),
    ),
    baseline_risks: card.baseline_risks.map((row, i) => overlayBaseline(row, payload.baseline_risks[i])),
  }
}

export function applyPayloadToLockedCard(card: LockedBriefCard, payload: CardTranslationPayload | null): LockedBriefCard {
  if (!payload) return card
  return { ...card, headline_ko: payload.headline || card.headline_ko }
}
