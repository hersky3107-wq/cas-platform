import { localLanguages } from '../engine/languages'
import type { ExpectedWindow } from '../hazards'
import { isHazardKind } from '../hazards'
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
  /** Teaser counts shown on the locked card; never the content itself. */
  novelty?: { only_us: number; also_seen_elsewhere: number }
  tierCounts?: { headlines: number; missed: number; baseline: number }
  /** First action line, only ever shown blurred. */
  teaser?: string
  /** Hazard keywords across tiers, for icons only. */
  hazards?: string[]
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
  baseline_risks: Array<BaselineRisk & { what_to_do_local?: string[] }>
  novelty: { only_us: number; also_seen_elsewhere: number }
  evidence: string[]
  costUsd: number
  stage: number
  headline_fallback?: boolean
  zoneKey?: string
  crossBorder?: Array<{ title: string; from_region: string; to_region: string; link: string }>
  intraZone?: Array<{ title: string; from_region: string; to_region: string; link: string }>
  predictions?: Array<{
    what: string
    where: string
    window_start: string
    window_end: string
    probability: number
    observable: string
    counts_as_hit: string
    label: string
  }>
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
  regions?: Array<{ region_id: number; name: string; iso3: string | null }>
  expected_window?: { min_days: number; max_days: number; start: string; end: string; label: string }
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
    regions: row.regions,
    expected_window: row.expected_window,
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
    Partial<
      Pick<EngineResult, 'headline_fallback' | 'headlines' | 'missed_by_others' | 'baseline_risks' | 'novelty_counts'>
    > | null
  stage?: number
}): LockedBriefCard {
  const tierCounts =
    opts.result && (opts.result.headlines || opts.result.missed_by_others || opts.result.baseline_risks)
      ? {
          headlines: opts.result.headlines?.length ?? 0,
          missed: opts.result.missed_by_others?.length ?? 0,
          baseline: opts.result.baseline_risks?.length ?? 0,
        }
      : undefined
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
    novelty: opts.result?.novelty_counts
      ? { only_us: opts.result.novelty_counts.only_us, also_seen_elsewhere: opts.result.novelty_counts.also_seen_elsewhere }
      : undefined,
    tierCounts,
    teaser: opts.result?.headlines?.find((row) => (row.what_to_do ?? []).length > 0)?.what_to_do?.[0],
    hazards: opts.result
      ? [
          ...new Set(
            [...(opts.result.headlines ?? []), ...(opts.result.missed_by_others ?? [])].flatMap((row) => row.hazards ?? []),
          ),
        ]
      : undefined,
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
    baseline_risks: opts.result.baseline_risks.map((row) => ({
      ...row,
      what_to_do_local: [...(row.what_to_do ?? [])],
    })),
    novelty: opts.result.novelty_counts ?? { only_us: 0, also_seen_elsewhere: 0 },
    evidence: opts.searchUrls,
    costUsd: opts.costUsd,
    stage: cardStageFromResult(opts.result),
    headline_fallback: opts.result.headline_fallback,
    zoneKey: opts.result.zone_key,
    crossBorder: opts.result.cross_border,
    intraZone: opts.result.intra_zone,
    predictions: opts.result.predictions,
  }
}

export type FragilityGroup = { kind: string; names: string[] }
export type FreeTriggerFact = {
  key: string
  hazardKind?: string
  expectedWindow?: ExpectedWindow
  sumMm?: number
  maxDayMm?: number
  peakM3s?: number
  mag?: number
  rateMultiplier?: number
  count7d?: number
  usual7d?: number
  oaf?: { m5: number; m6: number; m7: number }
  precursors?: Array<{ kind: string; multiplier?: number; steps?: number }>
}

export function freeLayerFromDetail(detail: unknown): {
  fragility: string[]
  fragilityGroups: FragilityGroup[]
  peopleNorm: number | null
  peopleCount: number | null
  urban: Array<{ name: string; pop: number }>
  triggerFacts: FreeTriggerFact[]
} {
  const rec = detail && typeof detail === 'object' && !Array.isArray(detail) ? (detail as Record<string, unknown>) : null
  const fragility: string[] = []
  const groupMap = new Map<string, string[]>()
  const pushItem = (kind: string | undefined, name: string) => {
    fragility.push(name)
    const key = (kind ?? 'site').trim() || 'site'
    const list = groupMap.get(key) ?? []
    if (!list.includes(name)) list.push(name)
    groupMap.set(key, list)
  }
  if (Array.isArray(rec?.fragility_items)) {
    for (const item of rec.fragility_items) {
      if (!item || typeof item !== 'object') continue
      const name = (item as { name?: unknown }).name
      const kind = (item as { kind?: unknown }).kind
      if (typeof name === 'string') pushItem(typeof kind === 'string' ? kind : undefined, name)
    }
  } else if (Array.isArray(rec?.fragility)) {
    for (const item of rec.fragility) {
      if (typeof item === 'string') pushItem(undefined, item)
      else if (item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string') {
        const kind = (item as { kind?: unknown }).kind
        pushItem(typeof kind === 'string' ? kind : undefined, (item as { name: string }).name)
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
  const urbanSum = urban.reduce((sum, row) => sum + (row.pop || 0), 0)
  const storedPop = typeof rec?.urban_pop === 'number' && Number.isFinite(rec.urban_pop) ? rec.urban_pop : null
  const peopleCount = storedPop && storedPop > 0 ? storedPop : urbanSum > 0 ? urbanSum : null
  const triggerFacts: FreeTriggerFact[] = []
  if (Array.isArray(rec?.components)) {
    for (const item of rec.components) {
      if (!item || typeof item !== 'object') continue
      const key = typeof (item as { key?: unknown }).key === 'string' ? (item as { key: string }).key : ''
      const value = typeof (item as { value?: unknown }).value === 'number' ? (item as { value: number }).value : 0
      if (!key || value <= 0) continue
      const raw =
        (item as { raw?: unknown }).raw && typeof (item as { raw?: unknown }).raw === 'object'
          ? ((item as { raw: Record<string, unknown> }).raw)
          : {}
      const fact: FreeTriggerFact = { key }
      if (typeof raw.hazard_kind === 'string' && isHazardKind(raw.hazard_kind)) fact.hazardKind = raw.hazard_kind
      if (raw.expected_window && typeof raw.expected_window === 'object') {
        fact.expectedWindow = raw.expected_window as ExpectedWindow
      }
      if (typeof raw.sum_mm === 'number') fact.sumMm = raw.sum_mm
      if (typeof raw.max_day_mm === 'number') fact.maxDayMm = raw.max_day_mm
      if (typeof raw.peak_m3s === 'number') fact.peakM3s = raw.peak_m3s
      if (typeof raw.mag === 'number') fact.mag = raw.mag
      if (typeof raw.rate_multiplier === 'number') fact.rateMultiplier = raw.rate_multiplier
      if (typeof raw.count_7d === 'number') fact.count7d = raw.count_7d
      if (typeof raw.usual_7d === 'number') fact.usual7d = raw.usual_7d
      if (typeof raw.oaf_m5 === 'number' && typeof raw.oaf_m6 === 'number' && typeof raw.oaf_m7 === 'number') {
        fact.oaf = { m5: raw.oaf_m5, m6: raw.oaf_m6, m7: raw.oaf_m7 }
      }
      if (Array.isArray(raw.precursors)) {
        const bits = raw.precursors.flatMap((bit) => {
          if (!bit || typeof bit !== 'object') return []
          const kind = (bit as { kind?: unknown }).kind
          if (typeof kind !== 'string') return []
          const multiplier = (bit as { multiplier?: unknown }).multiplier
          const steps = (bit as { steps?: unknown }).steps
          return [{
            kind,
            ...(typeof multiplier === 'number' ? { multiplier } : {}),
            ...(typeof steps === 'number' ? { steps } : {}),
          }]
        })
        if (bits.length) fact.precursors = bits
      }
      triggerFacts.push(fact)
    }
  }
  return {
    fragility,
    fragilityGroups: [...groupMap.entries()].map(([kind, names]) => ({ kind, names })),
    peopleNorm,
    peopleCount,
    urban,
    triggerFacts,
  }
}
