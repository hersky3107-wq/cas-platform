import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PREVIEW_SESSION_MISS } from '@/app/modes/oracle/talisman-preview/preview-access'
import { talismanSerialFromEnv } from '@/lib/oracle/talisman/serial'

const previewFromStoredSession = vi.fn()
const resolveRouteAuth = vi.fn()
const hasTalismanPurchase = vi.fn()
const insertTalismanPurchase = vi.fn()
const loadFirstIntegratedSessionId = vi.fn()

vi.mock('@/app/modes/oracle/talisman-preview/preview-session', () => ({
  previewFromStoredSession: (...args: unknown[]) => previewFromStoredSession(...args),
}))

vi.mock('@/lib/supabase/route-auth', () => ({
  missingSupabaseEnv: () => null,
  resolveRouteAuth: (...args: unknown[]) => resolveRouteAuth(...args),
}))

vi.mock('@/lib/oracle/talisman/purchase-store', () => ({
  hasTalismanPurchase: (...args: unknown[]) => hasTalismanPurchase(...args),
  loadFirstIntegratedSessionId: (...args: unknown[]) => loadFirstIntegratedSessionId(...args),
  createTalismanPurchaseStore: () => ({
    insert: (...args: unknown[]) => insertTalismanPurchase(...args),
  }),
}))

vi.mock('@/lib/oracle/talisman/png', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/oracle/talisman/png')>()
  return {
    ...actual,
    renderTalismanPng: vi.fn(async () => ({
      png: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 56, 0, 0, 4, 56]),
      width: 1080,
      height: 1080,
      engine: 'native' as const,
      ms: 1,
    })),
  }
})

describe('talisman PNG route', () => {
  beforeEach(() => {
    previewFromStoredSession.mockReset()
    resolveRouteAuth.mockReset()
    hasTalismanPurchase.mockReset()
    hasTalismanPurchase.mockResolvedValue(false)
    insertTalismanPurchase.mockReset()
    loadFirstIntegratedSessionId.mockReset()
    loadFirstIntegratedSessionId.mockResolvedValue('sess')
  })

  it('returns the preview not-found payload for a non-owner', async () => {
    resolveRouteAuth.mockResolvedValue({ user: { id: 'other' }, error: null })
    previewFromStoredSession.mockResolvedValue(PREVIEW_SESSION_MISS)
    const { GET } = await import('@/app/api/oracle/session/[id]/talisman/png/route')
    const res = await GET(new Request('http://local/api/oracle/session/sess/talisman/png?format=square'), {
      params: Promise.resolve({ id: 'sess' }),
    })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual(PREVIEW_SESSION_MISS)
    expect(previewFromStoredSession).toHaveBeenCalledWith('sess', null, 'other')
  })

  it('returns a private PNG for the owner on the free deficiency phone', async () => {
    resolveRouteAuth.mockResolvedValue({ user: { id: 'owner' }, error: null })
    previewFromStoredSession.mockResolvedValue({
      ok: true,
      spec: { id: 'sess' },
    })
    const { GET } = await import('@/app/api/oracle/session/[id]/talisman/png/route')
    const res = await GET(new Request('http://local/api/oracle/session/sess/talisman/png?format=phone'), {
      params: Promise.resolve({ id: 'sess' }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600')
    expect(res.headers.get('X-Talisman-Renderer')).toBe('native')
    expect(insertTalismanPurchase).not.toHaveBeenCalled()
  })

  it('returns not-found for deficiency phone on a later integrated session', async () => {
    resolveRouteAuth.mockResolvedValue({ user: { id: 'owner' }, error: null })
    previewFromStoredSession.mockResolvedValue({
      ok: true,
      spec: { id: 'later' },
    })
    loadFirstIntegratedSessionId.mockResolvedValue('first')
    const { GET } = await import('@/app/api/oracle/session/[id]/talisman/png/route')
    const res = await GET(new Request('http://local/api/oracle/session/later/talisman/png?format=phone'), {
      params: Promise.resolve({ id: 'later' }),
    })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual(PREVIEW_SESSION_MISS)
  })

  it('returns the preview not-found payload for an unpaid wallet', async () => {
    resolveRouteAuth.mockResolvedValue({ user: { id: 'owner' }, error: null })
    previewFromStoredSession.mockResolvedValue({
      ok: true,
      spec: { id: 'sess' },
    })
    hasTalismanPurchase.mockResolvedValue(false)
    const { GET } = await import('@/app/api/oracle/session/[id]/talisman/png/route')
    const res = await GET(new Request('http://local/api/oracle/session/sess/talisman/png?format=wallet'), {
      params: Promise.resolve({ id: 'sess' }),
    })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual(PREVIEW_SESSION_MISS)
  })

  it('returns all paid formats after a purchase', async () => {
    resolveRouteAuth.mockResolvedValue({ user: { id: 'owner' }, error: null })
    previewFromStoredSession.mockResolvedValue({
      ok: true,
      spec: { id: 'sess' },
    })
    hasTalismanPurchase.mockResolvedValue(true)
    const { GET } = await import('@/app/api/oracle/session/[id]/talisman/png/route')
    const res = await GET(new Request('http://local/api/oracle/session/sess/talisman/png?format=square&purpose=wealth'), {
      params: Promise.resolve({ id: 'sess' }),
    })
    expect(res.status).toBe(200)
    expect(hasTalismanPurchase).toHaveBeenCalledWith('owner', 'sess', 'wealth')
  })

  it('still throws when TALISMAN_SERIAL_SALT is missing in production', () => {
    expect(() => talismanSerialFromEnv('sess', { NODE_ENV: 'production' })).toThrow(
      /TALISMAN_SERIAL_SALT is required/,
    )
  })
})
