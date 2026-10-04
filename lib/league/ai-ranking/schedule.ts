/**
 * Idempotent AIRANK brand_table round opener. Cron calls this every minute;
 * slots only exist after Monday 09:00 KST (1w) / the 1st 09:00 KST (1m).
 */
import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import { ensureLeagueRound } from '@/lib/league/orchestrator'
import { buildAirankRankedRoundInput } from './resolve'
import { planAirankTableSlots, type BrandTableSlot } from './brand-table'

export type AirankTableEnsureReport = {
  due: number
  created: number
  existing: number
  errors: string[]
}

export async function ensureAirankTableRounds(
  now: Date = new Date(),
): Promise<AirankTableEnsureReport> {
  const slots = planAirankTableSlots(now)
  const report: AirankTableEnsureReport = { due: slots.length, created: 0, existing: 0, errors: [] }
  for (const slot of slots) {
    try {
      const existed = await cacheKeyExists(slot.cacheKey)
      if (existed) {
        report.existing += 1
        continue
      }
      const input = buildAirankRankedRoundInput(slot.instrument, slot.horizon, now, 'ko')
      if (!input) {
        report.errors.push(`compose_failed:${slot.instrument}`)
        continue
      }
      const ensured = await ensureLeagueRound(input)
      if (ensured.created) report.created += 1
      else report.existing += 1
    } catch (e) {
      report.errors.push(`${slot.cacheKey}:${e instanceof Error ? e.message : 'error'}`)
    }
  }
  return report
}

async function cacheKeyExists(cacheKey: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id')
    .eq('cache_key', cacheKey)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return Boolean(data?.id)
}

export function slotCacheKeys(slots: readonly BrandTableSlot[]): string[] {
  return slots.map((s) => s.cacheKey)
}
