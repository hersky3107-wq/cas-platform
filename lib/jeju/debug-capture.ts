import 'server-only'

/**
 * TEMPORARY diagnostic capture — surfaces raw upstream responses for broken
 * data paths (AirKorea dust, marine tide/sun/forecast, KAMIS prices) behind
 * ?debug=1. Does NOT affect production behavior: callers only get a sink when
 * debug is requested; all existing fetch/retry/timeout/caching logic is
 * untouched — this only observes and records what already happens.
 *
 * DELETE this file (and its call sites) once the 3 upstream issues are fixed.
 */

export interface DebugFetchEntry {
  /** Which upstream call this came from, e.g. 'airkorea-dust', 'tide', 'kamis'. */
  label: string
  /** Final request URL with the service key redacted. */
  url: string
  /** HTTP status, or null when the fetch itself threw before a response. */
  status: number | null
  /** First ~1500 chars of the raw response body, before any parsing. */
  bodySnippet: string
  /** Error message/name when the fetch threw. */
  error?: string
}

export interface DebugSink {
  enabled: boolean
  entries: DebugFetchEntry[]
}

/** Creates a sink. `enabled: false` sinks are cheap no-ops everywhere. */
export function createDebugSink(enabled: boolean): DebugSink {
  return { enabled, entries: [] }
}

/** Records one entry (no-op when the sink is disabled/absent) + console.logs it. */
export function recordDebug(sink: DebugSink | undefined, entry: DebugFetchEntry): void {
  if (!sink?.enabled) return
  sink.entries.push(entry)
  console.log(`[debug:${entry.label}]`, JSON.stringify(entry).slice(0, 2000))
}

/** Reads ?debug=1 (or debug=true) from a request URL. */
export function isDebugRequested(url: URL): boolean {
  const v = url.searchParams.get('debug')
  return v === '1' || v === 'true'
}
