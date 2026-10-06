/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Leaderboard } from '../../../components/league/Leaderboard'
import { computeBoards, emptyBoards } from '@/lib/league/boards/compute'
import { parseBoardFilters } from '@/lib/league/boards/filters'
import type { BoardFilters, BoardPrediction, BoardRound, BoardsResponse } from '@/lib/league/boards/types'
import { lookupRosterEntry } from '@/lib/league/roster'

const NOW = Date.parse('2026-10-06T12:00:00Z')

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function populated(): BoardsResponse['boards'] {
  const rounds: BoardRound[] = Array.from({ length: 12 }, (_, i) => ({
    id: `r${i}`,
    category: 'stock',
    horizon: '1d',
    label: `Round ${i}`,
    resolvesAt: `2026-10-0${1 + (i % 5)}T06:30:00Z`,
    consensusCorrect: i % 3 !== 0,
    consensusProbability: 70,
  }))
  const preds: BoardPrediction[] = rounds.map((r, i) => {
    const roster = lookupRosterEntry('gpt-6-astra')!
    return {
      roundId: r.id,
      modelId: 'gpt-6-astra',
      tier: roster.league_tier,
      camp: roster.camp,
      brand: roster.brand,
      side: 'up',
      probability: 70,
      correct: i % 4 !== 0,
      lens: null,
    }
  })
  return computeBoards(rounds, preds, NOW)
}

function response(filters: BoardFilters, boards = emptyBoards(NOW), rounds = 3): BoardsResponse {
  return {
    kind: 'boards',
    signature: 'test',
    filters,
    pending: false,
    meta: { generatedAt: '2026-10-06T03:00:00Z', categories: ['stock', 'sports'], minSample: 10, rounds },
    boards,
  }
}

const ALL: BoardFilters = { door: 'all', category: null, horizon: 'all', period: 'all' }

describe('Leaderboard filters and tabs', () => {
  let root: Root | null = null

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    root = null
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  async function mount(initial: BoardsResponse, query?: string) {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/league/context')) {
          return json({ profileLocale: 'ko', acceptLanguage: null, ipCountry: 'US', declaredCountry: null, isAdmin: false })
        }
        if (url.includes('/api/league/leaderboard')) {
          urls.push(url)
          const params = new URL(url, 'http://localhost').searchParams
          return json(response(parseBoardFilters((name) => params.get(name)), populated(), 12))
        }
        return json({})
      }),
    )
    const host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(createElement(Leaderboard, { initial, query }))
    })
    await settle(() => host.textContent?.includes('이번 주') ?? false)
    return { host, urls }
  }

  async function settle(done: () => boolean) {
    for (let i = 0; i < 10 && !done(); i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }
  }

  function button(host: HTMLElement, text: string): HTMLButtonElement {
    const found = [...host.querySelectorAll('button')].find((el) => el.textContent?.trim() === text)
    if (!found) throw new Error(`no button "${text}"`)
    return found as HTMLButtonElement
  }

  async function click(el: HTMLElement) {
    await act(async () => {
      el.click()
    })
  }

  it('refetches with the chosen period and swaps in the new boards', async () => {
    const { host, urls } = await mount(response(ALL))
    expect(host.textContent).toContain('AI 종합 적중률 기록 없음')
    await click(button(host, '이번 주'))
    await settle(() => host.textContent?.includes('66.6% (12판)') ?? false)
    expect(urls.at(-1)).toBe('/api/league/leaderboard?door=all&p=week')
    expect(host.textContent).toContain('AI 종합 적중률 66.6% (12판)')
    expect(button(host, '이번 주').getAttribute('aria-pressed')).toBe('true')
  })

  it('drops a category from another door when the door changes', async () => {
    const { host, urls } = await mount(response({ ...ALL, category: 'sports' }))
    await click(button(host, '금융'))
    await settle(() => urls.length > 0)
    expect(urls.at(-1)).toBe('/api/league/leaderboard?door=finance')
  })

  it('passes the admin preview query through', async () => {
    const { host, urls } = await mount(response(ALL), 'test=1')
    await click(button(host, '1주'))
    await settle(() => urls.length > 0)
    expect(urls.at(-1)).toBe('/api/league/leaderboard?door=all&h=1w&test=1')
  })

  it('switches tabs without refetching', async () => {
    const { host, urls } = await mount(response(ALL, populated(), 12))
    await click(button(host, '모델 순위'))
    expect(host.textContent).toContain('40 AI 순위')
    await click(button(host, '명예의 전당'))
    expect(host.textContent).toContain('허풍 순위')
    expect(urls).toHaveLength(0)
  })
})
