import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LeaderboardBoards } from '../../../components/league/LeaderboardBoards'
import { BoardTabBody, type BoardView } from '../../../components/league/LeaderboardBoardTabs'
import { boardRate, computeBoards, emptyBoards } from '@/lib/league/boards/compute'
import { boardLabels, rateText } from '@/lib/league/boards/display'
import { boardFiltersQuery, parseBoardFilters } from '@/lib/league/boards/filters'
import type { BoardPrediction, BoardRound, BoardSet, BoardsResponse } from '@/lib/league/boards/types'
import { MIN_GRADED_ROUNDS_FOR_WIN_RATE } from '@/lib/league/credits'
import { getLeagueUiPack } from '@/lib/league/i18n/dictionary'
import { BOARD_TABS, leaderboardBoardCopy } from '@/lib/league/i18n/leaderboard-board-copy'
import { LEAGUE_LOCALES, type LeagueLocale } from '@/lib/league/i18n/locales'
import { lookupRosterEntry } from '@/lib/league/roster'

const MIN = MIN_GRADED_ROUNDS_FOR_WIN_RATE
const NOW = Date.parse('2026-10-06T12:00:00Z')

function round(i: number, over: Partial<BoardRound> = {}): BoardRound {
  return {
    id: `r${String(i).padStart(2, '0')}`,
    category: 'stock',
    horizon: '1d',
    label: `Round ${i}`,
    resolvesAt: `2026-09-${String(10 + (i % 18)).padStart(2, '0')}T06:30:00Z`,
    consensusCorrect: true,
    consensusProbability: 65,
    ...over,
  }
}

function pred(roundId: string, modelId: string, correct: boolean, over: Partial<BoardPrediction> = {}): BoardPrediction {
  const roster = lookupRosterEntry(modelId)
  return {
    roundId,
    modelId,
    tier: roster?.league_tier ?? 'extra',
    camp: roster?.camp ?? 'other',
    brand: roster?.brand ?? modelId,
    side: 'up',
    probability: 60,
    correct,
    lens: null,
    ...over,
  }
}

function fixture(count: number): { rounds: BoardRound[]; preds: BoardPrediction[] } {
  const rounds = Array.from({ length: count }, (_, i) => round(i, { consensusCorrect: i % 3 !== 0 }))
  const preds = rounds.flatMap((r, i) => [
    pred(r.id, 'gpt-6-astra', i % 4 !== 0, { lens: 'trend_momentum', probability: 80 }),
    pred(r.id, 'qwen3.8-max', i % 2 === 0, { side: 'down', probability: 55 }),
    pred(r.id, 'claude-fable-5', i % 5 !== 0),
    pred(r.id, 'claude-sonnet-5', i % 3 === 0),
    pred(r.id, 'gpt-5-search-api', true),
    pred(r.id, 'divination', i % 2 === 1),
    pred(r.id, 'crow', i % 4 === 0, { side: 'down' }),
  ])
  return { rounds, preds }
}

function response(boards: BoardSet, rounds: number, over: Partial<BoardsResponse> = {}): BoardsResponse {
  return {
    kind: 'boards',
    signature: 'all|h=all|p=all',
    filters: { door: 'all', category: null, horizon: 'all', period: 'all' },
    pending: false,
    meta: { generatedAt: '2026-10-06T03:00:00Z', categories: ['stock', 'sports'], minSample: MIN, rounds },
    boards,
    ...over,
  }
}

function view(locale: LeagueLocale): BoardView {
  const t = getLeagueUiPack(locale)
  const copy = leaderboardBoardCopy(locale)
  return { t, copy, labels: boardLabels(locale, t, copy), locale }
}

function render(res: BoardsResponse, locale: LeagueLocale = 'ko', initialTab: (typeof BOARD_TABS)[number] = 'battle') {
  return renderToStaticMarkup(
    createElement(LeaderboardBoards, { response: res, view: view(locale), onFilters: () => {}, initialTab }),
  )
}

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ')
}

describe('rateText', () => {
  const copy = leaderboardBoardCopy('ko')

  it('shows "표본 부족 (n)" below the minimum sample, never a percentage', () => {
    expect(rateText(boardRate(3, 4), copy)).toEqual({ kind: 'insufficient', text: '표본 부족 (4)' })
    expect(rateText(boardRate(MIN - 1, MIN - 1), copy).text).not.toContain('%')
  })

  it('gates pooled figures on rounds and reports rounds, not calls', () => {
    expect(rateText(boardRate(20, 40, 4), copy, { pooled: true }).text).toBe('표본 부족 (4)')
  })

  it('prints every percentage with its n', () => {
    expect(rateText(boardRate(11, 17), copy)).toEqual({ kind: 'pct', text: '64.7% (17판)' })
    expect(rateText(boardRate(5, 10), copy).text).toBe('50% (10판)')
    expect(rateText(boardRate(250, 393, 17), copy, { pooled: true }).text).toBe('63.6% (17판 · 393건)')
    expect(rateText(boardRate(9, 12, 12), copy, { pooled: true }).text).toBe('75% (12판)')
  })

  it('says there is no record when nothing is graded', () => {
    expect(rateText(boardRate(0, 0, 0), copy)).toEqual({ kind: 'empty', text: '기록 없음' })
  })

  it('uses each locale’s sample-too-small line', () => {
    expect(rateText(boardRate(1, 2), leaderboardBoardCopy('en')).text).toBe('Sample too small (2)')
    expect(rateText(boardRate(8, 12), leaderboardBoardCopy('en')).text).toBe('66.6% (12 rounds)')
  })
})

describe('leaderboard board copy', () => {
  type Leaf = { path: string; value: unknown }
  function leaves(value: unknown, path = ''): Leaf[] {
    if (value && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
        leaves(child, path ? `${path}.${key}` : key),
      )
    }
    return [{ path, value }]
  }
  const reference = leaves(leaderboardBoardCopy('ko'))

  it.each(LEAGUE_LOCALES)('%s has every key, non-empty', (locale) => {
    const pack = leaves(leaderboardBoardCopy(locale))
    expect(pack.map((leaf) => leaf.path)).toEqual(reference.map((leaf) => leaf.path))
    for (const { path, value } of pack) {
      const text = typeof value === 'function' ? (value as (...args: unknown[]) => unknown)(7, 17, 393) : value
      expect(typeof text, `${locale}.${path}`).toBe('string')
      expect((text as string).trim().length, `${locale}.${path}`).toBeGreaterThan(0)
      expect(text as string, `${locale}.${path}`).not.toMatch(/undefined|NaN|\[object/)
    }
  })

  it('Korean copy matches the spec wording', () => {
    const ko = leaderboardBoardCopy('ko')
    expect(ko.bannerTitle).toBe('AI 종합 적중률')
    expect(ko.insufficient(4)).toBe('표본 부족 (4)')
    expect(ko.todayTitle).toBe('오늘의 대결')
    expect(BOARD_TABS.map((tab) => ko.tabs[tab])).toEqual([
      '대결',
      '모델 순위',
      '분야별',
      '회사·형제',
      '관점',
      '엑스트라',
      '명예의 전당',
    ])
    expect(ko.filters.doors).toEqual({ finance: '금융', world: '이슈', all: '전체' })
    expect(ko.filters.periods).toEqual({ week: '이번 주', month: '이번 달', '90d': '최근 90일', all: '전체' })
    expect(ko.fields.showAll).toBe('전체 순위 보기')
    expect(ko.battle.tierNote).toContain('같은 입력, 다른 판단')
  })
})

describe('filter query', () => {
  it('round-trips through parseBoardFilters', () => {
    const filters = { door: 'finance', category: 'stock', horizon: '1w', period: '90d' } as const
    const qs = new URLSearchParams(boardFiltersQuery(filters))
    expect(parseBoardFilters((name) => qs.get(name))).toEqual(filters)
    expect(boardFiltersQuery({ door: 'all', category: null, horizon: 'all', period: 'all' })).toBe('door=all')
  })
})

describe('leaderboard rendering', () => {
  it('renders "표본 부족 (n)" and no percentage or rank when every sample is small', () => {
    const { rounds, preds } = fixture(3)
    const boards = computeBoards(rounds, preds, NOW)
    for (const tab of BOARD_TABS) {
      const html = render(response(boards, 3), 'ko', tab)
      expect(html, tab).not.toContain('data-rate="pct"')
      const text = textOf(html)
      expect(text, tab).not.toMatch(/\d+(\.\d)?% \(\d/)
    }
    const banner = textOf(render(response(boards, 3)))
    expect(banner).toContain('AI 종합 적중률 표본 부족 (3)')
    const models = render(response(boards, 3), 'ko', 'models')
    expect(models).toContain('표본 부족 (3)')
    expect(models).not.toMatch(/<td class="[^"]*">1<\/td>/)
  })

  it('renders the banner, 오늘의 대결 cards and tabs once samples clear the gate', () => {
    const { rounds, preds } = fixture(12)
    const boards = computeBoards(rounds, preds, NOW)
    const html = render(response(boards, 12))
    const text = textOf(html)
    expect(text).toContain('AI 종합 적중률 66.6% (12판)')
    expect(text).toContain('동전 던지기 50%')
    expect(text).toContain('오늘의 대결')
    for (const id of ['camp', 'divination', 'siblings', 'method']) expect(html).toContain(`data-highlight="${id}"`)
    expect(text).toContain('미국 vs 중국')
    expect(text).toContain('점술 vs AI')
    expect(text).toContain('형제 대결 · Anthropic')
    expect(html.match(/role="tab"/g)).toHaveLength(BOARD_TABS.length)
    expect(text).toContain('같은 입력, 다른 판단')
    expect(text).toContain('채점 완료 12판 기준')
    expect(text).toContain('10판 미만은')
  })

  it('every percentage in every tab carries its n', () => {
    const { rounds, preds } = fixture(12)
    const boards = computeBoards(rounds, preds, NOW)
    const ko = leaderboardBoardCopy('ko')
    const labelsWithPercent = [
      ko.coinFlip,
      ...Object.values(ko.battle.shareBuckets),
      ko.fame.bluffNote(75),
      ko.fame.humbleNote(60),
    ]
    let figures = 0
    for (const tab of BOARD_TABS) {
      let text = textOf(render(response(boards, 12), 'ko', tab))
      for (const label of labelsWithPercent) text = text.split(label).join('')
      figures += (text.match(/\d+(\.\d)?% \(\d+판( · \d+건)?\)/g) ?? []).length
      const bare = text.replace(/\d+(\.\d)?% \(\d+판( · \d+건)?\)/g, '')
      expect(bare, tab).not.toMatch(/\d+(\.\d)?%/)
    }
    expect(figures).toBeGreaterThan(10)
  })

  it('shows model ranks, category top 5, company and sibling rows, lens labels, extras and fame', () => {
    const { rounds, preds } = fixture(12)
    const boards = computeBoards(rounds, preds, NOW)
    const res = response(boards, 12)
    const models = textOf(render(res, 'ko', 'models'))
    expect(models).toContain('40 AI 순위')
    expect(models).toContain('엑스트라 (별도 집계)')
    expect(models).toContain('점술')
    const fields = textOf(render(res, 'ko', 'fields'))
    expect(fields).toContain('상위 5')
    expect(fields).toContain('전체 순위 보기')
    const companies = textOf(render(res, 'ko', 'companies'))
    expect(companies).toContain('Anthropic')
    expect(companies).toContain('Claude Fable')
    expect(companies).toContain('Claude Sonnet')
    const lenses = textOf(render(res, 'ko', 'lenses'))
    expect(lenses).not.toContain('trend_momentum')
    const extras = textOf(render(res, 'ko', 'extras'))
    expect(extras).toContain('엑스트라 vs 40 AI')
    expect(extras).toContain('복기 · Claude Opus 5.5')
    expect(extras).toContain('다수와 반대로 간')
    const fame = textOf(render(res, 'ko', 'fame'))
    expect(fame).toContain('허풍 순위')
    expect(fame).toContain('겸손 순위')
    expect(fame).toContain('외로운 늑대')
  })

  it('renders every tab in every locale without leaking raw keys', () => {
    const { rounds, preds } = fixture(12)
    const boards = computeBoards(rounds, preds, NOW)
    for (const locale of LEAGUE_LOCALES) {
      for (const tab of BOARD_TABS) {
        const html = renderToStaticMarkup(createElement(BoardTabBody, { tab, boards, view: view(locale) }))
        expect(html.length, `${locale}/${tab}`).toBeGreaterThan(0)
        expect(textOf(html), `${locale}/${tab}`).not.toMatch(/undefined|NaN/)
      }
      const text = textOf(render(response(boards, 12), locale))
      expect(text, locale).toContain(leaderboardBoardCopy(locale).bannerTitle)
    }
  })

  it('shows the pending line and no boards before the first build', () => {
    const html = render(response(emptyBoards(NOW), 0, { pending: true }))
    expect(html).toContain('첫 집계를 준비하고 있습니다')
    expect(html).not.toContain('data-board="banner"')
    expect(html).not.toContain('role="tab"')
  })

  it('offers door, category (door-filtered), horizon and period filters', () => {
    const { rounds, preds } = fixture(3)
    const boards = computeBoards(rounds, preds, NOW)
    const all = textOf(render(response(boards, 3)))
    for (const label of ['금융', '이슈', '이번 주', '이번 달', '최근 90일', '1주', '주식', '스포츠']) expect(all).toContain(label)
    const finance = textOf(
      render(response(boards, 3, { filters: { door: 'finance', category: null, horizon: 'all', period: 'all' } })),
    )
    expect(finance).toContain('주식')
    expect(finance).not.toContain('스포츠')
  })
})
