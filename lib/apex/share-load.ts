/**
 * APEX — shared load-assembly logic.
 *
 * Pure mappers that turn raw DB rows (apex_turns / apex_results) into the plain
 * objects consumed by:
 *   - the authenticated `load` action in app/api/apex/route.ts (resume), and
 *   - the public share page at app/share/[share_id]/page.tsx.
 *
 * Mirrors lib/synod/share-load.ts. The load turn shape carries the raw provider
 * key in `ai` (not a brand label); callers that want brand names map it themselves.
 *
 * All functions are PURE: no DB calls, no network, no logging, no mutation.
 */

/** Loosely-typed DB row (the APEX supabase client is untyped). */
type Row = Record<string, unknown>

/** One flagship answer as emitted by the load action / share page. */
export type ApexLoadTurn = {
  /** Raw provider key (e.g. "openai"), NOT a brand label. */
  ai: string
  model: string
  content: string
  ms: number | null
}

/** Map apex_turns rows → ordered answer turns (caller controls row order). */
export function mapApexTurns(rows: readonly Row[] | null | undefined): ApexLoadTurn[] {
  return (rows ?? []).map((row) => ({
    ai: String(row.ai_name),
    model: typeof row.model_id === 'string' ? row.model_id : '',
    content: String(row.content ?? ''),
    ms: typeof row.ms === 'number' ? row.ms : null,
  }))
}

/** Map the single apex_results row → synthesis string, or null when absent. */
export function mapApexResult(row: Row | null | undefined): string | null {
  if (!row) return null
  return typeof row.synthesis === 'string' && row.synthesis.trim() ? row.synthesis : null
}

/**
 * Assemble a full APEX session view from the two DB result sets. Callers run the
 * (unchanged) DB selects, then hand the raw `.data` here.
 */
export function assembleApexSession(input: {
  turnsRows: readonly Row[] | null | undefined
  resultRow: Row | null | undefined
}): {
  turns: ApexLoadTurn[]
  synthesis: string | null
} {
  return {
    turns: mapApexTurns(input.turnsRows),
    synthesis: mapApexResult(input.resultRow),
  }
}
