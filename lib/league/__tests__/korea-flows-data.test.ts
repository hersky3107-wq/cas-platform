import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ supabaseAdmin: { from: vi.fn() } }))

import {
  ensureKrxFlowsDay,
  extractFlowRows,
  KRX_BLD,
  KRX_FLOW_INVESTORS,
  mapForeignOwnRow,
  mapNetPurchaseRow,
  mapShortBalanceRow,
  mapShortVolumeRow,
  parseKrxSignedNumber,
  planKrxFlowsCalls,
  t2BalanceDate,
  type KrxFlowRow,
  type KrxFlowsIo,
  type KrxForeignOwnRow,
  type KrxShortRow,
} from '../korea-flows-data'
import { isKrxTradingDay } from '../krx-calendar'

const STORE_SRC = readFileSync(join(__dirname, '../korea-flows-data.ts'), 'utf8')
const SESSION_SRC = readFileSync(join(__dirname, '../krx-session.ts'), 'utf8')
const SCRIPT_SRC = readFileSync(join(__dirname, '../../../scripts/league/krx-flows-backfill.ts'), 'utf8')
const MIGRATION_SRC = readFileSync(
  join(__dirname, '../../../supabase/migrations/20261003000002_league_krx_flows.sql'),
  'utf8',
)

const NET_FIXTURE = {
  ISU_SRT_CD: '005930',
  ISU_NM: '삼성전자',
  NETBID_TRDVOL: '-1,234,567',
  NETBID_TRDVAL: '8,900,000,000',
}

const SHORT_VOL_FIXTURE = {
  ISU_CD: '005930',
  CVSRTSELL_TRDVOL: '12,345',
  CVSRTSELL_TRDVAL: '3,400,000,000',
  TRDVOL_WT: '0.12',
}

const SHORT_BAL_FIXTURE = {
  ISU_CD: '005930',
  BAL_QTY: '5,489,240',
  BAL_AMT: '326,609,780,000',
  BAL_RTO: '0.09',
}

const FOREIGN_FIXTURE = {
  ISU_SRT_CD: '005930',
  FORN_SHR_RT: '55.53',
  FORN_LMT_EXHST_RT: '55.53',
}

function memoryIo(opts?: {
  present?: { KOSPI: boolean; KOSDAQ: boolean }
  jsonByBld?: Record<string, Record<string, unknown>[]>
}): {
  io: KrxFlowsIo
  upsertedFlows: KrxFlowRow[]
  upsertedShorts: KrxShortRow[]
  upsertedForeign: KrxForeignOwnRow[]
  updatedBalance: KrxShortRow[]
  posted: Record<string, string>[]
} {
  const upsertedFlows: KrxFlowRow[] = []
  const upsertedShorts: KrxShortRow[] = []
  const upsertedForeign: KrxForeignOwnRow[] = []
  const updatedBalance: KrxShortRow[] = []
  const posted: Record<string, string>[] = []
  const io: KrxFlowsIo = {
    session: {
      jsonPost: async (params) => {
        posted.push(params)
        const bld = params.bld
        return { ok: true, value: { output: opts?.jsonByBld?.[bld] ?? [], OutBlock_1: opts?.jsonByBld?.[bld] ?? [] } }
      },
    },
    flowsPresent: async () => opts?.present ?? { KOSPI: false, KOSDAQ: false },
    upsertFlows: async (rows) => {
      upsertedFlows.push(...rows)
    },
    upsertShorts: async (rows) => {
      upsertedShorts.push(...rows)
    },
    upsertForeign: async (rows) => {
      upsertedForeign.push(...rows)
    },
    updateShortBalance: async (rows) => {
      updatedBalance.push(...rows)
    },
  }
  return { io, upsertedFlows, upsertedShorts, upsertedForeign, updatedBalance, posted }
}

describe('korea-flows-data source contract', () => {
  it('is server-only, RLS-only, and never logs credentials', () => {
    expect(STORE_SRC).toContain("import 'server-only'")
    expect(SESSION_SRC).toContain("import 'server-only'")
    expect(SESSION_SRC).toContain('Never log KRX_ID')
    expect(SESSION_SRC).not.toContain('로그인 ID')
    expect(MIGRATION_SRC).toContain('league_krx_flows')
    expect(MIGRATION_SRC).toContain('league_krx_short')
    expect(MIGRATION_SRC).toContain('league_krx_foreign_own')
    expect(MIGRATION_SRC).toContain('enable row level security')
    expect(MIGRATION_SRC).not.toMatch(/create policy/i)
    expect(SCRIPT_SRC).toContain('const dryRun = !apply')
    expect(SCRIPT_SRC).toContain('--apply')
  })
})

describe('number parsing and fixtures', () => {
  it('parses commas and negatives', () => {
    expect(parseKrxSignedNumber('-1,234,567')).toBe(-1234567)
    expect(parseKrxSignedNumber('8,900,000,000')).toBe(8_900_000_000)
    expect(parseKrxSignedNumber('')).toBeNull()
    expect(mapNetPurchaseRow('KOSPI', 'foreign', '2026-10-02', NET_FIXTURE)).toMatchObject({
      code: '005930',
      netVolume: -1234567,
      netValue: 8_900_000_000,
    })
    expect(mapShortVolumeRow('KOSPI', '2026-10-02', SHORT_VOL_FIXTURE)?.shortVolume).toBe(12345)
    expect(mapShortBalanceRow('KOSPI', '2026-10-01', SHORT_BAL_FIXTURE)?.balanceQty).toBe(5489240)
    expect(mapForeignOwnRow('KOSPI', '2026-10-02', FOREIGN_FIXTURE)?.foreignHoldingRatio).toBe(55.53)
    expect(extractFlowRows({ output: [NET_FIXTURE] })).toHaveLength(1)
    expect(extractFlowRows({ OutBlock_1: [SHORT_VOL_FIXTURE] })).toHaveLength(1)
  })
})

describe('plan + T+2 math', () => {
  it('plans 16 POSTs/day with the pykrx bld codes and T+2 balance date', () => {
    expect(t2BalanceDate('2026-10-06')).toBe('2026-10-01')
    const calls = planKrxFlowsCalls('2026-10-06')
    expect(calls).toHaveLength(16)
    expect(KRX_FLOW_INVESTORS.map((i) => i.invstTpCd)).toEqual(['9000', '7050', '8000', '6000', '1000'])
    expect(calls.filter((c) => c.bld === KRX_BLD.netPurchases)).toHaveLength(10)
    expect(calls.filter((c) => c.bld === KRX_BLD.shortVolume)).toHaveLength(2)
    expect(calls.filter((c) => c.bld === KRX_BLD.foreignOwn)).toHaveLength(2)
    const bal = calls.filter((c) => c.bld === KRX_BLD.shortBalance)
    expect(bal).toHaveLength(2)
    expect(bal[0]?.params.trdDd).toBe('20261001')
    expect(bal[0]?.params.mktTpCd).toBe('1')
    expect(calls.find((c) => c.bld === KRX_BLD.shortVolume)?.params.inqCond).toBe('STMFRTSCIFDRFS')
  })
})

describe('ensureKrxFlowsDay', () => {
  it('skips holidays without posting', async () => {
    expect(isKrxTradingDay('2026-10-05')).toBe(false)
    const { io, posted, upsertedFlows } = memoryIo()
    await expect(ensureKrxFlowsDay('2026-10-05', io)).resolves.toMatchObject({
      ok: true,
      status: 'holiday',
    })
    expect(posted).toEqual([])
    expect(upsertedFlows).toEqual([])
  })

  it('does not cache emptiness on a trading day with empty fixtures', async () => {
    const { io, upsertedFlows, upsertedShorts, upsertedForeign, updatedBalance } = memoryIo({
      jsonByBld: {},
    })
    await expect(ensureKrxFlowsDay('2026-10-02', io)).resolves.toMatchObject({
      ok: true,
      status: 'not_published',
      t2Date: '2026-09-30',
    })
    expect(upsertedFlows).toEqual([])
    expect(upsertedShorts).toEqual([])
    expect(upsertedForeign).toEqual([])
    expect(updatedBalance).toEqual([])
  })

  it('upserts mapped rows and writes T+2 balance onto the earlier date', async () => {
    const { io, upsertedFlows, upsertedShorts, upsertedForeign, updatedBalance, posted } = memoryIo({
      jsonByBld: {
        [KRX_BLD.netPurchases]: [NET_FIXTURE],
        [KRX_BLD.shortVolume]: [SHORT_VOL_FIXTURE],
        [KRX_BLD.foreignOwn]: [FOREIGN_FIXTURE],
        [KRX_BLD.shortBalance]: [SHORT_BAL_FIXTURE],
      },
    })
    const result = await ensureKrxFlowsDay('2026-10-06', io)
    expect(result).toMatchObject({ ok: true, status: 'ok', t2Date: '2026-10-01' })
    expect(posted).toHaveLength(16)
    expect(upsertedFlows.some((r) => r.investor === 'foreign' && r.netVolume === -1234567)).toBe(true)
    expect(upsertedShorts[0]).toMatchObject({ date: '2026-10-06', shortVolume: 12345 })
    expect(upsertedForeign[0]?.foreignHoldingRatio).toBe(55.53)
    expect(updatedBalance[0]).toMatchObject({ date: '2026-10-01', balanceQty: 5489240 })
  })
})
