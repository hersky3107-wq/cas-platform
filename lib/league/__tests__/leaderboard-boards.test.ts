import { describe, expect, it } from 'vitest'
import { MIN_GRADED_ROUNDS_FOR_WIN_RATE } from '@/lib/league/credits'
import { lookupRosterEntry } from '@/lib/league/roster'
import {
  boardRate,
  computeBoards,
  confidenceBucket,
  majorityShareBucket,
  rankRows,
} from '@/lib/league/boards/compute'
import {
  boardSignature,
  categoriesOfScopeKey,
  kstMonth,
  parseBoardFilters,
  periodStartMs,
  scopeCategories,
  scopeKey,
  selectRounds,
} from '@/lib/league/boards/filters'
import { companyOf, familyOf } from '@/lib/league/boards/model-meta'
import { isBoardRound, toBoardPrediction, toBoardRound, type RoundDbRow } from '@/lib/league/boards/rows'
import type { BoardPrediction, BoardRound, BoardRow } from '@/lib/league/boards/types'

const MIN = MIN_GRADED_ROUNDS_FOR_WIN_RATE
const NOW = Date.parse('2026-10-06T12:00:00Z')

function round(id: string, over: Partial<BoardRound> = {}): BoardRound {
  return {
    id,
    category: 'stock',
    horizon: '1d',
    label: id,
    resolvesAt: '2026-10-01T06:30:00Z',
    consensusCorrect: true,
    consensusProbability: 65,
    ...over,
  }
}

function pred(roundId: string, modelId: string, correct: boolean, over: Partial<BoardPrediction> = {}): BoardPrediction {
  const roster = lookupRosterEntry(modelId)
  const extra = !roster
  return {
    roundId,
    modelId,
    tier: roster?.league_tier ?? (extra ? 'extra' : 'world'),
    camp: roster?.camp ?? 'other',
    brand: roster?.brand ?? modelId,
    side: 'up',
    probability: 60,
    correct,
    lens: null,
    ...over,
  }
}

function rounds(n: number, over: (i: number) => Partial<BoardRound> = () => ({})): BoardRound[] {
  return Array.from({ length: n }, (_, i) => round(`r${String(i).padStart(2, '0')}`, over(i)))
}

describe('board rate and rank gates', () => {
  it('has no percentage below the minimum sample, and truncates at it', () => {
    expect(boardRate(3, MIN - 1).pct).toBeNull()
    expect(boardRate(MIN - 1, MIN - 1).pct).toBeNull()
    expect(boardRate(2, 3, 3).pct).toBeNull()
    expect(boardRate(8, 12).pct).toBe(66.6)
    expect(boardRate(0, 0, 0)).toEqual({ correct: 0, n: 0, rounds: 0, pct: null })
  })

  it('gates pooled rates on distinct rounds, not calls', () => {
    const rate = boardRate(20, 20, 1)
    expect(rate.n).toBe(20)
    expect(rate.pct).toBeNull()
  })

  it('ranks only gated rows, ties share a rank, the rest follow unranked', () => {
    const rows: BoardRow[] = [
      { key: 'low', rate: boardRate(1, 2), rank: null },
      { key: 'b', rate: boardRate(6, 10), rank: null },
      { key: 'a', rate: boardRate(8, 10), rank: null },
      { key: 'c', rate: boardRate(12, 20), rank: null },
    ]
    const ranked = rankRows(rows, () => 0)
    expect(ranked.map((r) => [r.key, r.rank])).toEqual([
      ['a', 1],
      ['c', 2],
      ['b', 2],
      ['low', null],
    ])
  })
})

describe('public scope exclusions', () => {
  const base: RoundDbRow = {
    id: 'r1',
    category: 'stock',
    horizon: '1w',
    instrument: 'AAPL',
    subject_label: 'Apple',
    resolves_at: '2026-10-01T20:00:00Z',
    actual_outcome: 'up',
    grading_status: 'graded',
    is_test: false,
    consensus_is_correct: true,
    consensus_aggregate_probability: '71.5',
  }

  it('drops test, voided, ungraded and legacy same-day rounds', () => {
    expect(isBoardRound(base)).toBe(true)
    expect(isBoardRound({ ...base, is_test: true })).toBe(false)
    expect(isBoardRound({ ...base, is_test: null })).toBe(false)
    expect(isBoardRound({ ...base, grading_status: 'voided' })).toBe(false)
    expect(isBoardRound({ ...base, actual_outcome: null })).toBe(false)
    expect(
      isBoardRound({
        ...base,
        category: 'fx',
        instrument: 'EUR/USD',
        horizon: '1d',
        anchor_session_date: '2026-10-01',
        resolution_session_date: '2026-10-01',
      }),
    ).toBe(false)
  })

  it('admits test rounds only for the admin preview', () => {
    expect(isBoardRound({ ...base, is_test: true }, { includeTest: true })).toBe(true)
    expect(isBoardRound({ ...base, is_test: true, grading_status: 'voided' }, { includeTest: true })).toBe(false)
  })

  it('maps rows and refuses ungraded predictions', () => {
    expect(toBoardRound(base)).toMatchObject({ label: 'Apple', consensusProbability: 71.5, consensusCorrect: true })
    expect(
      toBoardPrediction({
        round_id: 'r1',
        model_id: 'phi-4',
        league_tier: 'world',
        camp: 'us',
        brand: 'Microsoft',
        predicted_direction: null,
        predicted_value: null,
        is_correct: null,
      }),
    ).toBeNull()
  })

  it('ignores predictions whose round is outside the selected set', () => {
    const set = rounds(MIN)
    const preds = [...set.map((r) => pred(r.id, 'phi-4', true)), pred('voided-round', 'phi-4', false)]
    const boards = computeBoards(set, preds, NOW)
    const phi = boards.models.official.find((row) => row.modelId === 'phi-4')!
    expect(phi.rate).toMatchObject({ correct: MIN, n: MIN, pct: 100 })
  })
})

describe('filters and signatures', () => {
  const withData = ['stock', 'gold_metal', 'sports', 'tech']

  it('names canonical scopes and collapses equivalent requests', () => {
    expect(scopeKey(['stock', 'gold_metal', 'sports', 'tech', 'fx'], withData)).toBe('all')
    expect(scopeKey(['stock', 'gold_metal', 'fx'], withData)).toBe('finance')
    expect(scopeKey(['sports', 'tech', 'ai_models'], withData)).toBe('world')
    expect(scopeKey(['stock'], withData)).toBe('cat:stock')
    expect(scopeKey(['stock', 'sports'], withData)).toBe('set:sports,stock')
    expect(scopeKey(['fx'], withData)).toBe('none')
    expect(scopeKey(['stock', 'gold_metal'], ['stock', 'gold_metal'])).toBe('all')
    expect(categoriesOfScopeKey('finance', withData)).toEqual(['stock', 'gold_metal'])
    expect(categoriesOfScopeKey('set:sports,stock', withData)).toEqual(['sports', 'stock'])
    expect(boardSignature('cat:stock', '1w', 'month')).toBe('cat:stock|h=1w|p=month')
  })

  it('parses filters, lets a category imply its door, drops a cross-door category', () => {
    const params = (q: string) => {
      const sp = new URLSearchParams(q)
      return (name: string) => sp.get(name)
    }
    expect(parseBoardFilters(params(''), 'finance')).toEqual({ door: 'finance', category: null, horizon: 'all', period: 'all' })
    expect(parseBoardFilters(params('door=all&cat=sports&h=1w&p=week'))).toEqual({
      door: 'all',
      category: 'sports',
      horizon: '1w',
      period: 'week',
    })
    expect(parseBoardFilters(params('door=finance&cat=sports')).category).toBeNull()
    expect(parseBoardFilters(params('h=5y&p=forever&cat=DROP%20TABLE'))).toEqual({
      door: 'all',
      category: null,
      horizon: 'all',
      period: 'all',
    })
  })

  it('narrows every scope to the viewer jurisdiction', () => {
    const universe = ['stock', 'fx', 'sports', 'politics_election']
    const filters = { door: 'all' as const, category: null, horizon: 'all' as const, period: 'all' as const }
    expect(scopeCategories(filters, universe, null)).toEqual(universe)
    expect(scopeCategories(filters, universe, ['stock', 'sports'])).toEqual(['stock', 'sports'])
    expect(scopeCategories({ ...filters, door: 'world' }, universe, ['stock'])).toEqual([])
    expect(scopeCategories({ ...filters, category: 'fx' }, universe, ['stock'])).toEqual([])
  })

  it('uses KST calendar windows', () => {
    expect(new Date(periodStartMs('week', NOW)!).toISOString()).toBe('2026-10-04T15:00:00.000Z')
    expect(new Date(periodStartMs('month', NOW)!).toISOString()).toBe('2026-09-30T15:00:00.000Z')
    expect(new Date(periodStartMs('90d', NOW)!).toISOString()).toBe('2026-07-08T15:00:00.000Z')
    expect(periodStartMs('all', NOW)).toBeNull()
    expect(kstMonth('2026-09-30T16:00:00Z')).toBe('2026-10')
  })

  it('selects rounds by category, horizon and period', () => {
    const set = [
      round('a', { category: 'stock', horizon: '1d', resolvesAt: '2026-10-05T06:30:00Z' }),
      round('b', { category: 'stock', horizon: '1w', resolvesAt: '2026-10-05T06:30:00Z' }),
      round('c', { category: 'sports', horizon: '1d', resolvesAt: '2026-10-05T06:30:00Z' }),
      round('d', { category: 'stock', horizon: '1d', resolvesAt: '2026-09-20T06:30:00Z' }),
    ]
    const pickIds = (opts: Parameters<typeof selectRounds>[1]) => selectRounds(set, opts).map((r) => r.id)
    expect(pickIds({ categories: ['stock'], horizon: 'all', period: 'all', nowMs: NOW })).toEqual(['a', 'b', 'd'])
    expect(pickIds({ categories: ['stock'], horizon: '1d', period: 'all', nowMs: NOW })).toEqual(['a', 'd'])
    expect(pickIds({ categories: ['stock', 'sports'], horizon: '1d', period: 'week', nowMs: NOW })).toEqual(['a', 'c'])
  })
})

describe('banner and agreement', () => {
  it('shows AI 종합 with its round count and gates the breakdown', () => {
    const set = [
      ...rounds(MIN, (i) => ({ consensusCorrect: i < 7 })),
      round('s1', { category: 'sports', consensusCorrect: true }),
      round('nopick', { consensusCorrect: null }),
    ]
    const { banner } = computeBoards(set, [], NOW)
    expect(banner.overall).toMatchObject({ correct: 8, n: MIN + 1, pct: 72.7 })
    expect(banner.coinFlipPct).toBe(50)
    expect(banner.byCategory.map((r) => [r.key, r.rate.n, r.rate.pct])).toEqual([
      ['stock', MIN, 70],
      ['sports', 1, null],
    ])
    expect(banner.byHorizon[0]).toMatchObject({ key: '1d' })
  })

  it('buckets AI 종합 by majority share and weighted confidence', () => {
    expect(majorityShareBucket(0.9)).toBe('85+')
    expect(majorityShareBucket(0.85)).toBe('85+')
    expect(majorityShareBucket(0.849)).toBe('70-84')
    expect(majorityShareBucket(0.7)).toBe('70-84')
    expect(majorityShareBucket(0.6)).toBe('<70')
    expect(confidenceBucket(80)).toBe('80+')
    expect(confidenceBucket(79.9)).toBe('70-79')
    expect(confidenceBucket(60)).toBe('60-69')
    expect(confidenceBucket(51)).toBe('<60')

    const set = [round('x', { consensusProbability: 82 }), round('y', { consensusProbability: 55, consensusCorrect: false })]
    const preds = [
      ...['gpt-6-astra', 'claude-fable-5', 'grok-4.7', 'phi-4'].map((m) => pred('x', m, true)),
      pred('y', 'gpt-6-astra', true),
      pred('y', 'phi-4', false, { side: 'down' }),
    ]
    const { agreement } = computeBoards(set, preds, NOW)
    expect(agreement.byMajorityShare.map((r) => [r.key, r.rate.n, r.rate.correct])).toEqual([
      ['85+', 1, 1],
      ['70-84', 0, 0],
      ['<70', 1, 0],
    ])
    expect(agreement.byConfidence.map((r) => [r.key, r.rate.n])).toEqual([
      ['80+', 1],
      ['70-79', 0],
      ['60-69', 0],
      ['<60', 1],
    ])
  })
})

describe('models, categories, groups', () => {
  it('ranks official and scout seats, keeps extras apart', () => {
    const set = rounds(MIN)
    const preds = set.flatMap((r, i) => [
      pred(r.id, 'gpt-6-astra', i < 8),
      pred(r.id, 'gpt-5-search-api', i < 6),
      pred(r.id, 'divination', i < 9),
    ])
    preds.push(pred('r00', 'phi-4', true))
    const { models } = computeBoards(set, preds, NOW)
    expect(models.official.map((r) => [r.modelId, r.rank, r.rate.pct])).toEqual([
      ['gpt-6-astra', 1, 80],
      ['gpt-5-search-api', 2, 60],
      ['phi-4', null, null],
    ])
    expect(models.official[0]).toMatchObject({ company: 'OpenAI', tier: 'premier', camp: 'us' })
    expect(models.extras.map((r) => [r.modelId, r.rank])).toEqual([['divination', 1]])
  })

  it('takes disjoint top 5 and bottom 5 per category and keeps the full list', () => {
    const ids = [
      'gpt-6-astra',
      'claude-fable-5',
      'gemini-3.1-pro',
      'grok-4.7',
      'muse-spark-1.2',
      'qwen3.8-max',
      'deepseek-v4-pro',
      'kimi-k3',
      'glm-5.3',
      'minimax-m3',
      'phi-4',
      'inkling',
    ]
    const set = rounds(MIN)
    const preds = set.flatMap((r, i) => ids.map((m, k) => pred(r.id, m, i < MIN - Math.floor(k / 2))))
    preds.push(pred('r00', 'seed-1.6', true))
    const [stock] = computeBoards(set, preds, NOW).categories.categories
    expect(stock!.key).toBe('stock')
    expect(stock!.ranked).toBe(12)
    expect(stock!.top).toHaveLength(5)
    expect(stock!.bottom).toHaveLength(5)
    const overlap = stock!.top.filter((row) => stock!.bottom.some((b) => b.modelId === row.modelId))
    expect(overlap).toEqual([])
    expect(stock!.all).toHaveLength(13)
    expect(stock!.all.at(-1)).toMatchObject({ modelId: 'seed-1.6', rank: null })
  })

  it('pools camp, tier, book and weights; tiers include extras', () => {
    const set = rounds(MIN)
    const preds = set.flatMap((r) => [
      pred(r.id, 'gpt-6-astra', true),
      pred(r.id, 'qwen3.8-max', false),
      pred(r.id, 'mistral-medium-3.5', true),
      pred(r.id, 'sonar-reasoning-pro', true),
      pred(r.id, 'history', false),
    ])
    const { groups } = computeBoards(set, preds, NOW)
    expect(groups.camp.map((r) => [r.key, r.rate.pct])).toEqual([
      ['us', 100],
      ['china', 0],
      ['other', 100],
    ])
    expect(groups.tier.map((r) => r.key)).toEqual(['premier', 'challenger', 'world', 'scout', 'extra'])
    expect(groups.tier.find((r) => r.key === 'extra')!.rate).toMatchObject({ n: MIN, correct: 0 })
    expect(groups.book.map((r) => [r.key, r.rate.n])).toEqual([
      ['reasoning', MIN * 3],
      ['search', MIN],
    ])
    expect(groups.weights.map((r) => [r.key, r.rate.n])).toEqual([
      ['closed', MIN * 2],
      ['open', MIN * 2],
    ])
  })
})

describe('companies, siblings, lenses', () => {
  it('groups brands into companies', () => {
    expect(companyOf('muse-spark-1.2')).toBe('Meta')
    expect(companyOf('llama-4-maverick')).toBe('Meta')
    expect(companyOf('qwen3.5-flash')).toBe('Alibaba')
    expect(companyOf('gpt-5.6-sol')).toBe('OpenAI')
    expect(familyOf('deepseek-flash')).toBe(familyOf('deepseek-v4-flash'))
  })

  it('totals companies and builds sibling battles without scouts', () => {
    const set = rounds(MIN)
    const preds = set.flatMap((r, i) => [
      pred(r.id, 'claude-fable-5', i < 9),
      pred(r.id, 'claude-sonnet-5', i < 5),
      pred(r.id, 'claude-haiku-4.5', i < 7),
      pred(r.id, 'claude-sonnet-5-websearch', true),
      pred(r.id, 'deepseek-flash', true),
      pred(r.id, 'deepseek-v4-flash', false),
    ])
    const { companies } = computeBoards(set, preds, NOW)
    const anthropic = companies.companies.find((row) => row.key === 'Anthropic')!
    expect(anthropic.rate).toMatchObject({ n: MIN * 4, rounds: MIN, correct: 9 + 5 + 7 + MIN })
    expect(anthropic.models).toBe(4)
    const battle = companies.siblings.find((s) => s.company === 'Anthropic')!
    expect(battle.members.map((m) => [m.key, m.rank, m.rate.n])).toEqual([
      ['Claude Fable', 1, MIN],
      ['Claude Haiku', 2, MIN],
      ['Claude Sonnet', 3, MIN],
    ])
    const deepseek = companies.siblings.find((s) => s.company === 'DeepSeek')!
    const flash = deepseek.members.find((m) => m.key === 'DeepSeek V4 Flash')!
    expect(flash.rate).toMatchObject({ n: MIN * 2, rounds: MIN, pct: 50 })
    expect(flash.modelIds).toEqual(['deepseek-flash', 'deepseek-v4-flash'])
    expect(deepseek.members.find((m) => m.key === 'DeepSeek V4 Pro')!.rate.n).toBe(0)
    expect(companies.siblings.some((s) => s.company === 'Perplexity')).toBe(false)
  })

  it('rates lenses on distinct rounds and counts calls without one', () => {
    const set = rounds(MIN)
    const preds = set.flatMap((r, i) => [
      pred(r.id, 'gpt-6-astra', i < 7, { lens: 'trend_momentum' }),
      pred(r.id, 'phi-4', true, { lens: 'trend_momentum' }),
      pred(r.id, 'kimi-k3', true, { lens: i < 3 ? 'risk_review' : null }),
    ])
    const { lenses } = computeBoards(set, preds, NOW)
    expect(lenses.rows.map((r) => [r.key, r.rank, r.rate.n, r.rate.rounds, r.rate.pct])).toEqual([
      ['trend_momentum', 1, MIN * 2, MIN, 85],
      ['risk_review', null, 3, 3, null],
    ])
    expect(lenses.withoutLens).toBe(MIN - 3)
  })
})

describe('extras league', () => {
  it('compares each seat to AI 종합 only on rounds where it answered', () => {
    const set = [
      ...rounds(MIN, (i) => ({ consensusCorrect: i < 6 })),
      round('nopick', { consensusCorrect: null }),
      round('noextra', { consensusCorrect: true }),
    ]
    const preds = [
      ...set.filter((r) => r.id !== 'noextra').map((r, i) => pred(r.id, 'divination', i % 2 === 0)),
      ...set.map((r) => pred(r.id, 'gpt-6-astra', true)),
    ]
    const { extras } = computeBoards(set, preds, NOW)
    const div = extras.seats.find((s) => s.key === 'divination')!
    expect(div.own.n).toBe(MIN + 1)
    expect(div.rounds).toBe(MIN)
    expect(div.extra).toMatchObject({ n: MIN, correct: 5, pct: 50 })
    expect(div.ai).toMatchObject({ n: MIN, correct: 6, pct: 60 })
    expect(extras.seats.map((s) => s.key)).not.toContain('crow')
    expect(extras.seats.find((s) => s.key === 'consensus')!.rounds).toBe(0)
    expect(extras.pooled.extras.n).toBe(MIN + 1)
    expect(extras.pooled.ai40.n).toBe(MIN + 1)
  })

  it('counts crow calls against the 40-seat majority that were right', () => {
    const set = [round('a'), round('b'), round('c')]
    const majority = (id: string, side: string) =>
      ['gpt-6-astra', 'claude-fable-5', 'grok-4.7'].map((m) => pred(id, m, side === 'up', { side }))
    const preds = [
      ...majority('a', 'up'),
      ...majority('b', 'up'),
      ...majority('c', 'up'),
      pred('a', 'crow', false, { side: 'down' }),
      pred('b', 'crow', true, { side: 'up' }),
      pred('c', 'crow', true, { side: 'down' }),
    ]
    expect(computeBoards(set, preds, NOW).extras.crow).toEqual({ answered: 3, contrarian: 2, contrarianRight: 1 })
  })

  it('draws the replay learning curve by KST month', () => {
    const set = [
      round('a', { resolvesAt: '2026-09-02T00:00:00Z' }),
      round('b', { resolvesAt: '2026-09-30T16:00:00Z' }),
      round('c', { resolvesAt: '2026-10-03T00:00:00Z' }),
    ]
    const preds = [pred('a', 'replay', true), pred('b', 'replay', false), pred('c', 'replay', true)]
    const curve = computeBoards(set, preds, NOW).extras.replayCurve
    expect(curve.map((p) => [p.month, p.rate.n, p.rate.pct])).toEqual([
      ['2026-09', 1, null],
      ['2026-10', 2, null],
    ])
  })
})

describe('hall of fame', () => {
  it('finds current and all-time streaks in time order', () => {
    const set = rounds(6, (i) => ({ resolvesAt: `2026-10-0${i + 1}T00:00:00Z` }))
    const results = [true, true, true, false, true, true]
    const preds = set.map((r, i) => pred(r.id, 'kimi-k3', results[i]!))
    preds.push(...set.map((r) => pred(r.id, 'phi-4', false)))
    const { fame } = computeBoards(set, preds, NOW)
    expect(fame.currentStreaks).toEqual([{ modelId: 'kimi-k3', length: 2 }])
    expect(fame.longestStreaks).toEqual([{ modelId: 'kimi-k3', length: 3 }])
  })

  it('counts lone wolves: right while on a side of three seats or fewer, in the minority', () => {
    const crowd = ['gpt-6-astra', 'claude-fable-5', 'grok-4.7', 'gemini-3.1-pro', 'muse-spark-1.2']
    const set = [round('a', { label: 'Apple' }), round('b')]
    const preds = [
      ...crowd.map((m) => pred('a', m, false, { side: 'up' })),
      pred('a', 'phi-4', true, { side: 'down' }),
      pred('a', 'inkling', true, { side: 'down' }),
      pred('b', 'phi-4', true, { side: 'down' }),
      pred('b', 'inkling', false, { side: 'up' }),
    ]
    const { fame } = computeBoards(set, preds, NOW)
    expect(fame.loneWolves.map((w) => [w.modelId, w.count])).toEqual([
      ['phi-4', 1],
      ['inkling', 1],
    ])
    expect(fame.loneWolves[0]!.rounds[0]).toMatchObject({ id: 'a', label: 'Apple' })
  })

  it('ranks bluff (wrong at >=75%) and humble (right at <=60%) only past the sample gate', () => {
    const set = rounds(MIN + 2)
    const preds = set.flatMap((r, i) => [
      pred(r.id, 'grok-4.7', i < 4, { probability: 80 }),
      pred(r.id, 'phi-4', i < 2, { probability: 90 }),
      pred(r.id, 'kimi-k3', i < 9, { probability: 55 }),
    ])
    preds.push(pred('r00', 'inkling', false, { probability: 99 }))
    const { fame } = computeBoards(set, preds, NOW)
    expect(fame.bluff.map((row) => [row.modelId, row.rank, row.hits, row.band.n])).toEqual([
      ['phi-4', 1, MIN, MIN + 2],
      ['grok-4.7', 2, MIN - 2, MIN + 2],
      ['inkling', null, 1, 1],
    ])
    expect(fame.bluff.at(-1)!.band.pct).toBeNull()
    expect(fame.humble.map((row) => [row.modelId, row.rank, row.hits])).toEqual([['kimi-k3', 1, 9]])
  })
})

describe('highlights and determinism', () => {
  it('builds the four daily cards and rotates the sibling battle by KST day', () => {
    const cards = computeBoards([], [], NOW).highlights
    expect(cards.map((c) => c.id)).toEqual(['camp', 'divination', 'siblings', 'method'])
    const tomorrow = computeBoards([], [], NOW + 24 * 3600 * 1000).highlights[2]!
    expect(tomorrow.company).not.toBe(cards[2]!.company)
  })

  it('is deterministic for the same input', () => {
    const set = rounds(MIN)
    const preds = set.flatMap((r, i) => [pred(r.id, 'gpt-6-astra', i % 3 !== 0), pred(r.id, 'divination', i % 2 === 0)])
    expect(computeBoards(set, preds, NOW)).toEqual(computeBoards([...set].reverse(), [...preds].reverse(), NOW))
  })
})
