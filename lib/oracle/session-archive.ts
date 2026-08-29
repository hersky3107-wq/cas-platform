/**
 * Projection from the runner's poll DTO into the legacy `oracle_sessions`
 * archive row (share link + best-answer vote).
 *
 * The runner owns the prose in `oracle_readings`; this archive exists only so
 * the share page and the vote keep working unchanged. It is written once, at
 * terminal status.
 *
 * LEAKAGE RULE: every entry is BUILT from an explicit two-field whitelist.
 * A row from `oracle_readings` is never spread into the payload, because that
 * table carries a server-only `model` column (exact provider model id) next to
 * `brand`. Spreading is what would leak it, so the shape of this function —
 * read two named fields, construct a fresh literal — is the guard.
 */
import type { OracleSessionResponse } from './session-types'

/** Only the fields this projection is allowed to read from a reading. */
export type ArchiveReadingSource = {
  brand: string
  narrative: string | null
}

export type ArchiveSynthesisSource = {
  brand: string
  conclusion: string | null
}

export type ArchiveProjectionInput = {
  readings: readonly ArchiveReadingSource[]
  /** The synthesizer brand + its conclusion, appended last. */
  synthesis?: ArchiveSynthesisSource | null
}

function entry(brand: string, content: string | null): OracleSessionResponse | null {
  const ai_name = brand.trim()
  if (!ai_name) return null
  const text = typeof content === 'string' ? content.trim() : ''
  // Two keys, both from named locals. Do not replace with a spread.
  return { ai_name, content: text === '' ? null : text }
}

/**
 * Readers in roster order, then the synthesizer. Brands with no name are
 * dropped rather than archived as an anonymous entry.
 */
export function projectOracleArchiveResponses(
  input: ArchiveProjectionInput,
): OracleSessionResponse[] {
  const out: OracleSessionResponse[] = []
  for (const reading of input.readings) {
    const row = entry(reading.brand, reading.narrative)
    if (row) out.push(row)
  }
  if (input.synthesis) {
    const row = entry(input.synthesis.brand, input.synthesis.conclusion)
    if (row) out.push(row)
  }
  return out
}
