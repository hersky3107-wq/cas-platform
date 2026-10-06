import 'server-only'

/**
 * Same-day KRX 전종목 시세 from data.krx.co.kr (logged-in session).
 * Used only as a generate-time provisional close after 15:30 KST, until the
 * official OPEN API daily file is published the next morning.
 */

import { supabaseAdmin } from '@/lib/supabase/server'
import { isKrxTradingDay } from '@/lib/league/krx-calendar'
import {
  extractKrxRows,
  mapKrxTradeRow,
  toCompactBasDd,
  toIsoBasDd,
  type KrxDailyBar,
  type KrxMarket,
} from '@/lib/league/korea-market-data'
import {
  getKrxSession,
  type KrxSession,
  type KrxSessionErr,
  type KrxSessionFailReason,
} from '@/lib/league/krx-session'

const TABLE = 'league_krx_daily'

export const KRX_PORTAL_OHLCV_BLD = 'dbms/MDC/STAT/standard/MDCSTAT01501'
export const KRX_PORTAL_SOURCE = 'krx_data_portal'
export const KRX_PORTAL_RETRY_DELAYS_MS = [0, 2000, 5000] as const
export const KRX_PORTAL_COOLDOWN_MS = 30_000

const MARKETS: { market: KrxMarket; mktId: string }[] = [
  { market: 'KOSPI', mktId: 'STK' },
  { market: 'KOSDAQ', mktId: 'KSQ' },
]

export type EnsureKrxPortalDayResult = 'cached' | 'ok' | 'official' | 'holiday' | 'empty'
export type PortalCloseResult = number | 'unavailable' | 'empty' | 'holiday'

export type KrxPortalCall = {
  market: KrxMarket
  params: Record<string, string>
  label: string
}

export type KrxPortalIo = {
  session: Pick<KrxSession, 'jsonPost'>
  officialMarketsPresent: (isoDate: string) => Promise<{ KOSPI: boolean; KOSDAQ: boolean }>
  portalMarketsPresent: (isoDate: string) => Promise<{ KOSPI: boolean; KOSDAQ: boolean }>
  upsertProvisional: (rows: KrxDailyBar[]) => Promise<void>
  getRow: (market: KrxMarket, code: string, isoDate: string) => Promise<KrxDailyBar | null>
  now: () => Date
  sleep: (ms: number) => Promise<void>
  log: (level: 'warn' | 'error', message: string) => void
}

function defaultLog(level: 'warn' | 'error', message: string): void {
  const line = `[krx-portal] ${message}`
  if (level === 'error') console.error(line)
  else console.warn(line)
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function planKrxPortalCloseCalls(isoDate: string): KrxPortalCall[] {
  const compact = toCompactBasDd(isoDate)
  return MARKETS.map((m) => ({
    market: m.market,
    params: {
      bld: KRX_PORTAL_OHLCV_BLD,
      locale: 'ko_KR',
      mktId: m.mktId,
      trdDd: compact,
      share: '1',
      money: '1',
      csvxls_isNo: 'false',
    },
    label: `${isoDate} ${m.market} 전종목 시세`,
  }))
}

export function mapPortalCloseRows(
  market: KrxMarket,
  isoDate: string,
  json: unknown,
): KrxDailyBar[] {
  return extractKrxRows(json)
    .map((row) => mapKrxTradeRow(market, row, isoDate))
    .filter((row): row is KrxDailyBar => row !== null)
    .map((row) => ({ ...row, source: KRX_PORTAL_SOURCE, provisional: true }))
}

function bothPresent(present: { KOSPI: boolean; KOSDAQ: boolean }): boolean {
  return present.KOSPI && present.KOSDAQ
}

export async function fetchKrxPortalDay(
  basDd: string,
  session: Pick<KrxSession, 'jsonPost'>,
): Promise<{ ok: true; rows: KrxDailyBar[] } | KrxSessionErr | { ok: false; reason: 'empty' }> {
  const isoDate = toIsoBasDd(basDd)
  const rows: KrxDailyBar[] = []
  for (const call of planKrxPortalCloseCalls(isoDate)) {
    const posted = await session.jsonPost(call.params)
    if (!posted.ok) return posted
    rows.push(...mapPortalCloseRows(call.market, isoDate, posted.value))
  }
  if (rows.length === 0) return { ok: false, reason: 'empty' }
  return { ok: true, rows }
}

function isMissingColumnError(message: string, column: string): boolean {
  return message.toLowerCase().includes(column) && /does not exist|schema cache/i.test(message)
}

async function marketHasRows(
  isoDate: string,
  market: KrxMarket,
  provisional: boolean,
): Promise<boolean> {
  const query = supabaseAdmin
    .from(TABLE)
    .select('code')
    .eq('bas_dd', isoDate)
    .eq('market', market)
    .eq('provisional', provisional)
    .limit(1)
  const { data, error } = await query
  if (error) {
    if (isMissingColumnError(error.message, 'provisional')) {
      if (provisional) return false
      const fallback = await supabaseAdmin
        .from(TABLE)
        .select('code')
        .eq('bas_dd', isoDate)
        .eq('market', market)
        .limit(1)
      if (fallback.error) throw new Error(`league_krx_daily portal present: ${fallback.error.message}`)
      return (fallback.data?.length ?? 0) > 0
    }
    throw new Error(`league_krx_daily portal present: ${error.message}`)
  }
  return (data?.length ?? 0) > 0
}

async function defaultOfficialMarketsPresent(
  isoDate: string,
): Promise<{ KOSPI: boolean; KOSDAQ: boolean }> {
  const [KOSPI, KOSDAQ] = await Promise.all([
    marketHasRows(isoDate, 'KOSPI', false),
    marketHasRows(isoDate, 'KOSDAQ', false),
  ])
  return { KOSPI, KOSDAQ }
}

async function defaultPortalMarketsPresent(
  isoDate: string,
): Promise<{ KOSPI: boolean; KOSDAQ: boolean }> {
  const [KOSPI, KOSDAQ] = await Promise.all([
    marketHasRows(isoDate, 'KOSPI', true),
    marketHasRows(isoDate, 'KOSDAQ', true),
  ])
  return { KOSPI, KOSDAQ }
}

function toProvisionalDbRow(row: KrxDailyBar) {
  return {
    bas_dd: row.date,
    market: row.market,
    code: row.code,
    name: row.name,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    trdval: row.trdval,
    mktcap: row.mktcap,
    source: KRX_PORTAL_SOURCE,
    provisional: true,
  }
}

async function defaultGetRow(
  market: KrxMarket,
  code: string,
  isoDate: string,
): Promise<KrxDailyBar | null> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('bas_dd, market, code, name, open, high, low, close, volume, trdval, mktcap, source, provisional')
    .eq('bas_dd', isoDate)
    .eq('market', market)
    .eq('code', code)
    .maybeSingle()
  if (error) {
    if (isMissingColumnError(error.message, 'source') || isMissingColumnError(error.message, 'provisional')) {
      return null
    }
    throw new Error(`league_krx_daily portal getRow: ${error.message}`)
  }
  if (!data || data.close == null) return null
  const mkt = data.market === 'KOSDAQ' ? 'KOSDAQ' : data.market === 'KOSPI' ? 'KOSPI' : null
  if (!mkt) return null
  return {
    date: String(data.bas_dd).slice(0, 10),
    market: mkt,
    code: String(data.code),
    name: data.name != null ? String(data.name) : null,
    open: data.open == null ? null : Number(data.open),
    high: data.high == null ? null : Number(data.high),
    low: data.low == null ? null : Number(data.low),
    close: Number(data.close),
    volume: data.volume == null ? null : Number(data.volume),
    trdval: data.trdval == null ? null : Number(data.trdval),
    mktcap: data.mktcap == null ? null : Number(data.mktcap),
    source: typeof data.source === 'string' ? data.source : undefined,
    provisional: data.provisional === true,
  }
}

async function defaultUpsertProvisional(rows: KrxDailyBar[]): Promise<void> {
  if (rows.length === 0) return
  const isoDate = rows[0]!.date
  const { data: official, error: officialError } = await supabaseAdmin
    .from(TABLE)
    .select('market, code')
    .eq('bas_dd', isoDate)
    .eq('provisional', false)
  if (officialError && !isMissingColumnError(officialError.message, 'provisional')) {
    throw new Error(`league_krx_daily portal official filter: ${officialError.message}`)
  }
  const skip = new Set(
    (official ?? []).map((row) => `${String(row.market)}|${String(row.code)}`),
  )
  const write = rows
    .filter((row) => !skip.has(`${row.market}|${row.code}`))
    .map(toProvisionalDbRow)
  if (write.length === 0) return
  const { error } = await supabaseAdmin.from(TABLE).upsert(write, { onConflict: 'bas_dd,market,code' })
  if (error) {
    if (isMissingColumnError(error.message, 'source') || isMissingColumnError(error.message, 'provisional')) {
      defaultLog('warn', 'provisional columns missing — portal close not persisted to league_krx_daily')
      return
    }
    throw new Error(`league_krx_daily portal upsert: ${error.message}`)
  }
}

function resolveIo(io?: Partial<KrxPortalIo>): KrxPortalIo {
  return {
    session: io?.session ?? getKrxSession(),
    officialMarketsPresent: io?.officialMarketsPresent ?? defaultOfficialMarketsPresent,
    portalMarketsPresent: io?.portalMarketsPresent ?? defaultPortalMarketsPresent,
    upsertProvisional: io?.upsertProvisional ?? defaultUpsertProvisional,
    getRow: io?.getRow ?? defaultGetRow,
    now: io?.now ?? (() => new Date()),
    sleep: io?.sleep ?? defaultSleep,
    log: io?.log ?? defaultLog,
  }
}

const ensureLocks = new Map<string, Promise<EnsureKrxPortalDayResult | KrxSessionErr>>()
const ensureLocksByIo = new WeakMap<object, Map<string, Promise<EnsureKrxPortalDayResult | KrxSessionErr>>>()

type PortalFailState = { at: number; reason: KrxSessionFailReason }
const failStateByIo = new WeakMap<object, PortalFailState>()
let defaultFailState: PortalFailState | null = null

function lockBucket(
  io?: Partial<KrxPortalIo>,
): Map<string, Promise<EnsureKrxPortalDayResult | KrxSessionErr>> {
  if (!io) return ensureLocks
  const existing = ensureLocksByIo.get(io)
  if (existing) return existing
  const created = new Map<string, Promise<EnsureKrxPortalDayResult | KrxSessionErr>>()
  ensureLocksByIo.set(io, created)
  return created
}

function readFail(io?: Partial<KrxPortalIo>): PortalFailState | null {
  return io ? (failStateByIo.get(io) ?? null) : defaultFailState
}

function writeFail(io: Partial<KrxPortalIo> | undefined, state: PortalFailState | null): void {
  if (!io) {
    defaultFailState = state
    return
  }
  if (state) failStateByIo.set(io, state)
  else failStateByIo.delete(io)
}

function failReasonMessage(reason: KrxSessionFailReason): string {
  if (reason === 'missing_credentials') return 'KRX data portal login failed: credentials not set'
  if (reason === 'password_change_required') return 'KRX data portal login failed: password change required'
  if (reason === 'auth_expired') return 'KRX data portal session expired'
  if (reason === 'http_error') return 'KRX data portal request failed'
  return 'KRX data portal login failed'
}

async function fetchWithBackoff(
  isoDate: string,
  deps: KrxPortalIo,
): Promise<{ ok: true; rows: KrxDailyBar[] } | KrxSessionErr | { ok: false; reason: 'empty' }> {
  let last: { ok: true; rows: KrxDailyBar[] } | KrxSessionErr | { ok: false; reason: 'empty' } = {
    ok: false,
    reason: 'empty',
  }
  for (let i = 0; i < KRX_PORTAL_RETRY_DELAYS_MS.length; i++) {
    const delay = KRX_PORTAL_RETRY_DELAYS_MS[i]!
    if (delay > 0) await deps.sleep(delay)
    last = await fetchKrxPortalDay(isoDate, deps.session)
    if (last.ok) return last
    if (last.reason === 'empty') return last
    deps.log('warn', `${failReasonMessage(last.reason)} (retry ${i + 1}/${KRX_PORTAL_RETRY_DELAYS_MS.length})`)
  }
  return last
}

async function ensureKrxPortalDayUnlocked(
  isoDate: string,
  deps: KrxPortalIo,
  io?: Partial<KrxPortalIo>,
): Promise<EnsureKrxPortalDayResult | KrxSessionErr> {
  if (!isKrxTradingDay(isoDate)) return 'holiday'
  if (bothPresent(await deps.officialMarketsPresent(isoDate))) return 'official'
  if (bothPresent(await deps.portalMarketsPresent(isoDate))) return 'cached'
  const failed = readFail(io)
  if (failed && deps.now().getTime() - failed.at < KRX_PORTAL_COOLDOWN_MS) {
    return { ok: false, reason: failed.reason }
  }
  const fetched = await fetchWithBackoff(isoDate, deps)
  if (!fetched.ok) {
    if (fetched.reason === 'empty') return 'empty'
    writeFail(io, { at: deps.now().getTime(), reason: fetched.reason })
    deps.log('error', failReasonMessage(fetched.reason))
    return fetched
  }
  writeFail(io, null)
  await deps.upsertProvisional(fetched.rows)
  return 'ok'
}

export async function ensureKrxPortalDay(
  basDd: string,
  io?: Partial<KrxPortalIo>,
): Promise<EnsureKrxPortalDayResult | KrxSessionErr> {
  const deps = resolveIo(io)
  const isoDate = toIsoBasDd(basDd)
  const locks = lockBucket(io)
  const hit = locks.get(isoDate)
  if (hit) return hit
  const pending = ensureKrxPortalDayUnlocked(isoDate, deps, io).finally(() => {
    if (locks.get(isoDate) === pending) locks.delete(isoDate)
  })
  locks.set(isoDate, pending)
  return pending
}

export function isPortalBar(row: KrxDailyBar | null | undefined): row is KrxDailyBar {
  return Boolean(row && (row.provisional === true || row.source === KRX_PORTAL_SOURCE))
}

export async function getPortalClose(
  market: KrxMarket,
  code: string,
  basDd: string,
  io?: Partial<KrxPortalIo>,
): Promise<PortalCloseResult> {
  const deps = resolveIo(io)
  const isoDate = toIsoBasDd(basDd)
  if (!isKrxTradingDay(isoDate)) return 'holiday'
  const ensured = await ensureKrxPortalDay(isoDate, io)
  if (ensured === 'holiday') return 'holiday'
  if (typeof ensured === 'object' && ensured.ok === false) return 'unavailable'
  if (ensured === 'empty') return 'empty'
  const row = await deps.getRow(market, code, isoDate)
  if (!isPortalBar(row)) return 'empty'
  if (!Number.isFinite(row.close) || row.close <= 0) return 'empty'
  return row.close
}

export function resetKrxPortalState(): void {
  ensureLocks.clear()
  defaultFailState = null
}
