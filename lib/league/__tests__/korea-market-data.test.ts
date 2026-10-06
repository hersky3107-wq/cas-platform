import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fromZonedTime } from 'date-fns-tz'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { lastNKrxSessionDates } from '../krx-calendar'
import {
  emptyKrxFetchOutcome,
  ensureKrxDay,
  ensureLatestKrxOfficialSession,
  extractKrxRows,
  getKrxCloseSeries,
  getOfficialClose,
  getOfficialClosesBetween,
  mapKrxTradeRow,
  parseKrxNumber,
  type KrxDailyBar,
  type KrxDailyIo,
} from '../korea-market-data'

const STORE_SRC = readFileSync(join(__dirname, '../korea-market-data.ts'), 'utf8')
const SCRIPT_SRC = readFileSync(join(__dirname, '../../../scripts/league/krx-daily-backfill.ts'), 'utf8')
const MIGRATION_SRC = readFileSync(
  join(__dirname, '../../../supabase/migrations/20261003000001_league_krx_daily.sql'),
  'utf8',
)

const SAMSUNG_FIXTURE: Record<string, unknown> = {
  ISU_CD: 'KR7005930003',
  ISU_SRT_CD: '005930',
  ISU_NM: '삼성전자',
  TDD_OPNPRC: '274,000',
  TDD_HGPRC: '276,500',
  TDD_LWPRC: '273,000',
  TDD_CLSPRC: '275,000',
  ACC_TRDVOL: '12,345,678',
  ACC_TRDVAL: '3,400,000,000,000',
  MKTCAP: '160,000,000,000,000',
}

const ECOPRO_FIXTURE: Record<string, unknown> = {
  ISU_CD: 'KR7247540008',
  ISU_SRT_CD: '247540',
  ISU_NM: '에코프로비엠',
  TDD_OPNPRC: '114,700',
  TDD_HGPRC: '116,000',
  TDD_LWPRC: '114,000',
  TDD_CLSPRC: '115,500',
  ACC_TRDVOL: '1,234,567',
  ACC_TRDVAL: '140,000,000,000',
  MKTCAP: '11,000,000,000,000',
}

function bar(
  over: Partial<KrxDailyBar> & Pick<KrxDailyBar, 'date' | 'market' | 'code' | 'close'>,
): KrxDailyBar {
  return {
    name: over.code,
    open: over.close,
    high: over.close,
    low: over.close,
    volume: 1,
    trdval: 1,
    mktcap: 1,
    ...over,
  }
}

function memoryIo(opts?: {
  fetchByDate?: Record<string, KrxDailyBar[]>
  nowIso?: string
}): { io: KrxDailyIo; upserted: KrxDailyBar[]; fetchCalls: string[]; listCalls: string[][]; presentCalls: number } {
  const table = new Map<string, KrxDailyBar>()
  const keyOf = (market: string, code: string, date: string) => `${date}|${market}|${code}`
  const upserted: KrxDailyBar[] = []
  const fetchCalls: string[] = []
  const listCalls: string[][] = []
  let presentCalls = 0
  const io: KrxDailyIo = {
    now: () => fromZonedTime(opts?.nowIso ?? '2026-10-02 16:00:00', 'Asia/Seoul'),
    fetchDay: async (compact) => {
      fetchCalls.push(compact)
      const iso = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
      return opts?.fetchByDate?.[iso] ?? opts?.fetchByDate?.[compact] ?? []
    },
    marketsPresent: async (isoDate) => {
      presentCalls += 1
      const present = { KOSPI: false, KOSDAQ: false }
      for (const row of table.values()) {
        if (row.date !== isoDate) continue
        if (row.provisional === true || row.source === 'krx_data_portal') continue
        present[row.market] = true
      }
      return present
    },
    upsertRows: async (rows) => {
      for (const row of rows) {
        table.set(keyOf(row.market, row.code, row.date), row)
        upserted.push(row)
      }
    },
    getRow: async (market, code, isoDate) => table.get(keyOf(market, code, isoDate)) ?? null,
    listCodeRows: async (market, code, isoDates) => {
      listCalls.push([...isoDates])
      const want = new Set(isoDates)
      return [...table.values()]
        .filter((row) => row.market === market && row.code === code && want.has(row.date))
        .sort((a, b) => a.date.localeCompare(b.date))
    },
  }
  return {
    io,
    upserted,
    fetchCalls,
    listCalls,
    get presentCalls() {
      return presentCalls
    },
  }
}

describe('korea-market-data source contract', () => {
  it('is server-only and does not cache empty non-holiday days', () => {
    expect(STORE_SRC).toContain("import 'server-only'")
    expect(STORE_SRC).toContain('never cached')
    expect(STORE_SRC).toContain('emptyKrxFetchOutcome')
    expect(MIGRATION_SRC).toContain('league_krx_daily')
    expect(MIGRATION_SRC).toContain('enable row level security')
    expect(MIGRATION_SRC).not.toMatch(/create policy/i)
  })

  it('backfill script defaults to dry-run and only writes with --apply', () => {
    expect(SCRIPT_SRC).toContain('--apply')
    expect(SCRIPT_SRC).toContain('dry-run')
    expect(SCRIPT_SRC).toContain('const dryRun = !apply')
  })
})

describe('parseKrxNumber / mapKrxTradeRow', () => {
  it('strips commas and maps official KRX trade fields', () => {
    expect(parseKrxNumber('275,000')).toBe(275000)
    expect(parseKrxNumber('3,400,000,000,000')).toBe(3_400_000_000_000)
    expect(parseKrxNumber('')).toBeNull()
    const mapped = mapKrxTradeRow('KOSPI', SAMSUNG_FIXTURE, '2026-10-02')
    expect(mapped).toEqual({
      date: '2026-10-02',
      market: 'KOSPI',
      code: '005930',
      name: '삼성전자',
      open: 274000,
      high: 276500,
      low: 273000,
      close: 275000,
      volume: 12345678,
      trdval: 3_400_000_000_000,
      mktcap: 160_000_000_000_000,
    })
    expect(mapKrxTradeRow('KOSDAQ', ECOPRO_FIXTURE, '2026-10-02')?.code).toBe('247540')
  })

  it('reads OutBlock_1 fixtures', () => {
    const rows = extractKrxRows({ OutBlock_1: [SAMSUNG_FIXTURE] })
    expect(rows).toHaveLength(1)
    expect(extractKrxRows({ outBlock_1: [ECOPRO_FIXTURE] })).toHaveLength(1)
    expect(extractKrxRows({ output: [SAMSUNG_FIXTURE] })).toHaveLength(1)
    expect(extractKrxRows({})).toEqual([])
  })
})

describe('emptyKrxFetchOutcome', () => {
  it('treats calendar holidays/weekends as holiday and trading days as not_published', () => {
    expect(emptyKrxFetchOutcome('2026-10-05')).toBe('holiday')
    expect(emptyKrxFetchOutcome('2026-10-03')).toBe('holiday')
    expect(emptyKrxFetchOutcome('2026-10-02')).toBe('not_published')
  })
})

describe('ensureKrxDay', () => {
  it('returns holiday without fetching or storing on a KRX holiday', async () => {
    const { io, upserted, fetchCalls } = memoryIo()
    await expect(ensureKrxDay('2026-10-05', io)).resolves.toBe('holiday')
    expect(fetchCalls).toEqual([])
    expect(upserted).toEqual([])
  })

  it('does not cache emptiness on a trading day with 0 API rows', async () => {
    const { io, upserted, fetchCalls } = memoryIo({ fetchByDate: { '2026-10-02': [] } })
    await expect(ensureKrxDay('2026-10-02', io)).resolves.toBe('not_published')
    expect(fetchCalls).toEqual(['20261002'])
    expect(upserted).toEqual([])
    await expect(getOfficialClose('KOSPI', '005930', '2026-10-02', io)).resolves.toBe('not_published')
  })

  it('upserts mapped rows and is a no-op when both markets already exist', async () => {
    const rows = [
      bar({ date: '2026-10-02', market: 'KOSPI', code: '005930', close: 275000 }),
      bar({ date: '2026-10-02', market: 'KOSDAQ', code: '247540', close: 115500 }),
    ]
    const { io, upserted, fetchCalls } = memoryIo({ fetchByDate: { '2026-10-02': rows } })
    await expect(ensureKrxDay('2026-10-02', io)).resolves.toBe('ok')
    expect(upserted).toHaveLength(2)
    await expect(ensureKrxDay('2026-10-02', io)).resolves.toBe('cached')
    expect(fetchCalls).toEqual(['20261002'])
    await expect(getOfficialClose('KOSPI', '005930', '2026-10-02', io)).resolves.toBe(275000)
    await expect(getOfficialClose('KOSPI', '999999', '2026-10-02', io)).resolves.toBe('unknown_code')
  })

  it('shares one in-flight fetch when two callers miss the same session', async () => {
    let started = 0
    let release!: (rows: KrxDailyBar[]) => void
    const gate = new Promise<KrxDailyBar[]>((resolve) => {
      release = resolve
    })
    const mem = memoryIo()
    mem.io.fetchDay = async () => {
      started += 1
      return gate
    }
    const a = ensureKrxDay('2026-10-06', mem.io)
    const b = ensureKrxDay('2026-10-06', mem.io)
    await Promise.resolve()
    expect(started).toBe(1)
    release([
      bar({ date: '2026-10-06', market: 'KOSPI', code: '402340', close: 1200000 }),
      bar({ date: '2026-10-06', market: 'KOSDAQ', code: '247540', close: 1 }),
    ])
    await expect(Promise.all([a, b])).resolves.toEqual(['ok', 'ok'])
    expect(started).toBe(1)
    expect(mem.upserted).toHaveLength(2)
  })

  it('ensureLatestKrxOfficialSession fetches the last completed session when the table is empty', async () => {
    const rows = [
      bar({ date: '2026-10-06', market: 'KOSPI', code: '402340', close: 1200000 }),
      bar({ date: '2026-10-06', market: 'KOSDAQ', code: '247540', close: 1 }),
    ]
    const mem = memoryIo({
      fetchByDate: { '2026-10-06': rows },
      nowIso: '2026-10-06 17:25:00',
    })
    const latest = await ensureLatestKrxOfficialSession(fromZonedTime('2026-10-06 17:25:00', 'Asia/Seoul'), mem.io)
    expect(latest).toEqual({ ok: true, date: '2026-10-06', result: 'ok' })
    expect(mem.fetchCalls).toEqual(['20261006'])
    await expect(getOfficialClose('KOSPI', '402340', '2026-10-06', mem.io)).resolves.toBe(1200000)
  })
})

describe('official grading ignores provisional portal rows', () => {
  it('still fetches the official file and grades against official closes', async () => {
    const mem = memoryIo({
      fetchByDate: {
        '2026-10-06': [
          bar({ date: '2026-10-06', market: 'KOSPI', code: '000660', close: 580000 }),
          bar({ date: '2026-10-06', market: 'KOSDAQ', code: '247540', close: 1 }),
        ],
      },
    })
    await mem.io.upsertRows([
      bar({
        date: '2026-10-06',
        market: 'KOSPI',
        code: '000660',
        close: 579000,
        source: 'krx_data_portal',
        provisional: true,
      }),
      bar({
        date: '2026-10-06',
        market: 'KOSDAQ',
        code: '247540',
        close: 2,
        source: 'krx_data_portal',
        provisional: true,
      }),
    ])
    await expect(getOfficialClose('KOSPI', '000660', '2026-10-06', mem.io)).resolves.toBe(580000)
    const bars = await getOfficialClosesBetween('KOSPI', '000660', '2026-10-06', '2026-10-06', mem.io)
    expect(bars).toEqual([{ sessionDate: '2026-10-06', close: 580000 }])
    expect(mem.fetchCalls).toContain('20261006')
  })
})

describe('getOfficialClosesBetween', () => {
  it('grades with the on-demand fetched close when the expected session is missing', async () => {
    const mem = memoryIo({
      fetchByDate: {
        '2026-10-06': [
          bar({ date: '2026-10-06', market: 'KOSPI', code: '000660', close: 580000 }),
          bar({ date: '2026-10-06', market: 'KOSDAQ', code: '247540', close: 1 }),
        ],
      },
    })
    await mem.io.upsertRows([
      bar({ date: '2026-10-02', market: 'KOSPI', code: '000660', close: 560000 }),
      bar({ date: '2026-10-02', market: 'KOSDAQ', code: '247540', close: 1 }),
    ])
    const bars = await getOfficialClosesBetween('KOSPI', '000660', '2026-10-02', '2026-10-06', mem.io)
    expect(mem.fetchCalls).toEqual(['20261006'])
    expect(bars).toEqual([
      { sessionDate: '2026-10-02', close: 560000 },
      { sessionDate: '2026-10-06', close: 580000 },
    ])
  })
})

describe('getKrxCloseSeries', () => {
  it('returns oldest→newest bars and reports skipped not_published days', async () => {
    const fetchByDate: Record<string, KrxDailyBar[]> = {
      '2026-09-30': [bar({ date: '2026-09-30', market: 'KOSPI', code: '005930', close: 100 })],
      '2026-10-01': [],
      '2026-10-02': [bar({ date: '2026-10-02', market: 'KOSPI', code: '005930', close: 110 })],
    }
    // Seed KOSDAQ on published days so both-markets cache does not refetch.
    for (const date of ['2026-09-30', '2026-10-02']) {
      fetchByDate[date].push(bar({ date, market: 'KOSDAQ', code: '247540', close: 1 }))
    }
    const { io } = memoryIo({
      fetchByDate,
      nowIso: '2026-10-02 16:00:00',
    })
    const result = await getKrxCloseSeries('KOSPI', '005930', 3, io)
    expect(result.unverified).toBe(false)
    expect(result.notPublished).toEqual(['2026-10-01'])
    expect(result.series.map((b) => [b.date, b.close])).toEqual([
      ['2026-09-30', 100],
      ['2026-10-02', 110],
    ])
  })

  it('uses one list when every session is cached and fetches only missing dates', async () => {
    const mem = memoryIo({ nowIso: '2026-10-02 16:00:00' })
    const dates = lastNKrxSessionDates('2026-10-02', 3)
    for (const date of dates) {
      if (date === '2026-10-01') continue
      await mem.io.upsertRows([
        bar({ date, market: 'KOSPI', code: '005930', close: 100 }),
        bar({ date, market: 'KOSDAQ', code: '247540', close: 1 }),
      ])
    }
    const beforePresent = mem.presentCalls
    const result = await getKrxCloseSeries('KOSPI', '005930', 3, mem.io)
    expect(mem.listCalls).toHaveLength(1)
    expect(mem.listCalls[0]).toEqual(dates)
    expect(mem.fetchCalls).toEqual(['20261001'])
    expect(mem.presentCalls - beforePresent).toBe(1)
    expect(result.notPublished).toEqual(['2026-10-01'])
    expect(result.series.map((b) => b.date)).toEqual(dates.filter((date) => date !== '2026-10-01'))
  })

  it('does not call ensureKrxDay when the batched rows already cover every session', async () => {
    const mem = memoryIo({ nowIso: '2026-10-02 16:00:00' })
    const dates = lastNKrxSessionDates('2026-10-02', 3)
    for (const date of dates) {
      await mem.io.upsertRows([bar({ date, market: 'KOSPI', code: '005930', close: 50 })])
    }
    const beforePresent = mem.presentCalls
    const result = await getKrxCloseSeries('KOSPI', '005930', 3, mem.io)
    expect(mem.listCalls).toHaveLength(1)
    expect(mem.fetchCalls).toEqual([])
    expect(mem.presentCalls - beforePresent).toBe(0)
    expect(result.series).toHaveLength(3)
    expect(result.notPublished).toEqual([])
  })
})
