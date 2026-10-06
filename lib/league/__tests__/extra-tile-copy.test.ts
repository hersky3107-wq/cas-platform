import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ModelTile } from '../../../components/league/ModelTile'
import type { CardModelPrediction } from '../card-types'
import { extraDescriptionPack, extraSeatDescription } from '../extra/descriptions'
import { EXTRA_SEAT_IDS } from '../extra/seats'
import { getLeagueUiPack } from '../i18n/dictionary'
import { LEAGUE_LOCALES } from '../i18n/locales'
import { SPORTS_UI_BANNED_RE } from '../sports-market'

function shown(html: string): string {
  return html.replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"')
}

function tile(modelId: string, brand = modelId): CardModelPrediction {
  return {
    prediction_id: null,
    model_id: modelId,
    brand,
    model_identifier: modelId,
    camp: 'other',
    league_tier: 'extra',
    direction: 'up',
    probability: 55,
    magnitude: null,
    qualifierText: null,
    reasoning_snippet: 'a short take',
    is_correct: null,
    cost_usd: 0,
    predicted_at: '2026-10-05T00:00:00.000Z',
  }
}

describe('extra tile descriptions', () => {
  it('shows role and basis for every extra seat in every locale, with no disclosure click', () => {
    for (const locale of LEAGUE_LOCALES) {
      const pack = extraDescriptionPack(locale)
      const t = getLeagueUiPack(locale)
      for (const id of EXTRA_SEAT_IDS) {
        const html = shown(renderToStaticMarkup(createElement(ModelTile, { model: tile(id), t, locale })))
        const seat = extraSeatDescription(locale, id)
        expect(html, `${locale}/${id}`).toContain('data-testid="extra-role-line"')
        expect(html, `${locale}/${id}`).toContain('data-testid="extra-basis-line"')
        expect(html, `${locale}/${id}`).toContain(pack.roleLabel)
        expect(html, `${locale}/${id}`).toContain(pack.basisLabel)
        expect(html, `${locale}/${id}`).toContain(seat.role)
        expect(html, `${locale}/${id}`).toContain(seat.basis)
        expect(html, `${locale}/${id}`).not.toContain('<details')
      }
    }
  })

  it('heads the market seat with the localized baseline name, including rows stored under the old brand', () => {
    for (const locale of LEAGUE_LOCALES) {
      const pack = extraDescriptionPack(locale)
      const html = renderToStaticMarkup(
        createElement(ModelTile, {
          model: tile('consensus', '💰 돈이 매긴 확률'),
          t: getLeagueUiPack(locale),
          locale,
        }),
      )
      expect(html, locale).toContain(`💰 ${pack.seats.consensus.name}`)
      expect(html, locale).not.toContain('💰 돈이 매긴 확률')
    }
  })

  it('uses the no-betting basis on a sports market tile', () => {
    const html = renderToStaticMarkup(
      createElement(ModelTile, {
        model: tile('consensus', '💰 시장 기준선'),
        t: getLeagueUiPack('ko'),
        locale: 'ko',
        category: 'sports',
      }),
    )
    const basis = extraDescriptionPack('ko').consensusBasisNoBetting
    expect(html).toContain(basis)
    expect(html).not.toMatch(SPORTS_UI_BANNED_RE)
  })
})
