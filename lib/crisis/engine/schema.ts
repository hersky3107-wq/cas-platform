import { z } from 'zod'

export const HORIZONS = ['7d', '30d', '180d'] as const
export const horizonSchema = z.enum(HORIZONS)
export type Horizon = z.infer<typeof horizonSchema>

export const ENGINE_ROLES = ['dept_analyst', 'query_writer', 'search', 'hunter', 'red_team', 'judge'] as const
export const engineRoleSchema = z.enum(ENGINE_ROLES)
export type EngineRole = z.infer<typeof engineRoleSchema>

export const DEPARTMENTS = [
  'natural-hydro',
  'natural-geo',
  'health',
  'conflict-political',
  'infrastructure-economy',
] as const
export type Department = (typeof DEPARTMENTS)[number]

export const hypothesisSchema = z
  .object({
    title: z.string().min(1),
    chain: z
      .array(
        z
          .object({
            step: z.string().min(1),
            cascade_id: z.string().nullable(),
          })
          .strict(),
      )
      .min(1),
    horizon: horizonSchema,
    possibility: z.enum(['low', 'medium', 'high']),
    why_humans_miss: z.string().min(1),
    evidence: z.array(
      z
        .object({
          type: z.string().min(1),
          ref: z.string().min(1),
          url: z.string().optional(),
          date: z.string().optional(),
          language: z.string().optional(),
          document: z.string().optional(),
          specific: z.boolean().optional(),
        })
        .strict(),
    ),
    what_to_do: z.array(z.string().min(1)).min(1),
    official_links: z.array(
      z
        .object({
          label: z.string().min(1),
          url: z.string().min(1),
        })
        .strict(),
    ),
    proposed_by: z.array(z.string().min(1)).min(1),
    weakness_notes: z.array(z.string()),
    novelty: z.enum(['only_us', 'also_seen_elsewhere']),
    stage: z.number().int().min(1).max(5),
    confidence: z.enum(['low', 'medium', 'high']),
    outsider: z.boolean(),
    hazards: z.array(z.string()).optional(),
    departments: z.array(z.string()).optional(),
    entities: z.array(z.string()).optional(),
    mechanism: z.string().optional(),
    lead_time_days: z.object({ min: z.number(), max: z.number() }).strict().optional(),
    early_indicators: z.array(z.string()).optional(),
    falsifier: z.string().optional(),
    non_obviousness: z.number().min(0).max(1).optional(),
    twist: z.string().optional(),
    novelty_match: noveltyMatchSchema().nullable().optional(),
    regions: z
      .array(
        z.object({ region_id: z.number(), name: z.string(), iso3: z.string().nullable() }).strict(),
      )
      .optional(),
    expected_window: z
      .object({
        min_days: z.number(),
        max_days: z.number(),
        start: z.string(),
        end: z.string(),
        label: z.string(),
      })
      .strict()
      .optional(),
  })
  .strict()

export type Hypothesis = z.infer<typeof hypothesisSchema>

function noveltyMatchSchema() {
  return z
    .object({
      source: z.enum(['reliefweb', 'gdacs', 'metaculus', 'mainstream']),
      title: z.string(),
      url: z.string(),
      date: z.string().nullable(),
      scope: z.enum(['region', 'country']),
      hazard: z.string(),
      matched_span: z.string(),
    })
    .strict()
}

export function backgroundCoverageSchema() {
  return z
    .object({
      source: z.enum(['reliefweb', 'gdacs', 'metaculus', 'mainstream']),
      title: z.string(),
      url: z.string(),
      hazard: z.string(),
      matched_span: z.string(),
    })
    .strict()
}

const baselineRiskSchema = z
  .object({
    title: z.string().min(1),
    stage: z.number().int().min(1).max(5),
    possibility: z.enum(['low', 'medium', 'high']),
    what_to_do: z.array(z.string().min(1)).min(1),
    reason: z.string().optional(),
    regions: z
      .array(
        z.object({ region_id: z.number(), name: z.string(), iso3: z.string().nullable() }).strict(),
      )
      .optional(),
  })
  .strict()

export type BaselineRisk = z.infer<typeof baselineRiskSchema>

export const engineResultSchema = z
  .object({
    headlines: z.array(hypothesisSchema),
    missed_by_others: z.array(hypothesisSchema),
    summary_ko: z.string().min(1),
    summary_en: z.string().min(1),
    headline_ko: z.string().min(1),
    headline_en: z.string().min(1),
    headline_fallback: z.boolean().optional(),
    map_focus: z
      .object({
        lat: z.number(),
        lon: z.number(),
        zoom: z.number(),
      })
      .strict(),
    partial: z.boolean(),
    baseline_risks: z.array(baselineRiskSchema).min(3).max(5),
    background_coverage: z.array(backgroundCoverageSchema()).optional(),
    coverage: z.record(z.string(), z.number()).optional(),
    novelty_counts: z.object({ only_us: z.number(), also_seen_elsewhere: z.number() }).strict().optional(),
    rejected: z.array(z.object({ model: z.string(), title: z.string(), reasons: z.array(z.string()) }).strict()).optional(),
    obvious: z.array(z.string()).optional(),
    zone_key: z.string().optional(),
    cross_border: z
      .array(
        z
          .object({
            title: z.string(),
            from_region: z.string(),
            to_region: z.string(),
            link: z.string(),
          })
          .strict(),
      )
      .optional(),
    intra_zone: z
      .array(
        z
          .object({
            title: z.string(),
            from_region: z.string(),
            to_region: z.string(),
            link: z.string(),
          })
          .strict(),
      )
      .optional(),
    predictions: z
      .array(
        z
          .object({
            what: z.string().min(1),
            where: z.string().min(1),
            window_start: z.string().min(1),
            window_end: z.string().min(1),
            probability: z.number().min(0).max(1),
            observable: z.string().min(1),
            counts_as_hit: z.string().min(1),
            label: z.string().min(1),
          })
          .strict(),
      )
      .max(3)
      .optional(),
  })
  .strict()

export type EngineResult = z.infer<typeof engineResultSchema>

export interface EngineCard {
  region_id: number
  name: string
  country: string
  iso3: string | null
  lat: number
  lon: number
  level: number
  horizon: Horizon
  components: Array<{ key: string; value: number; raw: Record<string, unknown> }>
  fragility: Array<{ kind: string; name: string }>
  cascades: Array<{ id: string; trigger: string; effect: string }>
  context: string[]
  urban: Array<{ name: string; pop: number }>
  zone_key?: string
  members?: Array<{ region_id: number; name: string; country: string; iso3: string | null; lat?: number; lon?: number }>
  neighbor_edges?: Array<{ regionId: number; neighborId: number; sharedBorder: boolean }>
  neighbors?: string[]
}
