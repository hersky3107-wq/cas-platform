import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DivisionBoard } from '../../../components/league/DivisionBoard'
import { HubDoors } from '../../../components/league/HubDoors'
import { ModelTile } from '../../../components/league/ModelTile'
import { WaitingArena } from '../../../components/league/WaitingArena'
import { emptyTally, type CardModelPrediction, type TierSplit } from '../card-types'
import { extraDescriptionPack } from '../extra/descriptions'
import { leagueQueueCap, LEAGUE_QUEUE_CAP_DEFAULT } from '../generation/policy'
import {
  categoryFromSearch,
  chipsForDoor,
  doorForCategory,
  parseStoredDoor,
} from '../hub-doors'
import { getLeagueUiPack } from '../i18n/dictionary'
import { LEAGUE_LOCALES } from '../i18n/locales'
import { leagueSurfaceCopy } from '../i18n/surface-copy'
import { runningRemainingMinutes, tickerTake } from '../waiting-arena'

function extraTile(modelId: string): CardModelPrediction {
  return {
    prediction_id: null,
    model_id: modelId,
    brand: modelId,
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

describe('extra seat explanations', () => {
  it('keeps the Korean intro and an intro in every locale', () => {
    expect(leagueSurfaceCopy('ko').extra.intro).toBe(
      '40개 AI와 다른 방식으로 보는 특별 좌석입니다. 채점은 하지만 40 AI 종합에는 섞지 않습니다.',
    )
    for (const locale of LEAGUE_LOCALES) {
      expect(leagueSurfaceCopy(locale).extra.intro.length).toBeGreaterThan(12)
    }
  })

  it('shows role and basis on an extra tile without a click', () => {
    const t = getLeagueUiPack('ko')
    const html = renderToStaticMarkup(
      createElement(ModelTile, { model: extraTile('divination'), t, locale: 'ko' }),
    )
    const divination = extraDescriptionPack('ko').seats.divination
    expect(html).toContain('data-testid="extra-role"')
    expect(html).toContain(divination.role)
    expect(html).toContain(divination.basis)
    expect(html).not.toContain('<details')
  })

  it('prints the extra intro under the extra header while a round is streaming', () => {
    const t = getLeagueUiPack('ko')
    const html = renderToStaticMarkup(
      createElement(DivisionBoard, {
        models: [],
        tierSplit: {
          premier: emptyTally(),
          challenger: emptyTally(),
          world: emptyTally(),
          scout: emptyTally(),
          extra: emptyTally(),
        } satisfies TierSplit,
        t,
        locale: 'ko',
        streaming: true,
      }),
    )
    expect(html).toContain('data-testid="extra-intro"')
    expect(html).toContain('40개 AI와 다른 방식으로 보는 특별 좌석입니다')
    expect(html).toContain('지금 생각 중')
  })
})

describe('waiting arena', () => {
  const t = getLeagueUiPack('ko')

  it('shows the real queue line and does not invent a split', () => {
    const html = renderToStaticMarkup(
      createElement(WaitingArena, {
        queued: true,
        answered: 0,
        rosterSize: 46,
        queuePosition: 2,
        etaMinutes: 4,
        models: [],
        t,
        locale: 'ko',
      }),
    )
    expect(html).toContain('data-testid="arena-queue"')
    expect(html).toContain('대기 2번째 · 약 4분')
    expect(html).toContain('아직 표가 없습니다')
    expect(html).toContain('motion-reduce:transition-none')
    expect(html).toContain('league-gen-pulse')
    expect(html).toContain('지금 생각 중')
  })

  it('ticks a real snippet into the ticker and labels remaining time from unanswered seats', () => {
    const model: CardModelPrediction = {
      ...extraTile('claude-fable-5'),
      brand: 'Anthropic',
      camp: 'us',
      league_tier: 'premier',
      reasoning_snippet: '울산 우세 — 순위 격차',
    }
    expect(tickerTake({ name: 'Claude', snippet: model.reasoning_snippet })).toBe('Claude: 울산 우세 — 순위 격차')
    expect(tickerTake({ name: 'Claude', snippet: '   ' })).toBeNull()
    const html = renderToStaticMarkup(
      createElement(WaitingArena, {
        queued: false,
        answered: 1,
        rosterSize: 46,
        models: [model],
        t,
        locale: 'ko',
        startedAtMs: Date.now(),
      }),
    )
    expect(html).toContain('Claude: 울산 우세 — 순위 격차')
    expect(html).toContain('data-testid="arena-clock"')
    expect(html).toContain(leagueSurfaceCopy('ko').arena.remaining(runningRemainingMinutes(1, 46)!))
    expect(html).toContain('data-testid="arena-tier-remaining"')
    expect(html).toContain('data-lit="true"')
  })

  it('keeps 8 to 10 waiting facts per locale and stops motion in CSS', () => {
    for (const locale of LEAGUE_LOCALES) {
      const facts = leagueSurfaceCopy(locale).arena.facts
      expect(facts.length).toBeGreaterThanOrEqual(8)
      expect(facts.length).toBeLessThanOrEqual(10)
      expect(new Set(facts).size).toBe(facts.length)
    }
    const css = readFileSync(resolve('app/globals.css'), 'utf8')
    const reduced = css.slice(css.indexOf('prefers-reduced-motion'))
    expect(reduced).toContain('.league-gen-pulse')
    expect(reduced).toContain('animation: none')
  })
})

describe('finance and world doors', () => {
  const categories = [
    { id: 'stocks' as const },
    { id: 'crypto' as const },
    { id: 'sports' as const },
    { id: 'politics_election' as const },
  ]

  it('drops a hidden category and keeps door order', () => {
    expect(chipsForDoor(categories, 'finance').map((row) => row.id)).toEqual(['stocks', 'crypto'])
    expect(chipsForDoor([...categories, { id: 'memecoin' as const }], 'finance').map((row) => row.id)).toEqual([
      'stocks',
      'crypto',
      'memecoin',
    ])
    expect(doorForCategory('sports')).toBe('world')
    expect(categoryFromSearch('?cat=sports&x=1', ['sports', 'stocks'])).toBe('sports')
    expect(categoryFromSearch('?cat=memecoin', ['stocks'])).toBeNull()
    expect(parseStoredDoor('finance')).toBe('finance')
    expect(parseStoredDoor('nope')).toBeNull()
  })

  it('landing doors have no chips and the Korean finance list omits 밈코인', () => {
    const html = renderToStaticMarkup(createElement(HubDoors, { omitMemecoin: true }))
    const copy = leagueSurfaceCopy('en').doors
    expect(html).toContain(copy.financeTitle)
    expect(html).toContain(copy.worldTitle)
    expect(html).toContain(copy.enter)
    expect(html.split('data-testid="door-world"')[0]).not.toContain('Memecoins')
    expect(html.split('data-testid="door-world"')[0]).not.toContain('밈코인')
    expect(html).not.toContain('data-testid="door-show-all"')
    expect(leagueSurfaceCopy('ko').doors.financeTitle).toBe('금융 예측')
    expect(leagueSurfaceCopy('ko').doors.worldTitle).toBe('이슈 예측')
    expect(leagueSurfaceCopy('en').doors.financeMark).toBe('MARKETS')
    expect(leagueSurfaceCopy('en').doors.worldMark).toBe('EVENTS')
    expect(leagueSurfaceCopy('en').doors.worldTitle).toBe('Event Predictions')
  })
})

describe('queue cap', () => {
  it('defaults to 30 and reads LEAGUE_QUEUE_CAP', () => {
    const previous = process.env.LEAGUE_QUEUE_CAP
    delete process.env.LEAGUE_QUEUE_CAP
    expect(leagueQueueCap()).toBe(LEAGUE_QUEUE_CAP_DEFAULT)
    expect(LEAGUE_QUEUE_CAP_DEFAULT).toBe(30)
    process.env.LEAGUE_QUEUE_CAP = '12'
    expect(leagueQueueCap()).toBe(12)
    process.env.LEAGUE_QUEUE_CAP = '0'
    expect(leagueQueueCap()).toBe(30)
    process.env.LEAGUE_QUEUE_CAP = '500'
    expect(leagueQueueCap()).toBe(200)
    if (previous == null) delete process.env.LEAGUE_QUEUE_CAP
    else process.env.LEAGUE_QUEUE_CAP = previous
  })

  it('refuses at the cap before any charge and uses the friendly line', () => {
    const src = readFileSync(resolve('app/api/league/generate/route.ts'), 'utf8')
    const cap = src.indexOf('active >= leagueQueueCap()')
    const charge = src.indexOf('await deductCreditsBalance')
    expect(cap).toBeGreaterThan(0)
    expect(charge).toBeGreaterThan(cap)
    expect(getLeagueUiPack('ko').hub.generationBusy).toBe(
      '지금 많은 분들이 이용 중입니다 · 잠시 후 다시 시도해 주세요',
    )
    for (const locale of LEAGUE_LOCALES) {
      expect(getLeagueUiPack(locale).hub.generationBusy.length).toBeGreaterThan(8)
    }
  })
})
