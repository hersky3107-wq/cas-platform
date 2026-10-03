import 'server-only'

/**
 * Live evening refresh. ensureKrxFlowsDay / ensureKrxDay go through
 * getKrxSession, which keeps KRX_MIN_REQUEST_GAP_MS. This file does not
 * call fetch itself. A stored day does not call ensureKrxFlowsDay, because
 * that function's cached path still requests short balance.
 * If the refresh-log table is missing, the run skips and does not hit KRX.
 */

import { supabaseAdmin } from '@/lib/supabase/server'
import { ensureKrxFlowsDay } from './korea-flows-data'
import { ensureKrxDay } from './korea-market-data'
import {
  KRX_DAILY_REFRESH,
  runKrxDailyRefresh,
  type KrxDailyRefreshIo,
  type KrxDailyRefreshResult,
  type KrxRefreshLog,
} from './krx-daily-refresh'

const LOG_TABLE = 'league_krx_refresh_log'

async function marketHas(table: string, date: string, market: 'KOSPI' | 'KOSDAQ'): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from(table)
    .select('code')
    .eq('bas_dd', date)
    .eq('market', market)
    .limit(1)
  if (error) throw new Error('krx refresh presence read failed')
  return (data?.length ?? 0) > 0
}

async function bothMarkets(table: string, date: string): Promise<boolean> {
  const [kospi, kosdaq] = await Promise.all([
    marketHas(table, date, 'KOSPI'),
    marketHas(table, date, 'KOSDAQ'),
  ])
  return kospi && kosdaq
}

function liveIo(): KrxDailyRefreshIo {
  return {
    async readLog(date: string): Promise<KrxRefreshLog> {
      const { data, error } = await supabaseAdmin
        .from(LOG_TABLE)
        .select('bas_dd,last_attempt_at,published')
        .eq('bas_dd', date)
        .maybeSingle()
      if (error) throw new Error('krx refresh log read failed')
      if (!data) return null
      return {
        date: String(data.bas_dd).slice(0, 10),
        lastAttemptMs: new Date(String(data.last_attempt_at)).getTime(),
        published: Boolean(data.published),
      }
    },
    async stored(date: string) {
      const [flows, daily] = await Promise.all([
        bothMarkets('league_krx_flows', date),
        bothMarkets('league_krx_daily', date),
      ])
      return { flows, daily }
    },
    async claimAttempt(date: string, atMs: number): Promise<boolean> {
      const at = new Date(atMs).toISOString()
      const inserted = await supabaseAdmin
        .from(LOG_TABLE)
        .insert({ bas_dd: date, last_attempt_at: at, published: false })
        .select('bas_dd')
      if (!inserted.error) return true
      const cutoff = new Date(atMs - KRX_DAILY_REFRESH.retryMs).toISOString()
      const updated = await supabaseAdmin
        .from(LOG_TABLE)
        .update({ last_attempt_at: at })
        .eq('bas_dd', date)
        .eq('published', false)
        .lt('last_attempt_at', cutoff)
        .select('bas_dd')
      if (updated.error) throw new Error('krx refresh claim failed')
      return (updated.data?.length ?? 0) > 0
    },
    async markPublished(date: string, atMs: number) {
      const { error } = await supabaseAdmin.from(LOG_TABLE).upsert(
        { bas_dd: date, last_attempt_at: new Date(atMs).toISOString(), published: true },
        { onConflict: 'bas_dd' },
      )
      if (error) throw new Error('krx refresh publish failed')
    },
    async ensureFlows(date: string) {
      const result = await ensureKrxFlowsDay(date)
      if (!result.ok) {
        console.log(`[league-generate] krx-daily-refresh flows reason=${result.reason}`)
      }
    },
    async ensureDaily(date: string) {
      await ensureKrxDay(date)
    },
  }
}

let loggedRefreshFailure = false

export async function refreshKrxDailyData(now = new Date()): Promise<KrxDailyRefreshResult> {
  try {
    return await runKrxDailyRefresh(now, liveIo())
  } catch {
    if (!loggedRefreshFailure) {
      loggedRefreshFailure = true
      console.log('[league-generate] krx-daily-refresh skipped reason=log_unavailable')
    }
    return { action: 'skip', reason: 'log_unavailable', flowRequests: 0 }
  }
}
