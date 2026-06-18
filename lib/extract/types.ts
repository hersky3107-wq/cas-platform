/**
 * Content-extraction layer types.
 *
 * This layer is intentionally decoupled from AI modules, prompts, and credits.
 * It only knows how to turn an external source into normalized text
 * (`ExtractedContent`). Adapters never throw; failures are returned as data.
 */

export type SourceType = 'url' | 'pdf' | 'csv' | 'xml' | 'json-api'

export interface ExtractInput {
  type: SourceType
  /** URL string, file path, or raw content depending on `type`. */
  value: string
  meta?: Record<string, unknown>
}

export interface ExtractedContent {
  sourceType: SourceType
  /** Best-effort title if available, otherwise null. */
  title: string | null
  /** The extracted/normalized text (markdown allowed). */
  text: string
  /** ISO timestamp of when extraction happened. */
  fetchedAt: string
  /** Human-readable origin, e.g. the URL or filename. */
  sourceLabel: string
  /** True if `text` was cut for length. */
  truncated: boolean
  /** False if extraction failed. */
  ok: boolean
  /** Populated when `ok === false`. */
  error?: string
}
