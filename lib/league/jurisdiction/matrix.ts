import type { PredictionCategory } from '@/lib/prediction/categories'
import type { JurisdictionGroup } from './types'

/**
 * AI Prediction League — (category x jurisdiction) visibility matrix.
 * DATA ONLY — this is the single file product/legal edits to change what's
 * visible where. No resolution logic lives here (see `resolve.ts`).
 *
 * DEFAULT-DENY: absence of an explicit `true` means DENIED. A group with an
 * empty/partial row is NOT "everything else allowed" — every visible
 * category must be explicitly listed. This is deliberate: adding a new
 * category to the system does not make it visible anywhere until someone
 * consciously turns it on per jurisdiction.
 *
 * Starting rules transcribed from the recorded plan:
 *  - crypto_perps: off in UK / EU / ME.
 *  - futures_derivatives, politics_election: off in ME.
 *  - politics_election: additionally auto-off during election blackout
 *    windows, layered on top of this matrix (see `election-blackout.ts`) —
 *    a jurisdiction can be "on" here and still be temporarily denied.
 *  - China mainland (CN): financial / sports / politics chips stay off
 *    (empty of those keys). `tech` and `ai_models` are ON — they are
 *    product-launch / model-release predictions, not financial, gambling,
 *    or political content, and there is no product or legal basis to hide
 *    them. Same for UNKNOWN (no geo signal): those two stay readable;
 *    everything else stays default-deny.
 *  - memecoin: treated as high-risk/speculative like crypto_perps (same
 *    category color bucket, 'red', as politics/entertainment in
 *    `lib/league/orchestrator.ts`'s CATEGORY_COLOR) and restricted
 *    similarly pending an explicit product/legal call — flagged below.
 *
 * Everything not explicitly called out above is a reasonable illustrative
 * default, NOT a legal determination — this table is intentionally the one
 * place to correct that without touching code.
 */
export const CATEGORY_JURISDICTION_MATRIX: Partial<
  Record<JurisdictionGroup, Partial<Record<PredictionCategory, true>>>
> = {
  US: {
    stock: true,
    etf_index: true,
    bond_rate: true,
    gold_metal: true,
    macro_econ: true,
    commodity_energy: true,
    crypto_spot: true,
    fx: true,
    futures_derivatives: true,
    crypto_perps: true,
    politics_election: true,
    sports: true,
    entertainment_awards: true,
    memecoin: true,
    real_estate: true,
    tech: true,
    ai_models: true,
  },
  EU: {
    stock: true,
    etf_index: true,
    bond_rate: true,
    gold_metal: true,
    macro_econ: true,
    commodity_energy: true,
    crypto_spot: true,
    fx: true,
    futures_derivatives: true,
    politics_election: true,
    sports: true,
    entertainment_awards: true,
    real_estate: true,
    tech: true,
    ai_models: true,
    // crypto_perps: OFF (retail perpetuals restricted region-wide)
    // memecoin: OFF (illustrative — same speculative-asset caution as crypto_perps)
  },
  UK: {
    stock: true,
    etf_index: true,
    bond_rate: true,
    gold_metal: true,
    macro_econ: true,
    commodity_energy: true,
    crypto_spot: true,
    fx: true,
    futures_derivatives: true,
    politics_election: true,
    sports: true,
    entertainment_awards: true,
    real_estate: true,
    tech: true,
    ai_models: true,
    // crypto_perps: OFF (FCA ban on crypto derivatives for retail)
    // memecoin: OFF (illustrative, mirrors EU)
  },
  KR: {
    stock: true,
    etf_index: true,
    bond_rate: true,
    gold_metal: true,
    macro_econ: true,
    commodity_energy: true,
    crypto_spot: true,
    fx: true,
    futures_derivatives: true,
    crypto_perps: true,
    politics_election: true,
    sports: true,
    entertainment_awards: true,
    memecoin: true,
    real_estate: true,
    tech: true,
    ai_models: true,
  },
  JP: {
    stock: true,
    etf_index: true,
    bond_rate: true,
    gold_metal: true,
    macro_econ: true,
    commodity_energy: true,
    crypto_spot: true,
    fx: true,
    futures_derivatives: true,
    crypto_perps: true,
    politics_election: true,
    sports: true,
    entertainment_awards: true,
    memecoin: true,
    real_estate: true,
    tech: true,
    ai_models: true,
  },
  ME: {
    stock: true,
    etf_index: true,
    bond_rate: true,
    gold_metal: true,
    macro_econ: true,
    commodity_energy: true,
    crypto_spot: true,
    fx: true,
    sports: true,
    entertainment_awards: true,
    real_estate: true,
    tech: true,
    ai_models: true,
    // futures_derivatives: OFF (explicit)
    // politics_election: OFF (explicit)
    // crypto_perps: OFF (mirrors UK/EU)
    // memecoin: OFF (illustrative)
  },
  CN: {
    // Financial / sports / politics stay off until there is a compliance
    // basis. tech + ai_models are not those categories.
    tech: true,
    ai_models: true,
  },
  OTHER: {
    stock: true,
    etf_index: true,
    bond_rate: true,
    gold_metal: true,
    macro_econ: true,
    commodity_energy: true,
    crypto_spot: true,
    fx: true,
    futures_derivatives: true,
    crypto_perps: true,
    politics_election: true,
    sports: true,
    entertainment_awards: true,
    real_estate: true,
    tech: true,
    ai_models: true,
    // memecoin: OFF (conservative default for an unclassified rest-of-world bucket)
  },
  UNKNOWN: {
    // No geo signal: default-deny finance/sports/politics. tech + ai_models
    // stay on — they are not restricted content.
    tech: true,
    ai_models: true,
  },
}

export function isCategoryAllowedForGroup(group: JurisdictionGroup, category: string): boolean {
  const row = CATEGORY_JURISDICTION_MATRIX[group]
  return row?.[category as PredictionCategory] === true
}
