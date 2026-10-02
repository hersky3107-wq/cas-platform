import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  KR_DISCLOSURE,
  fillDisclosure,
  formatKrTrackRecord,
  getKrAdvisoryRegNo,
  getKrBizNo,
  isKrLanePublicReady,
  resolveKrLaneBanner,
  resolveKrLaneFooter,
  trackRecordVarsFromRecordRoom,
} from '../korea-disclosure'
import { admissionStockLane } from '../stock-lane'
import { gatePublicGenerateInstrument } from '../access-policy'
import { KoreaStockLane } from '@/components/league/PublicLeagueHub'

const signalsMock = vi.hoisted(() => ({
  useLeagueRequestSignals: vi.fn(),
  defaultSignals: {
    acceptLanguage: null as string | null,
    ipCountry: null as string | null,
    profileLocale: null as string | null,
    declaredCountry: null as string | null,
    isAdmin: false,
    loading: false,
  },
}))

vi.mock('@/lib/league/use-league-request-signals', () => ({
  useLeagueRequestSignals: (...args: unknown[]) => signalsMock.useLeagueRequestSignals(...args),
}))

describe('Korea stock lane mandatory disclosures (자본시장법 유사투자자문업 규정)', () => {
  beforeEach(() => {
    signalsMock.useLeagueRequestSignals.mockReturnValue(signalsMock.defaultSignals)
  })
  it('KR_DISCLOSURE is frozen and has all required disclosure keys with exact copy', () => {
    expect(Object.isFrozen(KR_DISCLOSURE)).toBe(true)
    const requiredStringKeys = [
      'laneBanner',
      'laneBannerReg',
      'card',
      'confidence',
      'trackRecord',
      'generate',
      'deep',
      'crowding',
      'credits',
      'data',
      'footer',
    ] as const

    for (const key of requiredStringKeys) {
      expect(typeof KR_DISCLOSURE[key]).toBe('string')
      expect(KR_DISCLOSURE[key].trim().length).toBeGreaterThan(0)
    }
    expect(Array.isArray(KR_DISCLOSURE.usageNotice)).toBe(true)
    expect(KR_DISCLOSURE.usageNotice).toHaveLength(5)
    for (const line of KR_DISCLOSURE.usageNotice) {
      expect(line.trim().length).toBeGreaterThan(0)
    }
  })

  it('KR_DISCLOSURE strings contain none of: "보장합니다", "확실", "무조건", "환불" (guard against future edits)', () => {
    const banned = ['보장합니다', '무조건', '환불']
    for (const [key, text] of Object.entries(KR_DISCLOSURE)) {
      if (key === 'usageNotice') continue
      for (const b of banned) {
        expect(text, `key "${key}" should not contain "${b}"`).not.toContain(b)
      }
      expect(
        text,
        `key "${key}" must not contain affirmative "확실" claims`,
      ).not.toMatch(/확실(?!하다는\s*뜻은\s*아닙니다)/)
    }
    for (const line of KR_DISCLOSURE.usageNotice) {
      for (const b of banned) {
        expect(line, `usageNotice should not contain "${b}"`).not.toContain(b)
      }
      expect(line).not.toMatch(/확실(?!하다는\s*뜻은\s*아닙니다)/)
    }
    expect(KR_DISCLOSURE.usageNotice[3]).toContain('보장하거나')
  })

  it('fillDisclosure replaces placeholders when provided and leaves missing ones literal', () => {
    const raw = KR_DISCLOSURE.laneBannerReg
    expect(raw).toContain('{REG_NO}')

    const filled = fillDisclosure(raw, { REG_NO: '2026-서울-0001' })
    expect(filled).toContain('신고번호 2026-서울-0001')
    expect(filled).not.toContain('{REG_NO}')

    const unfilled = fillDisclosure(raw)
    expect(unfilled).toBe(raw)

    const multi = fillDisclosure(KR_DISCLOSURE.footer, {
      BIZ_NO: '123-45-67890',
      REG_NO: '2026-서울-0001',
    })
    expect(multi).toContain('사업자등록번호 123-45-67890')
    expect(multi).toContain('신고번호 2026-서울-0001')

    const track = fillDisclosure(KR_DISCLOSURE.trackRecord, {
      START_DATE: '2026-08-13',
      N: 50,
    })
    expect(track).toContain('집계 시작일(2026-08-13)')
    expect(track).toContain('모든 라운드(50건)')
  })

  it('resolveKrLaneBanner and resolveKrLaneFooter use pre-registration copy when reg is empty', () => {
    const banner = resolveKrLaneBanner('')
    expect(banner.main).toContain('신고 절차를 진행 중')
    expect(banner.regLine).toContain('신고 수리 후 표시됩니다')
    expect(banner.regLine).not.toContain('{REG_NO}')

    expect(resolveKrLaneFooter('', '')).not.toContain('{REG_NO}')
    expect(resolveKrLaneFooter('', '')).not.toContain('{BIZ_NO}')
    expect(resolveKrLaneFooter('', '111-22-33333')).toContain('111-22-33333')
    expect(resolveKrLaneFooter('', '111-22-33333')).not.toContain('신고번호')
  })

  it('resolveKrLaneBanner and resolveKrLaneFooter use registered copy when reg is set', () => {
    const banner = resolveKrLaneBanner('2026-0999')
    expect(banner.main).toContain('유사투자자문업자')
    expect(banner.regLine).toContain('2026-0999')

    const footer = resolveKrLaneFooter('2026-0999', '111-22-33333')
    expect(footer).toBe(
      fillDisclosure(KR_DISCLOSURE.footer, { REG_NO: '2026-0999', BIZ_NO: '111-22-33333' }),
    )
  })

  it('formatKrTrackRecord omits placeholder clauses instead of printing braces', () => {
    expect(formatKrTrackRecord({})).not.toMatch(/[{}]/)
    expect(formatKrTrackRecord({ n: 12 })).toContain('(12건)')
    expect(formatKrTrackRecord({ n: 12 })).not.toContain('{')
    expect(formatKrTrackRecord({ startDate: '2026-08-13', n: 50 })).toContain('2026-08-13')
  })

  it('KoreaStockLane pre-registration render has no braces and includes usageNotice', () => {
    const html = renderToStaticMarkup(createElement(KoreaStockLane))
    expect(html).not.toMatch(/\{[A-Z0-9_]+\}/)
    expect(html).toContain('신고 절차를 진행 중')
    expect(html).toContain('신고 수리 후 표시됩니다')
    expect(html).toContain('종목과 기간만 선택할 수 있으며')
    expect(html).toContain('kr-lane-usage-notice')
    expect(html).toContain('AI 모델들의 예측 능력을 비교·기록하는 콘텐츠입니다.')
    expect(html).toContain('개별적인 투자상담과 자금운용은 불가능')
    expect(html).toContain('원금손실 가능성')
    expect(html).toContain('상호 PRAY · 대표 허민재')

    const htmlWithNums = renderToStaticMarkup(
      createElement(KoreaStockLane, { regNo: '2026-0999', bizNo: '111-22-33333' }),
    )
    expect(htmlWithNums).not.toMatch(/\{[A-Z0-9_]+\}/)
    expect(htmlWithNums).toContain('유사투자자문업자')
    expect(htmlWithNums).toContain('2026-0999')
    expect(htmlWithNums).toContain('111-22-33333')
  })
})

describe('Korea stock lane registration gate (isKrLanePublicReady)', () => {
  it('isKrLanePublicReady false → non-admin KR user cannot generate (403 path unchanged); admin override still works', () => {
    const prevReg = process.env.KR_ADVISORY_REG_NO
    const prevBiz = process.env.KR_BIZ_NO
    try {
      delete process.env.KR_ADVISORY_REG_NO
      expect(isKrLanePublicReady()).toBe(false)
      expect(getKrAdvisoryRegNo()).toBe('')

      const krViewer = {
        isAdmin: false,
        jurisdiction: { declaredCountry: 'KR', ipCountry: 'KR' },
      }
      expect(admissionStockLane(krViewer.jurisdiction)).toBe('korea')

      const nonAdminGate = gatePublicGenerateInstrument('AAPL', krViewer, '1d')
      expect(nonAdminGate).toEqual({
        ok: false,
        status: 403,
        code: 'jurisdiction_blocked',
      })

      const adminViewer = {
        isAdmin: true,
        jurisdiction: { declaredCountry: 'KR', ipCountry: 'KR' },
      }
      const adminGate = gatePublicGenerateInstrument('AAPL', adminViewer, '1d')
      expect(adminGate.ok).toBe(true)

      const usViewer = {
        isAdmin: false,
        jurisdiction: { declaredCountry: 'US', ipCountry: 'US' },
      }
      expect(admissionStockLane(usViewer.jurisdiction)).toBe('global')
      const usGate = gatePublicGenerateInstrument('AAPL', usViewer, '1d')
      expect(usGate.ok).toBe(true)
    } finally {
      if (prevReg !== undefined) process.env.KR_ADVISORY_REG_NO = prevReg
      else delete process.env.KR_ADVISORY_REG_NO
      if (prevBiz !== undefined) process.env.KR_BIZ_NO = prevBiz
      else delete process.env.KR_BIZ_NO
    }
  })

  it('isKrLanePublicReady evaluates dynamically from KR_ADVISORY_REG_NO', () => {
    const prev = process.env.KR_ADVISORY_REG_NO
    try {
      delete process.env.KR_ADVISORY_REG_NO
      expect(isKrLanePublicReady()).toBe(false)

      process.env.KR_ADVISORY_REG_NO = '   '
      expect(isKrLanePublicReady()).toBe(false)

      process.env.KR_ADVISORY_REG_NO = '2026-FSS-1234'
      expect(isKrLanePublicReady()).toBe(true)
      expect(getKrAdvisoryRegNo()).toBe('2026-FSS-1234')
    } finally {
      if (prev !== undefined) process.env.KR_ADVISORY_REG_NO = prev
      else delete process.env.KR_ADVISORY_REG_NO
    }
  })
})

describe('Korean-lane card disclosures (PredictionCard)', () => {
  beforeEach(() => {
    signalsMock.useLeagueRequestSignals.mockReset()
    signalsMock.useLeagueRequestSignals.mockReturnValue(signalsMock.defaultSignals)
  })

  it('renders card + confidence footer for Korean-lane viewers only', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { createElement: el } = await import('react')
    const { PredictionCard } = await import('@/components/league/PredictionCard')
    const { buildCardData } = await import('../card-aggregate')

    const mockRound: Record<string, unknown> = {
      id: 'kr-stock-round',
      opened_at: '2026-09-27T08:00:00.000Z',
      resolves_at: '2026-09-28T02:00:00.000Z',
      category: 'stocks',
      item_type: 'ranked',
      proposition_kind: 'close_higher',
      subject_label: null,
      instrument: 'STOCK:NASDAQ:AAPL',
      horizon: '1d',
      resolution_rule: 'test',
      proposition_text: 'Will AAPL close higher?',
      anchor_price: 100,
      anchor_price_at: null,
      anchor_session_date: '2026-09-27',
      resolution_price: null,
      resolution_session_date: null,
      actual_outcome: null,
      resolved_at: null,
      status: 'pending',
    }

    const card = buildCardData(mockRound as never, [], [], [])

    signalsMock.useLeagueRequestSignals.mockReturnValue({
      acceptLanguage: 'ko',
      ipCountry: 'KR',
      profileLocale: 'ko',
      declaredCountry: 'KR',
      isAdmin: false,
      loading: false,
    })
    const krHtml = renderToStaticMarkup(el(PredictionCard, { initialData: card }))
    expect(krHtml).toContain('data-testid="kr-card-disclosure"')
    expect(krHtml).toContain(KR_DISCLOSURE.card.slice(0, 24))
    expect(krHtml).toContain(KR_DISCLOSURE.confidence.slice(0, 24))

    signalsMock.useLeagueRequestSignals.mockReturnValue({
      acceptLanguage: 'en',
      ipCountry: 'US',
      profileLocale: 'en',
      declaredCountry: 'US',
      isAdmin: false,
      loading: false,
    })
    const worldHtml = renderToStaticMarkup(el(PredictionCard, { initialData: card }))
    expect(worldHtml).not.toContain('data-testid="kr-card-disclosure"')
    expect(worldHtml).not.toContain(KR_DISCLOSURE.card.slice(0, 40))
  })
})

describe('trackRecordVarsFromRecordRoom', () => {
  it('counts graded rounds and picks earliest resolved date', () => {
    const meta = trackRecordVarsFromRecordRoom([
      { resolved_at: '2026-09-10T00:00:00.000Z', gradedCount: 3 },
      { resolved_at: '2026-08-01T00:00:00.000Z', gradedCount: 0 },
      { resolved_at: '2026-08-15T00:00:00.000Z', gradedCount: 1 },
    ])
    expect(meta.n).toBe(2)
    expect(meta.startDate).toBe('2026-08-15')
  })
})
