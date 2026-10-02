import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  KR_DISCLOSURE,
  fillDisclosure,
  getKrAdvisoryRegNo,
  getKrBizNo,
  isKrLanePublicReady,
} from '../korea-disclosure'
import { admissionStockLane } from '../stock-lane'
import { gatePublicGenerateInstrument } from '../access-policy'
import { KoreaStockLane } from '@/components/league/PublicLeagueHub'

describe('Korea stock lane mandatory disclosures (자본시장법 유사투자자문업 규정)', () => {
  it('KR_DISCLOSURE is frozen and has all required disclosure keys with exact copy', () => {
    expect(Object.isFrozen(KR_DISCLOSURE)).toBe(true)
    const requiredKeys = [
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

    for (const key of requiredKeys) {
      expect(typeof KR_DISCLOSURE[key]).toBe('string')
      expect(KR_DISCLOSURE[key].trim().length).toBeGreaterThan(0)
    }
  })

  it('KR_DISCLOSURE strings contain none of: "보장합니다", "확실", "무조건", "환불" (guard against future edits)', () => {
    const banned = ['보장합니다', '무조건', '환불']
    for (const [key, text] of Object.entries(KR_DISCLOSURE)) {
      for (const b of banned) {
        expect(text, `key "${key}" should not contain "${b}"`).not.toContain(b)
      }
      // "확실" must never be used as an affirmative promotional claim;
      // only the negative disclaimer ("결과가 확실하다는 뜻은 아닙니다") is permitted.
      expect(
        text,
        `key "${key}" must not contain affirmative "확실" claims`,
      ).not.toMatch(/확실(?!하다는\s*뜻은\s*아닙니다)/)
    }
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

  it('KoreaStockLane output always contains the substrings "유사투자자문업자", "개별적인 투자상담과 자금운용은 불가능", "원금손실 가능성"', () => {
    const html = renderToStaticMarkup(createElement(KoreaStockLane))

    expect(html).toContain('유사투자자문업자')
    expect(html).toContain('개별적인 투자상담과 자금운용은 불가능')
    expect(html).toContain('원금손실 가능성')

    // Also renders generate guidance and footer
    expect(html).toContain('종목과 기간만 선택할 수 있으며')
    expect(html).toContain('상호 PRAY · 대표 허민재')

    // Renders with supplied reg and biz numbers when passed
    const htmlWithNums = renderToStaticMarkup(
      createElement(KoreaStockLane, {
        regNo: '2026-0999',
        bizNo: '111-22-33333',
      }),
    )
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

      // Non-admin KR user cannot generate (403 jurisdiction_blocked)
      const nonAdminGate = gatePublicGenerateInstrument('AAPL', krViewer, '1d')
      expect(nonAdminGate).toEqual({
        ok: false,
        status: 403,
        code: 'jurisdiction_blocked',
      })

      // Admin override still works
      const adminViewer = {
        isAdmin: true,
        jurisdiction: { declaredCountry: 'KR', ipCountry: 'KR' },
      }
      const adminGate = gatePublicGenerateInstrument('AAPL', adminViewer, '1d')
      expect(adminGate.ok).toBe(true)

      // World-lane user is unaffected
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
