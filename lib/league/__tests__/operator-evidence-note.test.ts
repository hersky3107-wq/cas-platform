import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OperatorEvidenceNote } from '../../../components/league/OperatorEvidenceNote'
import { LEAGUE_UI } from '../i18n/dictionary'
import { LEAGUE_LOCALES } from '../i18n/locales'

describe('OperatorEvidenceNote', () => {
  it('renders nothing on a price card (null evidence) — no extra markup', () => {
    const html = renderToStaticMarkup(
      createElement(OperatorEvidenceNote, { evidence: null, t: LEAGUE_UI.en, locale: 'en' })
    )
    expect(html).toBe('')
  })

  it('shows the source link, operator-verified label, and grading date — never the observed fact', () => {
    const html = renderToStaticMarkup(
      createElement(OperatorEvidenceNote, {
        evidence: { sourceUrl: 'https://www.premierleague.com/match/123', gradedAt: '2026-09-01T22:10:00.000Z' },
        t: LEAGUE_UI.en,
        locale: 'en',
      })
    )
    expect(html).toContain('Operator-verified')
    expect(html).toContain('https://www.premierleague.com/match/123')
    expect(html).toContain('Source')
    expect(html).toMatch(/Sep 1, 2026|1 Sep 2026|2026/)
    expect(html).not.toContain('Manchester')
    expect(html).not.toContain('2-1')
    expect(html).not.toContain('observed')
  })

  it('fills the chrome in all 8 locales, with pt in Portuguese', () => {
    for (const locale of LEAGUE_LOCALES) {
      const t = LEAGUE_UI[locale]
      const html = renderToStaticMarkup(
        createElement(OperatorEvidenceNote, {
          evidence: { sourceUrl: 'https://example.com/result', gradedAt: '2026-09-01T22:10:00.000Z' },
          t,
          locale,
        })
      )
      expect(html).toContain(t.operatorGrade.verifiedLabel)
      expect(html).toContain(t.operatorGrade.sourceLinkLabel)
      expect(html).toContain('https://example.com/result')
    }
    expect(LEAGUE_UI.pt.operatorGrade.verifiedLabel).toBe('Verificado pelo operador')
    expect(LEAGUE_UI.pt.operatorGrade.sourceLinkLabel).toBe('Fonte')
    expect(LEAGUE_UI.en.operatorGrade.verifiedLabel).toBe('Operator-verified')
  })
})
