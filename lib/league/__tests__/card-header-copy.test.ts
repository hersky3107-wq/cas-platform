import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CardHeader } from '../../../components/league/CardHeader'
import { formatRoundOpenedDate, formatSessionDate, headerHeadline, headerWindow } from '../card-header-copy'
import { LEAGUE_UI } from '../i18n/dictionary'
import { toneFor } from '../tone'
import type { CardRoundMeta, HitRateSummary } from '../card-types'

const t = LEAGUE_UI.en
const ko = LEAGUE_UI.ko
const tone = toneFor('green')
const hitRate: HitRateSummary = { resolved: false, correct: null, graded: 0, hitRatePct: null, provisional: true }

function roundMeta(overrides: Partial<CardRoundMeta> = {}): CardRoundMeta {
  const base: CardRoundMeta = {
    round_id: 'test-round-123',
    opened_at: '2026-08-18T03:12:41.000Z',
    resolves_at: '2026-08-19T03:12:41.000Z',
    proposition_text: 'Will XAU/USD close higher?',
    proposition_kind: 'binary_close_higher',
    subject_label: null,
    instrument: 'XAU/USD',
    horizon: '1d',
    category: 'gold_metal',
    resolution_rule: 'Close comparison',
    color_bucket: 'green',
    anchorPrice: 2500,
    anchorSessionDate: '2026-08-17',
    anchorPriceAt: '2026-08-17T21:00:00.000Z',
    livePrice: 2505,
    livePriceAt: '2026-08-18T03:12:41.000Z',
    resolutionPrice: null,
    resolutionSessionDate: null,
    actual_outcome: null,
    resolved_at: null,
    operatorEvidence: null,
    gradingState: 'not_due',
    unresolvableReason: null,
    actualMagnitudePct: null,
  }
  return { ...base, ...overrides }
}

describe('header honesty', () => {
  it('does not invent a starting price when the anchor is missing', () => {
    const headline = headerHeadline({
      roundDate: 'Aug 18, 2026',
      instrument: 'AAPL',
      anchorPrice: null,
      anchorSessionDate: null,
      locale: 'en',
      t,
    })
    expect(headline).toContain('AAPL')
    expect(headline).toMatch(/unavailable/i)
    expect(headline).not.toMatch(/\$/)

    const window = headerWindow({
      instrument: 'AAPL',
      anchorPrice: null,
      anchorSessionDate: null,
      resolutionSessionDate: null,
      locale: 'en',
      t,
    })
    expect(window).toBe(t.header.windowNoAnchor)
  })

  it('renders the AAPL audit sentence from persisted session dates only — Aug 17 and Aug 18', () => {
    const sentence = headerWindow({
      instrument: 'AAPL',
      anchorPrice: 305.59,
      anchorSessionDate: '2026-08-17',
      resolutionSessionDate: '2026-08-18',
      locale: 'ko',
      t: ko,
    })
    expect(sentence).toContain('305.59')
    expect(sentence).toContain(formatSessionDate('2026-08-17', 'ko'))
    expect(sentence).toContain(formatSessionDate('2026-08-18', 'ko'))
    expect(sentence).toMatch(/17/)
    expect(sentence).toMatch(/18/)
    expect(sentence).not.toMatch(/19/)
  })

  it('never uses resolves_at or anchor_price_at — missing session dates stay undated', () => {
    const sentence = headerWindow({
      instrument: 'AAPL',
      anchorPrice: 305.59,
      anchorSessionDate: null,
      resolutionSessionDate: null,
      locale: 'en',
      t,
    })
    expect(sentence).toBe(t.header.windowNoSessionDates)
    expect(sentence).not.toMatch(/19/)
    expect(sentence).not.toMatch(/18/)
  })

  it('does not fall back to anchor_price_at when only the anchor session date is missing', () => {
    // resolution_session_date is present but anchor_session_date is null.
    // The renderer must NOT invent an anchor date from anchor_price_at; it
    // returns the no-session-dates sentence (기준일 미기록) with no date.
    const sentence = headerWindow({
      instrument: 'AAPL',
      anchorPrice: 305.59,
      anchorSessionDate: null,
      resolutionSessionDate: '2026-08-18',
      locale: 'ko',
      t: ko,
    })
    expect(sentence).toBe(ko.header.windowNoSessionDates)
    // No invented anchor date, no timestamp-derived date, no resolution date leaked in.
    expect(sentence).not.toMatch(/17/)
    expect(sentence).not.toMatch(/18/)
    expect(sentence).not.toMatch(/2026/)
  })

  it('does not fall back to resolves_at when only the resolution session date is missing', () => {
    // anchor_session_date is present but resolution_session_date is null.
    // The renderer keeps the anchor date (windowAnchorOnly) and does NOT
    // invent a resolution date from resolves_at.
    const sentence = headerWindow({
      instrument: 'AAPL',
      anchorPrice: 305.59,
      anchorSessionDate: '2026-08-17',
      resolutionSessionDate: null,
      locale: 'en',
      t,
    })
    expect(sentence).toBe(t.header.windowAnchorOnly(formatSessionDate('2026-08-17', 'en'), '$305.59'))
    expect(sentence).not.toMatch(/19/)
    expect(sentence).not.toMatch(/18/)
  })

  it('uses the round opened_at date, labeled as a round — never now()', () => {
    const opened = formatRoundOpenedDate('2026-08-18T03:12:41.000Z', 'en')
    expect(opened).toContain('18')
    expect(opened).not.toMatch(/24/)

    const headline = headerHeadline({
      roundDate: opened,
      instrument: 'AAPL',
      anchorPrice: 305.59,
      anchorSessionDate: '2026-08-17',
      locale: 'en',
      t,
    })
    expect(headline).toMatch(/Round of/i)
    expect(headline).toContain(opened)
    expect(headline).not.toMatch(/August 24/)

    const koHeadline = headerHeadline({
      roundDate: formatRoundOpenedDate('2026-08-18T03:12:41.000Z', 'ko'),
      instrument: 'AAPL',
      anchorPrice: 305.59,
      anchorSessionDate: '2026-08-17',
      locale: 'ko',
      t: ko,
    })
    expect(koHeadline).toContain('라운드')
    expect(koHeadline).toMatch(/18/)
  })

  it('renders metalsSpotNote on gold_metal category rounds ONLY', () => {
    const goldRound = roundMeta({ category: 'gold_metal', instrument: 'XAU/USD' })
    const goldHtml = renderToStaticMarkup(
      createElement(CardHeader, {
        round: goldRound,
        hitRate,
        tone,
        t: ko,
        locale: 'ko',
      })
    )
    expect(goldHtml).toContain('국제 현물 시세(USD/온스) 기준입니다. 국내 금값은 환율·부가세·유통 마진으로 이 시세와 다를 수 있습니다.')

    const stockRound = roundMeta({ category: 'stock', instrument: 'AAPL' })
    const stockHtml = renderToStaticMarkup(
      createElement(CardHeader, {
        round: stockRound,
        hitRate,
        tone,
        t: ko,
        locale: 'ko',
      })
    )
    expect(stockHtml).not.toContain('국제 현물 시세')
  })

  it('renders international metalsSpotNote in English on gold_metal rounds', () => {
    const goldRound = roundMeta({ category: 'gold_metal', instrument: 'GLD' })
    const goldHtml = renderToStaticMarkup(
      createElement(CardHeader, {
        round: goldRound,
        hitRate,
        tone,
        t,
        locale: 'en',
      })
    )
    expect(goldHtml).toContain('Based on international spot prices (USD/oz)')
  })
})
