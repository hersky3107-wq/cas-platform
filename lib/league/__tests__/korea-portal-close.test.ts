import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ supabaseAdmin: { from: vi.fn() } }))

import {
  ensureKrxPortalDay,
  fetchKrxPortalDay,
  getPortalClose,
  mapPortalCloseRows,
  planKrxPortalCloseCalls,
  resetKrxPortalState,
  type KrxPortalIo,
} from '../korea-portal-close'
import type { KrxDailyBar } from '../korea-market-data'

const SAMSUNG: Record<string, unknown> = {
  ISU_SRT_CD: '005930',
  ISU_ABBRV: '삼성전자',
  TDD_CLSPRC: '72,000',
  TDD_OPNPRC: '71,000',
  TDD_HGPRC: '72,500',
  TDD_LWPRC: '70,800',
}

function memoryPortal(opts?: {
  json?: unknown
  failReason?: 'login_failed' | 'auth_expired' | 'http_error' | 'missing_credentials'
  officialPresent?: boolean
}): { io: KrxPortalIo; upserted: KrxDailyBar[]; logs: string[]; posts: number } {
  const table = new Map<string, KrxDailyBar>()
  const upserted: KrxDailyBar[] = []
  const logs: string[] = []
  let posts = 0
  const io: KrxPortalIo = {
    now: () => new Date('2026-10-06T08:25:00.000Z'),
    sleep: async () => undefined,
    log: (_level, message) => {
      logs.push(message)
    },
    session: {
      jsonPost: async () => {
        posts += 1
        if (opts?.failReason) return { ok: false, reason: opts.failReason }
        return { ok: true, value: opts?.json ?? { OutBlock_1: [SAMSUNG] } }
      },
    },
    officialMarketsPresent: async () => ({
      KOSPI: opts?.officialPresent === true,
      KOSDAQ: opts?.officialPresent === true,
    }),
    portalMarketsPresent: async (isoDate) => {
      const present = { KOSPI: false, KOSDAQ: false }
      for (const row of table.values()) {
        if (row.date !== isoDate) continue
        if (row.provisional === true) present[row.market] = true
      }
      return present
    },
    upsertProvisional: async (rows) => {
      for (const row of rows) {
        table.set(`${row.date}|${row.market}|${row.code}`, row)
        upserted.push(row)
      }
    },
    getRow: async (market, code, isoDate) => table.get(`${isoDate}|${market}|${code}`) ?? null,
  }
  return { io, upserted, logs, get posts() { return posts } }
}

describe('KRX portal 전종목 시세', () => {
  it('plans one bulk request per market and maps TDD_CLSPRC as provisional', () => {
    const calls = planKrxPortalCloseCalls('2026-10-06')
    expect(calls).toHaveLength(2)
    expect(calls[0]?.params.mktId).toBe('STK')
    expect(calls[1]?.params.mktId).toBe('KSQ')
    expect(calls[0]?.params.bld).toContain('MDCSTAT01501')
    const mapped = mapPortalCloseRows('KOSPI', '2026-10-06', { OutBlock_1: [SAMSUNG] })
    expect(mapped[0]).toMatchObject({
      code: '005930',
      close: 72000,
      source: 'krx_data_portal',
      provisional: true,
    })
  })

  it('stores provisional closes after a successful portal fetch', async () => {
    resetKrxPortalState()
    const mem = memoryPortal()
    await expect(ensureKrxPortalDay('2026-10-06', mem.io)).resolves.toBe('ok')
    await expect(getPortalClose('KOSPI', '005930', '2026-10-06', mem.io)).resolves.toBe(72000)
    expect(mem.upserted[0]?.provisional).toBe(true)
    expect(mem.posts).toBe(2)
  })

  it('does not fetch the portal when official rows already exist', async () => {
    resetKrxPortalState()
    const mem = memoryPortal({ officialPresent: true })
    await expect(ensureKrxPortalDay('2026-10-06', mem.io)).resolves.toBe('official')
    expect(mem.posts).toBe(0)
  })

  it('logs a login/session failure, retries with backoff, then returns unavailable', async () => {
    resetKrxPortalState()
    const mem = memoryPortal({ failReason: 'login_failed' })
    await expect(fetchKrxPortalDay('2026-10-06', mem.io.session)).resolves.toEqual({
      ok: false,
      reason: 'login_failed',
    })
    await expect(getPortalClose('KOSPI', '005930', '2026-10-06', mem.io)).resolves.toBe('unavailable')
    expect(mem.logs.some((line) => /login failed/i.test(line))).toBe(true)
    expect(mem.posts).toBeGreaterThanOrEqual(3)
  })
})
