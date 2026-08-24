import { describe, expect, it, vi } from 'vitest'
import {
  persistRationaleTranslations,
  logRationaleCacheError,
  RATIONALE_TRANSLATIONS_TABLE,
} from '../rationale-i18n-store'

describe('persistRationaleTranslations', () => {
  it('logs a write failure and does not silently discard it', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const stored: unknown[] = []
    const ok = await persistRationaleTranslations(
      [
        {
          prediction_id: 'pred-1',
          locale: 'ko',
          translated_text: '번역문',
          source_hash: 'abc',
        },
      ],
      {
        upsert: async () => {
          // The write never lands.
          return { error: { message: "Could not find the table 'public.prediction_rationale_translations' in the schema cache" } }
        },
      }
    )
    expect(ok).toBe(false)
    expect(stored).toEqual([])
    expect(spy).toHaveBeenCalledTimes(1)
    const logged = String(spy.mock.calls[0]?.[0] ?? '')
    expect(logged).toContain(RATIONALE_TRANSLATIONS_TABLE)
    expect(logged).toContain('upsert FAILED')
    expect(logged).toContain('schema cache')
    spy.mockRestore()
  })

  it('returns true when the upsert succeeds — no error log', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let received = 0
    const ok = await persistRationaleTranslations(
      [
        {
          prediction_id: 'pred-1',
          locale: 'ko',
          translated_text: '번역문',
          source_hash: 'abc',
        },
      ],
      {
        upsert: async (writes) => {
          received = writes.length
          return { error: null }
        },
      }
    )
    expect(ok).toBe(true)
    expect(received).toBe(1)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('logRationaleCacheError', () => {
  it('distinguishes a cache-read failure from a genuine cache miss', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logRationaleCacheError('cache-read', 'relation does not exist')
    const logged = String(spy.mock.calls[0]?.[0] ?? '')
    expect(logged).toContain('cache-read FAILED (not a cache miss)')
    expect(logged).toContain(RATIONALE_TRANSLATIONS_TABLE)
    spy.mockRestore()
  })
})
