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
})
