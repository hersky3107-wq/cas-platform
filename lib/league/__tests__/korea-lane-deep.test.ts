import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  KR_DEEP_DISABLED_CATEGORIES,
  isDeepDisabledForViewer,
  isKrLaneDeepApiBlocked,
} from '../korea-lane-features'
import { KoreaStockLane } from '@/components/league/PublicLeagueHub'

const mocks = vi.hoisted(() => ({
  resolveLeagueViewer: vi.fn(),
  authorizeRoundForViewer: vi.fn(),
  roundHasCards: vi.fn(),
  buildLeagueDeepContext: vi.fn(),
  handleDeepAnalysis: vi.fn(),
  handleDeepStatus: vi.fn(),
  chargeDeep: vi.fn(),
}))

vi.mock('server-only', () => ({}))

vi.mock('@/lib/league/public-access', () => ({
  resolveLeagueViewer: mocks.resolveLeagueViewer,
  authorizeRoundForViewer: mocks.authorizeRoundForViewer,
}))

vi.mock('@/lib/league/deep-context', () => ({
  roundHasCards: mocks.roundHasCards,
  buildLeagueDeepContext: mocks.buildLeagueDeepContext,
}))

vi.mock('@/lib/league/deep-http', () => ({
  handleDeepAnalysis: (...args: unknown[]) => mocks.handleDeepAnalysis(...args),
  handleDeepStatus: (...args: unknown[]) => mocks.handleDeepStatus(...args),
}))

vi.mock('@/lib/league/deep-charge', () => ({
  chargeDeep: (...args: unknown[]) => mocks.chargeDeep(...args),
  refundDeep: vi.fn(),
}))

type Viewer = {
  userId: string
  email: string | null
  isAdmin: boolean
  jurisdiction: { declaredCountry: string | null; ipCountry: string | null }
  visibleCategories: string[]
}

function krViewer(isAdmin = false): Viewer {
  return {
    userId: 'u-kr',
    email: isAdmin ? 'admin@example.com' : 'kr@example.com',
    isAdmin,
    jurisdiction: { declaredCountry: 'KR', ipCountry: 'KR' },
    visibleCategories: ['stock'],
  }
}

function usViewer(): Viewer {
  return {
    userId: 'u-us',
    email: 'us@example.com',
    isAdmin: false,
    jurisdiction: { declaredCountry: 'US', ipCountry: 'US' },
    visibleCategories: ['stock'],
  }
}

function postReq(path: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('isDeepDisabledForViewer (reuse admissionStockLane)', () => {
  it('covers every category when KR_DEEP_DISABLED_CATEGORIES is "all"', () => {
    expect(KR_DEEP_DISABLED_CATEGORIES).toBe('all')
    const kr = { jurisdiction: { declaredCountry: 'KR' as const, ipCountry: 'KR' as const } }
    expect(isDeepDisabledForViewer(kr, 'stock')).toBe(true)
    expect(isDeepDisabledForViewer(kr, 'sports')).toBe(true)
    expect(isDeepDisabledForViewer(kr, 'crypto_spot')).toBe(true)
  })

  it('is true for Korean lane including admin (UI hide); API block exempts admin', () => {
    const krAdmin = { isAdmin: true, jurisdiction: { declaredCountry: 'KR', ipCountry: 'KR' } }
    const krUser = { isAdmin: false, jurisdiction: { declaredCountry: 'KR', ipCountry: 'US' } }
    const ipOnly = { isAdmin: false, jurisdiction: { declaredCountry: null, ipCountry: 'KR' } }
    expect(isDeepDisabledForViewer(krAdmin, 'stock')).toBe(true)
    expect(isKrLaneDeepApiBlocked(krAdmin, 'stock')).toBe(false)
    expect(isKrLaneDeepApiBlocked(krUser, 'stock')).toBe(true)
    expect(isKrLaneDeepApiBlocked(ipOnly, 'stock')).toBe(true)
  })

  it('world lane is never disabled', () => {
    const us = { isAdmin: false, jurisdiction: { declaredCountry: 'US', ipCountry: 'US' } }
    expect(isDeepDisabledForViewer(us, 'stock')).toBe(false)
    expect(isKrLaneDeepApiBlocked(us, 'stock')).toBe(false)
  })
})

describe('Korean lane render — no deep analysis UI', () => {
  it('KoreaStockLane contains no 개방형 분석 / 찬반 토론 text', () => {
    const html = renderToStaticMarkup(createElement(KoreaStockLane))
    expect(html).not.toContain('개방형 분석')
    expect(html).not.toContain('찬반 토론')
    expect(html).not.toContain('비채점 논평')
  })

  it('hub gates DeepAnalysis behind isDeepDisabledForViewer (absent, not disabled)', () => {
    const hub = readFileSync(join(__dirname, '../../../components/league/PublicLeagueHub.tsx'), 'utf8')
    const gate = hub.indexOf('isDeepDisabledForViewer')
    const deep = hub.indexOf('<DeepAnalysis')
    expect(gate).toBeGreaterThan(-1)
    expect(deep).toBeGreaterThan(gate)
    expect(hub).toMatch(/isDeepDisabledForViewer\([\s\S]*?\) \? null : \(/)
  })
})

describe('POST /api/league/deep-open and deep-debate — Korean lane 403', () => {
  beforeEach(() => {
    mocks.resolveLeagueViewer.mockReset()
    mocks.authorizeRoundForViewer.mockReset()
    mocks.roundHasCards.mockReset()
    mocks.buildLeagueDeepContext.mockReset()
    mocks.handleDeepAnalysis.mockReset()
    mocks.handleDeepStatus.mockReset()
    mocks.chargeDeep.mockReset()
    mocks.roundHasCards.mockResolvedValue(true)
    mocks.handleDeepAnalysis.mockResolvedValue(NextResponse.json({ ok: true, done: false }))
    mocks.authorizeRoundForViewer.mockResolvedValue({
      ok: true,
      roundId: 'round-1',
      category: 'stock',
      instrument: 'AAPL',
    })
  })

  async function postBoth(viewer: Viewer) {
    mocks.resolveLeagueViewer.mockResolvedValue({ ok: true, viewer })
    const { POST: openPost } = await import('@/app/api/league/deep-open/route')
    const { POST: debatePost } = await import('@/app/api/league/deep-debate/route')
    const open = await openPost(postReq('/api/league/deep-open', { roundId: 'round-1' }))
    const debate = await debatePost(postReq('/api/league/deep-debate', { roundId: 'round-1' }))
    return { open, debate }
  }

  it('Korean-lane viewer → 403 kr_lane_deep_disabled; charge and context builder not called; credits untouched', async () => {
    const { open, debate } = await postBoth(krViewer(false))
    expect(open.status).toBe(403)
    expect(debate.status).toBe(403)
    expect(await open.json()).toEqual({ error: 'kr_lane_deep_disabled' })
    expect(await debate.json()).toEqual({ error: 'kr_lane_deep_disabled' })
    expect(mocks.handleDeepAnalysis).not.toHaveBeenCalled()
    expect(mocks.chargeDeep).not.toHaveBeenCalled()
    expect(mocks.buildLeagueDeepContext).not.toHaveBeenCalled()
    expect(mocks.roundHasCards).not.toHaveBeenCalled()
  })

  it('World viewer → unchanged (handler runs)', async () => {
    const { open, debate } = await postBoth(usViewer())
    expect(open.status).toBe(200)
    expect(debate.status).toBe(200)
    expect(mocks.handleDeepAnalysis).toHaveBeenCalledTimes(2)
  })

  it('Admin from KR → API allowed', async () => {
    const { open, debate } = await postBoth(krViewer(true))
    expect(open.status).toBe(200)
    expect(debate.status).toBe(200)
    expect(mocks.handleDeepAnalysis).toHaveBeenCalledTimes(2)
  })

  it('route files call the KR gate before roundHasCards / handleDeepAnalysis', () => {
    for (const file of ['deep-open', 'deep-debate']) {
      const src = readFileSync(join(__dirname, `../../../app/api/league/${file}/route.ts`), 'utf8')
      const gate = src.indexOf('isKrLaneDeepApiBlocked')
      const cards = src.indexOf('await roundHasCards')
      const handle = src.indexOf('return handleDeepAnalysis')
      expect(gate).toBeGreaterThan(-1)
      expect(cards).toBeGreaterThan(gate)
      expect(handle).toBeGreaterThan(gate)
    }
  })
})
