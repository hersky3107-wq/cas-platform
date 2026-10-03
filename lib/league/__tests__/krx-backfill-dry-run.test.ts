import { fromZonedTime } from 'date-fns-tz'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ supabaseAdmin: { from: vi.fn() } }))

import {
  parseKrxDailyBackfillArgs,
  runKrxDailyBackfill,
} from '../../../scripts/league/krx-daily-backfill'
import {
  parseKrxFlowsBackfillArgs,
  runKrxFlowsBackfill,
} from '../../../scripts/league/krx-flows-backfill'

function kst(ymd: string, hm: string): Date {
  return fromZonedTime(`${ymd} ${hm}:00`, 'Asia/Seoul')
}

describe('KRX backfill dry-run never touches the network', () => {
  it('default argv is dry-run', () => {
    expect(parseKrxFlowsBackfillArgs([]).apply).toBe(false)
    expect(parseKrxDailyBackfillArgs([]).apply).toBe(false)
  })

  it('flows dry-run prints the plan and never calls fetch or login', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const getSession = vi.fn(() => {
      throw new Error('login must not run in dry-run')
    })
    const ensureDay = vi.fn(async () => {
      throw new Error('ensure must not run in dry-run')
    })
    const lines: string[] = []
    await runKrxFlowsBackfill(['--dry-run'], {
      now: () => kst('2026-10-02', '16:00'),
      log: (message) => lines.push(message),
      getSession,
      ensureDay,
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(getSession).not.toHaveBeenCalled()
    expect(ensureDay).not.toHaveBeenCalled()
    expect(lines[0]).toContain('dry-run')
    expect(lines.some((line) => line.startsWith('2026-10-02  planned_calls=16'))).toBe(true)
    expect(lines.at(-1)).toBe('done  total_planned_requests=320')
    expect(lines.some((line) => /rows=|flows=/.test(line))).toBe(false)
    vi.unstubAllGlobals()
  })

  it('daily dry-run prints the plan and never calls fetch', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const fetchDay = vi.fn(async () => {
      throw new Error('fetchDay must not run in dry-run')
    })
    const ensureDay = vi.fn(async () => {
      throw new Error('ensure must not run in dry-run')
    })
    const sleep = vi.fn(async () => {
      throw new Error('sleep must not run in dry-run')
    })
    const lines: string[] = []
    await runKrxDailyBackfill(['--dry-run'], {
      now: () => kst('2026-10-02', '16:00'),
      log: (message) => lines.push(message),
      fetchDay,
      ensureDay,
      sleep,
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(fetchDay).not.toHaveBeenCalled()
    expect(ensureDay).not.toHaveBeenCalled()
    expect(sleep).not.toHaveBeenCalled()
    expect(lines[0]).toContain('dry-run')
    expect(lines.some((line) => line.startsWith('2026-10-02  planned_calls=2'))).toBe(true)
    expect(lines.at(-1)).toBe('done  total_planned_requests=180')
    expect(lines.some((line) => /rows=/.test(line))).toBe(false)
    vi.unstubAllGlobals()
  })
})
