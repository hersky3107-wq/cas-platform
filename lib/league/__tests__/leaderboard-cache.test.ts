import { describe, expect, it, vi } from 'vitest'
import { lookupRosterEntry } from '@/lib/league/roster'
import {
  LEASE_BOARD,
  LEASE_SIGNATURE,
  liveBoards,
  META_BOARD,
  planRefresh,
  plannedScopes,
  readBoards,
  refreshBoardCache,
  SUMMARY_BOARD,
  type BoardCacheStore,
  type BoardSource,
  type CacheRow,
} from '@/lib/league/boards/cache'
import { computeBoards } from '@/lib/league/boards/compute'
import { BOARD_KEYS, type BoardFilters, type BoardPrediction, type BoardRound } from '@/lib/league/boards/types'

const NOW = Date.parse('2026-10-06T12:00:00Z')

class MemoryStore implements BoardCacheStore {
  rows = new Map<string, CacheRow>()
  reads = 0

  private key(board: string, signature: string) {
    return `${board}\u0000${signature}`
  }

  async acquireLease(refreshId: string, untilIso: string, nowIso: string) {
    const key = this.key(LEASE_BOARD, LEASE_SIGNATURE)
    const held = this.rows.get(key)
    if (held && held.computed_at >= nowIso) return false
    this.rows.set(key, { board: LEASE_BOARD, signature: LEASE_SIGNATURE, payload: {}, refresh_id: refreshId, computed_at: untilIso })
    return true
  }

  async releaseLease(refreshId: string) {
    const key = this.key(LEASE_BOARD, LEASE_SIGNATURE)
    if (this.rows.get(key)?.refresh_id === refreshId) this.rows.delete(key)
  }

  async upsert(rows: CacheRow[]) {
    for (const row of rows) this.rows.set(this.key(row.board, row.signature), structuredClone(row))
  }

  async deleteStale(refreshId: string) {
    let deleted = 0
    for (const [key, row] of this.rows) {
      if (row.board !== LEASE_BOARD && row.refresh_id !== refreshId) {
        this.rows.delete(key)
        deleted += 1
      }
    }
    return deleted
  }

  async readSignature(signature: string) {
    this.reads += 1
    return [...this.rows.values()].filter((row) => row.signature === signature)
  }

  async readMeta() {
    return this.rows.get(this.key(META_BOARD, 'meta')) ?? null
  }

  content() {
    return [...this.rows.values()]
      .filter((row) => row.board !== LEASE_BOARD)
      .map((row) => ({ board: row.board, signature: row.signature, payload: row.payload }))
      .sort((a, b) => `${a.board}|${a.signature}`.localeCompare(`${b.board}|${b.signature}`))
  }
}

function round(id: string, category: string, over: Partial<BoardRound> = {}): BoardRound {
  return {
    id,
    category,
    horizon: '1d',
    label: id,
    resolvesAt: '2026-10-05T06:30:00Z',
    consensusCorrect: true,
    consensusProbability: 70,
    ...over,
  }
}

function pred(roundId: string, modelId: string, correct: boolean): BoardPrediction {
  const roster = lookupRosterEntry(modelId)
  return {
    roundId,
    modelId,
    tier: roster?.league_tier ?? 'extra',
    camp: roster?.camp ?? 'other',
    brand: roster?.brand ?? modelId,
    side: 'up',
    probability: 65,
    correct,
    lens: null,
  }
}

function source(): BoardSource {
  const rounds = [
    round('s1', 'stock'),
    round('s2', 'stock', { horizon: '1w', resolvesAt: '2026-08-01T06:30:00Z' }),
    round('g1', 'gold_metal', { consensusCorrect: false }),
    round('p1', 'sports'),
  ]
  const predictions = rounds.flatMap((r, i) => [pred(r.id, 'gpt-6-astra', i % 2 === 0), pred(r.id, 'divination', true)])
  return { rounds, predictions }
}

const filters = (over: Partial<BoardFilters> = {}): BoardFilters => ({
  door: 'all',
  category: null,
  horizon: 'all',
  period: 'all',
  ...over,
})

describe('cache rebuild', () => {
  it('plans canonical scopes and skips signatures that select nothing', () => {
    expect(plannedScopes(['gold_metal', 'sports', 'stock'])).toEqual([
      'all',
      'cat:gold_metal',
      'cat:stock',
      'finance',
      'world',
    ])
    expect(plannedScopes(['stock'])).toEqual(['all'])
    const plan = planRefresh(source(), NOW)
    const signatures = plan.entries.map((e) => e.signature)
    expect(signatures).toContain('all|h=all|p=all')
    expect(signatures).toContain('cat:stock|h=1w|p=all')
    expect(signatures).not.toContain('cat:stock|h=1w|p=week')
    expect(signatures).not.toContain('world|h=3m|p=all')
    expect(signatures.some((s) => s.startsWith('cat:sports'))).toBe(false)
  })

  it('writes every board plus a summary per signature and one meta row', async () => {
    const store = new MemoryStore()
    const result = await refreshBoardCache(store, async () => source(), { nowMs: NOW, refreshId: 'one' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const all = await store.readSignature('all|h=all|p=all')
    expect(all.map((row) => row.board).sort()).toEqual([...BOARD_KEYS, SUMMARY_BOARD].sort())
    expect(all.find((row) => row.board === SUMMARY_BOARD)!.payload).toEqual({ rounds: 4 })
    expect(result.rows).toBe(result.signatures * (BOARD_KEYS.length + 1) + 1)
    expect((await store.readMeta())!.payload).toMatchObject({ categories: ['gold_metal', 'sports', 'stock'] })
    expect(store.rows.has(`${LEASE_BOARD}\u0000${LEASE_SIGNATURE}`)).toBe(false)
  })

  it('is idempotent: a second rebuild over the same data leaves identical rows and deletes nothing', async () => {
    const store = new MemoryStore()
    await refreshBoardCache(store, async () => source(), { nowMs: NOW, refreshId: 'one' })
    const first = store.content()
    const again = await refreshBoardCache(store, async () => source(), { nowMs: NOW, refreshId: 'two' })
    expect(again).toMatchObject({ ok: true, deleted: 0 })
    expect(store.content()).toEqual(first)
    expect([...store.rows.values()].every((row) => row.refresh_id === 'two')).toBe(true)
  })

  it('drops signatures whose rounds disappeared', async () => {
    const store = new MemoryStore()
    await refreshBoardCache(store, async () => source(), { nowMs: NOW, refreshId: 'one' })
    expect((await store.readSignature('world|h=all|p=all')).length).toBeGreaterThan(0)
    const withoutSports = source()
    withoutSports.rounds = withoutSports.rounds.filter((r) => r.category !== 'sports')
    const result = await refreshBoardCache(store, async () => withoutSports, { nowMs: NOW, refreshId: 'two' })
    expect(result.ok && result.deleted).toBeGreaterThan(0)
    expect(await store.readSignature('world|h=all|p=all')).toEqual([])
  })

  it('refuses to run while another rebuild holds the lease, and reclaims an expired one', async () => {
    const store = new MemoryStore()
    await store.acquireLease('other', new Date(NOW + 60_000).toISOString(), new Date(NOW).toISOString())
    const load = vi.fn(async () => source())
    expect(await refreshBoardCache(store, load, { nowMs: NOW, refreshId: 'mine' })).toEqual({ ok: false, reason: 'busy' })
    expect(load).not.toHaveBeenCalled()
    const later = await refreshBoardCache(store, load, { nowMs: NOW + 120_000, refreshId: 'mine' })
    expect(later.ok).toBe(true)
  })

  it('releases the lease when loading fails', async () => {
    const store = new MemoryStore()
    await expect(
      refreshBoardCache(store, async () => Promise.reject(new Error('db down')), { nowMs: NOW, refreshId: 'x' }),
    ).rejects.toThrow('db down')
    expect((await refreshBoardCache(store, async () => source(), { nowMs: NOW, refreshId: 'y' })).ok).toBe(true)
  })
})

describe('cache read path', () => {
  it('is pending with empty boards before the first rebuild', async () => {
    const response = await readBoards(new MemoryStore(), { filters: filters(), visible: null, nowMs: NOW })
    expect(response.pending).toBe(true)
    expect(response.boards.banner.overall).toMatchObject({ n: 0, pct: null })
  })

  it('serves the stored boards for the request signature without computing', async () => {
    const store = new MemoryStore()
    await refreshBoardCache(store, async () => source(), { nowMs: NOW, refreshId: 'one' })
    const fill = vi.fn()
    const response = await readBoards(store, { filters: filters({ door: 'finance', category: 'stock' }), visible: null, nowMs: NOW, fill })
    expect(response.signature).toBe('cat:stock|h=all|p=all')
    expect(response.meta.rounds).toBe(2)
    const src = source()
    const stock = src.rounds.filter((r) => r.category === 'stock')
    expect(response.boards).toEqual(JSON.parse(JSON.stringify(computeBoards(stock, src.predictions, NOW))))
    expect(fill).not.toHaveBeenCalled()
  })

  it('answers a signature with no rounds with empty boards, not a computation', async () => {
    const store = new MemoryStore()
    await refreshBoardCache(store, async () => source(), { nowMs: NOW, refreshId: 'one' })
    const fill = vi.fn()
    const response = await readBoards(store, { filters: filters({ period: 'week', horizon: '3m' }), visible: null, nowMs: NOW, fill })
    expect(response.pending).toBe(false)
    expect(response.meta.rounds).toBe(0)
    expect(response.boards.models.official).toEqual([])
    expect(fill).not.toHaveBeenCalled()
  })

  it('fills a jurisdiction-narrowed scope once, then reads it from the cache', async () => {
    const store = new MemoryStore()
    await refreshBoardCache(store, async () => source(), { nowMs: NOW, refreshId: 'one' })
    const src = source()
    const fill = vi.fn(async (categories: readonly string[]) => {
      const rounds = src.rounds.filter((r) => categories.includes(r.category))
      return { rounds: rounds.length, boards: computeBoards(rounds, src.predictions, NOW) }
    })
    const visible = ['stock', 'sports']
    const first = await readBoards(store, { filters: filters(), visible, nowMs: NOW, fill })
    expect(first.signature).toBe('set:sports,stock|h=all|p=all')
    expect(first.meta.categories).toEqual(['sports', 'stock'])
    expect(first.meta.rounds).toBe(3)
    const second = await readBoards(store, { filters: filters(), visible, nowMs: NOW, fill })
    expect(fill).toHaveBeenCalledTimes(1)
    expect(second.boards).toEqual(JSON.parse(JSON.stringify(first.boards)))
  })

  it('never shows a hidden category to a viewer', async () => {
    const store = new MemoryStore()
    await refreshBoardCache(store, async () => source(), { nowMs: NOW, refreshId: 'one' })
    const response = await readBoards(store, { filters: filters({ category: 'gold_metal' }), visible: ['stock'], nowMs: NOW })
    expect(response.signature).toBe('none|h=all|p=all')
    expect(response.boards.banner.overall.n).toBe(0)
    expect(response.meta.categories).toEqual(['stock'])
  })

  it('computes the admin live preview from whatever source it is given', () => {
    const response = liveBoards(source(), filters({ door: 'world' }), NOW)
    expect(response.signature).toBe('live|world|h=all|p=all')
    expect(response.meta.rounds).toBe(1)
  })
})
