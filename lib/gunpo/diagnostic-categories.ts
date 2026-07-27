/**
 * GUNPO diagnostic (진단형) — client-safe category definitions.
 *
 * Pure constants and types — NO server imports, NO connectors, NO 'server-only'.
 * Safe to import from both 'use client' pages and server-side engine files.
 *
 * diagnostic.ts (engine) imports FROM this file.
 * diagnostic/page.tsx (client) imports FROM this file.
 *
 * STEP 2 (구조 복제) STATE: both category lists were emptied to `[]` — the
 * original motie categories were 산업별 수출 카테고리(trade) / 자원·에너지
 * 카테고리(warroom), which don't apply to 군포시. TODO(군포): populate with
 * 도시·정비(trade) / 시민·정주(warroom) axis categories.
 */

/** Mirrors JejuCouncilMode from brief.ts — defined locally to stay client-safe. */
export type CouncilMode = 'trade' | 'warroom'

export type DiagnosticCategory = {
  id: string
  emoji: string
  label: string
  /** Preset open question fired when the button is clicked. */
  presetQuestion: string
  /** Seed phrase for the Perplexity status search. */
  searchSeed: string
  /**
   * Data-backing level.
   * 'data'   = live public-data connector directly backs this category.
   * 'search' = Perplexity / AI search only; no live connector.
   * 'hybrid' = partial live connector data + search-augmented.
   */
  backing: 'data' | 'search' | 'hybrid'
  /** @deprecated Use `backing` instead. Kept for smooth migration of callers. */
  dataBacked: boolean
}

// ---------------------------------------------------------------------------
// TRADE axis (도시·정비) — TODO(군포): 카테고리 미정
// ---------------------------------------------------------------------------

export const TRADE_DIAGNOSTIC_CATEGORIES: DiagnosticCategory[] = []

// ---------------------------------------------------------------------------
// WARROOM axis (시민·정주) — TODO(군포): 카테고리 미정
// ---------------------------------------------------------------------------

export const WARROOM_DIAGNOSTIC_CATEGORIES: DiagnosticCategory[] = []

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export function getDiagnosticCategories(mode: CouncilMode): DiagnosticCategory[] {
  return mode === 'trade' ? TRADE_DIAGNOSTIC_CATEGORIES : WARROOM_DIAGNOSTIC_CATEGORIES
}

export function getDiagnosticCategory(
  id: string,
  mode: CouncilMode,
): DiagnosticCategory | undefined {
  return getDiagnosticCategories(mode).find((c) => c.id === id)
}
