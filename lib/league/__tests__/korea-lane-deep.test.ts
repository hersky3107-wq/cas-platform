import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  krDeepPolicyForInstrument,
  isDeepDisabledForViewer,
  isKrLaneDeepApiBlocked,
  shouldShowLeagueLanguageToggle,
} from '../korea-lane-features'
import { KoreaStockLane } from '@/components/league/PublicLeagueHub'
import { resolveLeagueLocale } from '../i18n/resolve-locale'
import { gatePublicGenerateInstrument, visibleCategoriesFor } from '../access-policy'
import {
  findCatalogInstrument,
  PUBLIC_CATALOG,
  visibleChipEntriesForViewer,
} from '../catalog'

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

const HIDE_ROUNDS = [
  { category: 'stock', instrument: 'STOCK:NASDAQ:AAPL' },
  { category: 'etf_index', instrument: 'QQQ' },
  { category: 'gold_metal', instrument: 'GLD' },
  { category: 'gold_metal', instrument: 'XAU/USD' },
  { category: 'crypto_spot', instrument: 'BTC/USD' },
  { category: 'fx', instrument: 'EUR/USD' },
] as const

const ALLOW_ROUNDS = [
  { category: 'sports', instrument: 'MATCH:baseball_mlb:evt:home:1' },
  { category: 'politics_election', instrument: 'ELECTION:us:evt:1' },
  { category: 'entertainment_awards', instrument: 'SHOW:oscars:evt:1' },
  { category: 'real_estate', instrument: 'PROPERTY:US:idx:1' },
] as const

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

const kr = { jurisdiction: { declaredCountry: 'KR' as const, ipCountry: 'KR' as const } }
const us = { isAdmin: false, jurisdiction: { declaredCountry: 'US' as const, ipCountry: 'US' as const } }

describe('krDeepPolicyForInstrument', () => {
  it('hides stocks, index ETFs, gold ETFs, gray-zone spots/FX/crypto, and memecoin', () => {
    expect(krDeepPolicyForInstrument('stock', 'STOCK:NASDAQ:AAPL')).toBe('hide')
    expect(krDeepPolicyForInstrument('stock', 'AAPL')).toBe('hide')
    expect(krDeepPolicyForInstrument('etf_index', 'QQQ')).toBe('hide')
    expect(krDeepPolicyForInstrument('index_etf', 'SPY')).toBe('hide')
    expect(krDeepPolicyForInstrument('gold_metal', 'GLD')).toBe('hide')
    expect(krDeepPolicyForInstrument('gold_metal', 'SLV')).toBe('hide')
    expect(krDeepPolicyForInstrument('gold_metal', 'XAU/USD')).toBe('hide')
    expect(krDeepPolicyForInstrument('commodity_energy', 'UNG')).toBe('hide')
    expect(krDeepPolicyForInstrument('commodity_energy', 'WTI/USD')).toBe('hide')
    expect(krDeepPolicyForInstrument('fx', 'EUR/USD')).toBe('hide')
    expect(krDeepPolicyForInstrument('crypto_spot', 'BTC/USD')).toBe('hide')
    expect(krDeepPolicyForInstrument('memecoin', 'DOGE/USD')).toBe('hide')
  })

  it('allows sports, politics, entertainment, and real_estate', () => {
    for (const round of ALLOW_ROUNDS) {
      expect(krDeepPolicyForInstrument(round.category, round.instrument), round.category).toBe('allow')
    }
  })

  it('unknown category or instrument fail-closed hides and logs once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(krDeepPolicyForInstrument('not_a_category', 'ZZZ')).toBe('hide')
    expect(krDeepPolicyForInstrument('not_a_category', 'ZZZ')).toBe('hide')
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe('isDeepDisabledForViewer / isKrLaneDeepApiBlocked', () => {
  it('Korean-lane hides deep/debate on financial chips including admin UI; API exempts admin', () => {
    const krAdmin = { isAdmin: true, jurisdiction: { declaredCountry: 'KR', ipCountry: 'KR' } }
    const krUser = { isAdmin: false, jurisdiction: { declaredCountry: 'KR', ipCountry: 'US' } }
    const ipOnly = { isAdmin: false, jurisdiction: { declaredCountry: null, ipCountry: 'KR' } }
    for (const round of HIDE_ROUNDS) {
      expect(isDeepDisabledForViewer(krAdmin, round.category, round.instrument), round.instrument).toBe(true)
      expect(isKrLaneDeepApiBlocked(krAdmin, round.category, round.instrument), round.instrument).toBe(false)
      expect(isKrLaneDeepApiBlocked(krUser, round.category, round.instrument), round.instrument).toBe(true)
      expect(isKrLaneDeepApiBlocked(ipOnly, round.category, round.instrument), round.instrument).toBe(true)
    }
  })

  it('Korean-lane keeps deep/debate on non-financial categories', () => {
    for (const round of ALLOW_ROUNDS) {
      expect(isDeepDisabledForViewer(kr, round.category, round.instrument), round.category).toBe(false)
      expect(isKrLaneDeepApiBlocked({ isAdmin: false, ...kr }, round.category, round.instrument), round.category).toBe(
        false,
      )
    }
  })

  it('world lane is unchanged for hide and allow instruments', () => {
    for (const round of [...HIDE_ROUNDS, ...ALLOW_ROUNDS]) {
      expect(isDeepDisabledForViewer(us, round.category, round.instrument), round.instrument).toBe(false)
      expect(isKrLaneDeepApiBlocked(us, round.category, round.instrument), round.instrument).toBe(false)
    }
    expect(isDeepDisabledForViewer(us, 'not_a_category', 'ZZZ')).toBe(false)
    expect(isKrLaneDeepApiBlocked(us, 'not_a_category', 'ZZZ')).toBe(false)
  })

  it('unknown category hides for Korean lane', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(isDeepDisabledForViewer(kr, 'mystery', 'FOO')).toBe(true)
    expect(isKrLaneDeepApiBlocked({ isAdmin: false, ...kr }, 'mystery', 'FOO')).toBe(true)
    warn.mockRestore()
  })
})

describe('Korean-lane memecoin + leveraged/inverse ETF gates (existing jurisdiction pattern)', () => {
  const krPublic = { isAdmin: false, jurisdiction: { declaredCountry: 'KR' as const, ipCountry: 'KR' as const } }
  const usPublic = { isAdmin: false, jurisdiction: { declaredCountry: 'US' as const, ipCountry: 'US' as const } }

  it('does not show memecoin chips and blocks generate', () => {
    expect(visibleCategoriesFor(krPublic.jurisdiction)).not.toContain('memecoin')
    expect(gatePublicGenerateInstrument('DOGE/USD', krPublic)).toEqual({
      ok: false,
      status: 403,
      code: 'jurisdiction_blocked',
    })
    expect(visibleCategoriesFor(usPublic.jurisdiction)).toContain('memecoin')
    expect(gatePublicGenerateInstrument('DOGE/USD', usPublic)).toMatchObject({ ok: true, instrument: 'DOGE/USD' })
  })

  it('does not show leveraged/inverse index_etf chips in the catalog and blocks generate; SOXS is not a catalog chip', () => {
    const index = PUBLIC_CATALOG.find((c) => c.id === 'index_etf')!
    const leveraged = ['TQQQ', 'SQQQ', 'SOXL', 'UPRO', 'SPXU'] as const
    const krChips = visibleChipEntriesForViewer(index, krPublic).map((i) => i.instrument)
    for (const id of leveraged) {
      expect(krChips, id).not.toContain(id)
      expect(gatePublicGenerateInstrument(id, krPublic)).toEqual({
        ok: false,
        status: 403,
        code: 'jurisdiction_blocked',
      })
      expect(gatePublicGenerateInstrument(id, usPublic)).toMatchObject({ ok: true, instrument: id })
    }
    expect(findCatalogInstrument('SOXS')).toBeNull()
    expect(gatePublicGenerateInstrument('SOXS', krPublic)).toEqual({
      ok: false,
      status: 400,
      code: 'unknown_instrument',
    })
  })
})

describe('Korean lane locale + language selector', () => {
  it("Korean-lane viewer with ui_locale='en' and Accept-Language en-US resolves to 'ko'", () => {
    expect(
      resolveLeagueLocale({
        profileLocale: 'en',
        acceptLanguage: 'en-US',
        ipCountry: 'KR',
        declaredCountry: 'KR',
      }),
    ).toBe('ko')
    expect(
      resolveLeagueLocale({
        profileLocale: 'en',
        acceptLanguage: 'en-US',
        ipCountry: 'US',
        declaredCountry: 'KR',
      }),
    ).toBe('ko')
    expect(
      resolveLeagueLocale({
        profileLocale: 'en',
        acceptLanguage: 'en-US',
        ipCountry: 'KR',
        declaredCountry: null,
      }),
    ).toBe('ko')
  })

  it('world viewer locale resolution is unchanged', () => {
    expect(
      resolveLeagueLocale({
        profileLocale: 'en',
        acceptLanguage: 'en-US',
        ipCountry: 'US',
        declaredCountry: 'US',
      }),
    ).toBe('en')
    expect(
      resolveLeagueLocale({
        profileLocale: 'ja',
        acceptLanguage: 'en-US',
        ipCountry: 'US',
        declaredCountry: 'US',
      }),
    ).toBe('ja')
  })

  it('hides the language selector for Korean-lane non-admins; world and KR admin keep it', () => {
    expect(shouldShowLeagueLanguageToggle({ isAdmin: false, ...kr })).toBe(false)
    expect(shouldShowLeagueLanguageToggle({ isAdmin: true, ...kr })).toBe(true)
    expect(shouldShowLeagueLanguageToggle(us)).toBe(true)
  })

  it('PredictionCard / Leaderboard / RecordRoom omit LanguageToggle unless showLanguageToggle', () => {
    for (const file of ['PredictionCard.tsx', 'Leaderboard.tsx', 'RecordRoom.tsx']) {
      const src = readFileSync(join(__dirname, `../../../components/league/${file}`), 'utf8')
      expect(src).toMatch(/showLanguageToggle \? \([\s\S]*<LanguageToggle/)
    }
  })
})

describe('Korean lane render — no deep analysis UI on the stocks lane', () => {
  it('KoreaStockLane contains no 개방형 분석 / 찬반 토론 text', () => {
    const html = renderToStaticMarkup(createElement(KoreaStockLane))
    expect(html).not.toContain('개방형 분석')
    expect(html).not.toContain('찬반 토론')
    expect(html).not.toContain('비채점 논평')
  })

  it('hub gates DeepAnalysis behind isDeepDisabledForViewer with round category + instrument', () => {
    const hub = readFileSync(join(__dirname, '../../../components/league/PublicLeagueHub.tsx'), 'utf8')
    const gate = hub.indexOf('isDeepDisabledForViewer')
    const deep = hub.indexOf('<DeepAnalysis')
    expect(gate).toBeGreaterThan(-1)
    expect(deep).toBeGreaterThan(gate)
    expect(hub).toMatch(/isDeepDisabledForViewer\([\s\S]*?view\.card\.round\.category[\s\S]*?view\.card\.round\.instrument[\s\S]*?\) \? null : \(/)
  })
})

describe('POST /api/league/deep-open and deep-debate — per-instrument KR policy', () => {
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
  })

  async function postBoth(viewer: Viewer, category: string, instrument: string) {
    mocks.resolveLeagueViewer.mockResolvedValue({ ok: true, viewer })
    mocks.authorizeRoundForViewer.mockResolvedValue({
      ok: true,
      roundId: 'round-1',
      category,
      instrument,
    })
    const { POST: openPost } = await import('@/app/api/league/deep-open/route')
    const { POST: debatePost } = await import('@/app/api/league/deep-debate/route')
    const open = await openPost(postReq('/api/league/deep-open', { roundId: 'round-1' }))
    const debate = await debatePost(postReq('/api/league/deep-debate', { roundId: 'round-1' }))
    return { open, debate }
  }

  it.each(HIDE_ROUNDS)(
    'Korean-lane viewer → 403 on $category $instrument; charge and context builder not called',
    async (round) => {
      const { open, debate } = await postBoth(krViewer(false), round.category, round.instrument)
      expect(open.status).toBe(403)
      expect(debate.status).toBe(403)
      expect(await open.json()).toEqual({ error: 'kr_lane_deep_disabled' })
      expect(await debate.json()).toEqual({ error: 'kr_lane_deep_disabled' })
      expect(mocks.handleDeepAnalysis).not.toHaveBeenCalled()
      expect(mocks.chargeDeep).not.toHaveBeenCalled()
      expect(mocks.buildLeagueDeepContext).not.toHaveBeenCalled()
      expect(mocks.roundHasCards).not.toHaveBeenCalled()
    },
  )

  it.each(ALLOW_ROUNDS)('Korean-lane viewer → API allowed on $category $instrument', async (round) => {
    const { open, debate } = await postBoth(krViewer(false), round.category, round.instrument)
    expect(open.status).toBe(200)
    expect(debate.status).toBe(200)
    expect(mocks.handleDeepAnalysis).toHaveBeenCalledTimes(2)
  })

  it.each([...HIDE_ROUNDS, ...ALLOW_ROUNDS])(
    'World viewer → unchanged (handler runs) on $category $instrument',
    async (round) => {
      const { open, debate } = await postBoth(usViewer(), round.category, round.instrument)
      expect(open.status).toBe(200)
      expect(debate.status).toBe(200)
      expect(mocks.handleDeepAnalysis).toHaveBeenCalledTimes(2)
    },
  )

  it('Admin from KR → API allowed on a financial round', async () => {
    const { open, debate } = await postBoth(krViewer(true), 'stock', 'STOCK:NASDAQ:AAPL')
    expect(open.status).toBe(200)
    expect(debate.status).toBe(200)
    expect(mocks.handleDeepAnalysis).toHaveBeenCalledTimes(2)
  })

  it('route files call the KR gate with category + instrument before roundHasCards / handleDeepAnalysis', () => {
    for (const file of ['deep-open', 'deep-debate']) {
      const src = readFileSync(join(__dirname, `../../../app/api/league/${file}/route.ts`), 'utf8')
      const gate = src.indexOf('isKrLaneDeepApiBlocked')
      const cards = src.indexOf('await roundHasCards')
      const handle = src.indexOf('return handleDeepAnalysis')
      expect(gate).toBeGreaterThan(-1)
      expect(cards).toBeGreaterThan(gate)
      expect(handle).toBeGreaterThan(gate)
      expect(src).toContain('isKrLaneDeepApiBlocked(auth.viewer, access.category, access.instrument)')
    }
  })
})
