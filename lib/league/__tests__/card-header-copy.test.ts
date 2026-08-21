import { describe, expect, it } from 'vitest'
import { formatSessionDate, headerHeadline, headerWindow } from '../card-header-copy'
import { LEAGUE_UI } from '../i18n/dictionary'

const t = LEAGUE_UI.en
const ko = LEAGUE_UI.ko

describe('header honesty', () => {
  it('does not invent a starting price when the anchor is missing', () => {
    const headline = headerHeadline({
      today: 'Friday, August 21, 2026',
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
})
