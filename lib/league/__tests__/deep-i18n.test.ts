import { describe, expect, it, vi } from 'vitest'
import {
  persistDeepTranslations,
  logDeepTranslationCacheError,
  DEEP_TRANSLATIONS_TABLE,
} from '../deep-i18n-store'

describe('persistDeepTranslations', () => {
  it('logs a write failure and does not silently discard it', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ok = await persistDeepTranslations(
      [
        {
          run_id: 'run-1',
          part_key: 'synthesis',
          locale: 'ko',
          translated_text: '종합',
          source_hash: 'abc',
        },
      ],
      {
        upsert: async () => ({
          error: { message: "Could not find the table 'public.league_deep_translations' in the schema cache" },
        }),
      }
    )
    expect(ok).toBe(false)
    expect(spy).toHaveBeenCalledTimes(1)
    const logged = String(spy.mock.calls[0]?.[0] ?? '')
    expect(logged).toContain(DEEP_TRANSLATIONS_TABLE)
    expect(logged).toContain('upsert FAILED')
    spy.mockRestore()
  })
})

describe('logDeepTranslationCacheError', () => {
  it('distinguishes a cache-read failure from a genuine cache miss', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logDeepTranslationCacheError('cache-read', 'relation does not exist')
    const logged = String(spy.mock.calls[0]?.[0] ?? '')
    expect(logged).toContain('cache-read FAILED (not a cache miss)')
    expect(logged).toContain(DEEP_TRANSLATIONS_TABLE)
    spy.mockRestore()
  })
})
