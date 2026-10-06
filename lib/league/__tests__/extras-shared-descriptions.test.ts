import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ExtraCompare } from '../../../components/league/ExtraCompare'
import { BoardTabBody, type BoardView } from '../../../components/league/LeaderboardBoardTabs'
import { emptyBoards } from '@/lib/league/boards/compute'
import { boardLabels } from '@/lib/league/boards/display'
import { extraRoleLabels, extraSeatCopy } from '@/lib/league/boards/extra-copy'
import { buildCardData, type PredictionRow, type RoundRow } from '@/lib/league/card-aggregate'
import { extraDescriptionPack, extraSeatDescription } from '@/lib/league/extra/descriptions'
import { EXTRA_SEAT_IDS } from '@/lib/league/extra/seats'
import { getLeagueUiPack } from '@/lib/league/i18n/dictionary'
import { leaderboardBoardCopy } from '@/lib/league/i18n/leaderboard-board-copy'
import { LEAGUE_LOCALES, type LeagueLocale } from '@/lib/league/i18n/locales'
import { formatSeatLabel, lookupSeat } from '@/lib/league/seats'
import { sideLabelsFor } from '@/lib/league/side-labels'

const DIVINATION_BASIS: Record<LeagueLocale, string> = {
  ko: '날짜·괘·타로·룬, 대상의 연주·월주, 부동산은 구성기학 방위. 시장 데이터는 보지 않음',
  en: "Date, hexagrams, tarot, runes, the subject's year and month pillars, Nine Star Ki directions for property. Does not look at market data",
  ja: '日付・卦・タロット・ルーン・対象の年柱と月柱、不動産は九星気学の方位。市場データは見ない',
  'zh-TW': '日期、卦、塔羅、符文、對象的年柱與月柱，房地產看九星氣學方位。不看市場數據',
  fr: "Date, hexagrammes, tarot, runes, piliers année et mois du sujet, directions des neuf étoiles pour l'immobilier. Ne lit pas les données de marché",
  es: 'Fecha, hexagramas, tarot, runas, pilares de año y mes del sujeto, direcciones de las nueve estrellas para vivienda. No mira datos de mercado',
  pt: 'Data, hexagramas, tarô, runas, pilares de ano e mês do sujeito, direções das nove estrelas para imóveis. Não olha dados de mercado',
  ar: 'التاريخ والهيكساغرام والتارو والرموز، وعمودا السنة والشهر للموضوع، واتجاهات النجوم التسع للعقارات. لا ينظر إلى بيانات السوق',
}

function view(locale: LeagueLocale): BoardView {
  const t = getLeagueUiPack(locale)
  const copy = leaderboardBoardCopy(locale)
  return { t, copy, labels: boardLabels(locale, t, copy), locale }
}

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, ' ')
}

function extrasTab(locale: LeagueLocale): string {
  return textOf(
    renderToStaticMarkup(
      createElement(BoardTabBody, { tab: 'extras', boards: emptyBoards(Date.parse('2026-10-06T12:00:00Z')), view: view(locale) }),
    ),
  )
}

describe('divination basis', () => {
  it('names the 사주 pillars and 구성기학 directions in every locale', () => {
    for (const locale of LEAGUE_LOCALES) {
      expect(extraDescriptionPack(locale).seats.divination.basis, locale).toBe(DIVINATION_BASIS[locale])
    }
  })
})

describe('leaderboard extras use the shared descriptions', () => {
  it('reads name, role and basis from descriptions.ts for every seat and locale', () => {
    for (const locale of LEAGUE_LOCALES) {
      const pack = extraDescriptionPack(locale)
      expect(extraRoleLabels(locale), locale).toEqual({ role: pack.roleLabel, basis: pack.basisLabel })
      for (const id of EXTRA_SEAT_IDS) {
        expect(extraSeatCopy(locale, id), `${locale}/${id}`).toEqual(extraSeatDescription(locale, id))
      }
      expect(extraSeatCopy(locale, 'gpt-6-astra')).toBeNull()
    }
  })

  it('shows every seat with its role and basis line in the extras header', () => {
    const ko = extrasTab('ko')
    expect(ko).toContain(`역할: 오락용 점괘 · 판단 근거: ${DIVINATION_BASIS.ko}`)
    expect(ko).toContain('역할: 다수가 놓친 위험')
    expect(ko).toContain('시장 기준선')
    expect(ko).not.toContain('컨센서스')
    for (const locale of LEAGUE_LOCALES) {
      const text = extrasTab(locale)
      const pack = extraDescriptionPack(locale)
      for (const id of EXTRA_SEAT_IDS) {
        expect(text, `${locale}/${id}`).toContain(pack.seats[id].name)
        expect(text, `${locale}/${id}`).toContain(pack.seats[id].role)
      }
      expect(text, locale).toContain(DIVINATION_BASIS[locale])
    }
  })
})

describe('market seat label', () => {
  it('is 시장 기준선 on the boards, the extra compare strip and the seat registry', () => {
    expect(extraSeatCopy('ko', 'consensus')?.name).toBe('시장 기준선')
    expect(boardLabels('ko', getLeagueUiPack('ko'), leaderboardBoardCopy('ko')).model('consensus')).toBe('시장 기준선')
    expect(getLeagueUiPack('ko').extraCompare.seat.consensus).toBe('시장 기준선')
    expect(Object.values(getLeagueUiPack('ko').extraCompare.seat)).not.toContain('컨센서스')
    const seat = lookupSeat('extra:consensus')
    expect(seat?.brand).toBe('시장 기준선')
    expect(seat ? formatSeatLabel(seat) : null).toBe('시장 기준선')
  })

  it('uses one name per locale across descriptions, the compare strip and the sports label', () => {
    for (const locale of LEAGUE_LOCALES) {
      const t = getLeagueUiPack(locale)
      const name = extraDescriptionPack(locale).seats.consensus.name
      expect(t.extraCompare.seat.consensus, locale).toBe(name)
      expect(t.sportsMarket.consensusSeat, locale).toBe(name)
      expect(view(locale).labels.model('consensus'), locale).toBe(name)
    }
  })

  it('renders 시장 기준선 on a non-sports card strip', () => {
    const round: RoundRow = {
      id: 'round-market-label',
      proposition_text: 'Will AAPL close higher 24h from now?',
      category: 'stock',
      color_bucket: 'green',
      instrument: 'AAPL',
      horizon: '1d',
      resolution_rule: 'NASDAQ regular-session close',
      resolves_at: '2026-08-17T15:31:00.000Z',
      opened_at: '2026-08-16T21:30:00.000Z',
      actual_outcome: null,
      resolved_at: null,
    }
    const row = (over: Partial<PredictionRow>): PredictionRow => ({
      model_id: 'gpt-5.6-sol',
      brand: 'OpenAI',
      camp: 'us',
      league_tier: 'premier',
      predicted_direction: 'up',
      predicted_value: 70,
      reasoning_snippet: 'ok',
      is_correct: null,
      cost_usd: 0.01,
      predicted_at: '2026-08-16T21:31:00.000Z',
      ...over,
    })
    const card = buildCardData(round, [
      row({}),
      row({ model_id: 'consensus', brand: '💰 돈이 매긴 확률', camp: 'other', league_tier: 'extra', predicted_value: 61 }),
    ])
    const t = getLeagueUiPack('ko')
    const html = renderToStaticMarkup(
      createElement(ExtraCompare, { models: card.models, consensus: card.consensus, t, labels: sideLabelsFor(card.round, t) }),
    )
    expect(html).toContain('시장 기준선')
    expect(html).not.toContain('컨센서스')
  })
})
