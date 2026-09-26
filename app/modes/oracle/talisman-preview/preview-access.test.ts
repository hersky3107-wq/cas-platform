import { describe, expect, it } from 'vitest'
import { PREVIEW_SESSION_MISS, openTalismanPreviewLookup, selectPreviewSession } from './preview-access'

const rows = [{ id: 'sess', user_id: 'owner' }] as const

const localDev = { NODE_ENV: 'development' as const }
const vercelPreview = { VERCEL: '1', NODE_ENV: 'production' as const, VERCEL_ENV: 'preview' }
const production = { VERCEL: '1', NODE_ENV: 'production' as const, VERCEL_ENV: 'production' }

describe('talisman preview session gate', () => {
  it('allows an open lookup only on local dev', () => {
    expect(openTalismanPreviewLookup(localDev)).toBe(true)
    expect(selectPreviewSession(rows, 'sess', localDev, null)).toEqual({ id: 'sess', user_id: 'owner' })
  })

  it('keeps Vercel preview owner-only even though NODE_ENV is production', () => {
    expect(openTalismanPreviewLookup(vercelPreview)).toBe(false)
    expect(selectPreviewSession(rows, 'sess', vercelPreview, null)).toEqual(PREVIEW_SESSION_MISS)
    expect(selectPreviewSession(rows, 'sess', vercelPreview, 'owner')).toEqual({ id: 'sess', user_id: 'owner' })
    expect(selectPreviewSession(rows, 'sess', vercelPreview, 'intruder')).toEqual(PREVIEW_SESSION_MISS)
  })

  it('keeps production owner-only, including a local production process with VERCEL unset', () => {
    expect(openTalismanPreviewLookup(production)).toBe(false)
    expect(openTalismanPreviewLookup({ NODE_ENV: 'production' })).toBe(false)
    expect(selectPreviewSession(rows, 'sess', production, null)).toEqual(PREVIEW_SESSION_MISS)
    expect(selectPreviewSession(rows, 'sess', production, 'owner')).toEqual({ id: 'sess', user_id: 'owner' })
    expect(selectPreviewSession(rows, 'sess', { NODE_ENV: 'production' }, 'intruder')).toEqual(PREVIEW_SESSION_MISS)
  })

  it('returns the identical payload for a missing session and a session owned by someone else', () => {
    const missing = selectPreviewSession(rows, 'missing', production, 'owner')
    const notOwner = selectPreviewSession(rows, 'sess', production, 'intruder')
    const unsigned = selectPreviewSession(rows, 'sess', production, null)
    expect(missing).toBe(PREVIEW_SESSION_MISS)
    expect(notOwner).toBe(PREVIEW_SESSION_MISS)
    expect(unsigned).toBe(PREVIEW_SESSION_MISS)
    expect(JSON.stringify(missing)).toBe(JSON.stringify(notOwner))
    expect(missing).toEqual({ ok: false, reason: 'not-found' })
  })
})
