/**
 * Translation-cache I/O contract + error logging.
 *
 * Isolated from the model call so a write failure can be unit-tested without
 * a Supabase client or an AI provider. Both cache-read and upsert MUST capture
 * `{ error }` — a schema-cache miss is not a genuine empty cache.
 */

export const RATIONALE_TRANSLATIONS_TABLE = 'prediction_rationale_translations'

export type RationaleTranslationWrite = {
  prediction_id: string
  locale: string
  translated_text: string
  source_hash: string
}

export type RationaleTranslationCachedRow = {
  prediction_id: string
  translated_text: string
  source_hash: string
}

export type RationaleTranslationStore = {
  loadCached(
    locale: string,
    predictionIds: string[]
  ): Promise<{ rows: RationaleTranslationCachedRow[] | null; error: { message: string } | null }>
  upsert(writes: RationaleTranslationWrite[]): Promise<{ error: { message: string } | null }>
}

export function logRationaleCacheError(operation: 'cache-read' | 'upsert', message: string): void {
  if (operation === 'cache-read') {
    console.error(
      `[league/rationale-i18n] ${RATIONALE_TRANSLATIONS_TABLE} cache-read FAILED (not a cache miss): ${message}`
    )
    return
  }
  console.error(`[league/rationale-i18n] ${RATIONALE_TRANSLATIONS_TABLE} upsert FAILED: ${message}`)
}

/**
 * Persist translated rows. On failure: log loudly and return false — callers
 * still keep the live translations and must not treat the request as failed.
 */
export async function persistRationaleTranslations(
  writes: readonly RationaleTranslationWrite[],
  store: Pick<RationaleTranslationStore, 'upsert'>,
  logError: typeof logRationaleCacheError = logRationaleCacheError
): Promise<boolean> {
  if (writes.length === 0) return true
  const { error } = await store.upsert([...writes])
  if (error) {
    logError('upsert', error.message)
    return false
  }
  return true
}
