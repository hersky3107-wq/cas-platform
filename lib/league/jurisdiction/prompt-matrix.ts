import type { JurisdictionGroup } from './types'

/**
 * Freeform gateway — (jurisdiction × category) PROMPT permission table.
 * DATA ONLY. Flip a cell here during per-category review; do not add
 * `if (group === 'KR' && category === 'stocks')` in the shell or adapters.
 *
 * This is a different axis from `CATEGORY_JURISDICTION_MATRIX`:
 *  - that table decides whether the CATEGORY (chips, cards) is visible
 *  - this table decides whether the FREEFORM PROMPT BOX / gateway is allowed
 *
 * Korea financial categories are chips-only. Memecoin is blocked as a
 * category in Korea (see `matrix.ts`); the prompt cell is still false here
 * so a later category re-enable does not silently reopen the box.
 *
 * DEFAULT-DENY: a missing cell is denied. Every group × category pair below
 * is an explicit boolean so a new category cannot inherit a prompt by accident.
 */

export const PROMPT_CATEGORY_IDS = [
  'sports',
  'crypto',
  'stocks',
  'fx',
  'gold_metals',
  'index_etf',
  'commodities_energy',
  'politics_election',
  'entertainment',
  'memecoin',
  'real_estate',
  'macro_econ',
  'tech',
  'ai_models',
] as const

export type PromptCategoryId = (typeof PROMPT_CATEGORY_IDS)[number]

export const FINANCIAL_PROMPT_CATEGORIES: readonly PromptCategoryId[] = [
  'stocks',
  'index_etf',
  'gold_metals',
  'commodities_energy',
  'fx',
  'crypto',
  'memecoin',
  'real_estate',
]

export const NON_FINANCIAL_PROMPT_CATEGORIES: readonly PromptCategoryId[] = [
  'sports',
  'politics_election',
  'entertainment',
  'tech',
  'ai_models',
  'macro_econ',
]

type PromptRow = Record<PromptCategoryId, boolean>

/**
 * Initial cells (2026-09-09):
 *  - KR: prompt OFF for every financial category (chips only).
 *  - Non-financial: prompt ON everywhere, pending per-category review.
 *  - Other jurisdictions: financial prompt ON (category matrix may still hide the chip).
 *  - UNKNOWN: financial prompt OFF (no registered country / no IP).
 */
export const PROMPT_ALLOWED: Record<JurisdictionGroup, PromptRow> = {
  US: {
    sports: true,
    crypto: true,
    stocks: true,
    fx: true,
    gold_metals: true,
    index_etf: true,
    commodities_energy: true,
    politics_election: true,
    entertainment: true,
    memecoin: true,
    real_estate: true,
    macro_econ: true,
    tech: true,
    ai_models: true,
  },
  EU: {
    sports: true,
    crypto: true,
    stocks: true,
    fx: true,
    gold_metals: true,
    index_etf: true,
    commodities_energy: true,
    politics_election: true,
    entertainment: true,
    memecoin: false,
    real_estate: true,
    macro_econ: true,
    tech: true,
    ai_models: true,
  },
  UK: {
    sports: true,
    crypto: true,
    stocks: true,
    fx: true,
    gold_metals: true,
    index_etf: true,
    commodities_energy: true,
    politics_election: true,
    entertainment: true,
    memecoin: false,
    real_estate: true,
    macro_econ: true,
    tech: true,
    ai_models: true,
  },
  KR: {
    sports: true,
    crypto: false,
    stocks: false,
    fx: false,
    gold_metals: false,
    index_etf: false,
    commodities_energy: false,
    politics_election: true,
    entertainment: true,
    memecoin: false,
    real_estate: false,
    macro_econ: true,
    tech: true,
    ai_models: true,
  },
  JP: {
    sports: true,
    crypto: true,
    stocks: true,
    fx: true,
    gold_metals: true,
    index_etf: true,
    commodities_energy: true,
    politics_election: true,
    entertainment: true,
    memecoin: true,
    real_estate: true,
    macro_econ: true,
    tech: true,
    ai_models: true,
  },
  ME: {
    sports: true,
    crypto: true,
    stocks: true,
    fx: true,
    gold_metals: true,
    index_etf: true,
    commodities_energy: true,
    politics_election: true,
    entertainment: true,
    memecoin: false,
    real_estate: true,
    macro_econ: true,
    tech: true,
    ai_models: true,
  },
  CN: {
    sports: true,
    crypto: false,
    stocks: false,
    fx: false,
    gold_metals: false,
    index_etf: false,
    commodities_energy: false,
    politics_election: true,
    entertainment: true,
    memecoin: false,
    real_estate: false,
    macro_econ: true,
    tech: true,
    ai_models: true,
  },
  OTHER: {
    sports: true,
    crypto: true,
    stocks: true,
    fx: true,
    gold_metals: true,
    index_etf: true,
    commodities_energy: true,
    politics_election: true,
    entertainment: true,
    memecoin: false,
    real_estate: true,
    macro_econ: true,
    tech: true,
    ai_models: true,
  },
  UNKNOWN: {
    sports: true,
    crypto: false,
    stocks: false,
    fx: false,
    gold_metals: false,
    index_etf: false,
    commodities_energy: false,
    politics_election: true,
    entertainment: true,
    memecoin: false,
    real_estate: false,
    macro_econ: true,
    tech: true,
    ai_models: true,
  },
}

export function isPromptAllowedForGroup(group: JurisdictionGroup, category: string): boolean {
  const row = PROMPT_ALLOWED[group]
  return row?.[category as PromptCategoryId] === true
}
