import 'server-only'

/**
 * FESTIVAL success-forecast — standalone types.
 *
 * ISOLATION INVARIANT (non-negotiable):
 *   This module MUST NOT import or union with lib/motie's JejuCouncilMode, nor
 *   any lib/jeju type. Festival is a fully separate surface: deleting lib/festival
 *   leaves MOTIE (수출참모/워룸) + AX Jeju governance byte-for-byte identical.
 *   Festival code may depend ONLY on shared infra (lib/ai/router, lib/extract).
 */

/**
 * Festival council mode. Deliberately a standalone literal — NOT unioned with
 * JejuCouncilMode. There is exactly one festival register.
 */
export type FestivalMode = 'festival'

/** The 8 on-screen investigators (7 scoring LLMs + 1 search-only). */
export type FestivalInvestigatorId =
  | 'demand'
  | 'budget'
  | 'safety_reputation'
  | 'program_diff'
  | 'access_tourism'
  | 'marketing'
  | 'global_tourism'
  | 'benchmark_search'

/** 'score' = 0–100 흥행 score + debate; 'search' = Perplexity fact-finder, no score/debate. */
export type FestivalInvestigatorKind = 'score' | 'search'

/**
 * Router provider keys used by festival investigators. These are the SAME
 * strings lib/ai/router already knows (a subset of ExtendedAiProviderName), but
 * re-declared locally so festival does not import a MOTIE/Jeju-shared type.
 * No new provider is introduced.
 */
export type FestivalProvider =
  | 'openai'
  | 'google'
  | 'anthropic'
  | 'xai'
  | 'deepseek'
  | 'mistral'
  | 'perplexity'

export type FestivalInvestigatorPersona = {
  id: FestivalInvestigatorId
  /** Korean-facing role name shown in the investigation UI. */
  roleLabelKo: string
  kind: FestivalInvestigatorKind
  /** Router provider key (1:1 for scoring seats; perplexity for search). */
  provider: FestivalProvider
  /**
   * Optional model override for this seat.
   * - safety_reputation → Claude Opus (flagship)
   * - global_tourism → Claude Sonnet (router default; listed for clarity)
   * Omit → router MODEL_BY_PROVIDER default.
   */
  modelOverride?: string
  /** English prompt body: expert lens, what to judge, scoring rules (or search-only). */
  promptEn: string
  /**
   * Debate-stage seat id after merging.
   * null = does not debate (Perplexity).
   * Shared id = merged into one of the 6 debate seats.
   */
  debateSeatId: string | null
}

/** One merged debate seat (investigation UI still shows all 8 investigators). */
export type FestivalDebateSeat = {
  id: string
  labelKo: string
  /** Which on-screen investigators feed this debate seat. */
  investigatorIds: readonly FestivalInvestigatorId[]
}
