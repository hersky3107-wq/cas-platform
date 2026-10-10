import { localLanguages } from '../engine/languages'
import type { BaselineRisk, EngineResult, Hypothesis } from '../engine/schema'
import { noveltyBadge } from './labels'

export interface LockedBriefCard {
  runId: string
  regionId: number
  regionName: string
  country: string
  status: 'public'
  locked: true
  headline_ko: string
  stage: number
  headline_fallback?: boolean
  novelty?: never
}

export interface UnlockedBriefCard {
  runId: string
  regionId: number
  regionName: string
  country: string
  iso3: string | null
  status: 'public'
  locked: false
  headline_ko: string
  headline_en: string
  summary_ko: string
  summary_en: string
  headlines: PublicHypothesis[]
  missed_by_others: PublicHypothesis[]
  baseline_risks: BaselineRisk[]
  novelty: { only_us: number; also_seen_elsewhere: number }
  evidence: string[]
  costUsd: number
  stage: number
  headline_fallback?: boolean
}

export interface PublicHypothesis {
  title: string
  novelty: 'only_us' | 'also_seen_elsewhere'
  noveltyBadge: string | null
  stage: number
  possibility: string
  why_humans_miss: string
  what_to_do_ko: string[]
  what_to_do_local: string[]
  localLanguage: string
  official_links: Array<{ label: string; url: string }>
  evidence: Array<{ type: string; ref: string; url?: string }>
  hazards: string[]
}

export function localLanguageCode(iso3: string | null): string {
  const langs = localLanguages(iso3)
  return langs.find((code) => code !== 'en') ?? 'en'
}

function asHypothesis(row: Hypothesis): PublicHypothesis {
  const steps = row.what_to_do ?? []
  return {
    title: row.title,
    novelty: row.novelty,
    noveltyBadge: noveltyBadge(row.novelty),
    stage: row.stage,
    possibility: row.possibility,
    why_humans_miss: row.why_humans_miss,
    what_to_do_ko: steps,
    what_to_do_local: steps,
    localLanguage: 'en',
    official_links: row.official_links ?? [],
    evidence: row.evidence ?? [],
    hazards: row.hazards ?? [],
  }
}

export function cardStageFromResult(
  result: Partial<Pick<EngineResult, 'headlines' | 'missed_by_others' | 'baseline_risks'>> | null,
): number {
  let max = 1
  if (!result) return max
  for (const row of [...(result.headlines ?? []), ...(result.missed_by_others ?? [])]) {
    if (typeof row.stage === 'number' && row.stage > max) max = row.stage
  }
  for (const row of result.baseline_risks ?? []) {
    if (typeof row.stage === 'number' && row.stage > max) max = row.stage
  }
  return max
}

export function lockBriefCard(opts: {
  runId: string
  regionId: number
  regionName: string
  country: string
  result: Pick<EngineResult, 'headline_ko'> &
    Partial<Pick<EngineResult, 'headline_fallback' | 'headlines' | 'missed_by_others' | 'baseline_risks'>> | null
  stage?: number
}): LockedBriefCard {
  return {
    runId: opts.runId,
    regionId: opts.regionId,
    regionName: opts.regionName,
    country: opts.country,
    status: 'public',
    locked: true,
    headline_ko: opts.result?.headline_ko?.trim() || '브리핑',
    stage: opts.stage ?? cardStageFromResult(opts.result),
    headline_fallback: opts.result?.headline_fallback,
  }
}

export function unlockBriefCard(opts: {
  runId: string
  regionId: number
  regionName: string
  country: string
  iso3: string | null
  result: EngineResult
  searchUrls: string[]
  costUsd: number
}): UnlockedBriefCard {
  const local = localLanguageCode(opts.iso3)
  const localize = (row: Hypothesis): PublicHypothesis => ({
    ...asHypothesis(row),
    localLanguage: local,
  })
  return {
    runId: opts.runId,
    regionId: opts.regionId,
    regionName: opts.regionName,
    country: opts.country,
    iso3: opts.iso3,
    status: 'public',
    locked: false,
    headline_ko: opts.result.headline_ko,
    headline_en: opts.result.headline_en,
    summary_ko: opts.result.summary_ko,
    summary_en: opts.result.summary_en,
    headlines: opts.result.headlines.map(localize),
    missed_by_others: opts.result.missed_by_others.map(localize),
    baseline_risks: opts.result.baseline_risks,
    novelty: opts.result.novelty_counts ?? { only_us: 0, also_seen_elsewhere: 0 },
    evidence: opts.searchUrls,
    costUsd: opts.costUsd,
    stage: cardStageFromResult(opts.result),
    headline_fallback: opts.result.headline_fallback,
  }
}

export function freeLayerFromDetail(detail: unknown): {
  fragility: string[]
  peopleNorm: number | null
  urban: Array<{ name: string; pop: number }>
} {
  const rec = detail && typeof detail === 'object' && !Array.isArray(detail) ? (detail as Record<string, unknown>) : null
  const fragility: string[] = []
  if (Array.isArray(rec?.fragility_items)) {
    for (const item of rec.fragility_items) {
      if (item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string') {
        fragility.push((item as { name: string }).name)
      }
    }
  } else if (Array.isArray(rec?.fragility)) {
    for (const item of rec.fragility) {
      if (typeof item === 'string') fragility.push(item)
      else if (item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string') {
        fragility.push((item as { name: string }).name)
      }
    }
  }
  const urban: Array<{ name: string; pop: number }> = []
  const urbanRaw = rec?.urban_centres ?? rec?.urban
  if (Array.isArray(urbanRaw)) {
    for (const item of urbanRaw) {
      if (!item || typeof item !== 'object') continue
      const name = (item as { name?: unknown }).name
      const pop = (item as { pop?: unknown }).pop
      if (typeof name === 'string') urban.push({ name, pop: typeof pop === 'number' ? pop : 0 })
    }
  }
  const peopleNorm = typeof rec?.people_norm === 'number' ? rec.people_norm : null
  return { fragility, peopleNorm, urban }
}
