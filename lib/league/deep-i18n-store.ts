/**
 * Deep-analysis translation-cache I/O. Isolated from the model call so a
 * write failure can be unit-tested without a Supabase client or an AI provider.
 *
 * View-time only. Generation never writes here.
 */

export const DEEP_TRANSLATIONS_TABLE = 'league_deep_translations'

export type DeepTranslationWrite = {
  run_id: string
  part_key: string
  locale: string
  translated_text: string
  source_hash: string
}

export type DeepTranslationCachedRow = {
  part_key: string
  translated_text: string
  source_hash: string
}

export type DeepTranslationStore = {
  loadCached(
    runId: string,
    locale: string,
    partKeys: string[]
  ): Promise<{ rows: DeepTranslationCachedRow[] | null; error: { message: string } | null }>
  upsert(writes: DeepTranslationWrite[]): Promise<{ error: { message: string } | null }>
}

export function logDeepTranslationCacheError(operation: 'cache-read' | 'upsert', message: string): void {
  if (operation === 'cache-read') {
    console.error(
      `[league/deep-i18n] ${DEEP_TRANSLATIONS_TABLE} cache-read FAILED (not a cache miss): ${message}`
    )
    return
  }
  console.error(`[league/deep-i18n] ${DEEP_TRANSLATIONS_TABLE} upsert FAILED: ${message}`)
}

export async function persistDeepTranslations(
  writes: readonly DeepTranslationWrite[],
  store: Pick<DeepTranslationStore, 'upsert'>,
  logError: typeof logDeepTranslationCacheError = logDeepTranslationCacheError
): Promise<boolean> {
  if (writes.length === 0) return true
  const { error } = await store.upsert([...writes])
  if (error) {
    logError('upsert', error.message)
    return false
  }
  return true
}
