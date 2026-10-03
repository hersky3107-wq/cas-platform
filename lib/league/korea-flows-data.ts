import 'server-only'

/**
 * KRX investor flows / short / foreign ownership store.
 * Never expose this module's raw data to client components or API responses.
 * Emptiness is never cached.
 */

import { supabaseAdmin } from '@/lib/supabase/server'
import { isKrxTradingDay, previousKrxSessionDate } from '@/lib/league/krx-calendar'
import {
  getKrxSession,
  type KrxSession,
  type KrxSessionErr,
  type KrxSessionFailReason,
} from '@/lib/league/krx-session'

const FLOWS_TABLE = 'league_krx_flows'
const SHORT_TABLE = 'league_krx_short'
const FOREIGN_TABLE = 'league_krx_foreign_own'

export const KRX_FLOW_INVESTORS = [
  { invstTpCd: '9000', investor: 'foreign' },
  { invstTpCd: '7050', investor: 'institution' },
  { invstTpCd: '8000', investor: 'individual' },
  { invstTpCd: '6000', investor: 'pension' },
  { invstTpCd: '1000', investor: 'financial_investment' },
] as const

export type KrxFlowInvestor = (typeof KRX_FLOW_INVESTORS)[number]['investor']
export type KrxFlowMarket = 'KOSPI' | 'KOSDAQ'

const MARKETS = [
  { market: 'KOSPI' as const, mktId: 'STK', mktTpCd: '1' },
  { market: 'KOSDAQ' as const, mktId: 'KSQ', mktTpCd: '2' },
]

export const KRX_BLD = {
  netPurchases: 'dbms/MDC/STAT/standard/MDCSTAT02401',
  shortVolume: 'dbms/MDC/STAT/srt/MDCSTAT30101',
  shortBalance: 'dbms/MDC/STAT/srt/MDCSTAT30501',
  foreignOwn: 'dbms/MDC/STAT/standard/MDCSTAT03701',
} as const

export type KrxFlowRow = {
  date: string
  market: KrxFlowMarket
  code: string
  investor: KrxFlowInvestor
  netVolume: number | null
  netValue: number | null
}

export type KrxShortRow = {
  date: string
  market: KrxFlowMarket
  code: string
  shortVolume: number | null
  shortValue: number | null
  shortRatio: number | null
  balanceQty: number | null
  balanceValue: number | null
  balanceRatio: number | null
}

export type KrxForeignOwnRow = {
  date: string
  market: KrxFlowMarket
  code: string
  foreignHoldingRatio: number | null
  limitExhaustionRatio: number | null
}

export type EnsureKrxFlowsStatus = 'cached' | 'ok' | 'holiday' | 'not_published'
export type EnsureKrxFlowsResult =
  | { ok: true; status: EnsureKrxFlowsStatus; t2Date: string | null }
  | { ok: false; reason: KrxSessionFailReason }

export type KrxFlowsFetchBundle = {
  flows: KrxFlowRow[]
  shorts: KrxShortRow[]
  foreign: KrxForeignOwnRow[]
  balance: KrxShortRow[]
  t2Date: string | null
}

export type KrxPlannedCall = {
  bld: string
  params: Record<string, string>
  label: string
}

export type KrxFlowsIo = {
  session: Pick<KrxSession, 'jsonPost'>
  flowsPresent: (isoDate: string) => Promise<{ KOSPI: boolean; KOSDAQ: boolean }>
  upsertFlows: (rows: KrxFlowRow[]) => Promise<void>
  upsertShorts: (rows: KrxShortRow[]) => Promise<void>
  upsertForeign: (rows: KrxForeignOwnRow[]) => Promise<void>
  updateShortBalance: (rows: KrxShortRow[]) => Promise<void>
}

export function parseKrxSignedNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}

export function toCompactBasDd(isoOrCompact: string): string {
  const digits = isoOrCompact.replace(/-/g, '').trim()
  if (!/^\d{8}$/.test(digits)) throw new Error(`invalid KRX basDd: ${isoOrCompact}`)
  return digits
}

export function toIsoBasDd(isoOrCompact: string): string {
  const compact = toCompactBasDd(isoOrCompact)
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
}

export function extractFlowRows(json: unknown): Record<string, unknown>[] {
  if (!json || typeof json !== 'object') return []
  const rec = json as Record<string, unknown>
  if (Array.isArray(rec.output)) return rec.output as Record<string, unknown>[]
  if (Array.isArray(rec.OutBlock_1)) return rec.OutBlock_1 as Record<string, unknown>[]
  if (Array.isArray(rec.outBlock_1)) return rec.outBlock_1 as Record<string, unknown>[]
  return []
}

function sixDigitCode(row: Record<string, unknown>): string | null {
  const srt = String(row.ISU_SRT_CD ?? row.isuSrtCd ?? '').trim().toUpperCase()
  if (/^[0-9A-Z]{6}$/.test(srt)) return srt
  const cd = String(row.ISU_CD ?? row.isuCd ?? '').trim().toUpperCase()
  if (/^[0-9A-Z]{6}$/.test(cd)) return cd
  if (/^KR[0-9A-Z][0-9A-Z]{6}[0-9A-Z]{3}$/.test(cd)) return cd.slice(3, 9)
  return null
}

export function t2BalanceDate(isoDate: string): string {
  return previousKrxSessionDate(isoDate, 2)
}

export function planKrxFlowsCalls(isoDate: string): KrxPlannedCall[] {
  const compact = toCompactBasDd(isoDate)
  const t2 = toCompactBasDd(t2BalanceDate(isoDate))
  const calls: KrxPlannedCall[] = []
  for (const m of MARKETS) {
    for (const inv of KRX_FLOW_INVESTORS) {
      calls.push({
        bld: KRX_BLD.netPurchases,
        params: { strtDd: compact, endDd: compact, mktId: m.mktId, invstTpCd: inv.invstTpCd },
        label: `${isoDate} ${m.market} net ${inv.investor}`,
      })
    }
    calls.push({
      bld: KRX_BLD.shortVolume,
      params: { trdDd: compact, mktId: m.mktId, inqCond: 'STMFRTSCIFDRFS' },
      label: `${isoDate} ${m.market} short volume`,
    })
    calls.push({
      bld: KRX_BLD.foreignOwn,
      params: { searchType: '1', mktId: m.mktId, trdDd: compact, isuLmtRto: '0' },
      label: `${isoDate} ${m.market} foreign own`,
    })
    calls.push({
      bld: KRX_BLD.shortBalance,
      params: { trdDd: t2, mktTpCd: m.mktTpCd },
      label: `${isoDate} ${m.market} short balance T+2 ${toIsoBasDd(t2)}`,
    })
  }
  return calls.map((call) => ({ ...call, params: { bld: call.bld, ...call.params } }))
}

export function mapNetPurchaseRow(
  market: KrxFlowMarket,
  investor: KrxFlowInvestor,
  isoDate: string,
  row: Record<string, unknown>,
): KrxFlowRow | null {
  const code = sixDigitCode(row)
  if (!code) return null
  return {
    date: isoDate,
    market,
    code,
    investor,
    netVolume: parseKrxSignedNumber(row.NETBID_TRDVOL ?? row.netbidTrdvol),
    netValue: parseKrxSignedNumber(row.NETBID_TRDVAL ?? row.netbidTrdval),
  }
}

export function mapShortVolumeRow(
  market: KrxFlowMarket,
  isoDate: string,
  row: Record<string, unknown>,
): KrxShortRow | null {
  const code = sixDigitCode(row)
  if (!code) return null
  return {
    date: isoDate,
    market,
    code,
    shortVolume: parseKrxSignedNumber(row.CVSRTSELL_TRDVOL),
    shortValue: parseKrxSignedNumber(row.CVSRTSELL_TRDVAL),
    shortRatio: parseKrxSignedNumber(row.TRDVOL_WT),
    balanceQty: null,
    balanceValue: null,
    balanceRatio: null,
  }
}

export function mapShortBalanceRow(
  market: KrxFlowMarket,
  isoDate: string,
  row: Record<string, unknown>,
): KrxShortRow | null {
  const code = sixDigitCode(row)
  if (!code) return null
  return {
    date: isoDate,
    market,
    code,
    shortVolume: null,
    shortValue: null,
    shortRatio: null,
    balanceQty: parseKrxSignedNumber(row.BAL_QTY),
    balanceValue: parseKrxSignedNumber(row.BAL_AMT),
    balanceRatio: parseKrxSignedNumber(row.BAL_RTO),
  }
}

export function mapForeignOwnRow(
  market: KrxFlowMarket,
  isoDate: string,
  row: Record<string, unknown>,
): KrxForeignOwnRow | null {
  const code = sixDigitCode(row)
  if (!code) return null
  return {
    date: isoDate,
    market,
    code,
    foreignHoldingRatio: parseKrxSignedNumber(row.FORN_SHR_RT),
    limitExhaustionRatio: parseKrxSignedNumber(row.FORN_LMT_EXHST_RT),
  }
}

async function jsonRows(
  session: Pick<KrxSession, 'jsonPost'>,
  params: Record<string, string>,
): Promise<{ ok: true; rows: Record<string, unknown>[] } | KrxSessionErr> {
  const posted = await session.jsonPost(params)
  if (!posted.ok) return posted
  return { ok: true, rows: extractFlowRows(posted.value) }
}

async function fetchMapped(
  session: Pick<KrxSession, 'jsonPost'>,
  calls: KrxPlannedCall[],
  onRows: (call: KrxPlannedCall, rows: Record<string, unknown>[]) => void,
): Promise<{ ok: true } | KrxSessionErr> {
  for (const call of calls) {
    const got = await jsonRows(session, call.params)
    if (!got.ok) return got
    onRows(call, got.rows)
  }
  return { ok: true }
}

function marketFromLabel(label: string): KrxFlowMarket {
  return label.includes('KOSDAQ') ? 'KOSDAQ' : 'KOSPI'
}

export async function fetchKrxFlowsDay(
  basDd: string,
  session: Pick<KrxSession, 'jsonPost'> = getKrxSession(),
): Promise<{ ok: true; bundle: KrxFlowsFetchBundle } | KrxSessionErr> {
  const isoDate = toIsoBasDd(basDd)
  const t2 = t2BalanceDate(isoDate)
  const flows: KrxFlowRow[] = []
  const shorts: KrxShortRow[] = []
  const foreign: KrxForeignOwnRow[] = []
  const balance: KrxShortRow[] = []

  const mapped = await fetchMapped(session, planKrxFlowsCalls(isoDate), (call, rows) => {
    const market = marketFromLabel(call.label)
    if (call.bld === KRX_BLD.netPurchases) {
      const inv = KRX_FLOW_INVESTORS.find((i) => i.invstTpCd === call.params.invstTpCd)
      if (!inv) return
      for (const row of rows) {
        const mappedRow = mapNetPurchaseRow(market, inv.investor, isoDate, row)
        if (mappedRow) flows.push(mappedRow)
      }
    } else if (call.bld === KRX_BLD.shortVolume) {
      for (const row of rows) {
        const mappedRow = mapShortVolumeRow(market, isoDate, row)
        if (mappedRow) shorts.push(mappedRow)
      }
    } else if (call.bld === KRX_BLD.foreignOwn) {
      for (const row of rows) {
        const mappedRow = mapForeignOwnRow(market, isoDate, row)
        if (mappedRow) foreign.push(mappedRow)
      }
    } else if (call.bld === KRX_BLD.shortBalance) {
      for (const row of rows) {
        const mappedRow = mapShortBalanceRow(market, t2, row)
        if (mappedRow) balance.push(mappedRow)
      }
    }
  })
  if (!mapped.ok) return mapped
  return { ok: true, bundle: { flows, shorts, foreign, balance, t2Date: t2 } }
}

async function chunkedUpsert(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
): Promise<void> {
  const size = 500
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size)
    const { error } = await supabaseAdmin.from(table).upsert(chunk, { onConflict })
    if (error) throw new Error(`${table} upsert: ${error.message}`)
  }
}

async function defaultFlowsPresent(isoDate: string): Promise<{ KOSPI: boolean; KOSDAQ: boolean }> {
  const { data, error } = await supabaseAdmin.from(FLOWS_TABLE).select('market').eq('bas_dd', isoDate)
  if (error) throw new Error(`league_krx_flows present: ${error.message}`)
  const present = { KOSPI: false, KOSDAQ: false }
  for (const row of data ?? []) {
    if (row.market === 'KOSPI') present.KOSPI = true
    if (row.market === 'KOSDAQ') present.KOSDAQ = true
  }
  return present
}

async function defaultUpsertFlows(rows: KrxFlowRow[]): Promise<void> {
  await chunkedUpsert(
    FLOWS_TABLE,
    rows.map((r) => ({
      bas_dd: r.date,
      market: r.market,
      code: r.code,
      investor: r.investor,
      net_volume: r.netVolume,
      net_value: r.netValue,
    })),
    'bas_dd,market,code,investor',
  )
}

async function defaultUpsertShorts(rows: KrxShortRow[]): Promise<void> {
  await chunkedUpsert(
    SHORT_TABLE,
    rows.map((r) => ({
      bas_dd: r.date,
      market: r.market,
      code: r.code,
      short_volume: r.shortVolume,
      short_value: r.shortValue,
      short_ratio: r.shortRatio,
      balance_qty: r.balanceQty,
      balance_value: r.balanceValue,
      balance_ratio: r.balanceRatio,
    })),
    'bas_dd,market,code',
  )
}

async function defaultUpsertForeign(rows: KrxForeignOwnRow[]): Promise<void> {
  await chunkedUpsert(
    FOREIGN_TABLE,
    rows.map((r) => ({
      bas_dd: r.date,
      market: r.market,
      code: r.code,
      foreign_holding_ratio: r.foreignHoldingRatio,
      limit_exhaustion_ratio: r.limitExhaustionRatio,
    })),
    'bas_dd,market,code',
  )
}

async function defaultUpdateShortBalance(rows: KrxShortRow[]): Promise<void> {
  if (rows.length === 0) return
  const { data, error } = await supabaseAdmin
    .from(SHORT_TABLE)
    .select('bas_dd, market, code, short_volume, short_value, short_ratio')
    .eq('bas_dd', rows[0]!.date)
  if (error) throw new Error(`league_krx_short balance select: ${error.message}`)
  const existing = new Map(
    (data ?? []).map((r) => [`${r.market}|${r.code}`, r] as const),
  )
  const merged: Record<string, unknown>[] = rows.map((r) => {
    const prev = existing.get(`${r.market}|${r.code}`)
    return {
      bas_dd: r.date,
      market: r.market,
      code: r.code,
      short_volume: prev?.short_volume ?? null,
      short_value: prev?.short_value ?? null,
      short_ratio: prev?.short_ratio ?? null,
      balance_qty: r.balanceQty,
      balance_value: r.balanceValue,
      balance_ratio: r.balanceRatio,
    }
  })
  await chunkedUpsert(SHORT_TABLE, merged, 'bas_dd,market,code')
}

function resolveIo(io?: Partial<KrxFlowsIo>): KrxFlowsIo {
  return {
    session: io?.session ?? getKrxSession(),
    flowsPresent: io?.flowsPresent ?? defaultFlowsPresent,
    upsertFlows: io?.upsertFlows ?? defaultUpsertFlows,
    upsertShorts: io?.upsertShorts ?? defaultUpsertShorts,
    upsertForeign: io?.upsertForeign ?? defaultUpsertForeign,
    updateShortBalance: io?.updateShortBalance ?? defaultUpdateShortBalance,
  }
}

export async function ensureKrxFlowsDay(
  basDd: string,
  io?: Partial<KrxFlowsIo>,
): Promise<EnsureKrxFlowsResult> {
  const deps = resolveIo(io)
  const isoDate = toIsoBasDd(basDd)
  const t2 = t2BalanceDate(isoDate)
  if (!isKrxTradingDay(isoDate)) {
    return { ok: true, status: 'holiday', t2Date: t2 }
  }
  const present = await deps.flowsPresent(isoDate)
  if (present.KOSPI && present.KOSDAQ) {
    const balance: KrxShortRow[] = []
    const balanceCalls = planKrxFlowsCalls(isoDate).filter((c) => c.bld === KRX_BLD.shortBalance)
    const mapped = await fetchMapped(deps.session, balanceCalls, (call, rows) => {
      const market = marketFromLabel(call.label)
      for (const row of rows) {
        const mappedRow = mapShortBalanceRow(market, t2, row)
        if (mappedRow) balance.push(mappedRow)
      }
    })
    if (!mapped.ok) return mapped
    await deps.updateShortBalance(balance)
    return { ok: true, status: 'cached', t2Date: t2 }
  }
  const fetched = await fetchKrxFlowsDay(isoDate, deps.session)
  if (!fetched.ok) return fetched
  const { flows, shorts, foreign, balance } = fetched.bundle
  if (flows.length === 0 && shorts.length === 0 && foreign.length === 0) {
    if (balance.length > 0) await deps.updateShortBalance(balance)
    return { ok: true, status: 'not_published', t2Date: t2 }
  }
  await deps.upsertFlows(flows)
  await deps.upsertShorts(shorts)
  await deps.upsertForeign(foreign)
  await deps.updateShortBalance(balance)
  return { ok: true, status: 'ok', t2Date: t2 }
}
