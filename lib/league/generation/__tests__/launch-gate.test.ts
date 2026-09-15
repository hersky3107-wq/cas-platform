import { describe, expect, it } from 'vitest'
import { getRoster } from '@/lib/league/roster'
import { LEAGUE_JOB_TICK_BUDGET_MS } from '../policy'
import {
  claimNextLaunchableIndex,
  LAUNCH_GATE_FRESH_CHUNK_MS,
  seatCanLaunch,
} from '../launch-gate'

/**
 * Mirrors `generatePredictions`' worker fan-out: shared cursor, N workers,
 * claim is synchronous, run is awaited (here: yield). Used to prove the
 * index-6 deadline skip does not abort later seats in the same chunk.
 */
async function runChunkWorkers(
  roster: { model_id: string; timeoutMs?: number }[],
  opts: {
    concurrency: number
    nowMs: number
    deadlineAtMs?: number
    defaultTimeoutMs: number
    tickBudgetMs?: number
  }
): Promise<string[]> {
  const launched: string[] = []
  const cursor = { nextIndex: 0 }
  const launchedThisChunk = { launched: 0 }
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = claimNextLaunchableIndex(roster, cursor, {
        nowMs: opts.nowMs,
        deadlineAtMs: opts.deadlineAtMs,
        defaultTimeoutMs: opts.defaultTimeoutMs,
        tickBudgetMs: opts.tickBudgetMs,
        launchedThisChunk,
      })
      if (i === null) return
      launched.push(roster[i]!.model_id)
      await Promise.resolve()
    }
  }
  const n = Math.min(opts.concurrency, Math.max(roster.length, 1))
  await Promise.all(Array.from({ length: n }, () => worker()))
  return launched
}

/** Premier-shaped 10-seat roster: index 6 is the 240s DeepSeek seat. */
function premierLikeRoster() {
  const ids = [
    'gpt-5.6-sol',
    'claude-fable-5',
    'gemini-3.1-pro',
    'grok-4.5',
    'muse-spark-1.2',
    'qwen3.8-max',
    'deepseek-v4-pro',
    'kimi-k3',
    'glm-5.2',
    'minimax-m3',
  ]
  return ids.map((model_id, i) => ({
    model_id,
    timeoutMs: i === 6 ? 240_000 : 60_000,
  }))
}

describe('claimNextLaunchableIndex (generatePredictions worker gate)', () => {
  it('when index 6 cannot fit the remaining budget, indices 7–9 still run in the same chunk', async () => {
    const roster = premierLikeRoster()
    const nowMs = 1_000_000
    // 60s seats fit; the 240s DeepSeek seat does not.
    const deadlineAtMs = nowMs + 90_000

    const launched = await runChunkWorkers(roster, {
      concurrency: 6,
      nowMs,
      deadlineAtMs,
      defaultTimeoutMs: 60_000,
    })

    expect(launched).toEqual([
      'gpt-5.6-sol',
      'claude-fable-5',
      'gemini-3.1-pro',
      'grok-4.5',
      'muse-spark-1.2',
      'qwen3.8-max',
      'kimi-k3',
      'glm-5.2',
      'minimax-m3',
    ])
    expect(launched).not.toContain('deepseek-v4-pro')
    expect(launched).toHaveLength(9)
  })

  it('a deferred seat is not dropped: the next chunk still sees it and launches it when it fits', async () => {
    const roster = premierLikeRoster()
    const nowMs = 1_000_000
    const tightDeadline = nowMs + 90_000

    const chunk1 = await runChunkWorkers(roster, {
      concurrency: 6,
      nowMs,
      deadlineAtMs: tightDeadline,
      defaultTimeoutMs: 60_000,
    })
    const written = new Set(chunk1)
    // Resume filter is "has a row" (excludeModelIds). Deferred seats have none.
    const remaining = roster.filter((entry) => !written.has(entry.model_id))
    expect(remaining.map((e) => e.model_id)).toEqual(['deepseek-v4-pro'])

    // Same tight budget: still deferred, still present — not a silent drop.
    const stillTight = await runChunkWorkers(remaining, {
      concurrency: 6,
      nowMs,
      deadlineAtMs: tightDeadline,
      defaultTimeoutMs: 60_000,
    })
    expect(stillTight).toEqual([])
    expect(remaining.map((e) => e.model_id)).toEqual(['deepseek-v4-pro'])

    // Next tick with enough wall clock: the deferred seat launches.
    const launched = await runChunkWorkers(remaining, {
      concurrency: 6,
      nowMs,
      deadlineAtMs: nowMs + 240_000,
      defaultTimeoutMs: 60_000,
    })
    expect(launched).toEqual(['deepseek-v4-pro'])
  })

  it('with no deadline, every seat is claimed in roster order', () => {
    const roster = premierLikeRoster()
    const cursor = { nextIndex: 0 }
    const claimed: number[] = []
    for (;;) {
      const i = claimNextLaunchableIndex(roster, cursor, { nowMs: 0, defaultTimeoutMs: 60_000 })
      if (i === null) break
      claimed.push(i)
    }
    expect(claimed).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('last premier seat with timeout == tick budget launches on a fresh chunk after overhead', async () => {
    const tickBudgetMs = 240_000
    const chunkStart = 1_000_000
    const overheadMs = 2_173
    const nowMs = chunkStart + overheadMs
    const deadlineAtMs = chunkStart + tickBudgetMs
    const roster = [{ model_id: 'deepseek-v4-pro', timeoutMs: tickBudgetMs }]

    expect(nowMs + tickBudgetMs > deadlineAtMs).toBe(true)

    const launched = await runChunkWorkers(roster, {
      concurrency: 6,
      nowMs,
      deadlineAtMs,
      defaultTimeoutMs: 60_000,
      tickBudgetMs,
    })
    expect(launched).toEqual(['deepseek-v4-pro'])
  })

  it('does not solo-launch a long seat mid-chunk (elapsed past the fresh window)', () => {
    const tickBudgetMs = 240_000
    const timeoutMs = 240_000
    const remainingMs = 90_000
    const nowMs = 5_000_000
    const deadlineAtMs = nowMs + remainingMs
    expect(tickBudgetMs - remainingMs).toBeGreaterThan(LAUNCH_GATE_FRESH_CHUNK_MS)
    expect(
      seatCanLaunch(timeoutMs, {
        nowMs,
        deadlineAtMs,
        defaultTimeoutMs: 60_000,
        tickBudgetMs,
        launchedThisChunk: { launched: 0 },
      })
    ).toBe(false)
  })
})

describe('tick budget vs roster timeouts', () => {
  it('tick budget exceeds every roster seat timeout by at least 60s', () => {
    const defaultTimeoutMs = 60_000
    const longest = Math.max(
      ...getRoster().map((entry) => (entry.timeoutMs && entry.timeoutMs > 0 ? entry.timeoutMs : defaultTimeoutMs))
    )
    expect(LEAGUE_JOB_TICK_BUDGET_MS).toBeGreaterThanOrEqual(longest + 60_000)
  })
})
